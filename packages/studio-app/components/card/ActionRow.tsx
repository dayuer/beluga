import { isValidElement, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, space, type } from '../../lib/theme';

export interface ActionRowProps {
  /** 否定动作（如「还不行…」「先不做…」），固定靠左。 */
  readonly negative?: ReactNode;
  /** 中间一句后果说明（如「由这台设备确认」）。 */
  readonly hint?: string;
  /** 主动作（至多一个实底按钮），固定靠右。 */
  readonly primary?: ReactNode;
  readonly testID?: string;
}

function isFilledElement(node: ReactNode): boolean {
  if (!isValidElement(node)) return false;
  const props = node.props as Record<string, unknown> | null;
  if (props && props.filled === false) return false;
  if (props && props.filled === true) return true;
  const compType = node.type as { displayName?: string; name?: string } | string;
  const name = typeof compType === 'string' ? compType : (compType.displayName ?? compType.name ?? '');
  return name === 'PrimaryButton' || name === 'SignedButton';
}

/** 开发态校验：同一动作行至多一个实底按钮。 */
export function assertSingleFilledButton(negative: ReactNode, primary: ReactNode): void {
  const count = (isFilledElement(negative) ? 1 : 0) + (isFilledElement(primary) ? 1 : 0);
  if (count > 1) {
    throw new Error('ActionRow: 同一行至多允许一个实底按钮（PrimaryButton / SignedButton）');
  }
}

/**
 * 卡片动作行（SS-27）：否定动作靠左、主动作靠右、中间一句后果说明。
 * 三种排法：只有主动作、主+否定、主+否定+说明。
 */
export function ActionRow({ negative, hint, primary, testID }: ActionRowProps) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    assertSingleFilledButton(negative, primary);
  }

  return (
    <View testID={testID} style={styles.row}>
      {negative ? <View style={styles.left}>{negative}</View> : null}
      {hint ? (
        <Text style={[styles.hint, { color: color.text3 }, !negative && styles.hintLeft]} numberOfLines={2}>
          {hint}
        </Text>
      ) : null}
      {primary ? <View style={styles.right}>{primary}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  left: {
    flexShrink: 0,
  },
  hint: {
    ...type.caption,
    flex: 1,
    textAlign: 'center',
  },
  hintLeft: {
    textAlign: 'left',
  },
  right: {
    marginLeft: 'auto',
    flexShrink: 0,
  },
});
