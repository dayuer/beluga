import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { z } from 'zod';
import { detectLang, t, type Lang } from '../../lib/strings';
import { color, radius, space, type } from '../../lib/theme';
import type { UnderstandingCardSchema } from '../../lib/views';
import { ActionRow } from '../card/ActionRow';
import { Card } from '../card/Card';
import { PrimaryButton } from '../PrimaryButton';

export type UnderstandingCardData = z.infer<typeof UnderstandingCardSchema>;

export interface UnderstandingCardProps {
  readonly card: UnderstandingCardData;
  readonly lang?: Lang;
  readonly onConfirm?: (cardId: string) => Promise<void> | void;
  readonly onReject?: (cardId: string, reason: string) => Promise<void> | void;
  readonly testID?: string;
}

const COLLAPSE_LIMIT = 5;

/**
 * 理解卡（SS-43）：列出理解要点（超过 5 条默认折叠），主动作「对，就是这样」，否定「不对…」问原因。
 * 先用普通 PrimaryButton；若按 decide-sign-understanding 需签名，换 SignedButton 一行即可。
 */
export function UnderstandingCard({
  card,
  lang: langProp,
  onConfirm,
  onReject,
  testID = 'understanding-card',
}: UnderstandingCardProps) {
  const lang = langProp ?? detectLang();
  const [expanded, setExpanded] = useState(false);
  const [askingReason, setAskingReason] = useState(false);
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState<'pending' | 'confirmed' | 'rejected'>(
    card.status === 'done' ? 'confirmed' : card.status === 'dismissed' ? 'rejected' : 'pending',
  );
  const [busy, setBusy] = useState(false);

  const shouldFold = card.points.length > COLLAPSE_LIMIT;
  const visiblePoints = shouldFold && !expanded ? card.points.slice(0, COLLAPSE_LIMIT) : card.points;
  const hiddenCount = card.points.length - COLLAPSE_LIMIT;

  const handleConfirm = async () => {
    if (busy || decision !== 'pending') return;
    setBusy(true);
    try {
      await onConfirm?.(card.id);
      setDecision('confirmed');
    } finally {
      setBusy(false);
    }
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
        {t(lang, 'understanding.confirmed')}
      </Text>
    ) : decision === 'rejected' ? (
      <Text style={[styles.doneNote, { color: color.text2 }]} testID="understanding-rejected">
        {t(lang, 'understanding.rejected')}
      </Text>
    ) : askingReason ? (
      <View style={styles.reasonBox}>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder={t(lang, 'understanding.reasonPlaceholder')}
          placeholderTextColor={color.text3}
          multiline
          style={[
            styles.reasonInput,
            { color: color.text, backgroundColor: color.sunken, borderColor: color.hairline },
          ]}
          testID="understanding-reason-input"
          accessibilityLabel={t(lang, 'understanding.reasonPlaceholder')}
        />
        <ActionRow
          negative={
            <Pressable
              onPress={() => setAskingReason(false)}
              disabled={busy}
              accessibilityRole="button"
              testID="understanding-reason-cancel"
              style={styles.textBtn}
            >
              <Text style={[styles.textBtnLabel, { color: color.text2 }]}>
                {t(lang, 'understanding.reasonCancel')}
              </Text>
            </Pressable>
          }
          primary={
            <PrimaryButton
              label={t(lang, 'understanding.reasonSend')}
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
          <Pressable
            onPress={() => setAskingReason(true)}
            disabled={busy}
            accessibilityRole="button"
            testID="understanding-reject"
            style={styles.textBtn}
          >
            <Text style={[styles.textBtnLabel, { color: color.text2 }]}>{t(lang, 'understanding.reject')}</Text>
          </Pressable>
        }
        primary={
          <PrimaryButton
            label={t(lang, 'understanding.confirm')}
            disabled={busy}
            state={busy ? 'working' : 'idle'}
            onPress={() => void handleConfirm()}
            testID="understanding-confirm"
          />
        }
      />
    );

  return (
    <Card
      title={decision === 'confirmed' ? t(lang, 'understanding.titleDone') : t(lang, 'understanding.title')}
      status={decision === 'pending' ? 'needs-you' : 'done'}
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
                ? t(lang, 'understanding.collapse')
                : t(lang, 'understanding.expand', { n: hiddenCount })}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {card.outOfScope && card.outOfScope.length > 0 ? (
        <View style={[styles.scopeBox, { backgroundColor: color.sunken }]}>
          <Text style={[styles.scopeTitle, { color: color.text3OnSunken }]}>
            {t(lang, 'understanding.outOfScope')}
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
  doneNote: { ...type.callout, fontWeight: '600' },
});
