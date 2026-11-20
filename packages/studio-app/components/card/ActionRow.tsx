import { createContext, isValidElement, useContext, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useHasDeviceKey } from '../../lib/keys';
import { detectLang, t } from '../../lib/strings';
import { color, space, type } from '../../lib/theme';

export interface ActionRowProps {
  /** 否定动作（如「还不行…」「先不做…」），固定靠左。 */
  readonly negative?: ReactNode;
  /** 动作行下方占满整行的说明（如「由这台设备确认」或无密钥提示）。 */
  readonly hint?: string;
  /** 主动作（至多一个实底按钮），固定靠右。 */
  readonly primary?: ReactNode;
  readonly testID?: string;
}

const InsideActionRowContext = createContext(false);

export function useInsideActionRow(): boolean {
  return useContext(InsideActionRowContext);
}

function elementName(node: ReactNode): string {
  if (!isValidElement(node)) return '';
  const compType = node.type as { displayName?: string; name?: string } | string;
  return typeof compType === 'string' ? compType : (compType.displayName ?? compType.name ?? '');
}

function isFilledElement(node: ReactNode): boolean {
  if (!isValidElement(node)) return false;
  const props = node.props as Record<string, unknown> | null;
  if (props && props.filled === false) return false;
  if (props && props.filled === true) return true;
  const name = elementName(node);
  return name === 'PrimaryButton' || name === 'SignedButton';
}

/** 开发态校验：同一动作行至多一个实底按钮。 */
export function assertSingleFilledButton(negative: ReactNode, primary: ReactNode): void {
  const count = (isFilledElement(negative) ? 1 : 0) + (isFilledElement(primary) ? 1 : 0);
  if (count > 1) {
    throw new Error('ActionRow: 同一行至多允许一个实底按钮（PrimaryButton / SignedButton）');
  }
}

function SignedPrimaryHint({ hasKeyOverride }: { readonly hasKeyOverride?: boolean }) {
  const detected = useHasDeviceKey();
  const hasKey = hasKeyOverride ?? detected.hasKey;
  const lang = detectLang();
  return (
    <Text style={[styles.hint, { color: color.text3 }]} testID="action-row-hint">
      {hasKey ? t(lang, 'signed.byDevice') : t(lang, 'signed.noKeyHint')}
    </Text>
  );
}

/**
 * 卡片动作行（SS-27 / SS-170）：
 * 否定动作靠左、主动作靠右（可收缩），说明文字在动作行下方占满整行并完整折行，避免在 320pt/390pt 窄屏冲出卡片。
 */
export function ActionRow({ negative, hint, primary, testID }: ActionRowProps) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    assertSingleFilledButton(negative, primary);
  }

  const isSignedPrimary = elementName(primary) === 'SignedButton';
  const signedHasKeyOverride = isSignedPrimary
    ? ((primary as React.ReactElement<{ hasKeyOverride?: boolean }>).props?.hasKeyOverride)
    : undefined;

  return (
    <InsideActionRowContext.Provider value>
      <View testID={testID} style={styles.wrap}>
        <View style={styles.row}>
          {negative ? <View style={styles.left}>{negative}</View> : null}
          {primary ? <View style={styles.right}>{primary}</View> : null}
        </View>
        {hint ? (
          <Text style={[styles.hint, { color: color.text3 }]} testID="action-row-hint">
            {hint}
          </Text>
        ) : isSignedPrimary ? (
          <SignedPrimaryHint hasKeyOverride={signedHasKeyOverride} />
        ) : null}
      </View>
    </InsideActionRowContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    gap: space[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  left: {
    flexShrink: 0,
  },
  right: {
    marginLeft: 'auto',
    flexShrink: 1,
    alignItems: 'flex-end',
  },
  hint: {
    ...type.caption,
    width: '100%',
    flexShrink: 1,
  },
});
