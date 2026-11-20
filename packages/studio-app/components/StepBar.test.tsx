import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('react-native-svg', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-native-svg').catch(() => ({}));
  const r = await import('react');
  const host = (name: string) =>
    r.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      r.createElement(name, { ...props, ref }, props.children as React.ReactNode),
    );
  const Svg = host('Svg');
  return {
    ...actual,
    default: Svg,
    Svg,
    Defs: host('Defs'),
    Pattern: host('Pattern'),
    Rect: host('Rect'),
    Line: host('Line'),
  };
});

import { setScheme } from '../lib/theme';
import type { RequestStep } from '../lib/views';
import { findAllJson } from '../test/json';
import { StepBar } from './StepBar';

const FOUR_STEPS: readonly RequestStep[] = [
  { id: 's1', title: '核对设计稿与登录接口', status: 'done', summary: '已核对 18 个设计文件' },
  { id: 's2', title: '实现登录表单与一键登录按钮', status: 'active', summary: '正在编写表单校验' },
  { id: 's3', title: '接入错误提示与触感反馈', status: 'waiting', waitReason: 'queued', summary: '等待第 2 步完成后继续' },
  { id: 's4', title: '真机截图与预览部署', status: 'todo' },
];

describe('StepBar (SS-44)', () => {
  it('renders four step states including SVG stripe pattern for waiting, and expands detail on press', async () => {
    setScheme('light');
    const screen = await render(<StepBar steps={FOUR_STEPS} lang="zh" />);

    const s1 = screen.getByTestId('step-cell-s1');
    const s2 = screen.getByTestId('step-cell-s2');
    const s3 = screen.getByTestId('step-cell-s3');
    const s4 = screen.getByTestId('step-cell-s4');

    // 读屏读出第几步与什么状态
    expect(s1.props.accessibilityLabel).toBe('第 1 / 4 步：核对设计稿与登录接口，已完成');
    expect(s2.props.accessibilityLabel).toBe('第 2 / 4 步：实现登录表单与一键登录按钮，进行中');
    expect(s3.props.accessibilityLabel).toBe('第 3 / 4 步：接入错误提示与触感反馈，等待中');
    expect(s4.props.accessibilityLabel).toBe('第 4 / 4 步：真机截图与预览部署，未开始');

    // waiting 格子使用 react-native-svg 的 Pattern 斜纹
    const patterns = findAllJson(screen.toJSON(), (n) => n.type === 'Pattern');
    expect(patterns).toHaveLength(1);

    // 点一格展开说明，再点一次收起
    expect(screen.queryByTestId('step-detail')).toBeNull();
    await fireEvent.press(s3);
    expect(screen.getByTestId('step-detail')).toBeTruthy();
    expect(screen.getByText('第 3 步 · 等待中')).toBeTruthy();
    expect(screen.getByText('等待第 2 步完成后继续')).toBeTruthy();

    await fireEvent.press(s3);
    expect(screen.queryByTestId('step-detail')).toBeNull();
  });
});
