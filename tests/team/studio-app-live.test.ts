import { describe, expect, it } from 'vitest';
import type { AppFrame } from '../../src/studio/protocol.js';
import type { WatchHandlers } from '../../packages/studio-app/lib/hub.js';
import { createLive } from '../../packages/studio-app/lib/live.js';

/** BLG-91: one socket per project, shared by every screen that needs it. */

const fakeWatch = () => {
  let handlers: WatchHandlers | undefined;
  let calls = 0;
  let closed = 0;
  return {
    watch: (_pid: string, next: WatchHandlers) => {
      calls += 1;
      handlers = next;
      return () => {
        closed += 1;
      };
    },
    state: (state: 'open' | 'closed') => handlers?.state(state),
    frame: (frame: AppFrame) => handlers?.frame(frame),
    get calls() {
      return calls;
    },
    get closed() {
      return closed;
    },
  };
};

const gone: AppFrame = { t: 'plan-gone', planRef: 'p1' };

describe('the shared live socket', () => {
  it('opens one socket for two subscribers and broadcasts frames to both', () => {
    const fake = fakeWatch();
    const live = createLive(fake);
    const a: AppFrame[] = [];
    const b: AppFrame[] = [];
    const offA = live.subscribe('p1', { frame: (f) => a.push(f), state: () => {} });
    const offB = live.subscribe('p1', { frame: (f) => b.push(f), state: () => {} });

    expect(fake.calls).toBe(1);
    fake.frame(gone);
    expect(a).toEqual([gone]);
    expect(b).toEqual([gone]);

    offA();
    expect(fake.closed).toBe(0);
    fake.frame(gone);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);

    offB();
    expect(fake.closed).toBe(1);
  });

  it('tells a late subscriber what the socket is doing', async () => {
    const fake = fakeWatch();
    const live = createLive(fake);
    const first: string[] = [];
    const offFirst = live.subscribe('p1', { frame: () => {}, state: (s) => first.push(s) });
    fake.state('open');
    expect(first).toEqual(['open']);

    const late: string[] = [];
    const offLate = live.subscribe('p1', { frame: () => {}, state: (s) => late.push(s) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(late).toEqual(['open']);

    offFirst();
    offLate();
    expect(fake.closed).toBe(1);
  });

  it('dials again after every subscriber leaves', () => {
    const fake = fakeWatch();
    const live = createLive(fake);
    const off = live.subscribe('p1', { frame: () => {}, state: () => {} });
    off();
    expect(fake.calls).toBe(1);
    const offAgain = live.subscribe('p1', { frame: () => {}, state: () => {} });
    expect(fake.calls).toBe(2);
    offAgain();
  });

  it('keeps projects apart', () => {
    const fake = fakeWatch();
    const live = createLive(fake);
    const off1 = live.subscribe('p1', { frame: () => {}, state: () => {} });
    const off2 = live.subscribe('p2', { frame: () => {}, state: () => {} });
    expect(fake.calls).toBe(2);
    off1();
    off2();
    expect(fake.closed).toBe(2);
  });
});
