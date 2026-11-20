import * as Linking from 'expo-linking';
import { Download, ExternalLink, FileText, Globe, Image } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { detectLang, type Lang } from '../../lib/strings';
import { tDrawer } from '../../lib/strings/drawer';
import { color, radius, space, stroke, type } from '../../lib/theme';
import type { ResultDrawerView } from '../../lib/views';
import { InlineHint } from '../InlineHint';

export interface OutputsTabProps {
  readonly artifacts: ResultDrawerView['artifacts'];
  readonly attachments?: ResultDrawerView['attachments'];
  readonly lang?: Lang;
  readonly onOpenUrl?: (url: string) => Promise<void> | void;
  readonly testID?: string;
}

type ArtifactKind = ResultDrawerView['artifacts'][number]['kind'];

const KIND_KEY: Record<
  ArtifactKind,
  'outputs.kind.preview' | 'outputs.kind.build' | 'outputs.kind.screenshot' | 'outputs.kind.note' | 'outputs.kind.attachment'
> = {
  preview: 'outputs.kind.preview',
  build: 'outputs.kind.build',
  screenshot: 'outputs.kind.screenshot',
  note: 'outputs.kind.note',
  attachment: 'outputs.kind.attachment',
};

function iconFor(kind: ArtifactKind) {
  switch (kind) {
    case 'preview':
      return Globe;
    case 'build':
      return Download;
    case 'screenshot':
      return Image;
    default:
      return FileText;
  }
}

/**
 * 抽屉页签：成果（SS-49）：按轮次展示交付的文件、截图、安装包列表，点开用系统打开；没有时用 InlineHint。
 */
export function OutputsTab({
  artifacts,
  attachments = [],
  lang: langProp,
  onOpenUrl,
  testID = 'drawer-outputs-tab',
}: OutputsTabProps) {
  const lang = langProp ?? detectLang();

  const openUrl = (url?: string) => {
    if (!url) return;
    if (onOpenUrl) {
      void onOpenUrl(url);
    } else {
      void Linking.openURL(url);
    }
  };

  if (artifacts.length === 0 && attachments.length === 0) {
    return (
      <View testID={testID}>
        <InlineHint
          tone="info"
          reason={tDrawer(lang, 'outputs.emptyReason')}
          whenReady={tDrawer(lang, 'outputs.emptyWhen')}
          testID={`${testID}-empty`}
        />
      </View>
    );
  }

  // 按轮次倒序分组
  const rounds = [...new Set(artifacts.map((a) => a.round))].sort((a, b) => b - a);

  return (
    <View style={styles.root} testID={testID}>
      {rounds.map((round) => {
        const items = artifacts.filter((a) => a.round === round);
        return (
          <View key={round} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: color.text3 }]}>{tDrawer(lang, 'outputs.round', { n: round })}</Text>
            <View style={[styles.group, { backgroundColor: color.card, borderColor: color.hairline }]}>
              {items.map((item, idx) => {
                const Icon = iconFor(item.kind);
                const tappable = Boolean(item.url);
                return (
                  <Pressable
                    key={item.id}
                    disabled={!tappable}
                    onPress={() => openUrl(item.url)}
                    accessibilityRole={tappable ? 'button' : 'text'}
                    testID={`output-item-${item.id}`}
                    style={({ pressed }) => [
                      styles.row,
                      idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline },
                      pressed && tappable && { backgroundColor: color.press },
                    ]}
                  >
                    <Icon size={18} color={color.text2} strokeWidth={stroke} />
                    <View style={styles.rowCopy}>
                      <Text style={[styles.rowTitle, { color: color.text }]}>{item.title}</Text>
                      <Text style={[styles.rowMeta, { color: color.text3 }]}>{tDrawer(lang, KIND_KEY[item.kind])}</Text>
                    </View>
                    {tappable ? <ExternalLink size={16} color={color.text3} strokeWidth={stroke} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}

      {attachments.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: color.text3 }]}>{tDrawer(lang, 'outputs.attachments')}</Text>
          <View style={[styles.group, { backgroundColor: color.card, borderColor: color.hairline }]}>
            {attachments.map((att, idx) => {
              const tappable = Boolean(att.url);
              return (
                <Pressable
                  key={att.id}
                  disabled={!tappable}
                  onPress={() => openUrl(att.url)}
                  accessibilityRole={tappable ? 'button' : 'text'}
                  testID={`output-attachment-${att.id}`}
                  style={({ pressed }) => [
                    styles.row,
                    idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline },
                    pressed && tappable && { backgroundColor: color.press },
                  ]}
                >
                  <FileText size={18} color={color.text2} strokeWidth={stroke} />
                  <View style={styles.rowCopy}>
                    <Text style={[styles.rowTitle, { color: color.text }]}>{att.name}</Text>
                  </View>
                  {tappable ? <ExternalLink size={16} color={color.text3} strokeWidth={stroke} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[4] },
  section: { gap: space[2] },
  sectionTitle: { ...type.caption, fontWeight: '600' },
  group: { borderRadius: radius.m, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    minHeight: 52,
  },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { ...type.callout, fontWeight: '500' },
  rowMeta: { ...type.caption },
});
