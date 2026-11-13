import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { type MotionValue, motion, useReducedMotion, useSpring, useTransform, useVelocity } from 'motion/react';
import { useCalm } from '../fork/calm/index.js';
import { leanFor } from '../tasks/board-drag.js';

/**
 * Something picked up and carried (a board's card, a sidebar's chat row): it lifts a little and
 * swings left and right with the way it's pulled, then rights itself. The board's feel, in one place.
 */

const LIFT_SCALE = 1.035;
const LIFT_SPRING = { type: 'spring', stiffness: 500, damping: 30 } as const;
const LEAN_SPRING = { stiffness: 260, damping: 22 };

/** How far it leans, from how fast `x` moves (none with reduced motion, and none in calm mode: `calmOn()` is the fork's, TaskBoard's `reduce` carries it). */
export function useLean(x: MotionValue<number>): MotionValue<number> {
  const reduce = useReducedMotion() ?? false;
  const calm = useCalm();
  const target = useTransform(useVelocity(x), (v) => (reduce || calm ? 0 : leanFor(v)));
  const spring = useSpring(target, LEAN_SPRING);
  // Calm: the value itself, never a spring (docs/fork.md「沉稳界面」).
  return calm ? target : spring;
}

/** What follows the pointer, over everything. `down`: it's being put down (back to its own size). */
export function Lifted({ x, y, lean, width, down = false, className, children, ...data }: { x: MotionValue<number>; y: MotionValue<number>; lean: MotionValue<number>; width: number; down?: boolean; className?: string | undefined; children: ReactNode } & { [key: `data-${string}`]: string }) {
  const reduce = useReducedMotion() ?? false;
  // Calm mode lifts nothing: its own size, and no spring (LIFT_SCALE and LIFT_SPRING are upstream's).
  const calm = useCalm();
  return createPortal(
    <motion.div className={className} style={{ x, y, width, rotate: lean }} initial={reduce ? false : { scale: 1 }} animate={{ scale: calm || down ? 1 : LIFT_SCALE }} transition={calm ? { duration: 0 } : LIFT_SPRING} aria-hidden="true" {...data}>
      {children}
    </motion.div>,
    document.body,
  );
}
