import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('expo-linking', () => ({ openURL: vi.fn() }));
vi.mock('../../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('lucide-react-native', async () => {
  const r = await import('react');
  const icon = (name: string) => (props: Record<string, unknown>) => r.createElement('LucideIcon', { ...props, iconName: name });
  return {
    AlertCircle: icon('AlertCircle'),
    Clock: icon('Clock'),
    Download: icon('Download'),
    ExternalLink: icon('ExternalLink'),
    FileText: icon('FileText'),
    Gauge: icon('Gauge'),
    Globe: icon('Globe'),
    Image: icon('Image'),
    Info: icon('Info'),
    UserCheck: icon('UserCheck'),
    WifiOff: icon('WifiOff'),
  };
});

import { DEMO_RESULT_DRAWER } from '../../lib/demo/screens';
import { setScheme } from '../../lib/theme';
import { OutputsTab } from './OutputsTab';

describe('OutputsTab (SS-49)', () => {
  it('renders InlineHint when empty', async () => {
    setScheme('light');
    const screen = await render(<OutputsTab artifacts={[]} attachments={[]} lang="zh" />);
    expect(screen.getByTestId('drawer-outputs-tab-empty')).toBeTruthy();
    expect(screen.getByText('还没有可查看的成果')).toBeTruthy();
  });

  it('renders artifacts and attachments and opens URL on press', async () => {
    setScheme('light');
    const onOpenUrl = vi.fn();
    const screen = await render(
      <OutputsTab
        artifacts={DEMO_RESULT_DRAWER.artifacts}
        attachments={DEMO_RESULT_DRAWER.attachments}
        lang="zh"
        onOpenUrl={onOpenUrl}
      />,
    );

    expect(screen.getByText('第 2 轮')).toBeTruthy();
    expect(screen.getByText('测试环境在线预览')).toBeTruthy();
    expect(screen.getByText('iOS 测试安装包 1.8.3')).toBeTruthy();
    expect(screen.getByText('登录页设计稿.zip')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('output-item-a2'));
    expect(onOpenUrl).toHaveBeenCalledWith('https://demo-preview.synon.invalid/req-export.ipa');
  });
});
