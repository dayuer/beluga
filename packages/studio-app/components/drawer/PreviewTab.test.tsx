import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('expo-linking', () => ({ openURL: vi.fn() }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: vi.fn() }));
vi.mock('../../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('lucide-react-native', async () => {
  const r = await import('react');
  const icon = (name: string) => (props: Record<string, unknown>) => r.createElement('LucideIcon', { ...props, iconName: name });
  return {
    AlertCircle: icon('AlertCircle'),
    Check: icon('Check'),
    Clock: icon('Clock'),
    Download: icon('Download'),
    Gauge: icon('Gauge'),
    Globe: icon('Globe'),
    Info: icon('Info'),
    UserCheck: icon('UserCheck'),
    WifiOff: icon('WifiOff'),
  };
});

import { setScheme } from '../../lib/theme';
import { PreviewTab } from './PreviewTab';

describe('PreviewTab (SS-51)', () => {
  it('renders ready state with browser preview and installer download', async () => {
    setScheme('light');
    const onOpenBrowser = vi.fn();
    const onDownloadInstall = vi.fn();
    const screen = await render(
      <PreviewTab
        previewUrl="https://demo-preview.synon.invalid/req-export"
        installUrl="https://demo-preview.synon.invalid/req-export.ipa"
        lang="zh"
        onOpenBrowser={onOpenBrowser}
        onDownloadInstall={onDownloadInstall}
      />,
    );

    expect(screen.getByText('测试环境已就绪')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('preview-open-browser'));
    expect(onOpenBrowser).toHaveBeenCalledWith('https://demo-preview.synon.invalid/req-export');

    await fireEvent.press(screen.getByTestId('preview-download-install'));
    expect(onDownloadInstall).toHaveBeenCalledWith('https://demo-preview.synon.invalid/req-export.ipa');
  });

  it('renders deploying and unconfigured InlineHint states', async () => {
    setScheme('light');
    const deploying = await render(<PreviewTab state="deploying" lang="zh" />);
    expect(deploying.getByTestId('drawer-preview-tab-deploying')).toBeTruthy();
    expect(deploying.getByText('测试环境还在部署中')).toBeTruthy();

    const unconfigured = await render(<PreviewTab lang="zh" />);
    expect(unconfigured.getByTestId('drawer-preview-tab-unconfigured')).toBeTruthy();
    expect(unconfigured.getByText('尚未配置测试环境')).toBeTruthy();
  });
});
