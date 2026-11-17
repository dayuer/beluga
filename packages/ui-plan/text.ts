import { Platform, type TextStyle } from 'react-native';

/**
 * The three text styles the shared parts draw with. The values are the apps' own `type` tokens
 * (heading 16, callout 14, caption 12.5) with the same system font: the package may not import an
 * app's theme, so they are copied here and both apps read the same numbers.
 */
const sans = Platform.select({
  ios: 'System',
  android: undefined,
  default: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Roboto", "Helvetica Neue", sans-serif',
});

export const planText = {
  heading: { fontFamily: sans, fontSize: 16, lineHeight: 21, fontWeight: '600' as const, letterSpacing: -0.15 } as TextStyle,
  callout: { fontFamily: sans, fontSize: 14, lineHeight: 19, fontWeight: '400' as const } as TextStyle,
  caption: { fontFamily: sans, fontSize: 12.5, lineHeight: 16, fontWeight: '400' as const } as TextStyle,
};
