import { StyleSheet, Text, View } from 'react-native';
import { color, space, type } from '../lib/theme';

/** BLG-84 replaces this with the magic-link screen. The route exists now so the guard has a
 * target and the web build has a real page. */
export default function LoginScreen() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Synon Studio</Text>
      <Text style={styles.body}>登录屏（BLG-84 实现）</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bg, padding: space[6] },
  title: { ...type.title, color: color.text },
  body: { ...type.body, color: color.text2, marginTop: space[3], textAlign: 'center' },
});
