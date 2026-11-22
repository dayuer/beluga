import React from 'react';

const icon = (name: string) => (props: Record<string, unknown>) =>
  React.createElement('LucideIcon', { ...props, iconName: name });

export const AlertCircle = icon('AlertCircle');
export const Check = icon('Check');
export const ChevronDown = icon('ChevronDown');
export const ChevronRight = icon('ChevronRight');
export const Layers = icon('Layers');
export const RotateCw = icon('RotateCw');
export const Send = icon('Send');
export const X = icon('X');
export const Clock = icon('Clock');
export const Gauge = icon('Gauge');
export const Info = icon('Info');
export const ListChecks = icon('ListChecks');
export const MessageSquare = icon('MessageSquare');
export const User = icon('User');
export const UserCheck = icon('UserCheck');
export const WifiOff = icon('WifiOff');
