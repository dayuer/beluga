import { StyleSheet, Text, View } from 'react-native';
import { color, space, type } from '../lib/theme';
import { ActionRow } from './card/ActionRow';
import { Drawer } from './Drawer';
import { PrimaryButton, type PrimaryButtonState } from './PrimaryButton';
import { TextButton } from './TextButton';

export interface ConfirmSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** 标题直接说后果，例如「移除后这台设备将无法确认任何操作」。 */
  readonly title: string;
  readonly description?: string;
  /** 主按钮动作名，必须由调用方传入（如「上线」「移除设备」），禁止传「确定」或「OK」。 */
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly onConfirm: () => void;
  readonly state?: PrimaryButtonState;
  readonly error?: string | null;
  readonly testID?: string;
}

/** 开发态校验：不可逆确认抽屉的主按钮必须写具体动作名，禁止「确定」或「OK」。 */
export function assertConfirmActionLabel(label: string): void {
  const normalized = label.trim();
  if (normalized === '确定' || normalized.toUpperCase() === 'OK') {
    throw new Error('ConfirmSheet: 主按钮文字必须写具体动作名（如「上线」「移除设备」），禁止使用「确定」或「OK」');
  }
}

/**
 * 不可逆动作的确认抽屉（SS-34 / SS-142）：
 * 复用 `Drawer` 的抽屉手势；标题只出现在头部一次；取消在左、主动作在右。
 */
export function ConfirmSheet({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  onConfirm,
  state = 'idle',
  error,
  testID = 'confirm-sheet',
}: ConfirmSheetProps) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    assertConfirmActionLabel(confirmLabel);
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      testID={testID}
      footer={
        <ActionRow
          negative={<TextButton label={cancelLabel} onPress={onClose} testID={`${testID}-cancel`} />}
          primary={
            <PrimaryButton
              label={confirmLabel}
              onPress={onConfirm}
              state={state}
              error={error}
              testID={`${testID}-confirm`}
            />
          }
        />
      }
    >
      {description ? (
        <View style={styles.body}>
          <Text style={[styles.desc, { color: color.text2 }]}>{description}</Text>
        </View>
      ) : null}
    </Drawer>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: space[4],
    gap: space[3],
  },
  desc: {
    ...type.body,
  },
});
