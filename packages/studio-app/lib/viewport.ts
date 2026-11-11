import { useEffect, useState } from 'react';

/**
 * How much of the layout viewport the on-screen keyboard covers. iOS Safari ignores
 * `interactive-widget=resizes-content`, so this is the fallback both platforms use:
 *
 *   inset = innerHeight − visualViewport.height − visualViewport.offsetTop
 *
 * 0 when there is no visualViewport (desktop browsers that don't expose it, tests).
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const next = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      setInset(next);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return inset;
}
