import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: vi.fn() }));
vi.mock('expo-file-system', () => ({ File: class {} }));
vi.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {},
  getInfoAsync: vi.fn(),
}));
vi.mock('../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('../lib/viewport', () => ({ useKeyboardInset: () => 0 }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { PACKAGE_LIMITS, classifyEntryIssue, type PickedPackage } from '../lib/package-pick';
import { en, packageT, zh } from '../lib/strings/package';
import { color } from '../lib/theme';
import { resetDrawerCount } from '../lib/ui-state';
import { PackageManifest } from './PackageManifest';

const samplePkg: PickedPackage = {
  kind: 'zip',
  name: 'design-v2.zip',
  uri: 'file:///tmp/design-v2.zip',
  totalBytes: 3072 + PACKAGE_LIMITS.maxFileBytes + 10,
  entries: [
    {
      path: 'screens/home.png',
      size: 2048,
      source: { kind: 'file', uri: 'file:///tmp/home.png' },
    },
    {
      path: 'tokens/colors.json',
      size: 1024,
      source: { kind: 'file', uri: 'file:///tmp/colors.json' },
    },
    {
      path: 'assets/huge.png',
      size: PACKAGE_LIMITS.maxFileBytes + 10,
      source: { kind: 'file', uri: 'file:///tmp/huge.png' },
      issue: 'file-too-large',
    },
  ],
};

describe('PackageManifest', () => {
  afterEach(() => {
    resetDrawerCount();
  });

  it('shows file count, total size, issue reason, and excludes unchecked files on confirm', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    const screen = await render(
      <PackageManifest open pkg={samplePkg} onClose={onClose} onConfirm={onConfirm} />,
    );

    expect(screen.getByText('已选 2 / 3 个文件 · 3.0 KB')).toBeTruthy();
    expect(screen.getByTestId('package-manifest-issue-2')).toBeTruthy();
    expect(screen.getByText('超过单文件 25 MB 上限')).toBeTruthy();

    // 确认前不上传
    expect(onConfirm).not.toHaveBeenCalled();

    // 取消勾选第二个文件 tokens/colors.json
    await fireEvent.press(screen.getByTestId('package-manifest-item-1'));
    expect(screen.getByText('已选 1 / 3 个文件 · 2.0 KB')).toBeTruthy();

    // 点击确认上传，只回传仍勾选的 screens/home.png
    await fireEvent.press(screen.getByTestId('package-manifest-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0].map((e: { path: string }) => e.path)).toEqual([
      'screens/home.png',
    ]);
  });

  it('disables confirm when all valid files are unchecked', async () => {
    const onConfirm = vi.fn();
    const screen = await render(
      <PackageManifest open pkg={samplePkg} onClose={vi.fn()} onConfirm={onConfirm} />,
    );

    await fireEvent.press(screen.getByTestId('package-manifest-item-0'));
    await fireEvent.press(screen.getByTestId('package-manifest-item-1'));
    expect(screen.getByText('已选 0 / 3 个文件 · 0 B')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('package-manifest-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('skips secret files with muted gray text (not color.error) and never uploads them', async () => {
    const onConfirm = vi.fn();
    const secretPkg: PickedPackage = {
      kind: 'zip',
      name: 'with-secrets.zip',
      uri: 'file:///tmp/with-secrets.zip',
      totalBytes: 2048,
      entries: [
        { path: 'screens/app.png', size: 1024, source: { kind: 'file', uri: 'file:///tmp/app.png' } },
        {
          path: '.env',
          size: 256,
          source: { kind: 'file', uri: 'file:///tmp/.env' },
          issue: classifyEntryIssue('.env', 256),
        },
        {
          path: 'credentials.json',
          size: 256,
          source: { kind: 'file', uri: 'file:///tmp/credentials.json' },
          issue: classifyEntryIssue('credentials.json', 256),
        },
        {
          path: 'id_rsa',
          size: 512,
          source: { kind: 'file', uri: 'file:///tmp/id_rsa' },
          issue: classifyEntryIssue('id_rsa', 512),
        },
      ],
    };

    const screen = await render(
      <PackageManifest open pkg={secretPkg} onClose={vi.fn()} onConfirm={onConfirm} />,
    );

    const issueLabel = screen.getByTestId('package-manifest-issue-1');
    expect(issueLabel.props.style).toMatchObject({ color: color.text3 });
    expect(issueLabel.props.style.color).not.toBe(color.error);

    // 尝试点击跳过条目，不可勾选
    await fireEvent.press(screen.getByTestId('package-manifest-item-1'));
    await fireEvent.press(screen.getByTestId('package-manifest-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0].map((e: { path: string }) => e.path)).toEqual([
      'screens/app.png',
    ]);
  });

  it('has matching zh and en keys in lib/strings/package.ts', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    expect(packageT('en', 'package.confirm')).toBe('Upload');
    expect(packageT('zh', 'package.confirm')).toBe('开始上传');
    expect(packageT('en', 'package.issue.secretFile')).toContain('secret');
  });
});
