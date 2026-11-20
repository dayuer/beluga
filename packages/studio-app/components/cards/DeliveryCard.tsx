import { StyleSheet, Text, View } from 'react-native';
import { detectLang, type Lang } from '../../lib/strings';
import { signedCardStrings } from '../../lib/strings/signed-cards';
import { color, radius, space, type } from '../../lib/theme';
import type { KnownStudioCard } from '../../lib/views';
import { ActionRow } from '../card/ActionRow';
import { Card } from '../card/Card';
import { PrimaryButton } from '../PrimaryButton';

export type DeliveryCardModel = Extract<KnownStudioCard, { kind: 'delivery' }>;

export interface DeliveryCardProps {
  readonly card: DeliveryCardModel;
  /** 是否已完成检查（默认 true，自动交付通知卡出现时已通过）。 */
  readonly checksPassed?: boolean;
  /** 是否已合并（默认 true）。 */
  readonly merged?: boolean;
  /** 点击主动作「去看看」，打开结果抽屉的预览页签（不签名）。 */
  readonly onOpenPreviewTab?: (previewUrl?: string) => void;
  readonly lang?: Lang;
  readonly testID?: string;
}

/**
 * 交付卡（SS-65，自动交付的通知卡）：
 * 自动交付后出现，说明检查通过、已合并、预览地址；
 * 主动作「去看看」使用 `PrimaryButton` 打开结果抽屉的预览页签（不签名）。
 */
export function DeliveryCard({
  card,
  checksPassed = true,
  merged = true,
  onOpenPreviewTab,
  lang: langProp,
  testID = 'delivery-card',
}: DeliveryCardProps) {
  const lang = langProp ?? detectLang();
  const c = signedCardStrings(lang);

  return (
    <Card
      title={c['delivery.title'](card.round)}
      status="done"
      statusLabel={c['delivery.statusDone']}
      testID={testID}
      footer={
        <ActionRow
          primary={
            <PrimaryButton
              label={c['delivery.openPreview']}
              onPress={() => onOpenPreviewTab?.(card.previewUrl)}
              testID="delivery-open-preview"
            />
          }
        />
      }
    >
      <View style={styles.badges}>
        {checksPassed ? (
          <View style={[styles.badge, { backgroundColor: color.sunken }]} testID="delivery-checks-passed">
            <Text style={[styles.badgeCheck, { color: color.ok }]}>✓</Text>
            <Text style={[styles.badgeText, { color: color.text }]}>{c['delivery.checksPassed']}</Text>
          </View>
        ) : null}
        {merged ? (
          <View style={[styles.badge, { backgroundColor: color.sunken }]} testID="delivery-merged">
            <Text style={[styles.badgeCheck, { color: color.ok }]}>✓</Text>
            <Text style={[styles.badgeText, { color: color.text }]}>{c['delivery.merged']}</Text>
          </View>
        ) : null}
      </View>

      {card.summary ? <Text style={[styles.summary, { color: color.text2 }]}>{card.summary}</Text> : null}

      {card.previewUrl ? (
        <View style={[styles.urlBox, { backgroundColor: color.sunken, borderColor: color.hairline }]} testID="delivery-preview-url">
          <Text style={[styles.urlLabel, { color: color.text3OnSunken }]}>{c['delivery.previewLabel']}</Text>
          <Text style={[styles.urlValue, { color: color.info }]} selectable numberOfLines={2}>
            {card.previewUrl}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.pill,
  },
  badgeCheck: { ...type.caption, fontWeight: '700' },
  badgeText: { ...type.caption, fontWeight: '600' },
  summary: { ...type.callout },
  urlBox: {
    borderRadius: radius.m,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space[3],
    gap: space[1],
  },
  urlLabel: { ...type.caption, fontWeight: '600' },
  urlValue: { ...type.caption },
});
