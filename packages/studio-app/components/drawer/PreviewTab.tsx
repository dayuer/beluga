import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Download, Globe } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { detectLang, type Lang } from '../../lib/strings';
import { tDrawer } from '../../lib/strings/drawer';
import { color, radius, space, stroke, type } from '../../lib/theme';
import { InlineHint } from '../InlineHint';
import { PrimaryButton } from '../PrimaryButton';

export type PreviewState = 'ready' | 'deploying' | 'unconfigured';

export interface PreviewTabProps {
  readonly previewUrl?: string;
  readonly installUrl?: string;
  readonly state?: PreviewState;
  readonly lang?: Lang;
  readonly onOpenBrowser?: (url: string) => Promise<void> | void;
  readonly onDownloadInstall?: (url: string) => Promise<void> | void;
  readonly testID?: string;
}

/**
 * 抽屉页签：预览（SS-51）：测试环境地址用 expo-web-browser 打开，安装包给下载；
 * 没有预览时原地说明原因（还在部署 / 未配置测试环境）。
 */
export function PreviewTab({
  previewUrl,
  installUrl,
  state,
  lang: langProp,
  onOpenBrowser,
  onDownloadInstall,
  testID = 'drawer-preview-tab',
}: PreviewTabProps) {
  const lang = langProp ?? detectLang();
  const effectiveState: PreviewState = state ?? (previewUrl || installUrl ? 'ready' : 'unconfigured');

  if (effectiveState === 'deploying') {
    return (
      <View testID={testID}>
        <InlineHint
          tone="waiting"
          reason={tDrawer(lang, 'preview.deployingReason')}
          whenReady={tDrawer(lang, 'preview.deployingWhen')}
          testID={`${testID}-deploying`}
        />
      </View>
    );
  }

  if (effectiveState === 'unconfigured' || (!previewUrl && !installUrl)) {
    return (
      <View testID={testID}>
        <InlineHint
          tone="info"
          reason={tDrawer(lang, 'preview.unconfiguredReason')}
          whenReady={tDrawer(lang, 'preview.unconfiguredWhen')}
          testID={`${testID}-unconfigured`}
        />
      </View>
    );
  }

  const openBrowser = () => {
    if (!previewUrl) return;
    if (onOpenBrowser) {
      void onOpenBrowser(previewUrl);
    } else {
      void WebBrowser.openBrowserAsync(previewUrl);
    }
  };

  const downloadInstall = () => {
    if (!installUrl) return;
    if (onDownloadInstall) {
      void onDownloadInstall(installUrl);
    } else {
      void Linking.openURL(installUrl);
    }
  };

  return (
    <View style={styles.root} testID={testID}>
      <View style={[styles.card, { backgroundColor: color.card, borderColor: color.hairline }]}>
        <View style={styles.titleRow}>
          <Globe size={18} color={color.info} strokeWidth={stroke} />
          <Text style={[styles.title, { color: color.text }]}>{tDrawer(lang, 'preview.readyTitle')}</Text>
        </View>
        <Text style={[styles.desc, { color: color.text2 }]}>{tDrawer(lang, 'preview.readyDesc')}</Text>
        {previewUrl ? (
          <Text style={[styles.url, { color: color.text3 }]} numberOfLines={1}>
            {previewUrl}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        {previewUrl ? (
          <PrimaryButton label={tDrawer(lang, 'preview.openBrowser')} onPress={openBrowser} testID="preview-open-browser" />
        ) : null}

        {installUrl ? (
          <Pressable
            onPress={downloadInstall}
            accessibilityRole="button"
            testID="preview-download-install"
            style={({ pressed }) => [
              styles.secondaryBtn,
              { backgroundColor: color.card, borderColor: color.hairlineStrong },
              pressed && { backgroundColor: color.press },
            ]}
          >
            <Download size={16} color={color.text} strokeWidth={stroke} />
            <Text style={[styles.secondaryLabel, { color: color.text }]}>{tDrawer(lang, 'preview.downloadBuild')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[4] },
  card: {
    padding: space[4],
    borderRadius: radius.m,
    borderWidth: StyleSheet.hairlineWidth,
    gap: space[2],
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  title: { ...type.callout, fontWeight: '600' },
  desc: { ...type.caption },
  url: { ...type.caption },
  actions: { gap: space[2] },
  secondaryBtn: {
    minHeight: 48,
    borderRadius: radius.m,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    paddingHorizontal: space[4],
  },
  secondaryLabel: { ...type.callout, fontWeight: '600' },
});
