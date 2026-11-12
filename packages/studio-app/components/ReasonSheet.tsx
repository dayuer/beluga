import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { kv } from '../lib/kv';
import { pendingKey, useSend, type SendFailure } from '../lib/send';
import { refusalKey } from '../lib/submit';
import { t, type Lang } from '../lib/strings';
import { color, radius, space, type } from '../lib/theme';
import { useKeyboardInset } from '../lib/viewport';
import { PrimaryButton } from './PrimaryButton';
import { ReceiptLine } from './ReceiptLine';

interface ReasonSheetProps {
  readonly pid: string;
  readonly planRef: string;
  readonly milestoneRef: string;
  readonly draftRev: number;
  readonly lang: Lang;
  readonly onSent: () => void;
  readonly onRefresh: () => void;
}

const MIN_REASON = 10;

/** "Not yet…": why the milestone is going back, with three quick tags and a kept draft (M6 §4.11). */
export function ReasonSheet({ pid, planRef, milestoneRef, draftRev, lang, onSent, onRefresh }: ReasonSheetProps) {
  const key = `draft:sendback:${pid}:${planRef}:${milestoneRef}`;
  const [reason, setReason] = useState(() => kv.get<{ reason?: string }>(key)?.reason ?? '');
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reasonRef = useRef(reason);
  reasonRef.current = reason;
  const send = useSend(pid, pendingKey('sendback', pid, planRef, milestoneRef));
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  const change = (value: string): void => {
    setReason(value);
    reasonRef.current = value;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => kv.set(key, { reason: value, updatedAt: Date.now() }), 300);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const value = reasonRef.current;
      if (value.trim()) kv.set(key, { reason: value, updatedAt: Date.now() });
    },
    [key],
  );

  const failedText = (failure: SendFailure): string => t(lang, failure === 'offline' ? 'refusal.offline' : failure === 'expired' ? 'refusal.expired' : 'refusal.http');
  const ready = reason.trim().length >= MIN_REASON;
  const busy = send.state.phase === 'sending' || send.state.phase === 'queued';
  const failed = send.state.phase === 'failed';

  const submit = (): void => {
    if (!ready) return;
    void send.send(
      (opId) => ({ t: 'action', opId, kind: 'milestone.sendBack', planRef, payload: { milestoneRef, draftRev, reason: reason.trim() } }),
      {
        onQueued: () => {
          kv.remove(key);
          onSent();
        },
        onDone: () => {
          kv.remove(key);
          onSent();
        },
        onRefused: (code) => {
          setNotice(t(lang, refusalKey(code)));
          if (code === 'stale') onRefresh();
        },
        onFailed: (failure) => setNotice(failedText(failure)),
      },
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.tags}>
          {[t(lang, 'reason.tag1'), t(lang, 'reason.tag2'), t(lang, 'reason.tag3')].map((tag, i) => (
            <Pressable
              key={tag}
              accessibilityRole="button"
              testID={`reason-tag-${i + 1}`}
              onPress={() => change(reason.trim() ? `${reason.trim()}；${tag}` : tag)}
              style={({ pressed }) => [styles.tag, pressed && styles.pressed]}
            >
              <Text style={styles.tagText}>{tag}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={reason}
          onChangeText={change}
          placeholder={t(lang, 'reason.placeholder')}
          placeholderTextColor={color.text3}
          multiline
          maxLength={4000}
          style={styles.input}
          testID="reason-input"
          accessibilityLabel={t(lang, 'reason.title')}
        />
        {reason.length >= 3600 ? <Text style={styles.counter}>{t(lang, 'new.left', { n: 4000 - reason.length })}</Text> : null}
        {!ready ? (
          <Text style={styles.hint} testID="reason-too-short">
            {t(lang, 'reason.tooShort')}
          </Text>
        ) : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: (keyboard > 0 ? 0 : insets.bottom) + space[4] }]}>
        <ReceiptLine text={notice} tone="error" />
        <PrimaryButton
          label={busy ? t(lang, 'common.sending') : failed ? t(lang, 'common.retry') : t(lang, 'reason.send')}
          onPress={() => (failed ? void send.retry() : submit())}
          disabled={busy || (!failed && !ready)}
          loading={busy}
          testID="primary"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  scroll: { flex: 1 },
  content: { padding: space[4], gap: space[4] },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  tag: { minHeight: 44, paddingHorizontal: space[4], justifyContent: 'center', backgroundColor: color.sunken, borderRadius: radius.pill },
  tagText: { ...type.callout, color: color.text2 },
  pressed: { opacity: 0.9 },
  input: {
    ...type.callout,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 96,
    maxHeight: 204,
    textAlignVertical: 'top',
    color: color.text,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.m,
    padding: space[4],
  },
  counter: { ...type.caption, color: color.text3, textAlign: 'right' },
  hint: { ...type.caption, color: color.warn },
  footer: { paddingHorizontal: space[4], paddingTop: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline },
});
