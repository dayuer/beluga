import React from 'react';
import { render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));

import { color, setScheme } from '../lib/theme';
import { findAllJson } from '../test/json';
import { StatusDot } from './StatusDot';

describe('StatusDot', () => {
  it('uses exact dot colors for needs-you, waiting, working, error and draws no dot for done', async () => {
    setScheme('light');

    const needsYou = await render(<StatusDot status="needs-you" testID="dot-ny" />);
    const nyNode = needsYou.getByTestId('dot-ny');
    expect(nyNode.props.accessibilityLiveRegion).toBe('polite');
    expect(nyNode.props.accessibilityLabel).toBe('等你');
    expect(findAllJson(needsYou.toJSON(), (n) => n.props.style?.backgroundColor === '#C28A1E')).toHaveLength(1);

    const waiting = await render(<StatusDot status="waiting" testID="dot-wait" />);
    expect(findAllJson(waiting.toJSON(), (n) => n.props.style?.backgroundColor === '#B9B9BF')).toHaveLength(1);

    const working = await render(<StatusDot status="working" testID="dot-work" />);
    expect(findAllJson(working.toJSON(), (n) => n.props.style?.backgroundColor === color.ok)).toHaveLength(1);

    const err = await render(<StatusDot status="error" testID="dot-err" />);
    expect(findAllJson(err.toJSON(), (n) => n.props.style?.backgroundColor === color.error)).toHaveLength(1);

    const done = await render(<StatusDot status="done" testID="dot-done" />);
    expect(findAllJson(done.toJSON(), (n) => n.props.style?.borderRadius === 999)).toHaveLength(0);
  });
});
