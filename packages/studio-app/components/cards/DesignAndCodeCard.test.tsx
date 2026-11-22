import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const openURL = vi.fn().mockResolvedValue(true);

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('expo-linking', () => ({ openURL: (...args: unknown[]) => openURL(...args) }));
vi.mock('../../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));

import { setScheme } from '../../lib/theme';
import { CodeCard, type CodeCardData } from './CodeCard';
import { DesignCard, type DesignCardData } from './DesignCard';

describe('DesignCard & CodeCard (SS-46 / SS-191)', () => {
  beforeEach(() => {
    openURL.mockClear();
  });

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

  it('syncs pushState prop updates, hides retry without onRetryPush, shows retry error, and opens links', async () => {
    setScheme('light');
    const base: CodeCardData = {
      id: 'c1',
      kind: 'code',
      createdAt: 1000,
      status: 'pending',
      repoUrl: 'https://git.synon.invalid/shop/ios-app',
      prUrl: 'https://git.synon.invalid/shop/ios-app/pull/42',
      pushState: 'failed',
    };

    // 没有 onRetryPush 时不显示重试按钮
    const noHandler = await render(<CodeCard card={base} lang="zh" />);
    expect(noHandler.queryByTestId('code-card-retry')).toBeNull();

    // prop 的 pushState 变化会同步
    await noHandler.rerender(<CodeCard card={{ ...base, pushState: 'pushed' }} lang="zh" />);
    expect(noHandler.getByText('已推送')).toBeTruthy();

    // 重试失败时显示原因；再次重试成功
    const onRetry = vi
      .fn()
      .mockRejectedValueOnce(new Error('网络超时'))
      .mockResolvedValueOnce(true);
    const screen = await render(<CodeCard card={base} lang="zh" onRetryPush={onRetry} />);

    await fireEvent.press(screen.getByTestId('code-card-retry'));
    await waitFor(() => {
      expect(screen.getByText('网络超时')).toBeTruthy();
    });

    await fireEvent.press(screen.getByTestId('code-card-retry'));
    await waitFor(() => {
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(screen.getByText('已推送')).toBeTruthy();
    });

    // 点仓库与 PR 链接会调 Linking.openURL
    await fireEvent.press(screen.getByTestId('code-card-repo-link'));
    expect(openURL).toHaveBeenCalledWith('https://git.synon.invalid/shop/ios-app');

    await fireEvent.press(screen.getByTestId('code-card-pr-link'));
    expect(openURL).toHaveBeenCalledWith('https://git.synon.invalid/shop/ios-app/pull/42');
  });
});
