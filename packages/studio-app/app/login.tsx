import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { ActionDock } from '../components/ActionDock';
import { Header } from '../components/Header';
import { PrimaryButton } from '../components/PrimaryButton';
import { SyncBanner } from '../components/SyncBanner';
import { TextButton } from '../components/TextButton';
import { useScheme } from '../lib/appearance';
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
  useScheme();
  const styles = createStyles();
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
  const [mailHint, setMailHint] = useState<string | null>(null);
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
    setMailHint(null);
    const r = await hub.requestLink(address);
    if (r.ok) {
      setPhase('sent');
      setMessage(t(lang, 'login.sent'));
      return;
    }
    setPhase('error');
    setMessage(r.error.kind === 'offline' ? t(lang, 'login.offline') : t(lang, 'login.serviceDown'));
  };

  const openMailApp = async () => {
    setMailHint(null);
    try {
      if (Platform.OS === 'ios') {
        const supported = await Linking.canOpenURL('message://');
        if (!supported) {
          setMailHint(t(lang, 'login.openMailFailed'));
          return;
        }
        await Linking.openURL('message://');
        return;
      }
      if (Platform.OS === 'android') {
        try {
          await Linking.openURL(
            'intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.APP_EMAIL;end',
          );
          return;
        } catch {
          await Linking.openURL('mailto:');
          return;
        }
      }
      setMailHint(t(lang, 'login.openMailFailed'));
    } catch {
      if (aliveRef.current) setMailHint(t(lang, 'login.openMailFailed'));
    }
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
            <Svg width={29} height={42} viewBox="0 0 356 520">
              <Path
                d="M 300 174 A 130 130 0 1 0 178 260"
                stroke="#FFFFFF"
                strokeWidth={96}
                strokeLinecap="round"
                fill="none"
              />
              <Path
                d="M 178 260 A 130 130 0 1 1 56 434"
                stroke="#FFFFFF"
                strokeWidth={96}
                strokeLinecap="round"
                fill="none"
              />
              <Circle cx={300} cy={174} r={30} fill="#86AAF2" />
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
            {phase === 'sent' ? (
              <View style={styles.panel} testID="login-sent">
                <Text style={styles.panelTitle}>{t(lang, 'login.sentTitle')}</Text>
                <Text style={styles.panelText}>
                  {email.trim() ? t(lang, 'login.sentTo', { email: email.trim() }) : t(lang, 'login.sent')}
                </Text>
                {mailHint ? (
                  <Text style={styles.mailHint} testID="login-mail-hint">
                    {mailHint}
                  </Text>
                ) : null}
              </View>
            ) : message ? (
              <View style={[styles.panel, phase === 'error' && styles.panelError]} testID="login-message">
                <Text style={[styles.panelText, phase === 'error' && styles.panelTextError]}>{message}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
      <ActionDock maxWidth={400}>
        {phase === 'sent' ? (
          <View style={styles.sentActions}>
            <PrimaryButton label={t(lang, 'login.openMail')} onPress={() => void openMailApp()} testID="open-mail" />
            <TextButton label={t(lang, 'login.sendAnother')} onPress={() => void submit()} testID="send-another" />
          </View>
        ) : (
          <PrimaryButton
            label={t(lang, 'login.continue')}
            onPress={() => void submit()}
            loading={phase === 'sending' || verifying}
            testID="primary"
          />
        )}
      </ActionDock>
    </View>
  );
}

const createStyles = () => StyleSheet.create({
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
  panelTitle: { ...type.callout, fontWeight: '600', color: color.text, marginBottom: space[1] },
  panelText: { ...type.callout, color: color.text2 },
  panelTextError: { color: color.error },
  mailHint: { ...type.caption, color: color.text3, marginTop: space[2] },
  sentActions: { gap: space[2] },
});
