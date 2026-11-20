import { AlertCircle, Clock, Gauge, Info, UserCheck, WifiOff } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import type { WaitReason } from '../lib/views';
import { color, radius, space, stroke, type } from '../lib/theme';

export type InlineHintTone = 'waiting' | 'info' | 'error';

export interface InlineHintProps {
  /** 原因说明（如「执行机器暂时离线」「还没有可看的预览」）。 */
  readonly reason: string;
  /** 何时会好（如「机器上线后会自动继续」「本轮检查通过后出现」）。 */
  readonly whenReady?: string;
  readonly tone?: InlineHintTone;
  readonly waitReason?: WaitReason;
  readonly testID?: string;
}

function pickIcon(tone: InlineHintTone, waitReason?: WaitReason) {
  if (tone === 'error') return AlertCircle;
  if (waitReason === 'offline') return WifiOff;
  if (waitReason === 'queued') return Clock;
  if (waitReason === 'quota') return Gauge;
  if (waitReason === 'needs-human') return UserCheck;
  return tone === 'waiting' ? Clock : Info;
}

/**
 * 原地提示（SS-33）：图标 + 原因 + 何时会好。
 * 绝不弹窗、不遮罩，直接嵌在对应内容区域里；灰底上使用 `color.text3OnSunken`（#6A6A70）。
 */
export function InlineHint({
  reason,
  whenReady,
  tone = 'waiting',
  waitReason,
  testID = 'inline-hint',
}: InlineHintProps) {
  const Icon = pickIcon(tone, waitReason);
  const iconColor = tone === 'error' ? color.error : tone === 'info' ? color.info : color.text3OnSunken;

  return (
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      style={[styles.box, { backgroundColor: color.sunken, borderColor: color.hairline }]}
    >
      <View style={styles.iconWrap}>
        <Icon size={16} color={iconColor} strokeWidth={stroke} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.reason, { color: tone === 'error' ? color.error : color.text2 }]}>{reason}</Text>
        {whenReady ? (
          <Text style={[styles.when, { color: color.text3OnSunken }]}>{whenReady}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.m,
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    paddingTop: 2,
  },
  copy: {
    flex: 1,
    gap: space[1],
  },
  reason: {
    ...type.callout,
  },
  when: {
    ...type.caption,
  },
});
