import { StyleSheet, Text, View } from 'react-native';
import { detectLang, t } from '../lib/strings';
import type { RequestStatus } from '../lib/views';
import { color, radius, space, type } from '../lib/theme';

export interface StatusDotProps {
  readonly status: RequestStatus;
  readonly size?: number;
  readonly label?: string;
  readonly testID?: string;
}

const STATUS_KEYS: Record<RequestStatus, 'status.aiWorking' | 'status.needsYou' | 'status.waiting' | 'status.error' | 'status.done'> = {
  working: 'status.aiWorking',
  'needs-you': 'status.needsYou',
  waiting: 'status.waiting',
  error: 'status.error',
  done: 'status.done',
};

/**
 * 状态圆点（SS-33 / SS-141）：
 * - 等你：`color.needsYouDot`（#C28A1E）
 * - 等待：`color.waiting`（#B9B9BF）
 * - AI 在做：`color.ok`
 * - 需你亲手修：`color.error`
 * - 已完成（done）：不画点（与 `Card.tsx` 和 `docs/studio-ui.md §1` 一致）
 */
export function StatusDot({ status, size = 8, label, testID }: StatusDotProps) {
  const dotColor =
    status === 'done'
      ? null
      : status === 'needs-you'
        ? color.needsYouDot
        : status === 'waiting'
          ? color.waiting
          : status === 'error'
            ? color.error
            : color.ok;

  const a11yLabel = label ?? t(detectLang(), STATUS_KEYS[status]);

  return (
    <View
      testID={testID}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={a11yLabel}
      style={styles.wrap}
    >
      {dotColor ? (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: radius.pill,
            backgroundColor: dotColor,
          }}
        />
      ) : null}
      {label ? <Text style={[styles.label, { color: color.text3 }]}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  label: {
    ...type.caption,
  },
});
