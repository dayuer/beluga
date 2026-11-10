import type { Session } from '../core/session.js';
import { studioOf } from '../studio/service.js';
import type { Args, Method } from './api.js';

/** What each `studio.*` method does (see studio-api.ts). Results never carry the key. */

type StudioMethod = Extract<Method, `studio.${string}`>;
type StudioHandlers = { readonly [M in StudioMethod]: (s: Session, ...args: Args<M>) => unknown };

export const STUDIO_HANDLERS = {
  'studio.link': (s, code, hub, name) => studioOf(s).link(code, hub, name),
  'studio.unlink': (s) => studioOf(s).unlink(),
  'studio.status': (s) => studioOf(s).status(),
  'studio.setProject': (s, projectId, shared) => studioOf(s).setProject(projectId, shared),
  'studio.reconnect': (s) => studioOf(s).reconnect(),
} satisfies StudioHandlers;
