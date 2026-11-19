import { StyleSheet, Text, View } from 'react-native';
import { Header } from '../../components/Header';
import { color, space, type } from '../../lib/theme';

/** 「我」页签占位（SS-24），具体设置各页在后续任务中实现。 */
export default function MeScreen() {
  return (
    <View style={styles.root}>
      <Header title="我" />
      <View style={styles.body}>
        <Text style={styles.hint}>设置与设备管理</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  body: { flex: 1, padding: space[5], justifyContent: 'center', alignItems: 'center' },
  hint: { ...type.callout, color: color.text3OnSunken },
});
