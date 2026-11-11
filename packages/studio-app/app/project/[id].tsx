import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Header } from '../../components/Header';
import { detectLang, t } from '../../lib/strings';
import { color, space, type } from '../../lib/theme';

/** BLG-85 replaces this with the plan list and the New request action. */
export default function ProjectHomeScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const lang = detectLang();
  const title = typeof id === 'string' && id.length > 0 ? id : t(lang, 'projects.title');

  return (
    <View style={styles.root}>
      <Header title={title} back />
      <View style={styles.body}>
        <Text style={styles.title}>项目首页（BLG-85 实现）</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[6] },
  title: { ...type.body, color: color.text2, textAlign: 'center' },
});
