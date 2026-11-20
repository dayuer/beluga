import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AlertCircle, Check } from 'lucide-react-native';
import { color, radius, space, tint, type } from '../lib/theme';
import { PrimaryButton } from './PrimaryButton';
import { TextButton } from './TextButton';

export interface FingerprintLabels {
  readonly title?: string;
  readonly hint?: string;
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

/** 将节点公钥指纹规范化并切分为 4 组短码，便于客户逐组核对。 */
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
 * 节点指纹核对组件（SS-72）：
 * 展示 4 组大字短码，由客户对照搭环境的人给的纸条/消息点击「一致」；
 * 若「不一致」，明确给出风险提示与处理方式。
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
  const groups = splitFingerprintGroups(fingerprint);

  const copy = {
    title: labels?.title ?? '核对节点指纹',
    hint: labels?.hint ?? '请对照搭环境的人给你的纸条或消息，确认下面 4 组短码完全一致：',
    match: labels?.match ?? '一致，继续登记',
    mismatch: labels?.mismatch ?? '不一致',
    mismatchTitle: labels?.mismatchTitle ?? '指纹不一致，已暂停登记',
    mismatchBody:
      labels?.mismatchBody ??
      '这可能是链接被篡改，或对方重新初始化了节点。\n\n请不要继续登记，立即联系搭环境的人核实，并请对方重新发送一条新的邀请链接。',
    mismatchRetry: labels?.mismatchRetry ?? '重新核对',
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

      <View style={styles.actions}>
        <PrimaryButton
          testID={`${testID}-match`}
          label={copy.match}
          onPress={onMatch}
          loading={busy}
        />
        <TextButton
          testID={`${testID}-mismatch-btn`}
          label={copy.mismatch}
          onPress={() => {
            setStep('mismatch');
            onMismatch?.();
          }}
        />
      </View>
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
