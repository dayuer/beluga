import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AlertCircle, CheckCircle2, Clock3 } from 'lucide-react-native';
import { color, space, stroke, type } from '../lib/theme';

export type ReceiptTone = 'info' | 'warn' | 'ok' | 'error';

/** The action's receipt, right above the primary button: sending, queued, done, or a problem.
 * It stays until the screen changes; nothing floats away before it can be read. */
export function ReceiptLine({ text, tone = 'info', testID = 'receipt-line' }: { text: string | null; tone?: ReceiptTone; testID?: string }) {
  if (!text) return null;
  const tint = tone === 'ok' ? color.ok : tone === 'error' ? color.error : tone === 'warn' ? color.warn : color.text2;
  // The ok ink is 4.24:1 on the page; the green check carries the meaning, the sentence stays ink.
  const textColor = tone === 'ok' ? color.text : tint;

  return (
    <View style={styles.row} accessibilityLiveRegion="polite" testID={testID}>
      {tone === 'info' ? (
        <ActivityIndicator size="small" color={tint} />
      ) : tone === 'ok' ? (
        <CheckCircle2 size={16} strokeWidth={stroke} color={tint} />
      ) : tone === 'warn' ? (
        <Clock3 size={16} strokeWidth={stroke} color={tint} />
      ) : (
        <AlertCircle size={16} strokeWidth={stroke} color={tint} />
      )}
      <Text style={[styles.text, { color: textColor }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], minHeight: 20, marginBottom: space[3] },
  text: { ...type.callout, flex: 1 },
});
