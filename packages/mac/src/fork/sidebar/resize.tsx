import { useRef } from 'react';
import { ResizeHandle } from '../../layout/panel/ResizeHandle.js';
import { getPrefs, setPrefs } from '../../lib/prefs.js';
import { SIDEBAR_DEFAULT, clampSidebarWidth, stepSidebarWidth, widthAtPointer } from './resize-model.js';
import s from './resize.module.css';

/**
 * The sidebar's right edge, dragged to make it wider or narrower (fork; docs/fork.md, "侧边栏"),
 * the way the right panel's edge is (layout/panel/ResizeHandle.tsx): nothing shows until the pointer
 * is over it, the cursor turns to col-resize, double-click goes back to the default, and with
 * keyboard focus → and ← widen and narrow it. The width is upstream's `sidebarWidth` preference,
 * kept across launches like the panel's: while dragging only `--sidebar-w` moves, and the width is
 * saved once, when you let go.
 */
export function SidebarEdge() {
  const edge = useRef<HTMLSpanElement>(null);
  const drag = useRef<number | undefined>(undefined);
  const save = (width: number): void => setPrefs({ sidebarWidth: clampSidebarWidth(width) });
  return (
    <span ref={edge} className={s.edge} data-fork-sidebar-edge="">
      <ResizeHandle
        axis="x"
        label="Resize the sidebar"
        onMove={(x) => {
          const nav = edge.current?.closest('nav');
          if (!nav) return;
          drag.current = widthAtPointer(x, nav.getBoundingClientRect().left);
          document.documentElement.style.setProperty('--sidebar-w', `${drag.current}px`);
        }}
        onEnd={() => {
          if (drag.current !== undefined) save(drag.current);
          drag.current = undefined;
        }}
        onReset={() => save(SIDEBAR_DEFAULT)}
        // The handle's +1 is "toward the left" (it was made for the right panel): for the sidebar, narrower.
        onStep={(dir) => save(stepSidebarWidth(getPrefs().sidebarWidth, dir === 1 ? -1 : 1))}
      />
    </span>
  );
}
