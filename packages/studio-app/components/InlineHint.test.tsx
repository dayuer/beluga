import React from 'react';
import { render } from '@testing-library/react-native';
import { describe, expect, it } from 'vitest';
import { color, setScheme } from '../lib/theme';
import { findAllJson } from '../test/json';
import { InlineHint } from './InlineHint';

describe('InlineHint', () => {
  it('renders reason, whenReady, and tone-appropriate icon colors for all waitReasons', async () => {
    setScheme('light');

    const offline = await render(
      <InlineHint waitReason="offline" reason="执行机器暂时离线" whenReady="上线后会自动继续" testID="hint-offline" />,
    );
    expect(offline.getByText('执行机器暂时离线')).toBeTruthy();
    expect(offline.getByText('上线后会自动继续')).toBeTruthy();
    expect(findAllJson(offline.toJSON(), (n) => n.props.color === color.text3OnSunken).length).toBeGreaterThan(0);

    const queued = await render(<InlineHint waitReason="queued" reason="前面还有 2 个任务排队" />);
    expect(queued.getByText('前面还有 2 个任务排队')).toBeTruthy();

    const quota = await render(<InlineHint waitReason="quota" reason="本月用量已达上限" />);
    expect(quota.getByText('本月用量已达上限')).toBeTruthy();

    const human = await render(<InlineHint waitReason="needs-human" reason="需要工作室成员处理一下" />);
    expect(human.getByText('需要工作室成员处理一下')).toBeTruthy();

    const info = await render(<InlineHint tone="info" reason="还没有生成预览" whenReady="第一步完成后出现" />);
    expect(findAllJson(info.toJSON(), (n) => n.props.color === color.info).length).toBeGreaterThan(0);

    const err = await render(<InlineHint tone="error" reason="交付令牌已过期" />);
    expect(findAllJson(err.toJSON(), (n) => n.props.color === color.error).length).toBeGreaterThan(0);
  });
});
