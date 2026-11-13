import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StudioPlanView } from '../../../src/studio/protocol';
import { hasPrimary, type PagePhase } from '../lib/plan-phase';
import { pendingKey, useSend, type SendFailure } from '../lib/send';
import { refusalKey } from '../lib/submit';
import { t, type Lang } from '../lib/strings';
import { color, radius, space, type } from '../lib/theme';
import { useUndoSend } from '../lib/undo';
import { PrimaryButton } from './PrimaryButton';
import { ReceiptLine } from './ReceiptLine';

interface PrimaryActionProps {
  readonly pid: string;
  readonly planRef: string;
  readonly view: StudioPlanView;
  readonly phase: PagePhase;
  readonly lang: Lang;
  readonly onDecide: () => void;
  readonly onReason: (milestoneRef: string) => void;
  readonly onConfirmed: () => void;
  readonly onApplied: () => void;
  readonly onPassed: (milestoneRef: string) => void;
  readonly onRefresh: () => void;
}

/**
 * The one primary action of the phase (M6 §2.2). It lives in the ActionDock, so it never scrolls
 * away; the decision and reason drawers open from here, and the pass waits ten seconds with undo.
 */
export function PrimaryAction({ pid, planRef, view, phase, lang, onDecide, onReason, onConfirmed, onApplied, onPassed, onRefresh }: PrimaryActionProps) {
  const confirm = useSend(pid, pendingKey('confirm', pid, planRef));
  const pass = useSend(pid, pendingKey('pass', pid, planRef));
  const apply = useSend(pid, pendingKey('apply', pid, planRef));
  const undo = useUndoSend(10_000);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setNotice(null), [phase]);

  if (!hasPrimary(phase)) return null;

  const open = view.decisions.filter((d) => d.open).length;
  const reviewMilestone = view.milestones.find((m) => m.status === 'review');
  const failedText = (failure: SendFailure): string => t(lang, failure === 'offline' ? 'refusal.offline' : failure === 'expired' ? 'refusal.expired' : 'refusal.http');
  const refusedText = (code: string): string => {
    if (code === 'stale' && phase === 'changes') return t(lang, 'plan.changesUpdated');
    return t(lang, refusalKey(code as Parameters<typeof refusalKey>[0]));
  };

  const sendConfirm = (): void => {
    void confirm.send(
      (opId) => ({ t: 'action', opId, kind: 'plan.requestStart', planRef, payload: { draftRev: view.draftRev } }),
      {
        onQueued: onConfirmed,
        onDone: onConfirmed,
        onRefused: (code) => {
          setNotice(refusedText(code));
          if (code === 'stale') onRefresh();
        },
        onFailed: (failure) => setNotice(failedText(failure)),
      },
    );
  };

  const sendApply = (): void => {
    void apply.send(
      (opId) => ({ t: 'action', opId, kind: 'draft.apply', planRef, payload: { draftRev: view.draftRev } }),
      {
        onQueued: onApplied,
        onDone: onApplied,
        onRefused: (code) => {
          setNotice(refusedText(code));
          if (code === 'stale') onRefresh();
        },
        onFailed: (failure) => setNotice(failedText(failure)),
      },
    );
  };

  const sendPass = (): void => {
    if (!reviewMilestone) return;
    const milestoneRef = reviewMilestone.ref;
    undo.start(() => {
      void pass.send(
        (opId) => ({ t: 'action', opId, kind: 'milestone.pass', planRef, payload: { milestoneRef, draftRev: view.draftRev } }),
        {
          onQueued: () => onPassed(milestoneRef),
          onDone: () => onPassed(milestoneRef),
          onRefused: (code) => {
            setNotice(refusedText(code));
            if (code === 'stale') onRefresh();
          },
          onFailed: (failure) => setNotice(failedText(failure)),
        },
      );
    });
  };

  const noticeTone = notice === t(lang, 'plan.changesUpdated') ? 'warn' : 'error';

  if (phase === 'decide') {
    return (
      <View>
        <ReceiptLine text={notice} tone={noticeTone} />
        <PrimaryButton label={t(lang, 'plan.answer', { n: open })} onPress={onDecide} testID="primary" />
      </View>
    );
  }

  if (phase === 'confirm') {
    const busy = confirm.state.phase === 'sending' || confirm.state.phase === 'queued';
    const failed = confirm.state.phase === 'failed';
    return (
      <View>
        <ReceiptLine text={notice} tone={noticeTone} />
        <PrimaryButton
          label={busy ? t(lang, 'common.sending') : failed ? t(lang, 'common.retry') : t(lang, 'plan.confirm')}
          onPress={() => (failed ? void confirm.retry() : sendConfirm())}
          disabled={busy}
          loading={busy}
          testID="primary"
        />
      </View>
    );
  }

  if (phase === 'changes') {
    const busy = apply.state.phase === 'sending' || apply.state.phase === 'queued';
    const failed = apply.state.phase === 'failed';
    return (
      <View>
        <ReceiptLine text={notice} tone={noticeTone} />
        <PrimaryButton
          label={busy ? t(lang, 'common.sending') : failed ? t(lang, 'common.retry') : t(lang, 'plan.apply')}
          onPress={() => (failed ? void apply.retry() : sendApply())}
          disabled={busy}
          loading={busy}
          testID="primary"
        />
      </View>
    );
  }

  // review
  const passBusy = !undo.active && (pass.state.phase === 'sending' || pass.state.phase === 'queued');
  const passFailed = !undo.active && pass.state.phase === 'failed';
  const secondary = !undo.active && !passBusy;
  return (
    <View>
      <ReceiptLine text={notice} tone={noticeTone} />
      <View style={styles.row}>
        {secondary ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (reviewMilestone) onReason(reviewMilestone.ref);
            }}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            testID="not-yet"
          >
            <Text style={styles.secondaryText}>{t(lang, 'plan.notYet')}</Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <PrimaryButton
            label={undo.active ? t(lang, 'review.undoCount', { n: undo.remaining }) : passBusy ? t(lang, 'common.sending') : passFailed ? t(lang, 'common.retry') : t(lang, 'plan.approve')}
            onPress={() => {
              if (undo.active) undo.cancel();
              else if (passFailed) void pass.retry();
              else sendPass();
            }}
            disabled={passBusy}
            loading={passBusy}
            testID="primary"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', gap: space[3] },
  secondary: {
    minWidth: 96,
    height: 52,
    paddingHorizontal: space[4],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.sunken,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.m,
  },
  secondaryText: { ...type.heading, color: color.text2 },
  pressed: { opacity: 0.9 },
});
