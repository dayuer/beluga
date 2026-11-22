import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { z } from 'zod';
import { haptics } from '../../lib/haptics';
import { detectLang, type Lang } from '../../lib/strings';
import { tUnderstanding } from '../../lib/strings/understanding';
import { color, radius, space, type } from '../../lib/theme';
import { undoStore } from '../../lib/undo';
import type { UnderstandingCardSchema } from '../../lib/views';
import { ActionRow } from '../card/ActionRow';
import { Card } from '../card/Card';
import { PrimaryButton } from '../PrimaryButton';
import { SignedButton } from '../SignedButton';
import { TextButton } from '../TextButton';

export type UnderstandingCardData = z.infer<typeof UnderstandingCardSchema>;

export interface UnderstandingCardProps {
  readonly card: UnderstandingCardData;
  readonly lang?: Lang;
  readonly onConfirm?: (cardId: string) => Promise<void> | void;
  readonly onReject?: (cardId: string, reason: string) => Promise<void> | void;
  /** 可选覆盖设备密钥状态（主要供单测与预览使用）。 */
  readonly hasKeyOverride?: boolean;
  readonly testID?: string;
}

const COLLAPSE_LIMIT = 5;
const UNDO_MS = 4000;

/**
 * 理解卡（SS-43 / SS-188 / SS-202）：
 * - 列出理解要点，超过 5 条时折叠；
 * - requiresSignature !== false 时主按钮用 SignedButton，否则用 PrimaryButton；
 * - 点下后走 4 秒撤销条；到点进入 working 态 await onConfirm，成功才置 confirmed 并 haptics.success()，
 *   失败或抛错回到 pending、展示错误原因并 haptics.warning()；
 * - 否定动作「不对…」用 TextButton 靠左，问原因输入框 16pt。
 */
