import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { ActionDock } from '../components/ActionDock';
import { Header } from '../components/Header';
import { PrimaryButton } from '../components/PrimaryButton';
import { SyncBanner } from '../components/SyncBanner';
import { hub } from '../lib/client';
import { useOnline } from '../lib/net';
import { session } from '../lib/session';
import { detectLang, t } from '../lib/strings';
import { color, radius, space, type } from '../lib/theme';

type Phase = 'idle' | 'sending' | 'sent' | 'error';
type VerifyResult = Awaited<ReturnType<typeof hub.verify>>;

// Module-level deduplication so a deep-link remount never redeems a one-time token twice or drops
// the session if the first LoginScreen instance unmounts before hub.verify resolves.
const verifications = new Map<string, Promise<VerifyResult>>();

function verifyOnce(token: string): Promise<VerifyResult> {
  const existing = verifications.get(token);
  if (existing) return existing;
  const pending = hub.verify(token).then((r) => {
    if (r.ok) {
      session.set({ session: r.value.session, expiresAt: r.value.expiresAt, customerId: r.value.customerId });
    }
    return r;
  });
  verifications.set(token, pending);
  return pending;
}

function parseUrlToken(url: string | null | undefined): string {
  if (!url) return '';
  const hashIdx = url.indexOf('#token=');
  if (hashIdx !== -1) return decodeURIComponent(url.slice(hashIdx + '#token='.length).split('&')[0] ?? '');
  const queryIdx = url.indexOf('?token=');
  if (queryIdx !== -1) return decodeURIComponent((url.slice(queryIdx + '?token='.length).split('&')[0] ?? '').split('#')[0] ?? '');
  return '';
}

/**
 * The magic-link screen (M5 design §1). One email, one button. The hub always answers 202, so
 * the sent panel is deliberately the same whether or not the address was invited.
 *
 * A link landing on /login#token=… is verified once: the fragment is removed before the call so
 * the token stays out of history, and the guard in _layout.tsx moves to ?next= (or /) once the
 * session exists.
 */
export default function LoginScreen() {
  const lang = detectLang();
  const params = useLocalSearchParams<{ token?: string | string[]; next?: string | string[] }>();
  const routeToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const online = useOnline();

  const [email, setEmail] = useState('');
  const [focused, setFocused] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const emailRef = useRef<ComponentRef<typeof TextInput>>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const runVerify = useCallback(
    (token: string) => {
      if (!token) return;
      setVerifying(true);
      void verifyOnce(token).then((r) => {
        if (!aliveRef.current) return;
        setVerifying(false);
        if (r.ok) return; // verifyOnce already called session.set(); Guard redirects to ?next= or /
        setPhase('error');
        setMessage(
          r.error.kind === 'denied' && r.error.error === 'bad-link'
            ? t(lang, 'login.invalidLink')
            : r.error.kind === 'offline'
              ? t(lang, 'login.offline')
              : t(lang, 'login.serviceDown'),
        );
      });
    },
    // lang only affects the error sentence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (routeToken) runVerify(routeToken);
  }, [routeToken, runVerify]);

  useEffect(() => {
    const handleUrl = (url: string | null | undefined) => {
      const token = parseUrlToken(url);
      if (token) runVerify(token);
    };

    void Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => {
      sub.remove();
    };
  }, [runVerify]);

  const submit = async () => {
    if (phase === 'sending' || verifying) return;
    const address = email.trim();
    if (!address) {
      emailRef.current?.focus();
      return;
    }
    setPhase('sending');
    setMessage(null);
    const r = await hub.requestLink(address);
    if (r.ok) {
      setPhase('sent');
      setMessage(t(lang, 'login.sent'));
      return;
    }
    setPhase('error');
    setMessage(r.error.kind === 'offline' ? t(lang, 'login.offline') : t(lang, 'login.serviceDown'));
  };

  return (
    <View style={styles.root}>
      <Header title="Synon Studio" />
      {!online ? <SyncBanner kind="offline" text={t(lang, 'common.offline')} /> : null}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          <View style={styles.mark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Svg width={34} height={26} viewBox="0 0 34 26">
              <Path
                d="M3 15c0-5 4.6-9 10.3-9 4.8 0 8.7 2.6 9.9 6.2l2.7-2.6c1.2-1.1 3.1-.3 3.1 1.4v3.1c0 4.6-3.9 8.4-8.8 8.4H11C6.6 22.5 3 19.2 3 15z"
                fill="#F5F5F7"
              />
              <Circle cx={12.5} cy={13.5} r={1.15} fill="#1D1D1F" />
            </Svg>
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {t(lang, 'login.title')}
          </Text>
          <Text style={styles.subtitle}>{t(lang, 'login.subtitle')}</Text>

          <View style={[styles.form, desktop && styles.formDesktop]}>
            <Text style={styles.label}>{t(lang, 'login.email')}</Text>
            <TextInput
              ref={emailRef}
              value={email}
              onChangeText={setEmail}
              onFocus={() => {
                setFocused(true);
                const input = emailRef.current as unknown as { scrollIntoView?: (opts?: unknown) => void } | null;
                setTimeout(() => input?.scrollIntoView?.({ block: 'nearest' }), 80);
              }}
              onBlur={() => setFocused(false)}
              onSubmitEditing={() => void submit()}
              placeholder={t(lang, 'login.emailPlaceholder')}
              placeholderTextColor={color.text3}
              keyboardType="email-address"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              returnKeyType="go"
              accessibilityLabel={t(lang, 'login.email')}
              testID="email"
              style={[styles.input, focused && styles.inputFocused]}
            />
            {verifying ? <Text style={styles.note}>{t(lang, 'login.verifying')}</Text> : null}
            {message ? (
              <View style={[styles.panel, phase === 'error' && styles.panelError]} testID="login-message">
                <Text style={[styles.panelText, phase === 'error' && styles.panelTextError]}>{message}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
      <ActionDock maxWidth={400}>
        <PrimaryButton
          label={phase === 'sent' ? t(lang, 'login.sendAnother') : t(lang, 'login.continue')}
          onPress={() => void submit()}
          loading={phase === 'sending' || verifying}
          testID="primary"
        />
      </ActionDock>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: space[5] },
  column: { flex: 1, paddingTop: space[3], paddingBottom: space[6] },
  columnDesktop: { maxWidth: 400, width: '100%', alignSelf: 'center', paddingTop: space[7] },
  mark: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space[6],
  },
  title: { ...type.title, color: color.text },
  subtitle: { ...type.body, color: color.text2, marginTop: space[3] },
  form: { marginTop: 'auto', paddingTop: space[6] },
  formDesktop: { marginTop: space[7] },
  label: { ...type.callout, fontWeight: '500', color: color.text2, marginBottom: space[3] },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.m,
    backgroundColor: color.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    lineHeight: 22,
    color: color.text,
  },
  inputFocused: { borderColor: color.info },
  note: { ...type.caption, color: color.text2, marginTop: space[3] },
  panel: {
    marginTop: space[4],
    padding: 12,
    paddingHorizontal: 14,
    borderRadius: radius.m,
    backgroundColor: color.sunken,
  },
  panelError: { backgroundColor: 'rgba(196,55,48,0.085)' },
  panelText: { ...type.callout, color: color.text2 },
  panelTextError: { color: color.error },
});
