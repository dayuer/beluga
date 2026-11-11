import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StudioDraftDiff } from '../../../src/studio/protocol';
import { pendingKey, useSend, type SendFailure } from '../lib/send';
import { refusalKey } from '../lib/submit';
import { t, type Lang } from '../lib/strings';
import { color, radius, space, type } from '../lib/theme';
import { useKeyboardInset } from '../lib/viewport';
import { PrimaryButton } from './PrimaryButton';
import { ReceiptLine } from './ReceiptLine';

interface DraftDiffProps {
  readonly pid: string;
  readonly planRef: string;
  readonly diff: StudioDraftDiff;
  readonly draftRev: number;
  readonly lang: Lang;
  readonly onApplied: () => void;
  readonly onRefresh: () => void;
}

/** What the studio changed after the customer's request: added, changed and removed milestones
 * and tasks, with the one action that applies them (M6 §4.12). */
export function DraftDiff({ pid, planRef, diff, draftRev, lang, onApplied, onRefresh }: DraftDiffProps) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const send = useSend(pid, pendingKey('apply', pid, planRef));
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  const failedText = (failure: SendFailure): string => t(lang, failure === 'offline' ? 'refusal.offline' : failure === 'expired' ? 'refusal.expired' : 'refusal.http');
  const busy = send.state.phase === 'sending' || send.state.phase === 'queued';
  const failed = send.state.phase === 'failed';

  const apply = (): void => {
    void send.send(
      (opId) => ({ t: 'action', opId, kind: 'draft.apply', planRef, payload: { draftRev } }),
      {
        onQueued: onApplied,
        onDone: onApplied,
        onRefused: (code) => {
          setNotice(code === 'stale' ? t(lang, 'plan.changesUpdated') : t(lang, refusalKey(code)));
          if (code === 'stale') onRefresh();
        },
        onFailed: (failure) => setNotice(failedText(failure)),
      },
    );
  };

  const toggle = (i: number): void => {
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <View style={styles.root} testID="draft-diff">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {diff.added.length ? (
          <View style={styles.group} testID="diff-added">
            <Text style={[styles.groupTitle, { color: color.ok }]}>{t(lang, 'diff.added')}</Text>
            {diff.added.map((item, i) => (
              <View key={`a-${i}`} style={styles.row}>
                <Text style={[styles.sign, { color: color.ok }]}>+</Text>
                <View style={styles.rowMain}>
                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={styles.meta}>
                    {t(lang, item.kind === 'milestone' ? 'diff.milestone' : 'diff.task')}
                    {item.under ? ` · ${item.under}` : ''}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {diff.changed.length ? (
          <View style={styles.group} testID="diff-changed">
            <Text style={[styles.groupTitle, { color: color.warn }]}>{t(lang, 'diff.changed')}</Text>
            {diff.changed.map((item, i) => (
              <Pressable key={`c-${i}`} accessibilityRole="button" accessibilityState={{ expanded: open.has(i) }} onPress={() => toggle(i)} style={({ pressed }) => [styles.row, pressed && styles.pressed]} testID={`diff-changed-${i}`}>
                <Text style={[styles.sign, { color: color.warn }]}>~</Text>
                <View style={styles.rowMain}>
                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={styles.meta}>{t(lang, item.kind === 'milestone' ? 'diff.milestone' : 'diff.task')}</Text>
                  {open.has(i) ? (
                    <View style={styles.beforeAfter}>
                      <Text style={styles.before}>{item.before}</Text>
                      <Text style={styles.arrow}>→</Text>
                      <Text style={styles.after}>{item.after}</Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        {diff.removed.length ? (
          <View style={styles.group} testID="diff-removed">
            <Text style={[styles.groupTitle, { color: color.error }]}>{t(lang, 'diff.removed')}</Text>
            {diff.removed.map((item, i) => (
              <View key={`r-${i}`} style={styles.row}>
                <Text style={[styles.sign, { color: color.error }]}>−</Text>
                <View style={styles.rowMain}>
                  <Text style={[styles.title, styles.removed]}>{item.title}</Text>
                  <Text style={styles.meta}>{t(lang, item.kind === 'milestone' ? 'diff.milestone' : 'diff.task')}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: (keyboard > 0 ? 0 : insets.bottom) + space[4] }]}>
        <ReceiptLine text={notice} tone={notice === t(lang, 'plan.changesUpdated') ? 'warn' : 'error'} />
        <PrimaryButton
          label={busy ? t(lang, 'common.sending') : failed ? t(lang, 'common.retry') : t(lang, 'plan.apply')}
          onPress={() => (failed ? void send.retry() : apply())}
          disabled={busy}
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
  content: { padding: space[4], gap: space[5] },
  group: { gap: space[2] },
  groupTitle: { ...type.caption, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.hairline },
  pressed: { backgroundColor: color.press },
  sign: { ...type.heading, width: 18, textAlign: 'center' },
  rowMain: { flex: 1, gap: 2 },
  title: { ...type.callout, color: color.text, fontWeight: '600' },
  meta: { ...type.caption, color: color.text3 },
  removed: { textDecorationLine: 'line-through', color: color.text2 },
  beforeAfter: { marginTop: space[2], gap: 2, padding: space[3], backgroundColor: color.sunken, borderRadius: radius.m },
  before: { ...type.caption, color: color.text3, textDecorationLine: 'line-through' },
  arrow: { ...type.caption, color: color.text2 },
  after: { ...type.caption, color: color.text },
  footer: { paddingHorizontal: space[4], paddingTop: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline },
});
