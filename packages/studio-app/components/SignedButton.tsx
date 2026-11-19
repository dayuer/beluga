import { StyleSheet, Text, View } from 'react-native';
import { useHasDeviceKey } from '../lib/keys';
import { color, space, type } from '../lib/theme';
import { PrimaryButton, type PrimaryButtonState } from './PrimaryButton';

export interface SignedButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly state?: PrimaryButtonState;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly onDone?: () => void;
  readonly error?: string | null;
  /** 可选覆盖密钥状态（主要供预览或单测使用）；默认读取 `useHasDeviceKey()`。 */
  readonly hasKeyOverride?: boolean;
  readonly testID?: string;
}

/**
 * 签名主按钮（SS-32）：包一层 `PrimaryButton`，旁边写「由这台设备确认」。
 * 没有设备密钥时按钮置灰不可点，并在下方说明原因与登记位置（「我 › 设备」）。
 */
export function SignedButton({
  label,
  onPress,
  state,
  loading,
  disabled = false,
  onDone,
  error,
  hasKeyOverride,
  testID = 'signed-button',
}: SignedButtonProps) {
  const detected = useHasDeviceKey();
  const hasKey = hasKeyOverride ?? detected.hasKey;
  const off = disabled || !hasKey;

  return (
    <View style={styles.wrap}>
      <PrimaryButton
        testID={testID}
        label={label}
        onPress={onPress}
        state={state}
        loading={loading}
        disabled={off}
        onDone={onDone}
        error={error}
      />
      {hasKey ? (
        <Text style={[styles.hint, { color: color.text3 }]}>由这台设备确认</Text>
      ) : (
        <Text style={[styles.hint, { color: color.text3 }]}>
          这台设备还没有登记密钥，无法确认此操作；请前往「我 › 设备」添加设备。
        </Text>
      )}
    </View>
  );
}

SignedButton.displayName = 'SignedButton';

const styles = StyleSheet.create({
  wrap: {
    gap: space[2],
  },
  hint: {
    ...type.caption,
  },
});
