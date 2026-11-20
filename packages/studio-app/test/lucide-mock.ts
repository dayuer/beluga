import React from 'react';

const icon = (name: string) => (props: Record<string, unknown>) =>
  React.createElement('LucideIcon', { ...props, iconName: name });

export const AlertCircle = icon('AlertCircle');
export const Check = icon('Check');
export const ChevronDown = icon('ChevronDown');
export const ChevronRight = icon('ChevronRight');
export const ChevronUp = icon('ChevronUp');
export const Clock = icon('Clock');
export const Download = icon('Download');
export const ExternalLink = icon('ExternalLink');
export const FileText = icon('FileText');
export const Gauge = icon('Gauge');
export const Globe = icon('Globe');
export const Image = icon('Image');
export const Info = icon('Info');
export const ListChecks = icon('ListChecks');
export const MessageSquare = icon('MessageSquare');
export const User = icon('User');
export const UserCheck = icon('UserCheck');
export const WifiOff = icon('WifiOff');
