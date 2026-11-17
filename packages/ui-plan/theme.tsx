import { type ReactNode, createContext, useContext } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { PlanTone } from './types';

/**
 * What the shared plan parts need from an app's theme: the surfaces they sit on, the three text
 * inks, the green of a done bar, and the two tone helpers. Each app provides its own (the
 * companion and the customer app share the same tokens); nothing here is app-specific.
 *
 * `info` is the one extra ink the parts use (the companion's "this task is yours" mark); an app
 * without it can pass any quiet ink.
 */
export interface PlanUiTheme {
  readonly color: {
    readonly card: string;
    readonly hairline: string;
    readonly hairlineStrong: string;
    readonly sunken: string;
    readonly text: string;
    readonly text2: string;
    readonly text3: string;
    readonly ok: string;
    readonly info: string;
  };
  readonly toneBg: (tone: PlanTone) => string;
  readonly toneInk: (tone: PlanTone) => string;
  /** Optional card skin (the app's shadow and border), laid over the shared card defaults. */
  readonly cardStyle?: StyleProp<ViewStyle>;
}

const ThemeContext = createContext<PlanUiTheme | null>(null);

export function PlanUiThemeProvider({ theme, children }: { readonly theme: PlanUiTheme; readonly children: ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function usePlanUiTheme(): PlanUiTheme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('usePlanUiTheme must be used inside PlanUiThemeProvider');
  return theme;
}
