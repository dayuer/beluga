import { useState } from 'react';
import { Checkbox, Field, FormSheet, Popup, TextArea } from '../../components/FormSheet.js';
import { defaultAgentOf } from '@beluga/protocol.js';
import { agentName } from '@beluga/shared/agent-label.js';
import { useApi, useApp } from '../../lib/beluga.js';
import type { NativeMenuProps } from './index.js';
import { cmdReturn } from '../../lib/os-words.js';
import { useT } from '../../i18n/index.js';

/**
 * Start a worktree on a friend's computer: which of their projects, the task, and whether their
 * Claude plans first. They approve it, then their Claude does the work there.
 */
export function RemoteWorktreeForm({ peerId, project, close }: { peerId: string; project?: string; close: () => void }) {
  const t = useT();
  const api = useApi();
  const peer = useApp((st) => st.peers.find((p) => p.peerId === peerId));
  const planDefault = useApp((st) => st.planMode.room === true);
  const projects = peer?.projects ?? [];
  const [picked, setPicked] = useState(project ?? projects[0] ?? '');
  const [task, setTask] = useState('');
  const [plan, setPlan] = useState(planDefault);
  if (!peer) return null;
  return (
    <FormSheet
      title={t('dialogs.remoteWs.title', { name: peer.name })}
      icon="branch"
      intro={t('dialogs.remoteWs.intro', { name: peer.name, agent: agentName(defaultAgentOf(peer)) })}
      submitLabel={t('dialogs.remoteWs.ask', { name: peer.name })}
      canSubmit={Boolean(picked && task.trim())}
      onSubmit={() => {
        void api.remote.requestWorktree(peer.peerId, picked, task.trim(), plan);
        close();
      }}
      onCancel={close}
      width={540}
    >
      <Field label={t('dialogs.remoteWs.project')} htmlFor="rws-project">
        <Popup id="rws-project" label={t('dialogs.remoteWs.project')} value={picked} onChange={setPicked} options={projects.map((p) => ({ value: p, label: p }))} />
      </Field>
      <Field label={t('dialogs.remoteWs.task')} htmlFor="rws-task" hint={t('dialogs.remoteWs.taskHint', { agent: agentName(defaultAgentOf(peer)), keys: cmdReturn() })}>
        <TextArea id="rws-task" value={task} onChange={setTask} rows={4} placeholder={t('dialogs.remoteWs.taskPlaceholder')} data-autofocus />
      </Field>
      <Field label="">
        <Checkbox checked={plan} onChange={setPlan} label={t('dialogs.remoteWs.planFirst')} detail={t('dialogs.remoteWs.planFirstDetail', { name: peer.name, agent: agentName(defaultAgentOf(peer)) })} />
      </Field>
    </FormSheet>
  );
}

export function RemoteWorktreeSheet({ menu, close }: NativeMenuProps<'remote_ws'>) {
  return <RemoteWorktreeForm peerId={menu.peerId} close={close} />;
}
