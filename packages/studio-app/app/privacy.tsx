import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Header } from '../components/Header';
import { useScheme } from '../lib/appearance';
import { detectLang } from '../lib/strings';
import { tPrivacy, type PrivacyStringKey } from '../lib/strings/privacy';
import { color, space, type } from '../lib/theme';

/** (标题, 正文) 一节；正文里的空行分段落。与 `docs/studio-privacy.md` 的 9 节一一对应。 */
const SECTIONS: ReadonlyArray<readonly [PrivacyStringKey, PrivacyStringKey]> = [
  ['privacy.dataTitle', 'privacy.dataBody'],
  ['privacy.notTitle', 'privacy.notBody'],
  ['privacy.useTitle', 'privacy.useBody'],
  ['privacy.storeTitle', 'privacy.storeBody'],
  ['privacy.keepTitle', 'privacy.keepBody'],
  ['privacy.permsTitle', 'privacy.permsBody'],
  ['privacy.choicesTitle', 'privacy.choicesBody'],
  ['privacy.contactTitle', 'privacy.contactBody'],
  ['privacy.changesTitle', 'privacy.changesBody'],
];

/**
 * 隐私说明（SS-98）：入口在「我 › 账号」。纯文本、可离线阅读；精简自 `docs/studio-privacy.md`，
 * 上架用的公开网址见该文档「给开发者」。
 */
export default function PrivacyScreen() {
  useScheme();
  const styles = createStyles();
  const lang = detectLang();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

  return (
    <View style={styles.root} testID="privacy-screen">
      <Header title={tPrivacy(lang, 'privacy.title')} back />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          <Text style={styles.intro} testID="privacy-intro">
            {tPrivacy(lang, 'privacy.intro')}
          </Text>
          <Text style={styles.updated} testID="privacy-updated">
            {tPrivacy(lang, 'privacy.updated')}
          </Text>

          {SECTIONS.map(([titleKey, bodyKey]) => (
            <View key={titleKey} style={styles.section} testID={`privacy-section-${titleKey}`}>
              <Text style={styles.sectionTitle}>{tPrivacy(lang, titleKey)}</Text>
              {tPrivacy(lang, bodyKey)
                .split('\n')
                .filter((line) => line.trim().length > 0)
                .map((line, index) => (
                  <Text key={index} style={styles.paragraph}>
                    {line}
                  </Text>
                ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[7] },
  column: { flex: 1, width: '100%' },
  columnDesktop: { maxWidth: 720, alignSelf: 'center', paddingTop: space[4] },
  intro: { ...type.callout, color: color.text },
  updated: { ...type.caption, color: color.text3, marginTop: space[2] },
  section: { marginTop: space[6] },
  sectionTitle: { ...type.heading, color: color.text, marginBottom: space[2] },
  paragraph: { ...type.callout, color: color.text2, marginTop: space[2] },
});
