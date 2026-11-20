import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { undoStore } from '../lib/undo';
import { AttachList } from './AttachList';

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return { ...actual, Image: 'Image' };
});

// lib/appearance 读 kv，kv 用 expo-file-system；node 下没有原生模块，给个空的。
vi.mock('expo-file-system', () => ({
  Paths: { document: '/mock-doc' },
  File: class {},
}));

vi.mock('lucide-react-native', () => ({
  Camera: () => null,
  Image: () => null,
  X: () => null,
}));

describe('AttachList (SS-199)', () => {
  it('ensures >= 44pt hit targets and supports 4s undo restore on remove', async () => {
    const item = { id: 'a1', uri: 'file:///a.jpg', width: 1024, height: 768, fileName: 'a.jpg' };
    const onRemove = vi.fn();
    const onRestore = vi.fn();

    const { getByTestId } = await render(
      <AttachList
        items={[item]}
        onAddCamera={vi.fn()}
        onAddLibrary={vi.fn()}
        onRemove={onRemove}
        onRestore={onRestore}
        lang="zh"
      />,
    );

    const camStyle = StyleSheet.flatten(getByTestId('attach-camera').props.style);
    const libStyle = StyleSheet.flatten(getByTestId('attach-library').props.style);
    expect(camStyle.minHeight).toBeGreaterThanOrEqual(44);
    expect(libStyle.minHeight).toBeGreaterThanOrEqual(44);

    const removeBtn = getByTestId('attach-remove-a1');
    const removeStyle = StyleSheet.flatten(removeBtn.props.style);
    expect(removeStyle.width + (removeBtn.props.hitSlop ?? 0) * 2).toBeGreaterThanOrEqual(44);

    await fireEvent.press(removeBtn);
    expect(onRemove).toHaveBeenCalledWith('a1');
    expect(undoStore.getState().active).toBe(true);

    undoStore.cancel();
    expect(onRestore).toHaveBeenCalledWith(item, 0);
  });
});
