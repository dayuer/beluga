import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { RequestStatus } from '../../lib/views';
import { color, elevation, radius, space, type } from '../../lib/theme';

export interface CardProps {
  readonly title: string;
  readonly status?: RequestStatus;
  readonly statusLabel?: string;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  readonly testID?: string;
}

const DOT_COLOR: Record<RequestStatus, string | null> = {
  working: color.ok,
  'needs-you': color.needsYouDot,
  waiting: color.waiting,
  error: color.error,
  done: null,
};

/**
 * 卡片外框（SS-27）：标题、状态圆点、正文槽与底部动作区。
 * 状态变化使用 `accessibilityLiveRegion="polite"`，读屏礼貌播报且不抢焦点。
 */
export function Card({ title, status, statusLabel, children, footer, testID }: CardProps) {
  const dotColor = status ? DOT_COLOR[status] : null;
  const accessibleStatus = statusLabel ?? (status === 'needs-you' ? '等你' : status === 'waiting' ? '等待' : status === 'working' ? '进行中' : status === 'error' ? '需要处理' : status === 'done' ? '已完成' : undefined);

  return (
    <View
      testID={testID}
      style={[
        styles.card,
        {
          backgroundColor: elevation.card.surface,
          borderColor: elevation.card.border,
        },
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: color.text }]}>{title}</Text>
        {(dotColor || accessibleStatus) ? (
          <View
            style={styles.statusWrap}
            accessible
            accessibilityLiveRegion="polite"
            accessibilityLabel={accessibleStatus}
          >
            {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
            {statusLabel ? <Text style={[styles.statusText, { color: color.text3 }]}>{statusLabel}</Text> : null}
          </View>
        ) : null}
      </View>

      {children ? <View style={styles.body}>{children}</View> : null}
      {footer ? <View style={[styles.footer, { borderTopColor: color.hairline }]}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.l,
    borderWidth: 1,
    padding: space[5],
    gap: space[4],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  title: {
    ...type.heading,
    flex: 1,
  },
  statusWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  statusText: {
    ...type.caption,
  },
  body: {
    gap: space[3],
  },
  footer: {
    paddingTop: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
