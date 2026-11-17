import { useRef } from 'react';
import { Icon } from '../../components/Icon.js';
import { useCalm } from './index.js';

/**
 * The way back to the newest message, and how much arrived while you were reading further up
 * (docs/calm/hooks.md §2). Upstream's button only exists while you are not at the bottom, so
 * mounting it is the moment you left: everything that comes from then on is new. With calm mode
 * off the label is exactly the upstream one.
 */
export function JumpLabel({ rows }: { rows: number }) {
  const on = useCalm();
  const base = useRef<number | undefined>(undefined);
  // A list that got shorter is another conversation (or a reset): count again from here.
  if (base.current === undefined || rows < base.current) base.current = rows;
  const added = rows - base.current;
  if (!on || added <= 0) {
    return (
      <>
        <Icon name="chevronDown" size={12} />
        Latest
      </>
    );
  }
  return (
    <>
      <Icon name="chevronDown" size={12} />
      {/* Its own element: one-toast.css gives the count a quiet look, data-new says how many. */}
      {/* "new below", not "new": upstream's "{0} new" counts a plan's new milestones, and the two read differently in Chinese. */}
      <span data-new={added}>{added} new below</span>
    </>
  );
}
