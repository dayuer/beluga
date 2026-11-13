import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StudioDecision } from '../../../src/studio/protocol';
import { kv } from '../lib/kv';
import { pendingKey, useSend, type SendFailure } from '../lib/send';
import { refusalKey } from '../lib/submit';
import { t, type Lang } from '../lib/strings';
import { color, radius, space, type } from '../lib/theme';
import { useUndoSend } from '../lib/undo';
import { useKeyboardInset } from '../lib/viewport';
import { PrimaryButton } from './PrimaryButton';
import { ReceiptLine } from './ReceiptLine';

interface DecisionCardProps {
  readonly pid: string;
  readonly planRef: string;
  readonly decision: StudioDecision;
  readonly index: number;
  readonly total: number;
  readonly lang: Lang;
  readonly onAnswered: (decisionId: string) => void;
  readonly onRefresh: () => void;
}

const MAX_ANSWER = 2000;

/** One question at a time (M6 §4.10): wide option rows, a 10-second undo, free text with a cap. */
export function DecisionCard({ pid, planRef, decision, index, total, lang, onAnswered, onRefresh }: DecisionCardProps) {
  const key = `draft:decision:${pid}:${planRef}:${decision.decisionId}`;
  const saved = kv.get<{ picks?: string[]; text?: string }>(key);
  const [picks, setPicks] = useState<string[]>(() => (Array.isArray(saved?.picks) ? saved.picks.filter((p) => decision.options.some((o) => o.id === p)) : []));
  const [text, setText] = useState(() => (typeof saved?.text === 'string' ? saved.text.slice(0, MAX_ANSWER) : ''));
  const [notice, setNotice] = useState<string | null>(null);
  const send = useSend(pid, pendingKey('decision', pid, planRef, decision.decisionId));
  const undo = useUndoSend(10_000);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ picks, text });
  stateRef.current = { picks, text };

  const save = (nextPicks: string[], nextText: string): void => {
    stateRef.current = { picks: nextPicks, text: nextText };
    setPicks(nextPicks);
    setText(nextText);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => kv.set(key, { picks: nextPicks, text: nextText, updatedAt: Date.now() }), 300);
  };

  useEffect(
    () => () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
      const value = stateRef.current;
      if (value.picks.length || value.text.trim()) kv.set(key, { picks: value.picks, text: value.text, updatedAt: Date.now() });
    },
    [key],
  );

  const failedText = (failure: SendFailure): string => t(lang, failure === 'offline' ? 'refusal.offline' : failure === 'expired' ? 'refusal.expired' : 'refusal.http');

  const submit = (chosen: string[], value: string): void => {
    const trimmed = value.trim();
    if (!chosen.length && !trimmed) return;
    undo.start(() => {
      void send.send(
        (opId) => ({
          t: 'action',
          opId,
          kind: 'decision.answer',
          planRef,
          payload: {
            decisionId: decision.decisionId,
            ...(chosen.length ? { picks: chosen } : {}),
            ...(trimmed ? { text: trimmed } : {}),
          },
        }),
        {
          onQueued: () => {
            kv.remove(key);
            onAnswered(decision.decisionId);
          },
          onDone: () => {
            kv.remove(key);
            onAnswered(decision.decisionId);
          },
          onRefused: (code) => {
            setNotice(t(lang, refusalKey(code)));
            if (code === 'stale' || code === 'not-open') onRefresh();
          },
          onFailed: (failure) => setNotice(failedText(failure)),
        },
      );
    });
  };

  const toggle = (id: string): void => {
    const next = picks.includes(id) ? picks.filter((p) => p !== id) : [...picks, id];
    save(next, text);
  };

  const pickOne = (id: string): void => {
    save([id], text);
    submit([id], text);
  };

  const busy = !undo.active && (send.state.phase === 'sending' || send.state.phase === 'queued');
  const failed = !undo.active && send.state.phase === 'failed';
  const canSubmit = decision.multi || text.trim().length > 0 || failed;
  const showButton = undo.active || busy || failed || canSubmit;

  return (
    <View style={styles.root} testID="decision-card">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.count}>{t(lang, 'decision.count', { i: index + 1, n: total })}</Text>
        <Text style={styles.question}>{decision.question}</Text>
        {decision.multi ? <Text style={styles.multi}>{t(lang, 'decision.multi')}</Text> : null}
        <View style={styles.options}>
          {decision.options.map((option) => {
            const selected = picks.includes(option.id);
            return (
              <Pressable
                key={option.id}
                accessibilityRole={decision.multi ? 'checkbox' : 'radio'}
                accessibilityState={{ checked: selected, disabled: undo.active || busy }}
                disabled={undo.active || busy}
                onPress={() => (decision.multi ? toggle(option.id) : pickOne(option.id))}
                style={({ pressed }) => [styles.option, selected && styles.optionOn, pressed && styles.pressed]}
                testID={`decision-option-${option.id}`}
              >
                <View style={[styles.check, selected && styles.checkOn]}>
                  {selected ? <Text style={styles.checkInk}>✓</Text> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionLabel}>{option.label}</Text>
                  {option.description ? <Text style={styles.optionDescription}>{option.description}</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          value={text}
          onChangeText={(value) => save(picks, value.slice(0, MAX_ANSWER))}
          placeholder={t(lang, 'decision.textPlaceholder')}
          placeholderTextColor={color.text3}
          multiline
          maxLength={MAX_ANSWER}
          style={styles.input}
          testID="decision-text"
          accessibilityLabel={t(lang, 'decision.textPlaceholder')}
        />
        {text.length >= 1800 ? <Text style={styles.counter}>{t(lang, 'decision.left', { n: MAX_ANSWER - text.length })}</Text> : null}
        <Text style={styles.private}>{t(lang, 'plan.privateNote')}</Text>
      </ScrollView>
      {showButton ? (
        <View style={[styles.footer, { paddingBottom: (keyboard > 0 ? 0 : insets.bottom) + space[4] }]}>
          <ReceiptLine text={notice} tone="error" />
          <PrimaryButton
            label={
              undo.active
                ? t(lang, 'decision.undoCount', { n: undo.remaining })
                : busy
                  ? t(lang, 'common.sending')
                  : failed
                    ? t(lang, 'common.retry')
                    : t(lang, 'decision.submit')
            }
            onPress={() => {
              if (undo.active) undo.cancel();
              else if (failed) void send.retry();
              else submit(picks, text);
            }}
            disabled={busy || (!failed && !undo.active && !decision.multi && !text.trim() && picks.length === 0)}
            loading={busy}
            testID="primary"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  scroll: { flex: 1 },
  content: { padding: space[4], gap: space[3] },
  count: { ...type.caption, color: color.text3 },
  question: { ...type.heading, color: color.text, fontSize: 18, lineHeight: 24 },
  multi: { ...type.caption, color: color.text2 },
  options: { gap: space[2], marginTop: space[1] },
  option: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.m,
  },
  optionOn: { borderWidth: 1.5, borderColor: color.text },
  pressed: { opacity: 0.9 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: color.hairlineStrong, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: color.text, borderColor: color.text },
  checkInk: { ...type.caption, color: color.onPrimary, fontSize: 13, fontWeight: '800' },
  optionLabel: { ...type.callout, color: color.text, fontWeight: '600' },
  optionDescription: { ...type.caption, color: color.text2, marginTop: 2 },
  input: {
    ...type.callout,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 44,
    maxHeight: 84,
    textAlignVertical: 'top',
    color: color.text,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.m,
    padding: space[3],
  },
  counter: { ...type.caption, color: color.text3, textAlign: 'right' },
  private: { ...type.caption, color: color.text3, marginTop: space[2] },
  footer: { paddingHorizontal: space[4], paddingTop: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline },
});
