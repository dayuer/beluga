import { StyleSheet, Text, View } from 'react-native';
import { color, space, type } from '../lib/theme';

/** BLG-84 replaces this with the project cards. */
export default function ProjectsScreen() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>项目</Text>
      <Text style={styles.body}>项目屏（BLG-84 实现）</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bg, padding: space[6] },
  title: { ...type.title, color: color.text },
  body: { ...type.body, color: color.text2, marginTop: space[3], textAlign: 'center' },
});
