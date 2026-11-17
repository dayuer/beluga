import type { TaskView } from '@beluga/core/plans/progress.js';
import { taskAgentSeen, taskAgentWords } from '@beluga/fork/plans/task-agent.js';
import { runtimeMark } from '@beluga/shared/agent-marks.js';
import type { AgentRef } from '@beluga/protocol.js';
import { Icon } from '../../components/Icon.js';
import { useApp } from '../../lib/beluga.js';
import f from './task-agent.module.css';

/**
 * Fork: a plan's task card names the model on it (the canvas and the outline, one line each there):
 * its worktree's once it's at work, else who will work it (`plan`: the outline; the canvas passes
 * none and shows it once at work). Data: src/fork/plans/task-agent.ts.
 */
export function TaskAgentChip({ plan, t }: { plan?: { readonly agent?: AgentRef; readonly projectId: string }; t: TaskView }) {
  const projects = useApp((s) => s.projects);
  const projectAgents = useApp((s) => s.prefs.projectAgents);
  const seen = taskAgentSeen(plan, t, { projects, prefs: { ...(projectAgents ? { projectAgents } : {}) } });
  if (!seen.agent) return null;
  const words = taskAgentWords(seen.agent);
  return (
    <span className={f.taskAgent} data-ran={seen.ran ? 'yes' : 'no'} title={seen.ran ? `At work on it: ${words}` : `Will work on it: ${words}`}>
      <Icon name={runtimeMark(seen.agent.runtime)} size={10} />
      <span>{words}</span>
    </span>
  );
}
