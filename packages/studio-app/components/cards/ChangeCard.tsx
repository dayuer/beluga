import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StudioDraftDiff } from '../../../../src/studio/protocol';
import { haptics } from '../../lib/haptics';
import { detectLang, t, type Lang } from '../../lib/strings';
import { signedCardStrings } from '../../lib/strings/signed-cards';
import { color, space, type } from '../../lib/theme';
import { undoStore } from '../../lib/undo';
import type { KnownStudioCard } from '../../lib/views';
import { ActionRow } from '../card/ActionRow';
import { Card } from '../card/Card';
import { SignedButton } from '../SignedButton';
import { TextButton } from '../TextButton';

export type ChangesCardModel = Extract<KnownStudioCard, { kind: 'changes' }>;

export interface ChangeCardProps {
  readonly card: ChangesCardModel;
  /** 可选传入结构化 DraftDiff（提供修改前后的详情对比）。 */
  readonly diff?: StudioDraftDiff;
  readonly onDecline?: () => void;
  readonly onApprove?: () => void | Promise<void>;
  readonly hasKeyOverride?: boolean;
  readonly lang?: Lang;
  readonly testID?: string;
}

/**
 * 批准改动卡（SS-63）：
 * 「还不行…」之后计划的改动，复用 DraftDiff 的增（+）、改（~）、删（−）样式；
 * 「先不改…」靠左，「按这个改」靠右用 `SignedButton`。
 */
export function ChangeCard({
  card,
  diff,
  onDecline,
  onApprove,
  hasKeyOverride,
  lang: langProp,
  testID = 'change-card',
}: ChangeCardProps) {
  const lang = langProp ?? detectLang();
  const c = signedCardStrings(lang);
  const [approved, setApproved] = useState(card.status === 'done');
  const [pendingUndo, setPendingUndo] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setApproved(card.status === 'done');
    setPendingUndo(false);
    setWorking(false);
    setError(null);
  }, [card.id, card.status]);

  const addedItems = diff ? diff.added.map((x) => x.title) : card.added;
  const modifiedItems = diff
    ? diff.changed.map((x) => ({ title: x.title, before: x.before, after: x.after }))
    : card.modified.map((title) => ({ title, before: undefined as string | undefined, after: undefined as string | undefined }));
  const removedItems = diff ? diff.removed.map((x) => x.title) : card.removed;

  const handleApprove = () => {
    if (approved || pendingUndo || working) return;
    setError(null);
    setPendingUndo(true);
    undoStore.show({
      text: c['change.undoText'],
      ms: 4000,
      fire: () => {
        setPendingUndo(false);
        setWorking(true);
        void Promise.resolve()
          .then(() => onApprove?.())
          .then(
            () => {
              setWorking(false);
              setApproved(true);
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
      title={c['change.title']}
      status={approved ? 'done' : 'needs-you'}
      statusLabel={approved ? c['change.statusDone'] : c['change.statusPending']}
      testID={testID}
      footer={
        approved ? (
          <Text style={[styles.doneHint, { color: color.ok }]} testID="change-approved-hint">
            {c['change.approved']}
          </Text>
        ) : pendingUndo ? (
          <Text style={[styles.doneHint, { color: color.text2 }]} testID="change-pending-undo">
            {c['change.pendingUndo']}
          </Text>
        ) : (
          <ActionRow
            negative={
              onDecline ? <TextButton label={c['change.decline']} onPress={onDecline} testID="change-decline" /> : undefined
            }
            primary={
              <SignedButton
                label={c['change.approve']}
                onPress={handleApprove}
                state={working ? 'working' : 'idle'}
                error={error}
                hasKeyOverride={hasKeyOverride}
                testID="change-approve"
              />
            }
          />
        )
      }
    >
      {card.summary ? <Text style={[styles.summary, { color: color.text }]}>{card.summary}</Text> : null}

      {addedItems.length > 0 ? (
        <View style={styles.group} testID="change-added">
          <Text style={[styles.groupTitle, { color: color.ok }]}>{t(lang, 'diff.added')}</Text>
          {addedItems.map((title, i) => (
            <View key={`a-${i}`} style={styles.row}>
              <Text style={[styles.sign, { color: color.ok }]}>+</Text>
              <Text style={[styles.itemText, { color: color.text }]}>{title}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {modifiedItems.length > 0 ? (
        <View style={styles.group} testID="change-modified">
          <Text style={[styles.groupTitle, { color: color.warn }]}>{t(lang, 'diff.changed')}</Text>
          {modifiedItems.map((item, i) => (
            <View key={`m-${i}`} style={styles.row}>
              <Text style={[styles.sign, { color: color.warn }]}>~</Text>
              <View style={styles.itemBody}>
                <Text style={[styles.itemText, { color: color.text }]}>{item.title}</Text>
                {item.before !== undefined && item.after !== undefined ? (
                  <View style={styles.beforeAfter} testID={`change-before-after-${i}`}>
                    <Text style={[styles.before, { color: color.text3 }]}>{item.before}</Text>
                    <Text style={[styles.arrow, { color: color.text3 }]}>→</Text>
                    <Text style={[styles.after, { color: color.text2 }]}>{item.after}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {removedItems.length > 0 ? (
        <View style={styles.group} testID="change-removed">
          <Text style={[styles.groupTitle, { color: color.error }]}>{t(lang, 'diff.removed')}</Text>
          {removedItems.map((title, i) => (
            <View key={`r-${i}`} style={styles.row}>
              <Text style={[styles.sign, { color: color.error }]}>−</Text>
              <Text style={[styles.itemText, styles.removed, { color: color.text2 }]}>{title}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  summary: { ...type.callout },
  group: { gap: space[1] },
  groupTitle: { ...type.caption, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  sign: { ...type.callout, fontWeight: '700', width: 14, textAlign: 'center' },
  itemBody: { flex: 1, gap: space[1] },
  itemText: { ...type.callout, flex: 1 },
  beforeAfter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[1] },
  before: { ...type.caption, textDecorationLine: 'line-through' },
  arrow: { ...type.caption },
  after: { ...type.caption },
  removed: { textDecorationLine: 'line-through' },
  doneHint: { ...type.callout, fontWeight: '500' },
});
