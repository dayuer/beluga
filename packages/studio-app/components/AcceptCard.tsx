import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StudioMilestone, StudioPlanView } from '../../../src/studio/protocol';
import { haptics } from '../lib/haptics';
import { detectLang, t, type Lang } from '../lib/strings';
import { signedCardStrings } from '../lib/strings/signed-cards';
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
  const c = signedCardStrings(lang);
  const [pendingUndo, setPendingUndo] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    setPendingUndo(false);
    setWorking(false);
    setError(null);
    setApproved(card?.status === 'done');
  }, [card?.id, card?.status]);

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
  const criteria = card?.criteria ?? [];
  const screenshots = card?.screenshots ?? [];
  const previewUrl = card?.previewUrl;
  const installUrl = card?.installUrl;
  const isDone = approved || card?.status === 'done';

  const openUrl = (url?: string) => {
    if (!url) return;
    if (onOpenPreview) {
      onOpenPreview(url);
    } else {
      void Linking.openURL(url);
    }
  };

  const handleApprove = () => {
    if (pendingUndo || working || isDone) return;
    setError(null);
    setPendingUndo(true);
    undoStore.show({
      text: c['accept.undoText'](round),
      ms: 10_000,
      fire: () => {
        setPendingUndo(false);
        setWorking(true);
        void Promise.resolve()
          .then(() => onSigned?.())
          .then(
            () => {
              setWorking(false);
              setApproved(true);
              haptics.success();
            },
            (err: unknown) => {
              setWorking(false);
              setError(err instanceof Error ? err.message : c['signed.failed']);
              haptics.warning();
            },
          );
      },
      onUndo: () => {
        setPendingUndo(false);
      },
    });
  };

  return (
    <Card
      title={c['accept.roundTitle'](round)}
      status={isDone ? 'done' : 'needs-you'}
      statusLabel={isDone ? c['accept.approved'] : c['accept.needsYou']}
      testID={testID}
      footer={
        isDone ? (
          <Text style={[styles.doneHint, { color: color.ok }]} testID="accept-approved-hint">
            {c['accept.approved']}
          </Text>
        ) : pendingUndo ? (
          <Text style={[styles.doneHint, { color: color.text2 }]} testID="accept-pending-undo">
            {c['accept.pendingUndo']}
          </Text>
        ) : (
          <ActionRow
            negative={
              onNotYet ? <TextButton label={c['accept.notYet']} onPress={onNotYet} testID="accept-not-yet" /> : undefined
            }
            primary={
              <SignedButton
                label={c['accept.approve']}
                onPress={handleApprove}
                state={working ? 'working' : 'idle'}
                error={error}
                hasKeyOverride={hasKeyOverride}
                testID="accept-approve"
              />
            }
          />
        )
      }
    >
      {criteria.length > 0 ? (
        <View style={styles.sectionPlain} testID="accept-criteria">
          <Text style={[styles.label, { color: color.text3 }]}>{c['accept.criteria']}</Text>
          {criteria.map((item) => (
            <Text key={item} style={[styles.bodyText, { color: color.text }]}>
              ◦ {item}
            </Text>
          ))}
        </View>
      ) : null}

      {summary ? (
        <View style={styles.sectionPlain}>
          <Text style={[styles.label, { color: color.text3 }]}>{c['accept.howToCheck']}</Text>
          <Text style={[styles.bodyText, { color: color.text }]}>{summary}</Text>
        </View>
      ) : null}

      {screenshots.length > 0 ? (
        <View style={styles.sectionPlain} testID="accept-screenshots">
          <Text style={[styles.label, { color: color.text3 }]}>{c['accept.screenshots']}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shotRow}>
            {screenshots.map((uri, idx) => (
              <Image
                key={`${uri}-${idx}`}
                source={{ uri }}
                style={[styles.shot, { borderColor: color.hairline, backgroundColor: color.sunken }]}
                accessibilityLabel={`${c['accept.screenshots']} ${idx + 1}`}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {previewUrl ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => openUrl(previewUrl)}
          testID="accept-open-preview"
          style={({ pressed }) => [
            styles.previewBtn,
            { backgroundColor: color.sunken, borderColor: color.hairline },
            pressed && { backgroundColor: color.press },
          ]}
        >
          <Text style={[styles.previewLabel, { color: color.info }]}>{c['accept.openPreview']}</Text>
        </Pressable>
      ) : null}

      {installUrl ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => openUrl(installUrl)}
          testID="accept-open-install"
          style={({ pressed }) => [
            styles.previewBtn,
            { backgroundColor: color.sunken, borderColor: color.hairline },
            pressed && { backgroundColor: color.press },
          ]}
        >
          <Text style={[styles.previewLabel, { color: color.text }]}>{c['accept.openInstall']}</Text>
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
