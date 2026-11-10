import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useClock } from '../lib/window-active.js';
import { Button } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { copyText } from '../lib/copy.js';
import { Group, Row, Select, Switch } from './settings-controls.js';
import s from './settings.module.css';
import { t, useT } from '../i18n/index.js';

/** In a grant's projects: all your chats with no project. */
const STANDALONE_CHATS = 'chats';

type Level = 'ask' | 'trusted' | 'full';
type ActivityShown = 'all' | 'allowed' | 'asked' | 'refused';

interface Activity {
  readonly ts: number;
  readonly agent: string;
  readonly tool: string;
  readonly target: string;
  readonly decidedBy: 'rule' | 'person';
  readonly argsHash: string;
  readonly kind: Exclude<ActivityShown, 'all'>;
}

const activityShown = (): ReadonlyArray<{ value: ActivityShown; label: string }> => [
  { value: 'all', label: t('more.ext.show.all') },
  { value: 'allowed', label: t('more.ext.show.allowed') },
  { value: 'asked', label: t('more.ext.show.asked') },
  { value: 'refused', label: t('more.ext.show.refused') },
];
const kindWords = (kind: Activity['kind']): string => t(`more.ext.show.${kind}`);

type RouteKind = 'tailscale' | 'public';

interface Route {
  readonly kind: RouteKind;
  readonly state: 'opening' | 'on' | 'reopening';
  readonly url?: string;
  readonly error?: string;
}

interface Status {
  readonly on: boolean;
  readonly paused?: boolean;
  readonly url?: string;
  readonly routes?: readonly Route[];
  readonly error?: string;
}

interface Agent {
  readonly id: string;
  readonly name: string;
  readonly level: string;
  readonly route: 'local' | 'remote';
  readonly lastSeen: number;
  readonly expiresAt: number;
  readonly suspendedAt?: number;
}

const levels = (): ReadonlyArray<{ value: Level; label: string }> => [
  { value: 'ask', label: t('more.ext.level.ask') },
  { value: 'trusted', label: t('more.ext.level.trusted') },
  { value: 'full', label: t('more.ext.level.full') },
];
const levelWords = (level: string): string => (['blocked', 'ask', 'trusted', 'full'].includes(level) ? t(`more.ext.level.${level as 'blocked' | Level}`) : level);
const REFRESH_MS = 5000;
const routeRows = (): ReadonlyArray<{ kind: RouteKind; label: string; off: string; on: string }> => [
  { kind: 'tailscale', label: t('more.ext.route.tailscale'), off: t('more.ext.route.tailscaleOff'), on: t('more.ext.route.tailscaleOn') },
  { kind: 'public', label: t('more.ext.route.public'), off: t('more.ext.route.publicOff'), on: t('more.ext.route.publicOn') },
];

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const seenWords = (at: number): string => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Settings › External agents: other agents (a Claude Code in your terminal, GrokBot, a local model)
 * reaching Beluga through its MCP server. Turn it on, hand over its URL, make a pairing code (what it
 * gives is chosen here, and the sign-in page only spends it), see who connected, and revoke them.
 */
