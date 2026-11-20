import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clearReasonDraft, readReasonDraft, writeReasonDraft } from '../lib/drafts';
import { pendingKey, useSend, type SendFailure } from '../lib/send';
import { detectLang, t, type Lang } from '../lib/strings';
import { signedCardStrings } from '../lib/strings/signed-cards';
import { refusalKey } from '../lib/submit';
import { color, radius, space, type } from '../lib/theme';
import { useKeyboardInset } from '../lib/viewport';
import { Drawer } from './Drawer';
import { PrimaryButton } from './PrimaryButton';
import { ReceiptLine } from './ReceiptLine';

export interface ReasonSheetProps {
  /** 卡片 ID（P7 新版按卡片 ID 存草稿）。 */
  readonly cardId?: string;
  /** 抽屉开关（传入时内部包裹 Drawer；不传时只渲染内容区以兼容旧调用）。 */
  readonly open?: boolean;
  readonly onClose?: () => void;
  readonly title?: string;
  readonly quickTags?: readonly string[];
  readonly initialDraft?: string;
  readonly onSubmit?: (reason: string) => void | Promise<void>;
  readonly lang?: Lang;
  readonly testID?: string;
  /** 兼容旧版 app/plan/[id].tsx 调用的字段。 */
  readonly pid?: string;
  readonly planRef?: string;
  readonly milestoneRef?: string;
  readonly draftRev?: number;
  readonly onSent?: () => void;
  readonly onRefresh?: () => void;
}

const MIN_REASON = 10;

/**
 * P7 原因抽屉（SS-61）：
 * 至少 10 个字才可发，不足时明确提示还差几个字；
 * 关掉抽屉或卸载时通过 `lib/drafts.ts` 按卡片 ID 保留草稿，发送成功后清除。
 */
export function ReasonSheet({
  cardId,
  open,
  onClose,
  title,
  quickTags,
  initialDraft,
  onSubmit,
  lang: langProp,
  testID = 'reason-sheet',
  pid = '',
  planRef = '',
  milestoneRef = '',
  draftRev = 0,
  onSent,
  onRefresh,
}: ReasonSheetProps) {
  const lang = langProp ?? detectLang();
  const c = signedCardStrings(lang);
  const draftId = cardId ?? `sendback:${pid}:${planRef}:${milestoneRef}`;
  const [reason, setReason] = useState(() => readReasonDraft(draftId) || initialDraft || '');
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const reasonRef = useRef(reason);
  reasonRef.current = reason;
  const send = useSend(pid, pendingKey('sendback', pid, planRef, milestoneRef));
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  useEffect(() => {
    setReason(readReasonDraft(draftId) || initialDraft || '');
  }, [draftId, initialDraft]);

  const change = (value: string): void => {
    setReason(value);
    reasonRef.current = value;
    writeReasonDraft(draftId, value);
  };

  useEffect(
    () => () => {
      const value = reasonRef.current;
      if (value.trim()) writeReasonDraft(draftId, value);
    },
    [draftId],
  );

  const failedText = (failure: SendFailure): string =>
    t(lang, failure === 'offline' ? 'refusal.offline' : failure === 'expired' ? 'refusal.expired' : 'refusal.http');
  const trimmedLen = reason.trim().length;
  const missing = Math.max(0, MIN_REASON - trimmedLen);
  const ready = missing === 0;
  const busy = submitting || send.state.phase === 'sending' || send.state.phase === 'queued';
  const failed = send.state.phase === 'failed';

  const submit = async (): Promise<void> => {
    if (!ready || busy) return;
    const text = reason.trim();
    if (onSubmit) {
      setSubmitting(true);
      setNotice(null);
      try {
        await onSubmit(text);
        clearReasonDraft(draftId);
        setReason('');
        onSent?.();
        onClose?.();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : t(lang, 'refusal.http'));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    void send.send(
      (opId) => ({ t: 'action', opId, kind: 'milestone.sendBack', planRef, payload: { milestoneRef, draftRev, reason: text } }),
      {
        onQueued: () => {
          clearReasonDraft(draftId);
          onSent?.();
        },
        onDone: () => {
          clearReasonDraft(draftId);
          onSent?.();
        },
        onRefused: (code) => {
          setNotice(t(lang, refusalKey(code)));
          if (code === 'stale') onRefresh?.();
        },
        onFailed: (failure) => setNotice(failedText(failure)),
      },
    );
  };

  const tags = quickTags ?? [t(lang, 'reason.tag1'), t(lang, 'reason.tag2'), t(lang, 'reason.tag3')];

  const body = (
    <View style={styles.root} testID={open === undefined ? testID : undefined}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {tags.length > 0 ? (
          <View style={styles.tags}>
            {tags.map((tag, i) => (
              <Pressable
                key={tag}
                accessibilityRole="button"
                testID={`reason-tag-${i + 1}`}
                onPress={() => change(reason.trim() ? `${reason.trim()}${c['reason.tagJoiner']}${tag}` : tag)}
                style={({ pressed }) => [styles.tag, pressed && styles.pressed]}
              >
                <Text style={styles.tagText}>{tag}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <TextInput
          value={reason}
          onChangeText={change}
          placeholder={t(lang, 'reason.placeholder')}
          placeholderTextColor={color.text3}
          multiline
          maxLength={4000}
          style={styles.input}
          testID="reason-input"
          accessibilityLabel={title ?? t(lang, 'reason.title')}
        />
        {reason.length >= 3600 ? <Text style={styles.counter}>{t(lang, 'new.left', { n: 4000 - reason.length })}</Text> : null}
        {!ready ? (
          <Text style={styles.hint} testID="reason-too-short">
            {c['reason.missingChars'](missing)}
          </Text>
        ) : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: (keyboard > 0 ? 0 : insets.bottom) + space[4] }]}>
        <ReceiptLine text={notice} tone="error" />
        <PrimaryButton
          label={busy ? t(lang, 'common.sending') : failed ? t(lang, 'common.retry') : t(lang, 'reason.send')}
          onPress={() => (failed ? void send.retry() : void submit())}
          disabled={busy || (!failed && !ready)}
          loading={busy}
          testID="reason-submit"
        />
      </View>
    </View>
  );

  if (open !== undefined && onClose) {
    return (
      <Drawer open={open} onClose={onClose} title={title ?? t(lang, 'reason.title')} testID={testID}>
        {body}
      </Drawer>
    );
  }

  return body;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  scroll: { flex: 1 },
  content: { padding: space[4], gap: space[4] },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  tag: { minHeight: 44, paddingHorizontal: space[4], justifyContent: 'center', backgroundColor: color.sunken, borderRadius: radius.pill },
  tagText: { ...type.callout, color: color.text2 },
  pressed: { opacity: 0.9 },
  input: {
    ...type.callout,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 96,
    maxHeight: 204,
    textAlignVertical: 'top',
    color: color.text,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.m,
    padding: space[4],
  },
  counter: { ...type.caption, color: color.text3, textAlign: 'right' },
  hint: { ...type.caption, color: color.text3 },
  footer: { paddingHorizontal: space[4], paddingTop: space[3], gap: space[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline },
});