export function UnderstandingCard({
  card,
  lang: langProp,
  onConfirm,
  onReject,
  hasKeyOverride,
  testID = 'understanding-card',
}: UnderstandingCardProps) {
  const lang = langProp ?? detectLang();
  const [expanded, setExpanded] = useState(false);
  const [askingReason, setAskingReason] = useState(false);
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState<'pending' | 'undoing' | 'working' | 'confirmed' | 'rejected'>(
    card.status === 'done' ? 'confirmed' : card.status === 'dismissed' ? 'rejected' : 'pending',
  );
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const shouldFold = card.points.length > COLLAPSE_LIMIT;
  const visiblePoints = shouldFold && !expanded ? card.points.slice(0, COLLAPSE_LIMIT) : card.points;
  const hiddenCount = card.points.length - COLLAPSE_LIMIT;

  const runConfirm = async () => {
    setDecision('working');
    setConfirmError(null);
    try {
      await onConfirm?.(card.id);
      setDecision('confirmed');
      haptics.success();
    } catch (err) {
      const msg =
        err instanceof Error && err.message.trim()
          ? err.message
          : tUnderstanding(lang, 'understanding.confirmFailed');
      setConfirmError(msg);
      setDecision('pending');
      setAttempt((a) => a + 1);
      haptics.warning();
    }
  };

  const handleConfirm = () => {
    if (busy || decision !== 'pending') return;
    setConfirmError(null);
    setDecision('undoing');
    undoStore.show({
      text: tUnderstanding(lang, 'understanding.undoToast'),
      ms: UNDO_MS,
      fire: () => {
        void runConfirm();
      },
      onUndo: () => {
        setDecision('pending');
      },
    });
  };

  const handleRejectSubmit = async () => {
    const trimmed = reason.trim();
    if (busy || !trimmed) return;
    setBusy(true);
    try {
      await onReject?.(card.id, trimmed);
      setDecision('rejected');
      setAskingReason(false);
    } finally {
      setBusy(false);
    }
  };

  const isWorking = decision === 'working';

  const footer =
    decision === 'confirmed' ? (
      <Text style={[styles.doneNote, { color: color.ok }]} testID="understanding-confirmed">
        {tUnderstanding(lang, 'understanding.confirmed')}
      </Text>
    ) : decision === 'rejected' ? (
      <Text style={[styles.doneNote, { color: color.text2 }]} testID="understanding-rejected">
        {tUnderstanding(lang, 'understanding.rejected')}
      </Text>
    ) : decision === 'undoing' ? (
      <Text style={[styles.pendingUndo, { color: color.text3 }]} testID="understanding-undoing">
        {tUnderstanding(lang, 'understanding.pendingUndo')}
      </Text>
    ) : askingReason ? (
      <View style={styles.reasonBox}>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder={tUnderstanding(lang, 'understanding.reasonPlaceholder')}
          placeholderTextColor={color.text3}
          multiline
          style={[
            styles.reasonInput,
            { color: color.text, backgroundColor: color.sunken, borderColor: color.hairline },
          ]}
          testID="understanding-reason-input"
          accessibilityLabel={tUnderstanding(lang, 'understanding.reasonPlaceholder')}
        />
        <ActionRow
          negative={
            <TextButton
              label={tUnderstanding(lang, 'understanding.reasonCancel')}
              onPress={() => setAskingReason(false)}
              testID="understanding-reason-cancel"
            />
          }
          primary={
            <PrimaryButton
              label={tUnderstanding(lang, 'understanding.reasonSend')}
              disabled={!reason.trim() || busy}
              state={busy ? 'working' : 'idle'}
              onPress={() => void handleRejectSubmit()}
              testID="understanding-reason-submit"
            />
          }
        />
      </View>
    ) : (
      <ActionRow
        negative={
          <TextButton
            label={tUnderstanding(lang, 'understanding.reject')}
            onPress={() => {
              if (!isWorking) setAskingReason(true);
            }}
            testID="understanding-reject"
          />
        }
        primary={
          card.requiresSignature !== false ? (
            <SignedButton
              key={attempt}
              label={tUnderstanding(lang, 'understanding.confirm')}
              state={isWorking ? 'working' : 'idle'}
              disabled={busy || isWorking}
              error={confirmError}
              hasKeyOverride={hasKeyOverride}
              onPress={handleConfirm}
              testID="understanding-confirm"
            />
          ) : (
            <PrimaryButton
              key={attempt}
              label={tUnderstanding(lang, 'understanding.confirm')}
              state={isWorking ? 'working' : 'idle'}
              disabled={busy || isWorking}
              error={confirmError}
              onPress={handleConfirm}
              testID="understanding-confirm"
            />
          )
        }
      />
    );

  return (
    <Card
      title={decision === 'confirmed' ? tUnderstanding(lang, 'understanding.titleDone') : tUnderstanding(lang, 'understanding.title')}
      status={decision === 'pending' || decision === 'undoing' || decision === 'working' ? 'needs-you' : 'done'}
      footer={footer}
      testID={testID}
    >
      <View style={styles.list}>
        {visiblePoints.map((point, idx) => (
          <View key={`${idx}-${point}`} style={styles.row}>
            <View style={[styles.bullet, { backgroundColor: color.text2 }]} />
            <Text style={[styles.point, { color: color.text }]}>{point}</Text>
          </View>
        ))}

        {shouldFold ? (
          <Pressable
            onPress={() => setExpanded((v) => !v)}
            accessibilityRole="button"
            testID="understanding-toggle"
            style={styles.toggleBtn}
          >
            <Text style={[styles.toggleLabel, { color: color.info }]}>
              {expanded
                ? tUnderstanding(lang, 'understanding.collapse')
                : tUnderstanding(lang, 'understanding.expand', { n: hiddenCount })}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {card.outOfScope && card.outOfScope.length > 0 ? (
        <View style={[styles.scopeBox, { backgroundColor: color.sunken }]}>
          <Text style={[styles.scopeTitle, { color: color.text3OnSunken }]}>
            {tUnderstanding(lang, 'understanding.outOfScope')}
          </Text>
          {card.outOfScope.map((item, idx) => (
            <Text key={`${idx}-${item}`} style={[styles.scopeItem, { color: color.text2 }]}>
              · {item}
            </Text>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { gap: space[2] },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  bullet: { width: 5, height: 5, borderRadius: 3, marginTop: 8 },
  point: { ...type.callout, flex: 1 },
  toggleBtn: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  toggleLabel: { ...type.caption, fontWeight: '600' },
  scopeBox: { padding: space[3], borderRadius: radius.m, gap: space[1] },
  scopeTitle: { ...type.caption, fontWeight: '600' },
  scopeItem: { ...type.caption },
  reasonBox: { gap: space[3] },
  reasonInput: {
    ...type.callout,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 56,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderRadius: radius.m,
    padding: space[3],
  },
  pendingUndo: { ...type.caption },
  doneNote: { ...type.callout, fontWeight: '600' },
});
