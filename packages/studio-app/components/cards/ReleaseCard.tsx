import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { haptics } from '../../lib/haptics';
import { detectLang, type Lang } from '../../lib/strings';
import { signedCardStrings } from '../../lib/strings/signed-cards';
import { color, space, type } from '../../lib/theme';
import { ago } from '../../lib/time';
import type { KnownStudioCard } from '../../lib/views';
import { ActionRow } from '../card/ActionRow';
import { Card } from '../card/Card';
import { ConfirmSheet } from '../ConfirmSheet';
import { SignedButton } from '../SignedButton';
import { TextButton } from '../TextButton';

export type ReleaseCardModel = Extract<KnownStudioCard, { kind: 'release' }>;

export interface ReleaseCardProps {
  readonly card: ReleaseCardModel;
  /** 是否为受保护环境；非受保护环境不出此卡（返回 null）。默认 true。 */
  readonly protectedEnv?: boolean;
  /** 上次上线执行人（与上次上线时间分列展示）。 */
  readonly lastReleaseBy?: string;
  readonly onDecline?: () => void;
  readonly onRelease?: () => void | Promise<void>;
  readonly hasKeyOverride?: boolean;
  readonly lang?: Lang;
  readonly testID?: string;
}

/**
 * P11 批准上线卡（SS-64）：
 * 只在受保护环境展示；展示要上的版本、线上版本、上次上线（时间与人分列）；
 * 「先不上…」靠左，「上线」靠右使用 `SignedButton`，点击后弹出 `ConfirmSheet`（不可撤销）二次确认，
 * 确认上线成功触发一次 `haptics.success()`。
 */
export function ReleaseCard({
  card,
  protectedEnv = true,
  lastReleaseBy,
  onDecline,
  onRelease,
  hasKeyOverride,
  lang: langProp,
  testID = 'release-card',
}: ReleaseCardProps) {
  const lang = langProp ?? detectLang();
  const c = signedCardStrings(lang);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [released, setReleased] = useState(card.status === 'done');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!protectedEnv) return null;

  const actor =
    lastReleaseBy ??
    (typeof (card as Record<string, unknown>).lastReleaseBy === 'string'
      ? ((card as Record<string, unknown>).lastReleaseBy as string)
      : undefined);

  const handleConfirm = async () => {
    if (busy || released) return;
    setBusy(true);
    setError(null);
    try {
      await onRelease?.();
      setReleased(true);
      setConfirmOpen(false);
      haptics.success();
    } catch (err) {
      setError(err instanceof Error ? err.message : c['release.unknown']);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card
        title={c['release.title'](card.envTitle)}
        status={released ? 'done' : 'needs-you'}
        statusLabel={released ? c['release.statusDone'] : c['release.statusPending']}
        testID={testID}
        footer={
          released ? (
            <Text style={[styles.doneHint, { color: color.ok }]} testID="release-done-hint">
              {c['release.released']}
            </Text>
          ) : (
            <ActionRow
              negative={
                onDecline ? <TextButton label={c['release.decline']} onPress={onDecline} testID="release-decline" /> : undefined
              }
              primary={
                <SignedButton
                  label={c['release.release']}
                  onPress={() => setConfirmOpen(true)}
                  hasKeyOverride={hasKeyOverride}
                  testID="release-approve"
                />
              }
            />
          )
        }
      >
        <View style={styles.grid}>
          <View style={styles.col}>
            <Text style={[styles.label, { color: color.text3 }]}>{c['release.targetVersion']}</Text>
            <Text style={[styles.value, { color: color.text }]} testID="release-target-version">
              {card.version}
            </Text>
          </View>
          <View style={styles.col}>
            <Text style={[styles.label, { color: color.text3 }]}>{c['release.liveVersion']}</Text>
            <Text style={[styles.value, { color: color.text2 }]} testID="release-live-version">
              {card.lastVersion || c['release.unknown']}
            </Text>
          </View>
        </View>

        <View style={[styles.grid, styles.divider, { borderTopColor: color.hairline }]}>
          <View style={styles.col} testID="release-last-time-col">
            <Text style={[styles.label, { color: color.text3 }]}>{c['release.lastReleaseTime']}</Text>
            <Text style={[styles.value, { color: color.text2 }]}>
              {card.lastReleaseAt ? ago(card.lastReleaseAt, lang) : c['release.unknown']}
            </Text>
          </View>
          <View style={styles.col} testID="release-last-person-col">
            <Text style={[styles.label, { color: color.text3 }]}>{c['release.lastReleasePerson']}</Text>
            <Text style={[styles.value, { color: color.text2 }]}>{actor || c['release.unknown']}</Text>
          </View>
        </View>
      </Card>

      <ConfirmSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={c['release.confirmTitle'](card.envTitle)}
        description={c['release.confirmDesc'](card.version, card.envTitle, card.lastVersion)}
        confirmLabel={c['release.release']}
        onConfirm={() => void handleConfirm()}
        state={busy ? 'working' : 'idle'}
        error={error}
        testID="release-confirm-sheet"
      />
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: space[4] },
  col: { flex: 1, gap: space[1] },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space[3] },
  label: { ...type.caption, fontWeight: '600' },
  value: { ...type.callout, fontWeight: '500' },
  doneHint: { ...type.callout, fontWeight: '500' },
});
