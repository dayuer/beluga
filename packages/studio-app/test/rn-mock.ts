import React from 'react';

const createHost = (name: string) =>
  React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    const { children, style, ...rest } = props;
    const flatStyle = Array.isArray(style)
      ? Object.assign({}, ...style.flat(Infinity).filter(Boolean))
      : style;
    return React.createElement(
      name,
      { ...rest, style: flatStyle, ref },
      children as React.ReactNode,
    );
  });

export const View = createHost('View');
export const Text = createHost('Text');
export const ScrollView = createHost('ScrollView');
export const ActivityIndicator = createHost('ActivityIndicator');
export const TextInput = createHost('TextInput');

export const Pressable = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
  const { children, style, ...rest } = props;
  const resolvedStyle = typeof style === 'function' ? style({ pressed: false }) : style;
  const flatStyle = Array.isArray(resolvedStyle)
    ? Object.assign({}, ...resolvedStyle.flat(Infinity).filter(Boolean))
    : resolvedStyle;
  const resolvedChildren = typeof children === 'function' ? children({ pressed: false }) : children;
  return React.createElement('Pressable', { ...rest, style: flatStyle, ref }, resolvedChildren);
});

export const StyleSheet = {
  hairlineWidth: 0.5,
  absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: (s: unknown) => (Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : s),
};

export const Platform = {
  OS: 'ios',
  select: <T>(m: { ios?: T; android?: T; default?: T }): T | undefined => m.ios ?? m.default,
};

export const AppState = {
  addEventListener: () => ({ remove: () => {} }),
};

export const PanResponder = {
  create: () => ({ panHandlers: {} }),
};

export const useWindowDimensions = () => ({ width: 390, height: 844, scale: 3, fontScale: 1 });
export const useColorScheme = () => 'light';
export const Keyboard = { addListener: () => ({ remove: () => {} }) };
export const processColor = (c: unknown) => c;
export const codegenNativeComponent = (name: string) => createHost(name);
