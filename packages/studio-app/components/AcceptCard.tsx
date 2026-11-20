import { useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StudioMilestone, StudioPlanView } from '../../../src/studio/protocol';
import { haptics } from '../lib/haptics';
import { detectLang, t, type Lang } from '../lib/strings';
import { color, radius, space, type } from '../lib/theme';
import { undoStore } from '../lib/undo';
import type { KnownStudioCard } from '../lib/views';

type DeliveryCardModel = Extract<KnownStudioCard, { kind: 'delivery' }>;
import { ActionRow } from './card/ActionRow';
import { Card } from './card/Card';
import { SignedButton } from './SignedButton';
import { TextButton } from './TextButton';

export interface AcceptCardProps {
  /** P5 新版交付验收卡数据。 */
  readonly card?: DeliveryCardModel;
  /** 点击「还不行…」打开原因抽屉（P7）。 */
  readonly onNotYet?: () => void;
  /** 10 秒撤销窗口结束后真正发出的签名通过动作。 */
  readonly onSigned?: () => void | Promise<void>;
  /** 打开体验版（未传时默认用系统浏览器打开 previewUrl / installUrl）。 */
  readonly onOpenPreview?: (url: string) => void;
  /** 可选覆盖设备密钥状态（单测 / 预览用）。 */
  readonly hasKeyOverride?: boolean;
  readonly lang?: Lang;
  readonly testID?: string;
  /** 兼容旧版 app/plan/[id].tsx 调用的可选字段。 */
  readonly milestone?: StudioMilestone;
  readonly review?: StudioPlanView['review'];
}

const COPY = {
  zh: {
    roundTitle: (n: number) => `第 ${n} 轮交付`,
    howToCheck: '怎么看',
    screenshots: '截图',
    openPreview: '打开体验版',
    notYet: '还不行…',
    approve: '通过',
    approved: '已通过',
    pendingUndo: '已通过，10 秒内可撤销',
    undoText: (n: number) => `已通过第 ${n} 轮交付`,
    needsYou: '等你验收',
  },
  en: {
    roundTitle: (n: number) => `Delivery round ${n}`,
    howToCheck: 'What to check',
    screenshots: 'Screenshots',
    openPreview: 'Open preview',
    notYet: 'Not yet…',
    approve: 'Approve',
    approved: 'Approved',
    pendingUndo: 'Approved · undo within 10s',
    undoText: (n: number) => `Approved delivery round ${n}`,
    needsYou: 'Needs review',
  },
} as const;

/**
 * P5 交付验收卡（SS-60）：
 * 展示第几次交付、截图、怎么看、打开体验版；
 * 「还不行…」靠左（打开 ReasonSheet），「通过」靠右用 SignedButton；
 * 点通过 → 进入全局 undo store 10 秒倒计时 → 到点才调 onSigned 并触发一次 success 触感。
 */
