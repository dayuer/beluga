import React from 'react';
import { render } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockParams = vi.fn<() => { id?: string | string[] }>(() => ({}));
const mockRedirect = vi.fn();

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams(),
  Redirect: (props: { href: unknown }) => {
    mockRedirect(props.href);
    return React.createElement('Redirect', { href: props.href });
  },
}));

import LegacyPlanRedirect from '../app/plan/[id]';
import LegacyProjectRedirect from '../app/project/[id]';

describe('Legacy project & plan redirects (SS-186)', () => {
  beforeEach(() => {
    mockRedirect.mockClear();
  });

  it('redirects project/[id] for string, string[], and missing id', async () => {
    mockParams.mockReturnValue({ id: 'proj-shop' });
    await render(<LegacyProjectRedirect />);
    expect(mockRedirect).toHaveBeenLastCalledWith({ pathname: '/', params: { project: 'proj-shop' } });

    mockParams.mockReturnValue({ id: ['proj-ops', 'ignored'] });
    await render(<LegacyProjectRedirect />);
    expect(mockRedirect).toHaveBeenLastCalledWith({ pathname: '/', params: { project: 'proj-ops' } });

    mockParams.mockReturnValue({});
    await render(<LegacyProjectRedirect />);
    expect(mockRedirect).toHaveBeenLastCalledWith('/');
  });

  it('redirects plan/[id] for string, string[], and missing id', async () => {
    mockParams.mockReturnValue({ id: 'req-login' });
    await render(<LegacyPlanRedirect />);
    expect(mockRedirect).toHaveBeenLastCalledWith({ pathname: '/request/[id]', params: { id: 'req-login' } });

    mockParams.mockReturnValue({ id: ['req-export', 'extra'] });
    await render(<LegacyPlanRedirect />);
    expect(mockRedirect).toHaveBeenLastCalledWith({ pathname: '/request/[id]', params: { id: 'req-export' } });

    mockParams.mockReturnValue({});
    await render(<LegacyPlanRedirect />);
    expect(mockRedirect).toHaveBeenLastCalledWith('/');
  });
});
