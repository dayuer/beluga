import React from 'react';

// react-native-gesture-handler mock
export const GestureDetector = ({ children }: { children: React.ReactNode }) => children;

export const Gesture = {
  Pan: () => {
    const chain = {
      onUpdate: () => chain,
      onEnd: () => chain,
    };
    return chain;
  },
};

// react-native-reanimated mock
const AnimatedView = React.forwardRef((props: Record<string, unknown>, ref: unknown) =>
  React.createElement('View', { ...props, ref }, props.children as React.ReactNode),
);

export default { View: AnimatedView };
export const runOnJS = <T extends (...args: never[]) => unknown>(fn: T) => fn;
export const useReducedMotion = () => true;
export const useSharedValue = <T,>(v: T) => ({ value: v });
export const useAnimatedStyle = (fn: () => Record<string, unknown>) => fn();
export const withSpring = <T,>(v: T) => v;
export const withTiming = <T,>(v: T, _cfg?: unknown, cb?: (done: boolean) => void) => {
  cb?.(true);
  return v;
};

// react-native-safe-area-context mock
export const useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });

// react-native-keyboard-controller mock
export const useKeyboardHandler = () => {};
export const KeyboardProvider = ({ children }: { children: React.ReactNode }) => children;
