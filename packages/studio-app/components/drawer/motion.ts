import type { ReactNode } from 'react';
import { View } from 'react-native';
import type * as GestureHandlerModule from 'react-native-gesture-handler';
import type * as ReanimatedModule from 'react-native-reanimated';

type PanEvent = { readonly translationY: number; readonly velocityY: number };
type PanChain = {
  onUpdate: (cb: (e: PanEvent) => void) => PanChain;
  onEnd: (cb: (e: PanEvent) => void) => PanChain;
};

type MotionExports = {
  readonly GestureDetector: typeof GestureHandlerModule.GestureDetector;
  readonly Gesture: typeof GestureHandlerModule.Gesture;
  readonly AnimatedView: typeof View;
  readonly useSharedValue: <T>(initial: T) => { value: T };
  readonly useAnimatedStyle: <T extends Record<string, unknown>>(updater: () => T) => T;
  readonly withSpring: <T>(toValue: T, config?: unknown) => T;
  readonly withTiming: <T>(toValue: T, config?: unknown, callback?: (finished?: boolean) => void) => T;
  readonly runOnJS: <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A) => void;
  readonly useReducedMotion: () => boolean;
};

function createTestMotion(): MotionExports {
  const noopChain = (): PanChain => {
    const chain: PanChain = {
      onUpdate: () => chain,
      onEnd: () => chain,
    };
    return chain;
  };

  return {
    GestureDetector: (({ children }: { children: ReactNode }) => children) as unknown as typeof GestureHandlerModule.GestureDetector,
    Gesture: { Pan: noopChain } as unknown as typeof GestureHandlerModule.Gesture,
    AnimatedView: View,
    useSharedValue: <T,>(initial: T) => ({ value: initial }),
    useAnimatedStyle: <T extends Record<string, unknown>>(updater: () => T) => updater(),
    withSpring: <T,>(toValue: T) => toValue,
    withTiming: <T,>(toValue: T, _config?: unknown, callback?: (finished?: boolean) => void) => {
      callback?.(true);
      return toValue;
    },
    runOnJS:
      <A extends unknown[], R>(fn: (...args: A) => R) =>
      (...args: A) => {
        fn(...args);
      },
    useReducedMotion: () => true,
  };
}

function loadNativeMotion(): MotionExports {
  // 字面量 require 供 Metro 静态打包；Vitest 环境下不会执行到此处
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gh = require('react-native-gesture-handler') as typeof GestureHandlerModule;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const reanimated = require('react-native-reanimated') as typeof ReanimatedModule & {
    default: { View: typeof View };
  };
  return {
    GestureDetector: gh.GestureDetector,
    Gesture: gh.Gesture,
    AnimatedView: reanimated.default.View,
    useSharedValue: reanimated.useSharedValue as unknown as MotionExports['useSharedValue'],
    useAnimatedStyle: reanimated.useAnimatedStyle as unknown as MotionExports['useAnimatedStyle'],
    withSpring: reanimated.withSpring as unknown as MotionExports['withSpring'],
    withTiming: reanimated.withTiming as unknown as MotionExports['withTiming'],
    runOnJS: reanimated.runOnJS as unknown as MotionExports['runOnJS'],
    useReducedMotion: reanimated.useReducedMotion,
  };
}

const motion: MotionExports = process.env.VITEST ? createTestMotion() : loadNativeMotion();

export const {
  GestureDetector,
  Gesture,
  AnimatedView,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  useReducedMotion,
} = motion;