export function ExternalAgentsSettings() {
  const t = useT();
  const api = useApi();
  const projects = useApp((st) => st.projects.filter((p) => p.root && !p.error).map((p) => p.id + '\n' + p.name).join('\0'));
  const [status, setStatus] = useState<Status | undefined>();
  const [agents, setAgents] = useState<readonly Agent[]>([]);
  const [level, setLevel] = useState<Level>('full');
  const [allProjects, setAllProjects] = useState(true);
  const [remote, setRemote] = useState(false);
  // For one code only: it goes back to off when a code is made or the choice above changes.
  const [confirmFull, setConfirmFull] = useState(false);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [dms, setDms] = useState(true);
  const [groups, setGroups] = useState(true);
  const [code, setCode] = useState<{ code: string; expiresAt: number } | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [shown, setShownState] = useState<ActivityShown>('all');
  const [activity, setActivity] = useState<readonly Activity[]>([]);
  const filter = useRef<ActivityShown>('all');
  const setShown = (next: ActivityShown): void => {
    filter.current = next;
    setShownState(next);
    look();
  };

  const look = (): void => {
    void api.external.status().then((v) => setStatus(v as Status), (e: unknown) => setError(errorText(e)));
    void api.external.agents().then((v) => setAgents(v as readonly Agent[]), () => undefined);
    void api.external.activity(filter.current === 'all' ? {} : { kind: filter.current }).then((v) => setActivity(v as readonly Activity[]), () => undefined);
  };
  // An agent signs in from its own terminal while this pane is open.
  const tick = useClock(true, REFRESH_MS);
  useEffect(look, [tick]);

  const run = (work: Promise<unknown>): void => {
    setError(undefined);
    void work.then(look, (e: unknown) => setError(errorText(e)));
  };
  const makeCode = (): void => {
    if (remote && level === 'full' && !confirmFull) return setError(t('more.ext.confirmFirst'));
    setError(undefined);
    setConfirmFull(false);
    void api.external.pairingCode({ level, projects: allProjects ? 'all' : [...chosen], chats: { dms, groups }, ...(remote ? { remote: true } : {}), ...(remote && level === 'full' ? { allowRemoteFull: true } : {}) }).then((v) => setCode(v as { code: string; expiresAt: number }), (e: unknown) => setError(errorText(e)));
  };
  const toggle = (id: string): void => {
    const next = new Set(chosen);
    if (!next.delete(id)) next.add(id);
    setChosen(next);
  };
  const [turning, setTurning] = useState<RouteKind | undefined>();
  const setRoute = (kind: RouteKind, on: boolean): void => {
    setError(undefined);
    setTurning(kind);
    void api.external.setRoute(kind, on).then(look, (e: unknown) => setError(errorText(e))).finally(() => setTurning(undefined));
  };
  const routeDetail = (row: ReturnType<typeof routeRows>[number], route: Route | undefined): ReactNode => {
    if (turning === row.kind && !route?.url) return t('more.ext.route.opening');
    if (route?.state === 'reopening') return route.error ? t('more.ext.route.reopeningError', { error: route.error }) : t('more.ext.route.reopening');
    return route?.url ? <>{route.url}<br />{row.on}</> : row.off;
  };
  const projectRows = projects ? projects.split('\0').map((line) => line.split('\n') as [string, string]) : [];

  return (
    <>
      <Group>
        <Row label={t('more.ext.connect')} detail={status?.error ?? (status?.on ? status.routes?.length ? t('more.ext.connectRoutes') : t('more.ext.connectLocal') : t('more.ext.connectOff'))}>
          <Switch label={t('more.ext.connect')} on={status?.on ?? false} onChange={(on) => run(api.external.setEnabled(on))} />
        </Row>
        {status?.on ? (
          <Row label={t('more.ext.pause')} detail={status.paused ? t('more.ext.paused') : t('more.ext.pauseDetail')}>
            <Switch label={t('more.ext.pause')} on={status.paused ?? false} onChange={(on) => run(api.external.setPaused(on))} />
          </Row>
        ) : null}
        {status?.url ? (
          <Row label={t('more.ext.mcpUrl')} detail={status.url}>
            <Button onClick={() => void copyText(status.url!)}>{t('more.ext.copyMcpUrl')}</Button>
          </Row>
        ) : null}
        {routeRows().map((row) => {
          const route = status?.routes?.find((r) => r.kind === row.kind);
          return (
            <Row key={row.kind} label={row.label} detail={routeDetail(row, route)}>
              {route?.url ? <Button onClick={() => void copyText(route.url!)}>{t('more.ext.copyMcpUrl')}</Button> : null}
              <Switch label={row.label} on={route !== undefined} onChange={(on) => { if (!turning) setRoute(row.kind, on); }} />
            </Row>
          );
        })}
      </Group>
      {status?.on ? (
        <Group title={t('more.ext.connectGroup')}>
          <Row label={t('more.ext.outside')} detail={t('more.ext.outsideDetail')}>
            <Switch
              label={t('more.ext.outside')}
              on={remote}
              onChange={(on) => {
                setRemote(on);
                setConfirmFull(false);
                if (on && level === 'full') setLevel('trusted');
              }}
            />
          </Row>
          <Row label={t('more.ext.mayDo')} detail={t('more.ext.mayDoDetail')}>
            <Select<Level> label={t('more.ext.mayDo')} value={level} options={levels()} onChange={(next) => { setLevel(next); setConfirmFull(false); }} />
          </Row>
          {remote && level === 'full' ? (
            <Row label={t('more.ext.fullForCode')} detail={<span className={s.fullWarning} role="alert">{t('more.ext.remoteFullWarning')}</span>}>
              <Switch label={t('more.ext.understand')} on={confirmFull} onChange={setConfirmFull} />
            </Row>
          ) : null}
          <Row label={t('more.ext.allProjects')} detail={t('more.ext.allProjectsDetail')}>
            <Switch label={t('more.ext.reachAll')} on={allProjects} onChange={setAllProjects} />
          </Row>
          {allProjects ? null : projectRows.map(([id, name]) => (
            <Row key={id} label={name} detail={t('more.ext.projectReached')}>
              <Switch label={t('more.ext.reachName', { name })} on={chosen.has(id)} onChange={() => toggle(id)} />
            </Row>
          ))}
          {allProjects ? null : (
            <Row label={t('more.ext.standalone')} detail={t('more.ext.standaloneDetail')}>
              <Switch label={t('more.ext.reachStandalone')} on={chosen.has(STANDALONE_CHATS)} onChange={() => toggle(STANDALONE_CHATS)} />
            </Row>
          )}
          <Row label={t('more.ext.dms')} detail={t('more.ext.dmsDetail')}>
            <Switch label={t('more.ext.reachDms')} on={dms} onChange={setDms} />
          </Row>
          <Row label={t('more.ext.groups')} detail={t('more.ext.groupsDetail')}>
            <Switch label={t('more.ext.reachGroups')} on={groups} onChange={setGroups} />
          </Row>
          <Row label={t('more.ext.code')} detail={code ? t('more.ext.codeMade') : t('more.ext.codeHint')}>
            {code ? <code data-pairing-code>{code.code}</code> : null}
            {code ? <Button onClick={() => void copyText(code.code)}>{t('more.ext.copy')}</Button> : null}
            <Button onClick={makeCode}>{code ? t('more.ext.makeAnother') : t('more.ext.makeCode')}</Button>
          </Row>
        </Group>
      ) : null}
      {error ? <p className={s.endpointError} role="alert">{error}</p> : null}
      {agents.length ? (
        <Group title={t('more.ext.connected')}>
          <Row label={t('more.ext.stopAll')} detail={t('more.ext.stopAllDetail')}>
            <Button onClick={() => run(api.external.stopAll())}>{t('more.ext.stopAllButton')}</Button>
          </Row>
          {agents.map((a) => (
            <Row key={a.id} label={a.name} detail={`${a.suspendedAt === undefined ? '' : t('more.ext.suspended')}${a.route === 'remote' && a.level === 'full' ? t('more.ext.fullOutside') : `${levelWords(a.level)} · ${a.route === 'local' ? t('more.ext.onMac') : t('more.ext.outsideMac')}`} · ${t('more.ext.lastSeen', { when: seenWords(a.lastSeen) })}`}>
              {a.suspendedAt === undefined ? null : <Button onClick={() => run(api.external.resume(a.id))}>{t('more.ext.resume')}</Button>}
              <Button onClick={() => run(api.external.stopAgent(a.id))}>{t('more.ext.stop')}</Button>
              <Button tone="error" onClick={() => run(api.external.revoke(a.id))}>{t('more.ext.revoke')}</Button>
            </Row>
          ))}
        </Group>
      ) : null}
      {agents.length ? (
        <Group title={t('more.ext.activity')}>
          <Row label={t('more.ext.showLabel')} detail={t('more.ext.showDetail')}>
            <Select<ActivityShown> label={t('more.ext.showLabel')} value={shown} options={activityShown()} onChange={setShown} />
          </Row>
          {activity.length ? activity.map((a) => (
            <Row key={`${a.ts} ${a.tool} ${a.argsHash}`} label={`${a.agent}: ${a.tool}`} detail={`${kindWords(a.kind)} · ${a.decidedBy === 'person' ? t('more.ext.decidedByYou') : t('more.ext.decidedByLevel')}${a.target ? ` · ${a.target}` : ''} · ${seenWords(a.ts)}`}>
              {null}
            </Row>
          )) : (
            <Row label={t('more.ext.nothing')} detail={t('more.ext.nothingDetail')}>
              {null}
            </Row>
          )}
        </Group>
      ) : null}
    </>
  );
}
