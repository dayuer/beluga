import React from 'react';
import { render } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('../lib/kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));

import { DeviceKeyMissingError, hasDeviceKey, publicKey, sign } from '../lib/keys';
import { SignedButton } from './SignedButton';

describe('keys stub & SignedButton', () => {
  it('keys stub reports no device key and rejects sign()', async () => {
    await expect(hasDeviceKey()).resolves.toBe(false);
    await expect(publicKey()).resolves.toBeNull();
    await expect(sign(new Uint8Array([1, 2]))).rejects.toBeInstanceOf(DeviceKeyMissingError);
  });

  it('disables button and shows guidance when device has no key, enables when key exists', async () => {
    const noKey = await render(<SignedButton label="批准开工" onPress={() => {}} />);
    const btn = noKey.getByTestId('signed-button');
    expect(btn.props.accessibilityState.disabled).toBe(true);
    expect(noKey.getByText(/我 › 设备/)).toBeTruthy();

    const withKey = await render(<SignedButton label="批准开工" onPress={() => {}} hasKeyOverride />);
    const enabledBtn = withKey.getByTestId('signed-button');
    expect(enabledBtn.props.accessibilityState.disabled).toBe(false);
    expect(withKey.getByText('由这台设备确认')).toBeTruthy();
  });
});
