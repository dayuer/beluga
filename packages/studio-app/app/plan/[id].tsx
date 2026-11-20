import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * 旧计划页转到需求详情（SS-117）：旧链接不坏，旧屏不再维护。
 */
export default function LegacyPlanRedirect() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  if (id) {
    return <Redirect href={{ pathname: '/request/[id]', params: { id } }} />;
  }
  return <Redirect href="/(tabs)" />;
}
