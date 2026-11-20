import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * 旧项目页转到需求列表并按项目过滤（SS-117）：旧链接不坏，旧屏不再维护。
 */
export default function LegacyProjectRedirect() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  if (id) {
    return <Redirect href={{ pathname: '/(tabs)', params: { project: id } }} />;
  }
  return <Redirect href="/(tabs)" />;
}
