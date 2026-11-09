import { useMemo, useState } from 'react';
import { type TaskView, isFinal, oneLine, stateLabel, stateTone, targetLabel } from '@beluga/core/gateway/model.js';
import { Select } from '../components/Select.js';
import { Avatar, Button, Dot, Empty, Segmented, cx } from '../components/ui.js';
import { useApi, useApp, useBeluga } from '../lib/beluga.js';
import { TaskCard } from './TaskCard.js';
import s from './gateway.module.css';
import { currentLocale, t, useT } from '../i18n/index.js';

/**
 * Requests: tasks between Claudes in one place. Sent (what you and your Claude asked of others)
 * and Received (what others' Claudes asked of yours), newest first; a row opens into its card.
 * Your own "Ask me for…" note (what friends' Claudes see) and asking someone's Claude yourself.
 */

type Tab = 'sent' | 'received';

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return t('gateway.view.justNow');
  if (s < 3600) return t('gateway.view.minAgo', { n: Math.floor(s / 60) });
  if (s < 86_400) return t('gateway.view.hAgo', { n: Math.floor(s / 3600) });
  return new Date(ts).toLocaleDateString(currentLocale(), { month: 'short', day: 'numeric' });
}

const needsYou = (t: TaskView): boolean => (t.direction === 'sent' && t.state === 'confirm') || (t.direction === 'received' && t.state === 'awaiting_approval');

/** Still open: waiting for you or on its way. Answered ones (done, declined, failed) are tucked away. */
const pending = (t: TaskView): boolean => !isFinal(t.state);

/** How many tasks wait for you (the sidebar's badge). */
export const waitingForYou = (tasks: readonly TaskView[]): number => tasks.filter(needsYou).length;

function Row({ task, open, onToggle }: { task: TaskView; open: boolean; onToggle: () => void }) {
  useT();
  const tone = stateTone(task);
  const who = task.direction === 'sent' ? targetLabel(task) : task.by === 'agent' ? t('gateway.view.theirAgent', { name: task.peerName }) : task.peerName;
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={t(task.direction === 'sent' ? 'gateway.view.rowTo' : 'gateway.view.rowFrom', { who, ask: oneLine(task.ask, 80), state: stateLabel(task) })}
        className={cx(s.row, open && s.rowOn)}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <Avatar name={task.peerName} id={task.peerId} claude={task.kind === 'ask'} agent={task.kind === 'ask' ? task.result?.agent : undefined} size={20} />
        <span className={s.rowWho}>{who}</span>
        <span className={s.rowAsk}>{task.kind === 'run' && task.command ? `$ ${task.command}` : oneLine(task.ask, 140)}</span>
        <span className={`${s.status} ${s[`tone_${tone}`]}`}>
          <Dot tone={tone === 'claude' ? 'claude' : tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : tone === 'error' ? 'error' : 'muted'} live={!isFinal(task.state) && task.state !== 'confirm'} />
          {stateLabel(task)}
        </span>
        <span className={s.rowWhen}>{ago(task.createdAt, Date.now())}</span>
      </div>
      {open ? (
        <div className={s.detail}>
          <TaskCard task={task} />
        </div>
      ) : null}
    </>
  );
}

/** Your "Ask me for…" note: what friends' Claudes see when they look for who can help. */
function Note() {
  useT();
  const api = useApi();
  const { client } = useBeluga();
  const saved = useApp((st) => st.gateway.note);
  const [text, setText] = useState<string | undefined>();
  const value = text ?? saved;
  const save = (): void => {
    if (text === undefined || text === saved) return;
    void api.gateway
      .setNote(text)
      .then(() => {
        setText(undefined);
        client.store.dispatch({ type: 'toast', text: t('gateway.view.saved'), level: 'success' });
      })
      .catch((err: unknown) => client.store.dispatch({ type: 'toast', text: t('gateway.view.couldntSave', { error: message(err) }), level: 'error' }));
  };
  return (
    <label className={s.note}>
      <span>{t('gateway.view.askMeFor')}</span>
      <input
        aria-label={t('gateway.view.askMeFor')}
        placeholder={t('gateway.view.notePlaceholder')}
        value={value}
        maxLength={280}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
    </label>
  );
}

