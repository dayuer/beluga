import { Redirect, useLocalSearchParams } from 'expo-router';

function firstParam(raw: string | string[] | undefined): string {
  const val = Array.isArray(raw) ? raw[0] : raw;
  return typeof val === 'string' ? val.trim() : '';
}

/**
 * 旧计划页转到需求详情（SS-117 / SS-186）：参数归一，缺失时回退到 `/` 。
 */
export default function LegacyPlanRedirect() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const pid = firstParam(id);
  if (pid) {
    return <Redirect href={{ pathname: '/request/[id]', params: { id: pid } }} />;
  }
  return <Redirect href="/" />;
}
