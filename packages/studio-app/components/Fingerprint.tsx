import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AlertCircle, Check } from 'lucide-react-native';
import { detectLang } from '../lib/strings';
import { joinT } from '../lib/strings/join';
import { color, radius, space, tint, type } from '../lib/theme';
import { ActionRow } from './card/ActionRow';
import { PrimaryButton } from './PrimaryButton';
import { TextButton } from './TextButton';

export interface FingerprintLabels {
  readonly title?: string;
  readonly hint?: string;
  readonly actionHint?: string;
  readonly match?: string;
  readonly mismatch?: string;
  readonly mismatchTitle?: string;
  readonly mismatchBody?: string;
  readonly mismatchRetry?: string;
}

export interface FingerprintProps {
  readonly fingerprint: string;
  readonly onMatch: () => void;
  readonly onMismatch?: () => void;
  readonly busy?: boolean;
  readonly initialState?: 'verify' | 'mismatch';
  readonly labels?: FingerprintLabels;
  readonly testID?: string;
}

/** Normalize and split a node public-key fingerprint into 4 short groups. */
export function splitFingerprintGroups(fingerprint: string): [string, string, string, string] {
  const clean = fingerprint.replace(/[\s:-]+/g, '').toUpperCase();
  if (!clean) return ['----', '----', '----', '----'];
  const size = Math.max(1, Math.ceil(clean.length / 4));
  return [
    clean.slice(0, size) || '----',
    clean.slice(size, size * 2) || '----',
    clean.slice(size * 2, size * 3) || '----',
    clean.slice(size * 3, size * 4) || '----',
  ];
}

/**
 * Node fingerprint verification component (SS-72 / SS-179).
 */
export function Fingerprint({
  fingerprint,
  onMatch,
  onMismatch,
  busy = false,
  initialState = 'verify',
  labels,
  testID = 'fingerprint',
}: FingerprintProps) {
  const [step, setStep] = useState<'verify' | 'mismatch'>(initialState);
  const lang = detectLang();
  const groups = splitFingerprintGroups(fingerprint);

  const copy = {
    title: labels?.title ?? joinT(lang, 'fp.title'),
    hint: labels?.hint ?? joinT(lang, 'fp.hint'),
    actionHint: labels?.actionHint ?? joinT(lang, 'fp.actionHint'),
    match: labels?.match ?? joinT(lang, 'fp.match'),
    mismatch: labels?.mismatch ?? joinT(lang, 'fp.mismatch'),
    mismatchTitle: labels?.mismatchTitle ?? joinT(lang, 'fp.mismatchTitle'),
    mismatchBody: labels?.mismatchBody ?? joinT(lang, 'fp.mismatchBody'),
    mismatchRetry: labels?.mismatchRetry ?? joinT(lang, 'fp.mismatchRetry'),
  };

  if (step === 'mismatch') {
    return (
      <View
        testID={`${testID}-mismatch`}
        style={[
          styles.card,
          {
            backgroundColor: color.card,
            borderColor: color.error,
          },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={[styles.iconBadge, { backgroundColor: tint.rose[0] }]}>
            <AlertCircle size={20} color={color.error} strokeWidth={1.8} />
          </View>
          <Text style={[styles.title, { color: color.error }]}>{copy.mismatchTitle}</Text>
        </View>
        <Text style={[styles.body, { color: color.text2 }]}>{copy.mismatchBody}</Text>
        <View style={styles.actions}>
          <TextButton
            testID={`${testID}-retry`}
            label={copy.mismatchRetry}
            onPress={() => setStep('verify')}
          />
        </View>
      </View>
    );
  }

  return (
    <View
      testID={testID}
      style={[
        styles.card,
        {
          backgroundColor: color.card,
          borderColor: color.hairline,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={[styles.iconBadge, { backgroundColor: color.sunken }]}>
          <Check size={20} color={color.text} strokeWidth={1.8} />
        </View>
        <Text style={[styles.title, { color: color.text }]}>{copy.title}</Text>
      </View>

      <Text style={[styles.body, { color: color.text2 }]}>{copy.hint}</Text>

      <View style={styles.grid} testID={`${testID}-groups`}>
        {groups.map((group, index) => (
          <View
            key={`${index}-${group}`}
            style={[
              styles.codeBox,
              {
                backgroundColor: color.sunken,
                borderColor: color.hairline,
              },
            ]}
          >
            <Text style={[styles.codeText, { color: color.text }]}>{group}</Text>
          </View>
        ))}
      </View>

      <ActionRow
        testID={`${testID}-actions`}
        negative={
          <TextButton
            testID={`${testID}-mismatch-btn`}
            label={copy.mismatch}
            onPress={() => {
              setStep('mismatch');
              onMismatch?.();
            }}
          />
        }
        hint={copy.actionHint}
        primary={
          <PrimaryButton
            testID={`${testID}-match`}
            label={copy.match}
            onPress={onMatch}
            loading={busy}
          />
        }
      />
    </View>
  );
}

Fingerprint.displayName = 'Fingerprint';

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.m,
    borderWidth: 1,
    padding: space[4],
    gap: space[3],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  iconBadge: {
    width: 34,
    height: 34,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...type.heading,
    flex: 1,
  },
  body: {
    ...type.callout,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  codeBox: {
    flexGrow: 1,
    minWidth: '46%',
    borderRadius: radius.s,
    borderWidth: 1,
    paddingVertical: space[3],
    paddingHorizontal: space[2],
    alignItems: 'center',
  },
  codeText: {
    fontFamily: type.mono.fontFamily,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    gap: space[2],
    marginTop: space[1],
  },
});
