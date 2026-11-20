import { StyleSheet, Text, View } from 'react-native';
import { detectLang, t, type Lang } from '../../lib/strings';
import { color, space, type } from '../../lib/theme';
import type { RequestStep, ResultDrawerView } from '../../lib/views';
import { ReadOnlyDiffList } from '../DraftDiff';
import { InlineHint } from '../InlineHint';

export interface ChangesTabProps {
  readonly changes: ResultDrawerView['changes'];
  readonly milestones?: readonly RequestStep[];
  readonly lang?: Lang;
  readonly testID?: string;
}

/**
 * 抽屉页签：改动（SS-50）：复用 DraftDiff 的 ReadOnlyDiffList，按里程碑分组（若有），只读展示。
 */
export function ChangesTab({ changes, milestones = [], lang: langProp, testID = 'drawer-changes-tab' }: ChangesTabProps) {
  const lang = langProp ?? detectLang();
  const hasAny = changes.added.length > 0 || changes.modified.length > 0 || changes.removed.length > 0;

  if (!hasAny) {
    return (
      <View testID={testID}>
        <InlineHint
          tone="info"
          reason={t(lang, 'changes.emptyReason')}
          whenReady={t(lang, 'changes.emptyWhen')}
          testID={`${testID}-empty`}
        />
      </View>
    );
  }

  return (
    <View style={styles.root} testID={testID}>
      {changes.pendingApproval ? (
        <InlineHint tone="info" reason={t(lang, 'changes.pendingHint')} testID={`${testID}-pending`} />
      ) : null}

      {milestones.length > 0 ? (
        <View style={styles.groupHeader}>
          <Text style={[styles.groupTitle, { color: color.text3 }]}>
            {t(lang, 'changes.milestonePrefix', { n: 1 })}
            {milestones[0]!.title}
          </Text>
        </View>
      ) : null}

      <ReadOnlyDiffList
        added={changes.added}
        modified={changes.modified}
        removed={changes.removed}
        lang={lang}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[3] },
  groupHeader: { paddingTop: space[1] },
  groupTitle: { ...type.caption, fontWeight: '600' },
});
