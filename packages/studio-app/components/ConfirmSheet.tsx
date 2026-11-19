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
  /** 主按钮动作名，必须由调用方传入（如「上线」「移除设备」），不写「确定」。 */
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly onConfirm: () => void;
  readonly state?: PrimaryButtonState;
  readonly error?: string | null;
  readonly testID?: string;
}

/**
 * 不可逆动作的确认抽屉（SS-34）：
 * 复用 `Drawer` 的抽屉手势；取消在左、主动作在右，主按钮文字必须由调用方传入具体动作名。
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
      <View style={styles.body}>
        <Text style={[styles.titleText, { color: color.text }]}>{title}</Text>
        {description ? <Text style={[styles.desc, { color: color.text2 }]}>{description}</Text> : null}
      </View>
    </Drawer>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: space[4],
    gap: space[3],
  },
  titleText: {
    ...type.heading,
  },
  desc: {
    ...type.body,
  },
});
