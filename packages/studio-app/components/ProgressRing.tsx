import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { color } from '../lib/theme';

/** done / total as a 44pt ring. Waiting-on-you plans use amber; everything else ink. */
export function ProgressRing({
  done,
  total,
  size = 44,
  tone = 'text',
}: {
  done: number;
  total: number;
  size?: number;
  tone?: 'text' | 'warn' | 'ok';
}) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  const stroke = tone === 'warn' ? color.warn : tone === 'ok' ? color.ok : color.text;

  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={`${done} / ${total}`}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(0,0,0,0.10)" strokeWidth={3} />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={`${circumference * (1 - pct)}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
    </View>
  );
}
