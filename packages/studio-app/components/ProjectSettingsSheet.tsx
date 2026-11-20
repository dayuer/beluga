import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useHasDeviceKey } from '../lib/keys';
import { buildUpdateSettings } from '../lib/signed-actions';
import { detectLang, type Lang } from '../lib/strings';
import { tMe, type MeStringKey } from '../lib/strings/me';
import { color, radius, space, type } from '../lib/theme';
import { useSignedAction } from '../lib/use-signed-action';
import { ActionRow } from './card/ActionRow';
import { ConfirmSheet } from './ConfirmSheet';
import { Drawer } from './Drawer';
import { TextButton } from './TextButton';

export const PROJECT_DELIVERY_MODES = ['preview-only', 'repo', 'push-mine'] as const;
export type ProjectDeliveryMode = (typeof PROJECT_DELIVERY_MODES)[number];

const MODE_LABEL: Record<ProjectDeliveryMode, MeStringKey> = {
  'preview-only': 'project.deliveryPreviewOnly',
  repo: 'project.deliveryRepo',
  'push-mine': 'project.deliveryPushMine',
};

const REPO_URL_RE = /^https:\/\/[^\s]+$/;

/** 界面上的三种交付方式 → `settings.update` 白名单里的值（SS-226 定的协议）。 */
export function settingsPatchFor(
  mode: ProjectDeliveryMode,
  repoUrl?: string,
): { readonly delivery: 'preview' | 'hosted' | 'repo'; readonly repoUrl?: string } {
  switch (mode) {
    case 'repo':
      return { delivery: 'hosted' };
    case 'push-mine':
      return { delivery: 'repo', repoUrl: (repoUrl ?? '').trim() };
    case 'preview-only':
    default:
      return { delivery: 'preview' };
  }
}

export interface ProjectSettingsSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly projectId: string;
  readonly projectName: string;
  readonly initialMode: ProjectDeliveryMode;
  readonly initialRepoUrl?: string;
  readonly lang?: Lang;
  /** 保存成功（节点已收到）：列表可以先把这张卡换掉。 */
  readonly onSaved?: (mode: ProjectDeliveryMode, repoUrl?: string) => void;
  readonly testID?: string;
}

/**
 * 改项目设置（SS-228，决定 secrets-phone-temp）：
 * 只改 `settings.update` 白名单里的两项——代码交付方式与需要的仓库地址；
 * 发出前用 `ConfirmSheet` 二次确认，主按钮是「保存设置」；由 `useSignedAction` 补签名信封。
 * 开关关掉时这个组件不会被渲染（入口在 `app/me/project.tsx`）。
 */