/** Ask someone's Claude yourself (it goes straight to them: you're the one asking). */
function Compose({ onDone }: { onDone: () => void }) {
  useT();
  const api = useApi();
  const { client } = useBeluga();
  const people = useApp((st) => {
    const self = st.selfId;
    const friends = st.network.enabled ? st.network.friends.map((f) => ({ id: f.peerId, name: f.name })) : [];
    const room = st.peers.filter((p) => p.peerId !== self && !p.guest && !friends.some((f) => f.id === p.peerId)).map((p) => ({ id: p.peerId, name: p.name }));
    return JSON.stringify([...friends, ...room]);
  });
  const list = useMemo(() => JSON.parse(people) as Array<{ id: string; name: string }>, [people]);
  const [to, setTo] = useState(list[0]?.id ?? '');
  const [ask, setAsk] = useState('');
  const send = (): void => {
    if (!to || !ask.trim()) return;
    void api.gateway
      .ask(to, ask.trim())
      .then(onDone)
      .catch((err: unknown) => client.store.dispatch({ type: 'toast', text: t('gateway.view.couldntAsk', { error: message(err) }), level: 'error' }));
  };
  if (!list.length) return <div className={s.compose}>{t('gateway.view.nobody')}</div>;
  return (
    <div className={s.compose} role="group" aria-label={t('gateway.view.askSomeone')}>
      <div className={s.composeRow}>
        <span>{t('gateway.view.to')}</span>
        <Select label={t('gateway.view.whose')} value={to} onChange={setTo} options={list.map((p) => ({ value: p.id, label: t('gateway.view.theirAgent', { name: p.name }), icon: <Avatar name={p.name} id={p.id} size={16} /> }))} />
      </div>
      <textarea className={s.edit} aria-label={t('gateway.view.whatToAsk')} placeholder={t('gateway.view.askPlaceholder')} value={ask} onChange={(e) => setAsk(e.target.value)} autoFocus />
      <div className={s.actions}>
        <Button variant="primary" disabled={!ask.trim()} onClick={send}>
          {t('gateway.view.ask')}
        </Button>
        <Button variant="quiet" onClick={onDone}>
          {t('gateway.view.cancel')}
        </Button>
      </div>
    </div>
  );
}

export function RequestsView() {
  useT();
  const gateway = useApp((st) => st.gateway);
  const [tab, setTab] = useState<Tab>(() => (gateway.tasks.some((t) => t.direction === 'received' && t.state === 'awaiting_approval') ? 'received' : 'sent'));
  const [open, setOpen] = useState<string | undefined>();
  const [composing, setComposing] = useState(false);
  const [answered, setAnswered] = useState(false);
  if (!gateway.enabled) {
    return <Empty icon="hand" title={t('gateway.view.needApp')} detail={t('gateway.view.needAppDetail')} />;
  }
  const mine = gateway.tasks.filter((t) => t.direction === tab);
  const done = mine.filter((t) => !pending(t)).length;
  const list = (answered ? mine : mine.filter(pending)).slice().reverse();
  const count = (d: Tab): number => gateway.tasks.filter((t) => t.direction === d && pending(t)).length;
  return (
    <div className={s.page}>
      <div className={s.inner}>
        <div className={s.bar}>
          <Segmented<Tab>
            label={t('gateway.view.requests')}
            value={tab}
            onChange={(v) => {
              setTab(v);
              setOpen(undefined);
            }}
            options={[
              { value: 'sent', label: `${t('gateway.view.sent')}${count('sent') ? ` · ${count('sent')}` : ''}` },
              { value: 'received', label: `${t('gateway.view.received')}${count('received') ? ` · ${count('received')}` : ''}` },
            ]}
          />
          <span className={s.grow} />
          {composing ? null : (
            <Button icon="claude" onClick={() => setComposing(true)}>
              {t('gateway.view.askButton')}
            </Button>
          )}
        </div>
        <Note />
        {composing ? (
          <Compose
            onDone={() => {
              setComposing(false);
              setTab('sent');
            }}
          />
        ) : null}
        <div className={s.list} role="list" aria-label={tab === 'sent' ? t('gateway.view.sentList') : t('gateway.view.receivedList')}>
          {list.length ? (
            list.map((t) => (
              <div role="listitem" key={t.id}>
                <Row task={t} open={open === t.id || (open === undefined && needsYou(t) && list.find(needsYou)?.id === t.id)} onToggle={() => setOpen(open === t.id ? '' : t.id)} />
              </div>
            ))
          ) : (
            <div className={s.empty}>
              {done ? t('gateway.view.allAnswered') : tab === 'sent' ? t('gateway.view.noneSent') : t('gateway.view.noneReceived')}
            </div>
          )}
        </div>
        {done ? (
          <Button variant="quiet" onClick={() => setAnswered(!answered)}>
            {answered ? t('gateway.view.hideAnswered') : t('gateway.view.showAnswered', { n: done })}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
