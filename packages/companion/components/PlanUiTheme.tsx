import { Platform, type ViewStyle } from 'react-native';
import type { PlanUiTheme } from '../../ui-plan';
import { color, elevation, scheme } from '../lib/theme';
import { toneBg, toneInk } from './ui';

/**
 * The companion's colours for the shared plan parts. Built per render: `color`, `elevation` and
 * `scheme` are live (the root swaps them on a scheme change and remounts), so a module-level
 * object would freeze one scheme.
 */
export function planUiTheme(): PlanUiTheme {
  return {
    color: {
      card: color.card,
      hairline: color.hairline,
      hairlineStrong: color.hairlineStrong,
      sunken: color.sunken,
      text: color.text,
      text2: color.text2,
      text3: color.text3,
      ok: color.ok,
      info: color.info,
    },
    toneBg,
    toneInk,
    // The same skin as the companion's Card: its hairline, and in light its soft lift.
    cardStyle: {
      borderColor: elevation.card.border,
      ...(scheme === 'light' ? shadow() : {}),
    },
  };
}

/** The companion Card's lift (ui.tsx keeps its own private copy). */
function shadow(): ViewStyle {
  return Platform.select({
    web: { boxShadow: color.shadowCss } as ViewStyle,
    default: { shadowColor: color.shadowInk, shadowOpacity: 0.03, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 0 },
  })!;
}
