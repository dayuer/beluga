import { Pressable, StyleSheet, Text, View } from 'react-native';
import { detectLang, t } from '../lib/strings';
import { color, radius, space, type } from '../lib/theme';
import { useUndoBar } from '../lib/undo';

export interface UndoBarProps {
  readonly testID?: string;
}

/**
 * 全局撤销条（SS-29 / SS-144）：位于页签上方，写清做了什么和对象名，右侧为撤销按钮。
 * 由 `undoStore` 驱动，同时只会有一条；读屏采用 polite 播报，不抢焦点。
 */
export function UndoBar({ testID = 'undo-bar' }: UndoBarProps) {
  const { active, text, cancel } = useUndoBar();
  if (!active) return null;
  const undoLabel = t(detectLang(), 'undo.button');

  return (
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      style={[
        styles.bar,
        {
          backgroundColor: color.primary,
          borderColor: color.hairlineStrong,
        },
      ]}
    >
      <Text style={[styles.text, { color: color.onPrimary }]} numberOfLines={2}>
        {text}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={undoLabel}
        onPress={cancel}
        hitSlop={8}
        style={({ pressed }) => [styles.undoBtn, pressed && styles.undoPressed]}
      >
        <Text style={[styles.undoLabel, { color: color.onPrimary }]}>{undoLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    marginHorizontal: space[4],
    marginBottom: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderRadius: radius.m,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: {
    ...type.callout,
    flex: 1,
  },
  undoBtn: {
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.s,
  },
  undoPressed: {
    opacity: 0.7,
  },
  undoLabel: {
    ...type.callout,
    fontWeight: '600',
  },
});
