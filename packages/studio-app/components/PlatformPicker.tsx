import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { PLATFORMS, type StudioPlatform } from '../../../src/studio/protocol';
import { detectLang, t, type StringKey } from '../lib/strings';
import { color, radius, space, type } from '../lib/theme';

const LABELS: Record<StudioPlatform, StringKey> = {
  ios: 'new.platformIos',
  android: 'new.platformAndroid',
  miniprogram: 'new.platformMiniprogram',
  web: 'new.platformWeb',
};

/** Four 52pt blocks in two columns; at least one must be picked. */
export function PlatformPicker({ value, onChange }: { value: readonly StudioPlatform[]; onChange: (next: StudioPlatform[]) => void }) {
  const lang = detectLang();
  const toggle = (p: StudioPlatform) => onChange(value.includes(p) ? value.filter((v) => v !== p) : [...value, p]);

  return (
    <View style={styles.grid} accessibilityRole="group" accessibilityLabel={t(lang, 'new.platforms')}>
      {PLATFORMS.map((p) => {
        const on = value.includes(p);
        return (
          <Pressable
            key={p}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            aria-pressed={on}
            testID={`platform-${p}`}
            onPress={() => toggle(p)}
            style={({ pressed }) => [styles.block, on && styles.on, pressed && styles.pressed]}
          >
            <Text style={[styles.label, on && styles.labelOn]}>{t(lang, LABELS[p])}</Text>
            {on ? <Check size={14} strokeWidth={2.2} color={color.text} style={styles.tick} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  block: {
    width: '48.9%',
    height: 52,
    marginBottom: space[3],
    borderWidth: 1,
    borderColor: color.hairline,
    borderRadius: radius.m,
    backgroundColor: color.card,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  on: { borderColor: color.text, backgroundColor: color.sunken },
  pressed: { opacity: 0.85 },
  label: { ...type.callout, color: color.text2 },
  labelOn: { color: color.text, fontWeight: '600' },
  tick: { position: 'absolute', left: 14, top: 19 },
});
