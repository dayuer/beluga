import { type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, space } from '../lib/theme';
import { useKeyboardInset } from '../lib/viewport';

/** The bottom action area: one primary button, inside the screen's content column. */
export function ActionDock({ children, testID = 'dock', maxWidth, safeBottom = true }: { children: ReactNode; testID?: string; maxWidth?: number; safeBottom?: boolean }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const keyboard = useKeyboardInset();

  return (
    <View
      style={[
        styles.dock,
        {
          // The keyboard covers the home indicator, so the safe area is not added on top of it.
          paddingBottom: keyboard > 0 ? space[5] : (safeBottom ? insets.bottom : 0) + space[5],
          marginBottom: keyboard,
        },
      ]}
      testID={testID}
    >
      <View style={[styles.inner, desktop && styles.innerDesktop, desktop && maxWidth ? { maxWidth } : null]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    backgroundColor: color.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
    paddingTop: space[4],
    paddingHorizontal: space[5],
  },
  inner: { width: '100%' },
  innerDesktop: { maxWidth: 720, alignSelf: 'center' },
});
