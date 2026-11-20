import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { detectLang, t } from '../../lib/strings';
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

function dotColorFor(status: RequestStatus): string | null {
  switch (status) {
    case 'working':
      return color.ok;
    case 'needs-you':
      return color.needsYouDot;
    case 'waiting':
      return color.waiting;
    case 'error':
      return color.error;
    case 'done':
      return null;
  }
}

const STATUS_KEY: Record<RequestStatus, 'status.needsYou' | 'status.waiting' | 'status.working' | 'status.error' | 'status.done'> = {
  'needs-you': 'status.needsYou',
  waiting: 'status.waiting',
  working: 'status.working',
  error: 'status.error',
  done: 'status.done',
};

/**
 * 卡片外框（SS-27 / SS-141 / SS-144）：标题、状态圆点、正文槽与底部动作区。
 * 颜色在渲染期读取 `color.*` 以跟随深色模式；状态变化使用 `accessibilityLiveRegion="polite"`。
 */
export function Card({ title, status, statusLabel, children, footer, testID }: CardProps) {
  const dotColor = status ? dotColorFor(status) : null;
  const accessibleStatus = statusLabel ?? (status ? t(detectLang(), STATUS_KEY[status]) : undefined);

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
