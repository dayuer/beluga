import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));

import { color, setScheme } from '../../lib/theme';
import { findAllJson } from '../../test/json';
import { Card } from './Card';

describe('Card', () => {
  it('renders title, body, footer, and polite accessibilityLiveRegion on status', async () => {
    setScheme('light');
    const screen = await render(
      <Card title="登录改版" status="needs-you" footer={<Text>操作区</Text>}>
        <Text>正文内容</Text>
      </Card>,
    );

    expect(screen.getByText('登录改版')).toBeTruthy();
    expect(screen.getByText('正文内容')).toBeTruthy();
    expect(screen.getByText('操作区')).toBeTruthy();

    const tree = screen.toJSON();
    const liveNodes = findAllJson(tree, (n) => n.props.accessibilityLiveRegion === 'polite');
    expect(liveNodes).toHaveLength(1);
    expect(liveNodes[0]?.props.accessibilityLabel).toBe('等你');
    expect(findAllJson(liveNodes[0]!, (n) => n.props.style?.backgroundColor === color.needsYouDot)).toHaveLength(1);
  });

  it('draws no dot for done status and uses waiting grey for waiting status', async () => {
    setScheme('light');
    const doneTree = (await render(<Card title="已完成卡片" status="done" />)).toJSON();
    const doneLive = findAllJson(doneTree, (n) => n.props.accessibilityLiveRegion === 'polite')[0]!;
    expect(findAllJson(doneLive, (n) => n.props.style?.borderRadius === 999)).toHaveLength(0);

    const waitTree = (await render(<Card title="等待卡片" status="waiting" />)).toJSON();
    const waitLive = findAllJson(waitTree, (n) => n.props.accessibilityLiveRegion === 'polite')[0]!;
    expect(findAllJson(waitLive, (n) => n.props.style?.backgroundColor === '#B9B9BF')).toHaveLength(1);
  });
});
