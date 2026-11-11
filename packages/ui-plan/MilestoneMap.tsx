import { Check, ChevronRight } from 'lucide-react-native';
import { type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { milestoneLevels } from './levels';
import { planText } from './text';
import { usePlanUiTheme } from './theme';
import type { MapItem, PlanTone } from './types';

export interface MilestoneMapProps {
  readonly items: readonly MapItem[];
  readonly onPick: (id: string) => void;
  /** Multiplies the node width and the gap between them; text keeps its size. Default 1. */
  readonly scale?: number;
  /** The node width at scale 1. The companion draws 156; the customer app 236. */
  readonly nodeWidth?: number;
  /**
   * Wrap the whole node, press included. When given, the caller owns the press (the companion
   * wraps it in its own Press and FadeIn); when absent, the shared Pressable below is used.
   */
  readonly wrapNode?: (node: ReactNode, item: MapItem) => ReactNode;
  readonly contentPaddingHorizontal?: number;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/** The plan as a small graph: milestones in columns by what they wait on, each with its state and progress. */
export function MilestoneMap({ items, onPick, scale = 1, nodeWidth = 156, wrapNode, contentPaddingHorizontal = 16, style, testID }: MilestoneMapProps) {
  const theme = usePlanUiTheme();
  const levels = milestoneLevels(items);
  const columns: { item: MapItem }[][] = [];
  items.forEach((item, i) => (columns[levels[i]!] ??= []).push({ item }));
  const gap = 8 * scale;
  const width = nodeWidth * scale;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: contentPaddingHorizontal, alignItems: 'center' }}
      style={style}
      testID={testID}
    >
      {columns.map((col, c) => (
        <View key={c} style={{ flexDirection: 'row', alignItems: 'center' }}>
          {c ? <ChevronRight color={theme.color.text3} size={16} style={{ marginHorizontal: 4 }} /> : null}
          <View style={{ gap }}>
            {col.map(({ item }) => {
              const node = <MapNode item={item} width={width} />;
              return wrapNode ? (
                <View key={item.id}>{wrapNode(node, item)}</View>
              ) : (
                <Pressable
                  key={item.id}
                  onPress={() => onPick(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}, ${item.statusLabel}, ${item.done} of ${item.total}`}
                  style={({ pressed }) => [{ opacity: pressed ? 0.55 : 1 }]}
                >
                  {node}
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function MapNode({ item, width }: { readonly item: MapItem; readonly width: number }) {
  const theme = usePlanUiTheme();
  const tone = item.tone;
  return (
    <View
      style={{
        width,
        padding: 10,
        gap: 6,
        borderRadius: 14,
        backgroundColor: theme.color.card,
        borderWidth: item.emphasized ? 1.5 : 0.5,
        borderColor: item.emphasized ? theme.toneInk(tone) : theme.color.hairline,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.toneBg(tone) }}>
          {item.passed ? (
            <Check color={theme.toneInk(tone)} size={12} strokeWidth={2.2} />
          ) : (
            <Text style={{ ...planText.caption, fontSize: 11, fontWeight: '800', color: theme.toneInk(tone) }}>{item.index}</Text>
          )}
        </View>
        <MapPill label={item.statusLabel} tone={tone} />
      </View>
      <Text style={{ ...planText.callout, fontSize: 13.5, lineHeight: 18, fontWeight: '600', color: theme.color.text }} numberOfLines={2}>
        {item.title}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: theme.color.sunken, overflow: 'hidden' }}>
          <View
            style={{
              width: `${item.total ? (item.done / item.total) * 100 : 0}%`,
              height: 4,
              borderRadius: 2,
              backgroundColor: theme.color.ok,
              opacity: 0.5,
            }}
          />
        </View>
        <Text style={{ ...planText.caption, fontSize: 11, color: theme.color.text3 }}>
          {item.done}/{item.total}
        </Text>
      </View>
    </View>
  );
}

/** The companion's Pill: quiet text in a hairline outline; butter and rose ink it and fill it faintly. */
function MapPill({ label, tone }: { readonly label: string; readonly tone: PlanTone }) {
  const theme = usePlanUiTheme();
  const meant = tone === 'butter' || tone === 'rose';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        height: 22,
        paddingHorizontal: 8,
        borderRadius: 6,
        backgroundColor: meant ? theme.toneBg(tone) : 'transparent',
        borderWidth: meant ? 0 : StyleSheet.hairlineWidth * 2,
        borderColor: theme.color.hairline,
      }}
    >
      <Text
        style={{ ...planText.caption, fontSize: 12, color: meant ? theme.toneInk(tone) : theme.color.text2, fontWeight: '500' }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}
