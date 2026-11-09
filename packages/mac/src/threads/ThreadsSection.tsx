import { t, tl, useT } from '../i18n/index.js';
import { findWorkspace } from '@beluga/ui/workspace-models.js';
import { useMemo } from 'react';
import { since } from '../claude-code/cc-model.js';
import { subAgentsUnder } from '../claude-code/subagents-model.js';
import { useNow } from '../chat/Items.js';
import { Icon } from '../components/Icon.js';
import { ActionsDropdown, type ActionItem } from '../components/SpecMenu.js';
import { Button, Dot, Tip, cx } from '../components/ui.js';
import { Panel } from '../layout/inspector-parts.js';
import { openSubAgent, useAgentOrigins, useCcSessions } from '../layout/SubAgents.js';
import { useActions } from '../lib/actions.js';
import { toast, useApi, useApp, useBeluga, useUi } from '../lib/beluga.js';
import { sameDeep } from '../lib/stable.js';
import { DOT, FamilyEnd, FamilyMark, FamilyTitle } from './FamilyRow.js';
import { type ThreadFamilyParent, type ThreadFamilyRow, THREAD_WORDS, isThreadWorking, threadFamilyView, panelRows } from './threads-model.js';
import s from './threads.module.css';

/** How many finished rows stay in view before the rest fold into Earlier. */
const FINISHED_SHOWN = 3;

/**
 * The open chat's family in the right panel: the chat that started it, the threads and sub-agents
 * it started, how each is doing, and Stop. Only with threads on, and only when it has any of them.
 */
export function ThreadsSection({ id }: { id: string }) {
  const api = useApi();
  const actions = useActions();
  const { client } = useBeluga();
  const sessions = useCcSessions();
  const origins = useAgentOrigins();
  const agents = useMemo(() => subAgentsUnder(sessions, id, origins), [sessions, id, origins]);
  const view = useApp(
    (st) => {
      const ws = findWorkspace(st.projects, id);
      return ws ? threadFamilyView(st, ws, agents) : undefined;
    },
    (a, b) => sameDeep(a, b, 4),
  );
  const key = `threads-finished:${id}`;
  const showAll = useUi((u) => u.collapsed.includes(key));
  const now = useNow(Boolean(view?.running));
  useT();
  if (!view) return null;
  const { shown, earlier } = panelRows(view.rows, FINISHED_SHOWN, showAll);
  const toggle = (): void => actions.run({ type: 'toggle_fold', key });
  const stop = (thread: string): void => void api.threads.stop(thread).catch((err: unknown) => toast(client, err instanceof Error ? err.message : t('threads.cantStop'), 'error'));
  const open = (row: ThreadFamilyRow): void => {
    const sub = row.kind === 'agent' ? agents.find((a) => a.agent.id === row.id) : undefined;
    if (sub) openSubAgent(client, actions, sub);
    else actions.run({ type: 'open_ws', id: row.id });
  };
  const items: ActionItem[] = [
    { label: t('threads.stopAll'), icon: 'stop', disabled: !view.stoppable.length, onSelect: () => void api.threads.stopAll(id).catch((err: unknown) => toast(client, err instanceof Error ? err.message : t('threads.cantStopAll'), 'error')) },
    { label: t('threads.showFinished'), checked: showAll, separate: true, onSelect: toggle },
  ];
  return (
    <Panel
      title={view.running ? t('threads.titleRunning', { n: view.running }) : t('threads.title')}
      action={
        view.rows.length ? (
          <ActionsDropdown items={items}>
            <Button size="small" variant="quiet" icon="more" aria-label={t('threads.actions')} />
          </ActionsDropdown>
        ) : null
      }
    >
      <div className={s.list} role="list" aria-label={t('threads.title')}>
        {view.parent ? <ParentRow parent={view.parent} onOpen={(to) => actions.run({ type: 'open_ws', id: to })} /> : null}
        {shown.map((row) => (
          <ChildRow key={`${row.kind}:${row.id}`} row={row} now={now} onOpen={() => open(row)} onStop={() => stop(row.id)} />
        ))}
        {earlier ? (
          <div role="listitem">
            <button type="button" className={s.earlier} onClick={toggle}>
              {t('threads.earlier', { n: earlier })}
            </button>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function ChildRow({ row, now, onOpen, onStop }: { row: ThreadFamilyRow; now: number; onOpen: () => void; onStop: () => void }) {
  const working = isThreadWorking(row.state);
  const stoppable = working && row.kind === 'thread';
  useT();
  const word = tl('THREAD_WORDS', row.state, 'text', THREAD_WORDS[row.state]);
  const duration = since((row.endedAt ?? now) - row.since);
  return (
    <div role="listitem" className={cx(s.row, stoppable && s.stoppable)} data-thread-row={row.kind} data-state={row.state}>
      <Tip
        side="left"
        label={
          <span className={s.card}>
            <strong>{row.title}</strong>
            <span>{[row.kind === 'agent' ? t('claudeCode.monitor.subAgent') : '', row.agent, row.model].filter(Boolean).join(' · ')}</span>
            <span>
              {word} · {duration}
            </span>
          </span>
        }
      >
        <button type="button" className={s.open} aria-label={t(row.kind === 'agent' ? 'threads.openSubAgent' : 'threads.open', { title: row.title, state: word })} onClick={onOpen}>
          <FamilyMark row={row} />
          <FamilyTitle row={row} />
        </button>
      </Tip>
      <span className={s.end}>
        <FamilyEnd row={row} now={now} />
        {stoppable ? (
          <button type="button" className={s.stop} aria-label={t('threads.stopNamed', { title: row.title })} onClick={onStop}>
            {t('threads.stop')}
          </button>
        ) : null}
      </span>
    </div>
  );
}

/** The chat that started this one. A removed parent keeps its title and opens nothing. */
function ParentRow({ parent, onOpen }: { parent: ThreadFamilyParent; onOpen: (id: string) => void }) {
  // An open chat with no run says Idle; a Your Mac chat's state isn't known here.
  useT();
  const word = parent.gone ? t('threads.removed') : parent.state ? tl('THREAD_WORDS', parent.state, 'text', THREAD_WORDS[parent.state]) : parent.openId ? t('claudeCode.model.idle') : '';
  const inner = (
    <>
      <span className={s.mark}>
        <Icon name="up" size={13} />
        {word && !parent.gone ? (
          <span className={s.dot}>
            <Dot tone={parent.state ? DOT[parent.state] : 'muted'} />
          </span>
        ) : null}
      </span>
      <span className={s.title}>{parent.title}</span>
    </>
  );
  return (
    <div role="listitem" className={s.row} data-thread-row="parent">
      {parent.openId ? (
        <button type="button" className={s.open} aria-label={t('threads.openParent', { title: parent.title })} onClick={() => onOpen(parent.openId!)}>
          {inner}
        </button>
      ) : (
        <span className={cx(s.open, s.still)}>{inner}</span>
      )}
      <span className={s.end}>
        <span className={s.time}>{word}</span>
      </span>
    </div>
  );
}
