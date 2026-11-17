import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { pendingKey, useSend, type SendFailure } from '../lib/send';
import { refusalKey } from '../lib/submit';
import { t, type Lang } from '../lib/strings';
import type { TodoCard as TodoData } from '../lib/todo-store';
import { color, radius, space, type } from '../lib/theme';
import { useUndoSend } from '../lib/undo';
import { ReceiptLine } from './ReceiptLine';

interface TodoCardProps {
  readonly todo: TodoData;
  readonly lang: Lang;
  readonly onHidden: (key: string) => void;
  readonly onOpenPlan: (pid: string, planRef: string, open?: 'decide' | 'reason') => void;
  readonly onRefresh: () => void;
}

/** One to-do, with its own action: no filled primary button on this list (M6 §6.4). */
export function TodoCard({ todo, lang, onHidden, onOpenPlan, onRefresh }: TodoCardProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const pass = useSend(todo.pid, pendingKey('pass', todo.pid, todo.planRef));
  const apply = useSend(todo.pid, pendingKey('apply', todo.pid, todo.planRef));
  const discard = useSend(todo.pid, pendingKey('discard', todo.pid, todo.planRef));
  const confirm = useSend(todo.pid, pendingKey('confirm', todo.pid, todo.planRef));
  const undo = useUndoSend(10_000);

  const failedText = (failure: SendFailure): string => t(lang, failure === 'offline' ? 'refusal.offline' : failure === 'expired' ? 'refusal.expired' : 'refusal.http');
  const refusedText = (code: string): string => t(lang, refusalKey(code as Parameters<typeof refusalKey>[0]));
  const refused = (code: string): void => {
    setNotice(code === 'stale' ? t(lang, 'plan.changesUpdated') : refusedText(code));
    if (code === 'stale') onRefresh();
  };

  const passGo = (): void => {
    if (!todo.milestoneRef) return;
    undo.start(() => {
      void pass.send(
        (opId) => ({ t: 'action', opId, kind: 'milestone.pass', planRef: todo.planRef, payload: { milestoneRef: todo.milestoneRef!, draftRev: todo.draftRev ?? 0 } }),
        {
          onQueued: () => onHidden(todo.key),
          onDone: () => onHidden(todo.key),
          onRefused: refused,
          onFailed: (failure) => setNotice(failedText(failure)),
        },
      );
    });
  };

  const applyGo = (): void => {
    void apply.send(
      (opId) => ({ t: 'action', opId, kind: 'draft.apply', planRef: todo.planRef, payload: { draftRev: todo.draftRev ?? 0 } }),
      {
        onQueued: () => onHidden(todo.key),
        onDone: () => onHidden(todo.key),
        onRefused: (code) => setNotice(refusedText(code)),
        onFailed: (failure) => setNotice(failedText(failure)),
      },
    );
  };

  const discardGo = (): void => {
    void discard.send(
      (opId) => ({ t: 'action', opId, kind: 'draft.discard', planRef: todo.planRef, payload: { draftRev: todo.draftRev ?? 0 } }),
      {
        onQueued: () => onHidden(todo.key),
        onDone: () => onHidden(todo.key),
        onRefused: (code) => setNotice(refusedText(code)),
        onFailed: (failure) => setNotice(failedText(failure)),
      },
    );
  };

  const confirmGo = (): void => {
    void confirm.send(
      (opId) => ({ t: 'action', opId, kind: 'plan.requestStart', planRef: todo.planRef, payload: { draftRev: todo.draftRev ?? 0 } }),
      {
        onQueued: () => onHidden(todo.key),
        onDone: () => onHidden(todo.key),
        onRefused: (code) => setNotice(refusedText(code)),
        onFailed: (failure) => setNotice(failedText(failure)),
      },
    );
  };

  const kindKey = todo.kind === 'decision' ? 'todo.decision' : todo.kind === 'review' ? 'todo.review' : todo.kind === 'changes' ? 'todo.changes' : 'todo.confirm';
  const kindLabel = t(lang, kindKey);
  const passBusy = !undo.active && (pass.state.phase === 'sending' || pass.state.phase === 'queued');
  const passFailed = !undo.active && pass.state.phase === 'failed';
  const applyBusy = apply.state.phase === 'sending' || apply.state.phase === 'queued';
  const applyFailed = apply.state.phase === 'failed';
  const discardBusy = discard.state.phase === 'sending' || discard.state.phase === 'queued';
  const confirmBusy = confirm.state.phase === 'sending' || confirm.state.phase === 'queued';
  const confirmFailed = confirm.state.phase === 'failed';

  return (
    <View style={styles.card} testID="todo-card">
      <Text style={styles.project} numberOfLines={1}>
        {todo.projectName}
      </Text>
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={2}>
          {todo.title}
        </Text>
        <Text style={styles.kind}>{kindLabel}</Text>
      </View>
      <Text style={styles.sub} numberOfLines={2}>
        {todo.sub}
      </Text>
      <ReceiptLine text={notice} tone="error" />
      <View style={styles.actions}>
        {todo.kind === 'decision' ? (
          <Action label={t(lang, 'todo.answer')} onPress={() => onOpenPlan(todo.pid, todo.planRef, 'decide')} testID="todo-answer" />
        ) : null}
        {todo.kind === 'review' ? (
          <>
            <Action
              label={undo.active ? t(lang, 'review.undoCount', { n: undo.remaining }) : passBusy ? t(lang, 'common.sending') : passFailed ? t(lang, 'common.retry') : t(lang, 'plan.approve')}
              onPress={() => {
                if (undo.active) undo.cancel();
                else if (passFailed) void pass.retry();
                else passGo();
              }}
              disabled={passBusy}
              main
              testID="todo-approve"
            />
            {!undo.active && !passBusy ? <Action label={t(lang, 'plan.notYet')} onPress={() => onOpenPlan(todo.pid, todo.planRef, 'reason')} testID="todo-not-yet" /> : null}
          </>
        ) : null}
        {todo.kind === 'changes' ? (
          <>
            <Action label={applyBusy ? t(lang, 'common.sending') : applyFailed ? t(lang, 'common.retry') : t(lang, 'todo.apply')} onPress={() => (applyFailed ? void apply.retry() : applyGo())} disabled={applyBusy} main testID="todo-apply" />
            <Action label={discardBusy ? t(lang, 'common.sending') : t(lang, 'todo.discard')} onPress={() => void discardGo()} disabled={discardBusy} testID="todo-discard" />
          </>
        ) : null}
        {todo.kind === 'confirm' ? (
          <Action label={confirmBusy ? t(lang, 'common.sending') : confirmFailed ? t(lang, 'common.retry') : t(lang, 'todo.confirm')} onPress={() => (confirmFailed ? void confirm.retry() : confirmGo())} disabled={confirmBusy} main testID="todo-confirm" />
        ) : null}
      </View>
    </View>
  );
}

function Action({ label, onPress, disabled, main, testID }: { readonly label: string; readonly onPress: () => void; readonly disabled?: boolean; readonly main?: boolean; readonly testID: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.action, main && styles.actionMain, disabled && styles.actionOff, pressed && !disabled && styles.pressed]}
    >
      <Text style={[styles.actionText, main && styles.actionTextMain]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.card, borderRadius: radius.l, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)', padding: space[5], marginBottom: space[4], gap: space[2] },
  project: { ...type.caption, color: color.text3, fontWeight: '600' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  title: { ...type.heading, color: color.text, flex: 1 },
  kind: { ...type.caption, color: color.text3, paddingTop: 2 },
  sub: { ...type.callout, color: color.text2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] },
  action: { minHeight: 44, paddingHorizontal: space[4], alignItems: 'center', justifyContent: 'center', backgroundColor: color.sunken, borderRadius: radius.m, borderWidth: 1, borderColor: color.hairline },
  actionMain: { backgroundColor: color.card, borderColor: color.hairlineStrong },
  actionOff: { opacity: 0.5 },
  actionText: { ...type.callout, color: color.text2, fontWeight: '500' },
  actionTextMain: { color: color.text, fontWeight: '600' },
  pressed: { opacity: 0.9 },
});
