import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pendingKey, useSend, type SendFailure } from '../lib/send';
import { refusalKey } from '../lib/submit';
import { t, type Lang } from '../lib/strings';
import { color, space, type } from '../lib/theme';
import { useKeyboardInset } from '../lib/viewport';
import { PrimaryButton } from './PrimaryButton';
import { ReceiptLine } from './ReceiptLine';
import { TextButton } from './TextButton';

interface DiscardSheetProps {
  readonly pid: string;
  readonly planRef: string;
  readonly draftRev: number;
  readonly lang: Lang;
  readonly onCancel: () => void;
  readonly onDiscarded: () => void;
  readonly onRefresh: () => void;
}

/** The second confirmation behind ••• → Discard changes (M6 §4.12). */
export function DiscardSheet({ pid, planRef, draftRev, lang, onCancel, onDiscarded, onRefresh }: DiscardSheetProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const send = useSend(pid, pendingKey('discard', pid, planRef));
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();
  const failedText = (failure: SendFailure): string => t(lang, failure === 'offline' ? 'refusal.offline' : failure === 'expired' ? 'refusal.expired' : 'refusal.http');
  const busy = send.state.phase === 'sending' || send.state.phase === 'queued';
  const failed = send.state.phase === 'failed';

  const discard = (): void => {
    void send.send(
      (opId) => ({ t: 'action', opId, kind: 'draft.discard', planRef, payload: { draftRev } }),
      {
        onQueued: onDiscarded,
        onDone: onDiscarded,
        onRefused: (code) => {
          setNotice(t(lang, refusalKey(code)));
          if (code === 'stale') onRefresh();
        },
        onFailed: (failure) => setNotice(failedText(failure)),
      },
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.body}>
        <Text style={styles.bodyText}>{t(lang, 'plan.discardAsk')}</Text>
      </View>
      <View style={[styles.footer, { paddingBottom: (keyboard > 0 ? 0 : insets.bottom) + space[4] }]}>
        <ReceiptLine text={notice} tone="error" />
        <View style={styles.row}>
          <TextButton label={t(lang, 'common.cancel')} onPress={onCancel} testID="discard-cancel" />
          <View style={{ flex: 1 }}>
            <PrimaryButton
              label={busy ? t(lang, 'common.sending') : failed ? t(lang, 'common.retry') : t(lang, 'plan.discard')}
              onPress={() => (failed ? void send.retry() : discard())}
              disabled={busy}
              loading={busy}
              testID="primary"
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  body: { flex: 1, padding: space[5] },
  bodyText: { ...type.callout, color: color.text2 },
  footer: { paddingHorizontal: space[4], paddingTop: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: space[3] },
});
