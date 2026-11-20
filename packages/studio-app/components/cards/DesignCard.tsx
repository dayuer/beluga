import { StyleSheet, Text, View } from 'react-native';
import type { z } from 'zod';
import { detectLang, t, type Lang } from '../../lib/strings';
import { color, radius, space, type } from '../../lib/theme';
import type { DesignCardSchema } from '../../lib/views';
import { Card } from '../card/Card';

export type DesignCardData = z.infer<typeof DesignCardSchema> & {
  /** 可选包名（假数据或未来字段）。 */
  readonly packageName?: string;
  /** 上传进度 0..1；未传或 >= 1 且 status === 'done' 时显示「已收下」。 */
  readonly progress?: number;
};

export interface DesignCardProps {
  readonly card: DesignCardData;
  readonly lang?: Lang;
  readonly testID?: string;
}

/**
 * 设计稿卡（SS-46）：只读展示设计稿包名、文件数、上传进度或「已收下」。
 */
export function DesignCard({ card, lang: langProp, testID = 'design-card' }: DesignCardProps) {
  const lang = langProp ?? detectLang();
  const isUploading = typeof card.progress === 'number' && card.progress < 1 && card.status !== 'done';
  const pct = isUploading ? Math.max(0, Math.min(99, Math.round((card.progress ?? 0) * 100))) : 100;
  const packageName = card.packageName?.trim() || t(lang, 'designCard.defaultName');

  return (
    <Card
      title={t(lang, 'designCard.title')}
      status={isUploading ? 'working' : 'done'}
      statusLabel={isUploading ? t(lang, 'designCard.uploading', { pct }) : t(lang, 'designCard.received')}
      testID={testID}
    >
      <Text style={[styles.name, { color: color.text }]}>{packageName}</Text>
      <Text style={[styles.summary, { color: color.text2 }]}>
        {t(lang, 'designCard.summary', {
          files: card.fileCount,
          images: card.imageCount,
          specs: card.specCount,
        })}
      </Text>

      {isUploading ? (
        <View style={[styles.track, { backgroundColor: color.sunken }]} testID={`${testID}-progress`}>
          <View style={[styles.fill, { backgroundColor: color.info, width: `${pct}%` }]} />
        </View>
      ) : null}

      {card.skipped.length > 0 ? (
        <Text style={[styles.skipped, { color: color.text3 }]}>
          {t(lang, 'designCard.skipped', { n: card.skipped.length })}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  name: { ...type.callout, fontWeight: '600' },
  summary: { ...type.caption },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  skipped: { ...type.caption },
});
