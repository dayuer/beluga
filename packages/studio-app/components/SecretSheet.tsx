import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useHasDeviceKey } from '../lib/keys';
import { SECRET_MAX_BYTES } from '../../../src/studio/protocol.js';
import { buildSecretSet, SecretValueError } from '../lib/signed-actions';
import { detectLang, type Lang } from '../lib/strings';
import { tMe } from '../lib/strings/me';
import { color, radius, space, type } from '../lib/theme';
import { useSignedAction } from '../lib/use-signed-action';
import { ActionRow } from './card/ActionRow';
import { ConfirmSheet } from './ConfirmSheet';
import { Drawer } from './Drawer';
import { TextButton } from './TextButton';

export interface SecretSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly projectId: string;
  readonly envId: string;
  /** 密钥名，例如 `STRIPE_SECRET_KEY`。 */
  readonly name: string;
  /** 用途，一行为准。 */
  readonly purpose: string;
  /** 节点的 X25519 封装公钥；拿不到时说明还没准备好，不让发。 */
  readonly nodeSealKey: string | null;
  readonly lang?: Lang;
  /** 保存成功（节点已收到）：列表可以先把这一行的更新时间换掉。 */
  readonly onSaved?: () => void;
  readonly testID?: string;
}

/**
 * 填写 / 更新一个密钥（SS-227，决定 secrets-phone-temp）：
 * - 值只留在这个组件的 state 里，`secureTextEntry` 遮蔽，不写 kv、不写草稿、不进剪贴板；
 * - 发出前用 `ConfirmSheet` 二次确认，主按钮是「保存密钥」；
 * - 动作由 `useSignedAction` 补签名信封；没有设备密钥时按钮不可点并写明原因；
 * - 成功（节点回执 done）后清空输入、关闭抽屉。
 */
export function SecretSheet({
  open,
  onClose,
  projectId,
  envId,
  name,
  purpose,
  nodeSealKey,
  lang: langProp,
  onSaved,
  testID = 'secret-sheet',
}: SecretSheetProps) {
  const lang = langProp ?? detectLang();
  const [value, setValue] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const { ready, hasKey } = useHasDeviceKey();
  const action = useSignedAction(projectId, `secret:${projectId}:${envId}:${name}`);

  // 关掉抽屉就丢掉还没发的值：不留在任何地方。
  useEffect(() => {
    if (open) return;
    setValue('');
    setConfirming(false);
    setLocalError(null);
  }, [open]);

  const canSend = ready && hasKey && nodeSealKey !== null && value.length > 0;
  const error = localError ?? action.error;

  const askConfirm = (): void => {
    setLocalError(null);
    if (!canSend) return;
    const bytes = new TextEncoder().encode(value);
    if (bytes.length > SECRET_MAX_BYTES) {
      setLocalError(tMe(lang, 'env.secretTooLarge', { kb: Math.floor(SECRET_MAX_BYTES / 1024) }));
      return;
    }
    setConfirming(true);
  };

  const save = (): void => {
    if (!canSend || !nodeSealKey) return;
    setLocalError(null);
    void action
      .send(
        (opId) => buildSecretSet({ opId, projectId, envId, name, purpose, value, nodeSealKey }),
        {
          onDone: () => {
            setValue('');
            setConfirming(false);
            onSaved?.();
            onClose();
            action.reset();
          },
        },
      )
      .catch((err: unknown) => {
        setLocalError(err instanceof SecretValueError ? err.message : tMe(lang, 'env.secretSendFailed'));
      });
  };

  const hint = !ready
    ? undefined
    : !hasKey
      ? tMe(lang, 'env.noDeviceKey')
      : nodeSealKey === null
        ? tMe(lang, 'env.noNodeKey')
        : tMe(lang, 'env.secretByDevice');

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={tMe(lang, 'env.secretSheetTitle', { name })}
        testID={testID}
        footer={
          <ActionRow
            negative={<TextButton label={tMe(lang, 'account.cancel')} onPress={onClose} testID={`${testID}-cancel`} />}
            primary={
              <TextButton
                label={tMe(lang, 'env.secretSave')}
                onPress={askConfirm}
                disabled={!canSend}
                testID={`${testID}-ask`}
              />
            }
            hint={hint}
          />
        }
      >
        <View style={styles.body}>
          {purpose ? <Text style={styles.purpose}>{purpose}</Text> : null}
          <TextInput
            testID={`${testID}-input`}
            style={styles.input}
            value={value}
            onChangeText={setValue}
            secureTextEntry
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            autoComplete="off"
            importantForAutofill="no"
            textContentType="none"
            placeholder={tMe(lang, 'env.secretPlaceholder')}
            placeholderTextColor={color.text3}
            accessibilityLabel={tMe(lang, 'env.secretInputLabel', { name })}
          />
          <Text style={styles.hint}>{tMe(lang, 'env.secretHidden')}</Text>
          {ready && !hasKey ? <Text style={styles.warn}>{tMe(lang, 'env.noDeviceKey')}</Text> : null}
          {ready && hasKey && nodeSealKey === null ? <Text style={styles.warn}>{tMe(lang, 'env.noNodeKey')}</Text> : null}
        </View>
      </Drawer>
      <ConfirmSheet
        open={open && confirming}
        onClose={() => setConfirming(false)}
        title={tMe(lang, 'env.secretConfirmTitle')}
        description={tMe(lang, 'env.secretConfirmBody')}
        confirmLabel={tMe(lang, 'env.secretSave')}
        cancelLabel={tMe(lang, 'account.cancel')}
        onConfirm={save}
        state={action.buttonState}
        error={error}
        testID={`${testID}-confirm`}
      />
    </>
  );
}

const styles = StyleSheet.create({
  body: { padding: space[4], gap: space[3] },
  purpose: { ...type.callout, color: color.text2 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.m,
    backgroundColor: color.sunken,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    ...type.body,
    color: color.text,
  },
  hint: { ...type.caption, color: color.text3 },
  warn: { ...type.caption, color: color.warn },
});
