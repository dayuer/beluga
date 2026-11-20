import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { z } from 'zod';
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
 * 理解卡（SS-43 / 决定 sign-in-app-2）：
 * - 列出理解要点，超过 5 条时折叠；
 * - 主动作「对，就是这样」使用 SignedButton（无设备密钥时不可点并说明原因）；
 * - 点下主动作后进入 4 秒撤销条，撤销窗口内不发任何签名动作；
 * - 否定动作「不对，我改一下」靠左、描边、不用签名。
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
  const [decision, setDecision] = useState<'pending' | 'undoing' | 'confirmed' | 'rejected'>(
    card.status === 'done' ? 'confirmed' : card.status === 'dismissed' ? 'rejected' : 'pending',
  );
  const [busy, setBusy] = useState(false);

  const shouldFold = card.points.length > COLLAPSE_LIMIT;
  const visiblePoints = shouldFold && !expanded ? card.points.slice(0, COLLAPSE_LIMIT) : card.points;
  const hiddenCount = card.points.length - COLLAPSE_LIMIT;

  const handleConfirm = () => {
    if (busy || decision !== 'pending') return;
    setDecision('undoing');
    undoStore.show({
      text: tUnderstanding(lang, 'understanding.undoToast'),
      ms: UNDO_MS,
      fire: () => {
        setDecision('confirmed');
        void onConfirm?.(card.id);
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
            onPress={() => setAskingReason(true)}
            testID="understanding-reject"
          />
        }
        primary={
          card.requiresSignature !== false ? (
            <SignedButton
              label={tUnderstanding(lang, 'understanding.confirm')}
              disabled={busy}
              hasKeyOverride={hasKeyOverride}
              onPress={handleConfirm}
              testID="understanding-confirm"
            />
          ) : (
            <PrimaryButton
              label={tUnderstanding(lang, 'understanding.confirm')}
              disabled={busy}
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
      status={decision === 'pending' || decision === 'undoing' ? 'needs-you' : 'done'}
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
  toggleBtn: { paddingVertical: space[1], alignSelf: 'flex-start' },
  toggleLabel: { ...type.caption, fontWeight: '600' },
  scopeBox: { padding: space[3], borderRadius: radius.m, gap: space[1] },
  scopeTitle: { ...type.caption, fontWeight: '600' },
  scopeItem: { ...type.caption },
  outlinedBtn: {
    minHeight: 44,
    paddingHorizontal: space[3],
    borderRadius: radius.m,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBtn: { paddingVertical: space[2], paddingHorizontal: space[1] },
  textBtnLabel: { ...type.callout, fontWeight: '600' },
  reasonBox: { gap: space[3] },
  reasonInput: {
    ...type.callout,
    minHeight: 56,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderRadius: radius.m,
    padding: space[3],
  },
  pendingUndo: { ...type.caption },
  doneNote: { ...type.callout, fontWeight: '600' },
});
