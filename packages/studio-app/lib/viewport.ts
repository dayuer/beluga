import { useEffect, useState } from 'react';
import { KeyboardEvents } from 'react-native-keyboard-controller';

/**
 * 原生键盘高度（pt）：基于 react-native-keyboard-controller 的 KeyboardEvents，
 * 在键盘弹出/收起时同步更新底部占位高度，取整到整数 pt（docs/studio-mobile-ux.md §5）。
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (typeof KeyboardEvents?.addListener !== 'function') return;
    const onShow = (e: { height: number }) => {
      setInset(Math.max(0, Math.round(e.height)));
    };
    const onHide = () => {
      setInset(0);
    };
    const subs = [
      KeyboardEvents.addListener('keyboardWillShow', onShow),
      KeyboardEvents.addListener('keyboardDidShow', onShow),
      KeyboardEvents.addListener('keyboardWillHide', onHide),
      KeyboardEvents.addListener('keyboardDidHide', onHide),
    ];
    return () => {
      for (const sub of subs) sub.remove();
    };
  }, []);

  return inset;
}
