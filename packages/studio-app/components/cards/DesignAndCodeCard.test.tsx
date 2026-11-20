import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));

import { setScheme } from '../../lib/theme';
import { CodeCard, type CodeCardData } from './CodeCard';
import { DesignCard, type DesignCardData } from './DesignCard';

describe('DesignCard & CodeCard (SS-46)', () => {
  it('renders uploading and received states in DesignCard', async () => {
    setScheme('light');
    const uploading: DesignCardData = {
      id: 'd1',
      kind: 'design',
      createdAt: 1000,
      status: 'pending',
      packageName: '登录页改版.zip',
      fileCount: 18,
      totalBytes: 4_820_000,
      imageCount: 14,
      specCount: 4,
      skipped: [{ name: '.env.local', reason: 'secret' }],
      progress: 0.45,
    };

    const s1 = await render(<DesignCard card={uploading} lang="zh" />);
    expect(s1.getByText('登录页改版.zip')).toBeTruthy();
    expect(s1.getByText('上传中 45%')).toBeTruthy();
    expect(s1.getByTestId('design-card-progress')).toBeTruthy();
    expect(s1.getByText('已跳过 1 个无关文件')).toBeTruthy();

    const received: DesignCardData = { ...uploading, id: 'd2', status: 'done', progress: 1 };
    const s2 = await render(<DesignCard card={received} lang="zh" />);
    expect(s2.getByText('已收下')).toBeTruthy();
    expect(s2.queryByTestId('design-card-progress')).toBeNull();
  });

  it('renders pushed and failed states in CodeCard with retry push action', async () => {
    setScheme('light');
    const onRetry = vi.fn();
    const failed: CodeCardData = {
      id: 'c1',
      kind: 'code',
      createdAt: 1000,
      status: 'pending',
      repoUrl: 'https://git.synon.invalid/shop/ios-app',
      prUrl: 'https://git.synon.invalid/shop/ios-app/pull/42',
      pushState: 'failed',
    };

    const screen = await render(<CodeCard card={failed} lang="zh" onRetryPush={onRetry} />);
    expect(screen.getByText('推送失败')).toBeTruthy();
    expect(screen.getByText('https://git.synon.invalid/shop/ios-app')).toBeTruthy();
    expect(screen.getByTestId('code-card-retry')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('code-card-retry'));
    await waitFor(() => {
      expect(onRetry).toHaveBeenCalledWith('c1');
      expect(screen.getByText('已推送')).toBeTruthy();
    });
  });
});
