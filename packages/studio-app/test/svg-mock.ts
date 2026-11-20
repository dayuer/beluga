import React from 'react';

const createSvgHost = (name: string) =>
  React.forwardRef((props: Record<string, unknown>, ref: unknown) =>
    React.createElement(name, { ...props, ref }, props.children as React.ReactNode),
  );

export const Svg = createSvgHost('Svg');
export const Path = createSvgHost('Path');
export const Circle = createSvgHost('Circle');
export const Rect = createSvgHost('Rect');
export const Line = createSvgHost('Line');
export const Polyline = createSvgHost('Polyline');
export const Polygon = createSvgHost('Polygon');
export const G = createSvgHost('G');
export const Defs = createSvgHost('Defs');
export const Pattern = createSvgHost('Pattern');
export default Svg;
