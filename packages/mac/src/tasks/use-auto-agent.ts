import { useCallback } from 'react';
import type { Issue } from '@beluga/core/board/model.js';
import type { AgentRef } from '@beluga/protocol.js';
import { routedAgent } from '@beluga/shared/auto-route.js';
import { useApp } from '../lib/beluga.js';

/**
 * Who auto route (fork, shared/auto-route.ts) gives a task: the same answer the daemon reaches
 * when it starts (BoardWork.autoAgent). Undefined: its own, its plan's, its project's or your default.
 */
export function useAutoAgent(): (issue: Issue) => AgentRef | undefined {
  const prefs = useApp((s) => s.prefs);
  const runtimes = useApp((s) => s.runtimes);
  const projects = useApp((s) => s.projects);
  const plans = useApp((s) => s.plans);
  return useCallback((issue) => routedAgent(issue, { prefs, runtimes, projects, plans }), [prefs, runtimes, projects, plans]);
}
