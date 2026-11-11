import { Platform, type ViewStyle } from 'react-native';
import type { PlanTone, PlanUiTheme } from '../../../ui-plan';
import { color, ink, scheme, tint } from '../../lib/theme';

/** The customer app's colours for the shared plan parts, built per render from the live tokens. */
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
    toneBg: (t: PlanTone): string => (t === 'plain' ? color.sunken : tint[t]),
    toneInk: (t: PlanTone): string => (t === 'plain' ? color.text2 : ink[t]),
    cardStyle: {
      borderColor: color.hairline,
      ...(scheme === 'light' ? shadow() : {}),
    },
  };
}

/** The customer app's soft card lift (the same rule as the companion's Card). */
function shadow(): ViewStyle {
  return Platform.select({
    web: { boxShadow: color.shadowCss } as ViewStyle,
    default: { shadowColor: color.shadowInk, shadowOpacity: 0.03, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 0 },
  })!;
}
