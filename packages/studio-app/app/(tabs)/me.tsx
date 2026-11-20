import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Header } from '../../components/Header';
import { TabBar } from '../../components/TabBar';
import { detectLang, t } from '../../lib/strings';
import { color, space, type } from '../../lib/theme';
import { useTodos } from '../../lib/todo-store';

/** 「我」页签占位（SS-24 / SS-140），大屏下渲染顶部 TabBar，颜色在渲染时读取以跟随深色模式。 */
export default function MeScreen() {
  const lang = detectLang();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const { result } = useTodos();
  const todoCount = result?.todos.length ?? 0;

  return (
    <View style={[styles.root, { backgroundColor: color.bg }]}>
      <Header title={t(lang, 'tabs.me')} />
      {desktop ? <TabBar todoCount={todoCount} /> : null}
      <View style={styles.body}>
        <Text style={[styles.hint, { color: color.text3OnSunken }]}>{t(lang, 'me.placeholder')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, padding: space[5], justifyContent: 'center', alignItems: 'center' },
  hint: { ...type.callout },
});