export function ProjectSettingsSheet({
  open,
  onClose,
  projectId,
  projectName,
  initialMode,
  initialRepoUrl,
  lang: langProp,
  onSaved,
  testID = 'project-settings-sheet',
}: ProjectSettingsSheetProps) {
  const lang = langProp ?? detectLang();
  const [mode, setMode] = useState<ProjectDeliveryMode>(initialMode);
  const [repoUrl, setRepoUrl] = useState(initialRepoUrl ?? '');
  const [confirming, setConfirming] = useState(false);
  const { ready, hasKey } = useHasDeviceKey();
  const action = useSignedAction(projectId, `settings:${projectId}`);

  // 每次打开都用这张卡当前的值，不留下上一次没保存的选择。
  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setRepoUrl(initialRepoUrl ?? '');
    setConfirming(false);
  }, [open, initialMode, initialRepoUrl]);

  const needsRepo = mode === 'push-mine';
  const urlOk = !needsRepo || REPO_URL_RE.test(repoUrl.trim());
  const canSend = ready && hasKey && urlOk;

  const hint = !ready
    ? undefined
    : !hasKey
      ? tMe(lang, 'project.noDeviceKey')
      : needsRepo && !urlOk
        ? tMe(lang, 'project.repoRequired')
        : tMe(lang, 'project.settingsByDevice');

  const save = (): void => {
    if (!canSend) return;
    const patch = settingsPatchFor(mode, repoUrl);
    void action.send(
      (opId) => buildUpdateSettings({ opId, projectId, delivery: patch.delivery, ...(patch.repoUrl !== undefined ? { repoUrl: patch.repoUrl } : {}) }),
      {
        onDone: () => {
          setConfirming(false);
          onSaved?.(mode, patch.repoUrl);
          onClose();
          action.reset();
        },
      },
    );
  };

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={tMe(lang, 'project.settingsTitle', { name: projectName })}
        testID={testID}
        footer={
          <ActionRow
            negative={<TextButton label={tMe(lang, 'account.cancel')} onPress={onClose} testID={`${testID}-cancel`} />}
            primary={
              <TextButton
                label={tMe(lang, 'project.saveSettings')}
                onPress={() => setConfirming(true)}
                disabled={!canSend}
                testID={`${testID}-ask`}
              />
            }
            hint={hint}
          />
        }
      >
        <View style={styles.body}>
          <Text style={styles.section}>{tMe(lang, 'project.deliveryMode')}</Text>
          <View style={styles.options}>
            {PROJECT_DELIVERY_MODES.map((key) => {
              const selected = key === mode;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  testID={`${testID}-mode-${key}`}
                  onPress={() => setMode(key)}
                  style={[styles.option, selected && styles.optionSelected]}
                >
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected ? <View style={styles.radioDot} /> : null}
                  </View>
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{tMe(lang, MODE_LABEL[key])}</Text>
                </Pressable>
              );
            })}
          </View>

          {needsRepo ? (
            <View style={styles.repoBlock}>
              <Text style={styles.section}>{tMe(lang, 'project.repo')}</Text>
              <TextInput
                testID={`${testID}-repo`}
                style={styles.input}
                value={repoUrl}
                onChangeText={setRepoUrl}
                autoCorrect={false}
                autoCapitalize="none"
                autoComplete="off"
                keyboardType="url"
                placeholder={tMe(lang, 'project.repoPlaceholder')}
                placeholderTextColor={color.text3}
                accessibilityLabel={tMe(lang, 'project.repo')}
              />
              {!urlOk ? <Text style={styles.warn}>{tMe(lang, 'project.repoRequired')}</Text> : null}
            </View>
          ) : null}

          {ready && !hasKey ? <Text style={styles.warn}>{tMe(lang, 'project.noDeviceKey')}</Text> : null}
        </View>
      </Drawer>
      <ConfirmSheet
        open={open && confirming}
        onClose={() => setConfirming(false)}
        title={tMe(lang, 'project.settingsConfirmTitle')}
        description={tMe(lang, 'project.settingsConfirmBody', {
          delivery: tMe(lang, MODE_LABEL[mode]),
          ...(needsRepo ? { repo: repoUrl.trim() } : {}),
        })}
        confirmLabel={tMe(lang, 'project.saveSettings')}
        cancelLabel={tMe(lang, 'account.cancel')}
        onConfirm={save}
        state={action.buttonState}
        error={action.error}
        testID={`${testID}-confirm`}
      />
    </>
  );
}

const styles = StyleSheet.create({
  body: { padding: space[4], gap: space[3] },
  section: { ...type.caption, fontWeight: '600', color: color.text3 },
  options: { gap: space[2] },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 44,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.m,
    backgroundColor: color.card,
  },
  optionSelected: { borderColor: color.primary, backgroundColor: color.sunken },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: color.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: color.primary },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: color.primary },
  optionText: { ...type.callout, color: color.text2, flexShrink: 1 },
  optionTextSelected: { color: color.text, fontWeight: '600' },
  repoBlock: { gap: space[2], marginTop: space[2] },
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
  warn: { ...type.caption, color: color.warn },
});