export function AcceptCard({
  card,
  onNotYet,
  onSigned,
  onOpenPreview,
  hasKeyOverride,
  lang: langProp,
  testID = 'accept-card',
  milestone,
  review,
}: AcceptCardProps) {
  const lang = langProp ?? detectLang();
  const c = COPY[lang];
  const [pendingUndo, setPendingUndo] = useState(false);
  const [approved, setApproved] = useState(false);

  if (!card && milestone) {
    const notes = review?.milestoneRef === milestone.ref ? review.notes.trim() : '';
    return (
      <Card title={milestone.title} status="needs-you" statusLabel={t(lang, 'review.title')} testID={testID}>
        {milestone.criteria.length ? (
          <View style={styles.list}>
            {milestone.criteria.map((item) => (
              <Text key={item} style={[styles.bodyText, { color: color.text2 }]}>
                ◦ {item}
              </Text>
            ))}
          </View>
        ) : null}
        {notes ? (
          <View style={[styles.section, { borderTopColor: color.hairline }]}>
            <Text style={[styles.label, { color: color.text2 }]}>{t(lang, 'review.notes')}</Text>
            <Text style={[styles.bodyText, { color: color.text2 }]}>{notes}</Text>
          </View>
        ) : null}
      </Card>
    );
  }

  const round = card?.round ?? 1;
  const summary = card?.summary ?? '';
  const screenshots = card?.screenshots ?? [];
  const previewTarget = card?.previewUrl ?? card?.installUrl;
  const isDone = approved || card?.status === 'done';

  const handleOpenPreview = () => {
    if (!previewTarget) return;
    if (onOpenPreview) {
      onOpenPreview(previewTarget);
    } else {
      void Linking.openURL(previewTarget);
    }
  };

  const handleApprove = () => {
    if (pendingUndo || isDone) return;
    setPendingUndo(true);
    undoStore.show({
      text: c.undoText(round),
      ms: 10_000,
      fire: () => {
        setPendingUndo(false);
        setApproved(true);
        const result = onSigned?.();
        if (result && typeof (result as Promise<void>).then === 'function') {
          void (result as Promise<void>).then(
            () => haptics.success(),
            () => {},
          );
        } else {
          haptics.success();
        }
      },
      onUndo: () => {
        setPendingUndo(false);
      },
    });
  };

  return (
    <Card
      title={c.roundTitle(round)}
      status={isDone ? 'done' : 'needs-you'}
      statusLabel={isDone ? c.approved : c.needsYou}
      testID={testID}
      footer={
        isDone ? (
          <Text style={[styles.doneHint, { color: color.ok }]} testID="accept-approved-hint">
            {c.approved}
          </Text>
        ) : pendingUndo ? (
          <Text style={[styles.doneHint, { color: color.text2 }]} testID="accept-pending-undo">
            {c.pendingUndo}
          </Text>
        ) : (
          <ActionRow
            negative={
              onNotYet ? <TextButton label={c.notYet} onPress={onNotYet} testID="accept-not-yet" /> : undefined
            }
            primary={
              <SignedButton
                label={c.approve}
                onPress={handleApprove}
                hasKeyOverride={hasKeyOverride}
                testID="accept-approve"
              />
            }
          />
        )
      }
    >
      {summary ? (
        <View style={styles.sectionPlain}>
          <Text style={[styles.label, { color: color.text3 }]}>{c.howToCheck}</Text>
          <Text style={[styles.bodyText, { color: color.text }]}>{summary}</Text>
        </View>
      ) : null}

      {screenshots.length > 0 ? (
        <View style={styles.sectionPlain} testID="accept-screenshots">
          <Text style={[styles.label, { color: color.text3 }]}>{c.screenshots}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shotRow}>
            {screenshots.map((uri, idx) => (
              <Image
                key={`${uri}-${idx}`}
                source={{ uri }}
                style={[styles.shot, { borderColor: color.hairline, backgroundColor: color.sunken }]}
                accessibilityLabel={`${c.screenshots} ${idx + 1}`}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {previewTarget ? (
        <Pressable
          accessibilityRole="button"
          onPress={handleOpenPreview}
          testID="accept-open-preview"
          style={({ pressed }) => [
            styles.previewBtn,
            { backgroundColor: color.sunken, borderColor: color.hairline },
            pressed && { backgroundColor: color.press },
          ]}
        >
          <Text style={[styles.previewLabel, { color: color.info }]}>{c.openPreview}</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { gap: space[1] },
  sectionPlain: { gap: space[1] },
  section: { gap: space[1], borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space[3] },
  label: { ...type.caption, fontWeight: '600' },
  bodyText: { ...type.callout },
  shotRow: { gap: space[2], paddingTop: space[1] },
  shot: { width: 120, height: 180, borderRadius: radius.m, borderWidth: 1 },
  previewBtn: {
    minHeight: 44,
    borderRadius: radius.m,
    borderWidth: 1,
    paddingHorizontal: space[4],
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewLabel: { ...type.callout, fontWeight: '600' },
  doneHint: { ...type.callout, fontWeight: '500' },
});
