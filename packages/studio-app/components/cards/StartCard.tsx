import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { haptics } from '../../lib/haptics';
import { detectLang, type Lang } from '../../lib/strings';
import { signedCardStrings } from '../../lib/strings/signed-cards';
import { color, space, type } from '../../lib/theme';
import type { KnownStudioCard } from '../../lib/views';
import { ActionRow } from '../card/ActionRow';
import { Card } from '../card/Card';
import { SignedButton } from '../SignedButton';
import { TextButton } from '../TextButton';

export type StartCardModel = Extract<KnownStudioCard, { kind: 'start' }>;

export interface StartCardProps {
  readonly card: StartCardModel;
  /** 可选展示的具体步骤标题列表。 */
  readonly steps?: readonly string[];
  /** 可选说明「怎么做」。 */
  readonly howItWorks?: string;
  /** 可选说明「什么时候开始」。 */
  readonly whenToStart?: string;
  /** 点击「先不做…」回调。 */
  readonly onDecline?: () => void;
  /** 点击「开始做」确认开工回调。 */
  readonly onStart?: () => void | Promise<void>;
  readonly hasKeyOverride?: boolean;
  readonly lang?: Lang;
  readonly testID?: string;
}

/**
 * P10 批准开工卡（SS-62）：
 * 展示步骤、大约多久、怎么做、什么时候开始；
 * 「先不做…」靠左，「开始做」靠右用 `SignedButton`（旁带「由这台设备确认」/ 无密钥提示）。
 */
export function StartCard({
  card,
  steps,
  howItWorks,
  whenToStart,
  onDecline,
  onStart,
  hasKeyOverride,
  lang: langProp,
  testID = 'start-card',
}: StartCardProps) {
  const lang = langProp ?? detectLang();
  const c = signedCardStrings(lang);
  const [started, setStarted] = useState(card.status === 'done');
  const [busy, setBusy] = useState(false);

  const handleStart = async () => {
    if (started || busy) return;
    setBusy(true);
    try {
      await onStart?.();
      setStarted(true);
      haptics.success();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={card.planTitle}
      status={started ? 'done' : 'needs-you'}
      statusLabel={started ? c['start.statusDone'] : c['start.statusPending']}
      testID={testID}
      footer={
        started ? (
          <Text style={[styles.doneHint, { color: color.ok }]} testID="start-confirmed-hint">
            {c['start.started']}
          </Text>
        ) : (
          <ActionRow
            negative={
              onDecline ? <TextButton label={c['start.decline']} onPress={onDecline} testID="start-decline" /> : undefined
            }
            primary={
              <SignedButton
                label={c['start.start']}
                onPress={() => void handleStart()}
                loading={busy}
                hasKeyOverride={hasKeyOverride}
                testID="start-approve"
              />
            }
          />
        )
      }
    >
      <View style={styles.rows}>
        <View style={styles.row}>
          <Text style={[styles.label, { color: color.text3 }]}>{c['start.stepsLabel']}</Text>
          <Text style={[styles.value, { color: color.text }]}>{c['start.stepsCount'](card.stepCount)}</Text>
        </View>
        {steps && steps.length > 0 ? (
          <View style={styles.stepList}>
            {steps.map((s, idx) => (
              <Text key={`${s}-${idx}`} style={[styles.stepItem, { color: color.text2 }]}>
                {idx + 1}. {s}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.row}>
          <Text style={[styles.label, { color: color.text3 }]}>{c['start.estimateLabel']}</Text>
          <Text style={[styles.value, { color: color.text }]}>{card.estimateLabel || c['start.estimateFallback']}</Text>
        </View>

        <View style={styles.block}>
          <Text style={[styles.label, { color: color.text3 }]}>{c['start.howLabel']}</Text>
          <Text style={[styles.value, { color: color.text2 }]}>{howItWorks || c['start.howFallback']}</Text>
        </View>

        <View style={styles.row}>
          <Text style={[styles.label, { color: color.text3 }]}>{c['start.whenLabel']}</Text>
          <Text style={[styles.value, { color: color.text }]}>{whenToStart || c['start.whenFallback']}</Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  rows: { gap: space[3] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[3] },
  block: { gap: space[1] },
  label: { ...type.caption, fontWeight: '600' },
  value: { ...type.callout },
  stepList: { gap: space[1], paddingLeft: space[2] },
  stepItem: { ...type.caption },
  doneHint: { ...type.callout, fontWeight: '500' },
});
