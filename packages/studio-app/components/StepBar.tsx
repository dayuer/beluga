import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';
import { detectLang, type Lang } from '../lib/strings';
import { tSteps } from '../lib/strings/steps';
import { color, radius, space, type } from '../lib/theme';
import type { RequestStep, StepStatus } from '../lib/views';

export interface StepBarProps {
  readonly steps: readonly RequestStep[];
  readonly lang?: Lang;
  readonly initialExpandedId?: string | null;
  readonly testID?: string;
}

const STATUS_KEY: Record<
  StepStatus,
  'steps.status.done' | 'steps.status.active' | 'steps.status.waiting' | 'steps.status.todo'
> = {
  done: 'steps.status.done',
  active: 'steps.status.active',
  waiting: 'steps.status.waiting',
  todo: 'steps.status.todo',
};

function WaitingStripes({ patternId }: { readonly patternId: string }) {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <Rect width="8" height="8" fill={color.waiting} />
          <Line x1="0" y1="0" x2="0" y2="8" stroke={color.waitingStripe} strokeWidth="3" />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </Svg>
  );
}

/**
 * P4 步骤条（SS-44）：里程碑一格一格展示完成、进行中、等待（react-native-svg 斜纹）、未开始；
 * 点一格展开该步说明，读屏读出第几步与状态。
 */
export function StepBar({ steps, lang: langProp, initialExpandedId = null, testID = 'step-bar' }: StepBarProps) {
  const lang = langProp ?? detectLang();
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId);

  if (steps.length === 0) return null;

  const expandedIndex = expandedId ? steps.findIndex((s) => s.id === expandedId) : -1;
  const expandedStep = expandedIndex >= 0 ? steps[expandedIndex] : undefined;

  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.track} accessibilityRole="tablist">
        {steps.map((step, idx) => {
          const statusLabel = tSteps(lang, STATUS_KEY[step.status]);
          const isExpanded = expandedStep?.id === step.id;
          const a11yLabel = tSteps(lang, 'steps.a11y', {
            i: idx + 1,
            n: steps.length,
            title: step.title,
            status: statusLabel,
          });

          const cellBg =
            step.status === 'done'
              ? color.ok
              : step.status === 'active'
                ? color.info
                : step.status === 'waiting'
                  ? color.waiting
                  : color.sunken;

          return (
            <Pressable
              key={step.id}
              onPress={() => setExpandedId((cur) => (cur === step.id ? null : step.id))}
              accessibilityRole="button"
              accessibilityLabel={a11yLabel}
              accessibilityState={{ expanded: isExpanded, selected: isExpanded }}
              testID={`step-cell-${step.id}`}
              style={({ pressed }) => [
                styles.cell,
                {
                  backgroundColor: cellBg,
                  borderColor: isExpanded ? color.text : step.status === 'todo' ? color.hairlineStrong : 'transparent',
                  borderWidth: isExpanded ? 1.5 : step.status === 'todo' ? 1 : 0,
                },
                pressed && styles.pressed,
              ]}
            >
              {step.status === 'waiting' ? <WaitingStripes patternId={`wait-stripe-${step.id}`} /> : null}
            </Pressable>
          );
        })}
      </View>

      {expandedStep ? (
        <View
          style={[styles.detail, { backgroundColor: color.sunken, borderColor: color.hairline }]}
          testID="step-detail"
        >
          <Text style={[styles.detailMeta, { color: color.text3OnSunken }]}>
            {tSteps(lang, 'steps.stepLabel', {
              i: expandedIndex + 1,
              status: tSteps(lang, STATUS_KEY[expandedStep.status]),
            })}
          </Text>
          <Text style={[styles.detailTitle, { color: color.text }]}>{expandedStep.title}</Text>
          <Text style={[styles.detailSummary, { color: color.text2 }]}>
            {expandedStep.summary ?? tSteps(lang, 'steps.noSummary')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[2] },
  track: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  cell: {
    flex: 1,
    height: 12,
    borderRadius: radius.s,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.8 },
  detail: {
    padding: space[3],
    borderRadius: radius.m,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  detailMeta: { ...type.caption },
  detailTitle: { ...type.callout, fontWeight: '600' },
  detailSummary: { ...type.caption },
});
