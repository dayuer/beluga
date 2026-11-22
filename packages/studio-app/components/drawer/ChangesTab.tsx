import { StyleSheet, Text, View } from 'react-native';
import { detectLang, type Lang } from '../../lib/strings';
import { tDrawer } from '../../lib/strings/drawer';
import { color, space, type } from '../../lib/theme';
import type { RequestStep, ResultDrawerView } from '../../lib/views';
import { ReadOnlyDiffList } from '../DraftDiff';
import { InlineHint } from '../InlineHint';

export interface MilestoneChangeGroup {
  readonly milestoneTitle: string;
  readonly added: readonly string[];
  readonly modified: readonly string[];
  readonly removed: readonly string[];
}

export interface ChangesTabProps {
  readonly changes: ResultDrawerView['changes'] & {
    readonly groups?: readonly MilestoneChangeGroup[];
  };
  readonly milestones?: readonly RequestStep[];
  readonly lang?: Lang;
  readonly testID?: string;
}

/**
 * 抽屉页签：改动（SS-50 / SS-187）：复用 DraftDiff 的 ReadOnlyDiffList；
 * 仅当视图数据里明确带有改动归属（groups）时按里程碑分组，否则直接列出只读改动。
 */
export function ChangesTab({ changes, lang: langProp, testID = 'drawer-changes-tab' }: ChangesTabProps) {
  const lang = langProp ?? detectLang();
  const groups = changes.groups ?? [];
  const hasAny =
    groups.length > 0 ||
    changes.added.length > 0 ||
    changes.modified.length > 0 ||
    changes.removed.length > 0;

  if (!hasAny) {
    return (
      <View testID={testID}>
        <InlineHint
          tone="info"
          reason={tDrawer(lang, 'changes.emptyReason')}
          whenReady={tDrawer(lang, 'changes.emptyWhen')}
          testID={`${testID}-empty`}
        />
      </View>
    );
  }

  return (
    <View style={styles.root} testID={testID}>
      {changes.pendingApproval ? (
        <InlineHint tone="info" reason={tDrawer(lang, 'changes.pendingHint')} testID={`${testID}-pending`} />
      ) : null}

      {groups.length > 0 ? (
        groups.map((group, idx) => (
          <View key={`${idx}-${group.milestoneTitle}`} style={styles.groupBlock}>
            <Text style={[styles.groupTitle, { color: color.text3 }]}>{group.milestoneTitle}</Text>
            <ReadOnlyDiffList
              added={group.added}
              modified={group.modified}
              removed={group.removed}
              lang={lang}
            />
          </View>
        ))
      ) : (
        <ReadOnlyDiffList
          added={changes.added}
          modified={changes.modified}
          removed={changes.removed}
          lang={lang}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[3] },
  groupBlock: { gap: space[2] },
  groupTitle: { ...type.caption, fontWeight: '600' },
});
