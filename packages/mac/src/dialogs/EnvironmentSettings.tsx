import { useEffect, useRef, useState } from 'react';
import { type EnvVar, envProblems, importEnv, parseEnvText } from '@beluga/shared/env-vars.js';
import { Icon } from '../components/Icon.js';
import { Button, Tip, cx } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { useMyAgentName } from '../lib/agent-words.js';
import { Group, Row, Select, Switch } from './settings-controls.js';
import s from './settings.module.css';
import e from './env-settings.module.css';
import { thisComputer } from '../lib/os-words.js';
import { useT } from '../i18n/index.js';

interface EnvRow extends EnvVar {
  readonly id: number;
}

let nextId = 1;
const withIds = (vars: readonly EnvVar[]): EnvRow[] => vars.map((v) => ({ ...v, id: nextId++ }));
const filled = (rows: readonly EnvVar[]): EnvVar[] => rows.filter((r) => r.key || r.value).map(({ key, value }) => ({ key, value }));
const errorText = (err: unknown): string => (err instanceof Error ? err.message.replace(/^Bad arguments for env\.set: /, '') : String(err));

type Status = { kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; text: string };

/** Paste KEY=value lines (a .env, an export block) to add them all at once. */
function ImportBox({ onImport, onClose }: { onImport: (vars: EnvVar[]) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const parsed = parseEnvText(text);
  const t = useT();
  return (
    <div className={e.importBox}>
      <textarea className={e.importText} aria-label={t('settings.env.lines')} autoFocus spellCheck={false} placeholder={'API_URL=https://api.example.com\nexport TOKEN="…"'} value={text} onChange={(ev) => setText(ev.target.value)} />
      <div className={e.importBar}>
        <span className={e.muted}>{text.trim() ? `${t('settings.env.variables', { n: parsed.vars.length })}${parsed.skipped.length ? t('settings.env.skipped', { n: parsed.skipped.length }) : ''}` : t('settings.env.linesHint')}</span>
        <span className={e.flex} />
        <Button size="small" variant="quiet" onClick={onClose}>
          {t('settings.common.cancel')}
        </Button>
        <Button size="small" variant="primary" disabled={!parsed.vars.length} onClick={() => onImport(parsed.vars)}>
          {t('settings.env.addN', { n: parsed.vars.length || '' })}
        </Button>
      </div>
    </div>
  );
}

/**
 * The key/value editor for one place: yours, or a project's. Changes save as you leave a field.
 * A project's main folder .env shows under its own variables (BLG-369): typing over one of its
 * values sets it in Beluga, which wins; Use .env takes that back.
 */
export function EnvEditor({ projectId }: { projectId: string }) {
  const api = useApi();
  const t = useT();
  const project = useApp((st) => st.projects.find((p) => p.id === projectId));
  const keysHere = useApp((st) => (project ? st.envKeys.projects[project.root] : st.envKeys.global));
  const [rows, setRows] = useState<EnvRow[] | undefined>(undefined);
  const [dotenv, setDotenv] = useState(false);
  const [dotenvVars, setDotenvVars] = useState<readonly EnvVar[]>([]);
  const [dotenvFiles, setDotenvFiles] = useState<readonly string[]>([]);
  const [copying, setCopying] = useState(false);
  const [claudeDotenv, setClaudeDotenv] = useState(false);
  const [newKeysBack, setNewKeysBack] = useState(true);
  const [overridden, setOverridden] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [shown, setShown] = useState<ReadonlySet<number>>(new Set());
  const [shownFile, setShownFile] = useState<ReadonlySet<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [focusId, setFocusId] = useState<{ id: number; field: 'key' | 'value'; caret?: number } | undefined>(undefined);
  const saved = useRef('');
  const editing = useRef(false);

  // Load the values (only this screen gets them), and again if another screen changes them.
  useEffect(() => {
    if (editing.current) return;
    let live = true;
    void api.env.get(projectId || undefined).then((scope) => {
      if (!live) return;
      saved.current = JSON.stringify([filled(scope.vars), scope.dotenv]);
      setRows(withIds(scope.vars));
      setDotenv(scope.dotenv);
      setDotenvVars(scope.dotenvVars ?? []);
      setDotenvFiles(scope.dotenvFiles ?? []);
      setClaudeDotenv(scope.claudeDotenv);
      setNewKeysBack(scope.newKeysBack ?? true);
      setOverridden(scope.overridden ?? {});
    });
    return () => void (live = false);
  }, [projectId, keysHere]);

  const problems = envProblems(rows ?? []);
  const commit = (next: readonly EnvRow[], nextDotenv = dotenv): void => {
    editing.current = false;
    if (envProblems(next).size) return setStatus({ kind: 'error', text: t('settings.env.fixNames') });
    const snapshot = JSON.stringify([filled(next), nextDotenv]);
    if (snapshot === saved.current) return;
    api.env.set(projectId || undefined, filled(next), projectId ? nextDotenv : undefined).then(
      () => {
        saved.current = snapshot;
        setStatus({ kind: 'saved' });
      },
      (err: unknown) => setStatus({ kind: 'error', text: errorText(err) }),
    );
  };
  const change = (id: number, patch: Partial<EnvVar>): void => {
    editing.current = true;
    setStatus({ kind: 'idle' });
    setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const add = (): void => {
    const row = withIds([{ key: '', value: '' }])[0]!;
    setRows((rs) => [...(rs ?? []), row]);
    setFocusId({ id: row.id, field: 'key' });
  };
  // Typing over a .env value: it's set here from now on (and wins), the caret kept where you type.
  const override = (key: string, value: string, caret: number | null): void => {
    const row = withIds([{ key, value }])[0]!;
    editing.current = true;
    setStatus({ kind: 'idle' });
    if (shownFile.has(key)) setShown((set) => new Set([...set, row.id]));
    setRows((rs) => [...(rs ?? []), row]);
    setFocusId({ id: row.id, field: 'value', ...(caret !== null ? { caret } : {}) });
  };
  const copyIn = (): void => {
    setCopying(true);
    api.env.importDotenv(projectId).then(
      (n) => {
        setCopying(false);
        setStatus(n ? { kind: 'saved' } : { kind: 'error', text: t('settings.env.allIn') });
      },
      (err: unknown) => {
        setCopying(false);
        setStatus({ kind: 'error', text: errorText(err) });
      },
    );
  };
  const addAll = (vars: readonly EnvVar[]): void => {
    const next = importEnv(rows ?? [], vars);
    const known = new Map((rows ?? []).map((r) => [r.key, r.id]));
    const merged = next.map((v) => ({ ...v, id: known.get(v.key) ?? nextId++ }));
    setRows(merged);
    setImporting(false);
    commit(merged);
  };
  const remove = (id: number): void => {
    const next = (rows ?? []).filter((r) => r.id !== id);
    setRows(next);
    commit(next);
  };

  // Closing Settings (or switching place) mid-edit saves it too: a field left without a blur isn't lost.
  const saveOnClose = useRef<() => void>(() => undefined);
  saveOnClose.current = () => {
    if (editing.current && rows) commit(rows);
  };
  useEffect(() => () => saveOnClose.current(), []);

  if (!rows) return <div className={s.note}>{t('settings.env.loading')}</div>;
  const masked = (id: number): boolean => !showAll && !shown.has(id);
  const fromFile = new Map(projectId && dotenv ? dotenvVars.map((v) => [v.key, v.value]) : []);
  const own = new Set(rows.map((r) => r.key));
  // The .env's own rows: only those not set here (a set one shows above, marked as winning over it).
  const fileRows = [...fromFile].filter(([key]) => !own.has(key));
  const notCopied = dotenvVars.filter((v) => !own.has(v.key)).length;
  // One list, in the .env's order: a value changed here stays in its place (only its tag changes); ones set only here follow.
  type Listed = { kind: 'file'; key: string; value: string } | { kind: 'own'; row: EnvRow; index: number };
  const byKey = new Map(rows.map((row, index) => [row.key, { kind: 'own' as const, row, index }]));
  const listed: Listed[] = [
    ...[...fromFile].map(([key, value]): Listed => byKey.get(key) ?? { kind: 'file', key, value }),
    ...rows.map((row, index): Listed => ({ kind: 'own', row, index })).filter((x) => !(x.kind === 'own' && fromFile.has(x.row.key))),
  ];
  const filesLabel = dotenvFiles.length ? dotenvFiles.join(t('settings.layout.and')) : '.env';

  return (
    <>
      <Group>
        {projectId ? (
          <div className={e.sourceBar}>
            <Icon name="file" size={12} className={e.sourceIcon} />
            <span className={e.sourceText}>
              {t('settings.env.include', { files: filesLabel })}
              <span className={e.muted}>
                {dotenv ? (dotenvVars.length ? t('settings.env.includeCount', { n: dotenvVars.length }) : t('settings.env.includeNone')) : t('settings.env.includeOff')}
              </span>
            </span>
            <Switch
              label={t('settings.env.useMain')}
              on={dotenv}
              onChange={(v) => {
                setDotenv(v);
                commit(rows, v);
              }}
            />
          </div>
        ) : null}
        <div className={e.head}>
          <span>{t('settings.env.name')}</span>
          <span>{t('settings.env.value')}</span>
          <Tip label={showAll ? t('settings.env.hideValues') : t('settings.env.showValues')}>
            <button type="button" className={cx(e.eye, showAll && e.eyeOn)} aria-label={t('settings.env.showValuesAria')} aria-pressed={showAll} onClick={() => setShowAll(!showAll)}>
              <Icon name="eye" size={13} />
            </button>
          </Tip>
          <span />
        </div>
        {rows.length || fileRows.length ? null : <div className={e.empty}>{projectId ? t('settings.env.emptyProject') : t('settings.env.empty')}</div>}
        {listed.map((item) => {
          if (item.kind === 'file') {
            const { key, value } = item;
            const hidden = !showAll && !shownFile.has(key);
            return (
              <div key={`file:${key}`} className={e.row}>
                <input className={cx(e.key, e.fixedKey)} aria-label={t('settings.env.name')} value={key} readOnly tabIndex={-1} />
                <input
                  className={cx(e.value, hidden && value && e.masked)}
                  aria-label={t('settings.env.fileValueAria', { key, files: filesLabel })}
                  value={value}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(ev) => override(key, ev.target.value, ev.target.selectionStart)}
                />
                <button type="button" className={cx(e.eye, !hidden && e.eyeOn)} aria-label={hidden ? t('settings.env.show', { what: key }) : t('settings.env.hide', { what: key })} aria-pressed={!hidden} disabled={showAll} onClick={() => setShownFile((set) => (set.has(key) ? new Set([...set].filter((x) => x !== key)) : new Set([...set, key])))}>
                  <Icon name="eye" size={13} />
                </button>
                <Tip label={t('settings.env.fromFile', { files: filesLabel })}>
                  <span className={e.sourceTag}>.env</span>
                </Tip>
              </div>
            );
          }
          const { row: r, index: i } = item;
          const fileValue = fromFile.get(r.key);
          const overrides = fileValue !== undefined;
          return (
            <div key={r.id} className={cx(e.row, problems.has(i) && e.bad)}>
              <input
                className={cx(e.key, overrides && e.fixedKey)}
                aria-label={t('settings.env.name')}
                aria-invalid={problems.has(i)}
                value={r.key}
                placeholder="NAME"
                spellCheck={false}
                autoComplete="off"
                readOnly={overrides}
                tabIndex={overrides ? -1 : undefined}
                autoFocus={focusId?.id === r.id && focusId.field === 'key'}
                onChange={(ev) => change(r.id, { key: ev.target.value.trim() })}
                onBlur={() => commit(rows)}
                onPaste={(ev) => {
                  const text = ev.clipboardData.getData('text');
                  const pasted = /[=\n]/.test(text) ? parseEnvText(text).vars : [];
                  if (!pasted.length) return;
                  ev.preventDefault();
                  addAll(pasted);
                }}
              />
              <input
                className={cx(e.value, masked(r.id) && r.value && e.masked)}
                aria-label={t('settings.env.valueOf', { key: r.key || t('settings.env.newVariable') })}
                value={r.value}
                placeholder={t('settings.env.valuePlaceholder')}
                spellCheck={false}
                autoComplete="off"
                autoFocus={focusId?.id === r.id && focusId.field === 'value'}
                onFocus={(ev) => {
                  if (focusId?.id !== r.id || focusId.field !== 'value') return;
                  const at = focusId.caret ?? ev.currentTarget.value.length;
                  ev.currentTarget.setSelectionRange(at, at);
                  setFocusId(undefined);
                }}
                onChange={(ev) => change(r.id, { value: ev.target.value })}
                onBlur={() => commit(rows)}
              />
              <button type="button" className={cx(e.eye, !masked(r.id) && e.eyeOn)} aria-label={masked(r.id) ? t('settings.env.show', { what: r.key || t('settings.env.valueWord') }) : t('settings.env.hide', { what: r.key || t('settings.env.valueWord') })} aria-pressed={!masked(r.id)} disabled={showAll} onClick={() => setShown((set) => (set.has(r.id) ? new Set([...set].filter((x) => x !== r.id)) : new Set([...set, r.id])))}>
                <Icon name="eye" size={13} />
              </button>
              {overrides ? (
                <Tip label={t('settings.env.changedTip', { files: filesLabel })}>
                  <button type="button" className={cx(e.sourceTag, e.sourceEdited)} aria-label={t('settings.env.useFileFor', { files: filesLabel, key: r.key })} onClick={() => remove(r.id)}>
                    <Icon name="refresh" size={10} />
                  </button>
                </Tip>
              ) : (
                <button type="button" className={e.remove} aria-label={t('settings.env.removeRow', { what: r.key || t('settings.env.thisRow') })} onClick={() => remove(r.id)}>
                  <Icon name="x" size={10} />
                </button>
              )}
              {problems.has(i) ? <div className={e.problem}>{problems.get(i)}</div> : null}
              {!problems.has(i) && overrides ? (
                <div className={e.override}>
                  {fileValue === r.value ? t('settings.env.sameAsFile', { files: filesLabel }) : t('settings.env.changedHere', { files: filesLabel })}{' '}
                  <button type="button" className={e.inlineLink} onClick={() => remove(r.id)}>
                    {t('settings.env.useFile', { files: filesLabel })}
                  </button>
                </div>
              ) : null}
              {!problems.has(i) && overridden[r.key]?.length ? (
                <div className={e.override}>
                  {t('settings.env.notUsed', { where: overridden[r.key]!.join(', '), n: overridden[r.key]!.length, key: r.key })}
                </div>
              ) : null}
            </div>
          );
        })}
        {importing ? <ImportBox onImport={addAll} onClose={() => setImporting(false)} /> : null}
        <div className={e.foot}>
          <Button size="small" variant="quiet" icon="plus" onClick={add}>
            {t('settings.env.addVariable')}
          </Button>
          {importing ? null : (
            <Button size="small" variant="quiet" icon="clip" onClick={() => setImporting(true)}>
              {t('settings.env.paste')}
            </Button>
          )}
          {projectId && dotenv && notCopied ? (
            <Tip label={t('settings.env.keepCopyTip')}>
              <Button size="small" variant="quiet" icon="download" disabled={copying} onClick={copyIn}>
                {copying ? t('settings.env.copying') : t('settings.env.keepCopy')}
              </Button>
            </Tip>
          ) : null}
          <span className={e.flex} />
          <span className={cx(e.status, status.kind === 'error' && e.statusError)} role="status">
            {status.kind === 'saved' ? (
              <>
                <Icon name="check" size={11} /> {t('settings.env.saved')}
              </>
            ) : status.kind === 'error' ? (
              status.text
            ) : null}
          </span>
        </div>
      </Group>
      {projectId ? (
        <Group title={t('settings.env.worktrees')}>
          <Row label={t('settings.env.newKeys')} detail={t('settings.env.newKeysDetail')}>
            <Switch
              label={t('settings.env.newKeysAria')}
              on={newKeysBack}
              onChange={(v) => {
                setNewKeysBack(v);
                api.env.newKeysBack(projectId, v).then(
                  () => setStatus({ kind: 'saved' }),
                  (err: unknown) => {
                    setNewKeysBack(!v);
                    setStatus({ kind: 'error', text: errorText(err) });
                  },
                );
              }}
            />
          </Row>
        </Group>
      ) : null}
      <DatabaseTest projectId={projectId} />
      <Group title={t('settings.agent.yourAgent')}>
        <Row
          label={t('settings.env.readEnv')}
          detail={
            projectId
              ? t('settings.env.readEnvProject')
              : t('settings.env.readEnvAll')
          }
        >
          <Switch
            label={t('settings.env.readEnvAria')}
            on={claudeDotenv}
            onChange={(v) => {
              setClaudeDotenv(v);
              api.env.claudeDotenv(projectId || undefined, v).then(
                () => setStatus({ kind: 'saved' }),
                (err: unknown) => {
                  setClaudeDotenv(!v);
                  setStatus({ kind: 'error', text: errorText(err) });
                },
              );
            }}
          />
        </Row>
      </Group>
    </>
  );
}

/**
 * Whether the database your Claude's views would use here answers: the same lookup they make
 * (DATABASE_URL and the like, or Supabase's variables), so a pass here works for them too.
 */
function DatabaseTest({ projectId }: { projectId: string }) {
  const api = useApi();
  const [result, setResult] = useState<{ ok: true; from: string } | { ok: false; message: string } | 'testing' | undefined>(undefined);
  const t = useT();
  const test = (): void => {
    setResult('testing');
    api.env.testDatabase(projectId || undefined).then(setResult, (err: unknown) => setResult({ ok: false, message: errorText(err) }));
  };
  return (
    <Group title={t('settings.env.database')}>
      <Row
        label={t('settings.env.postgres')}
        detail={
          result === undefined || result === 'testing'
            ? t('settings.env.postgresDetail')
            : result.ok
              ? t('settings.env.connected', { from: result.from })
              : result.message
        }
      >
        <Button size="small" icon={result !== undefined && result !== 'testing' && result.ok ? 'check' : undefined} disabled={result === 'testing'} onClick={test}>
          {result === 'testing' ? t('settings.env.testing') : t('settings.env.test')}
        </Button>
      </Row>
    </Group>
  );
}

/**
 * Settings › Environment: variables Beluga gives your shells, setup and run commands, and your
 * agent. Yours apply everywhere; a project's apply in its workspaces, over yours.
 */
export function EnvironmentSettings() {
  const projects = useApp((st) => st.projects).filter((p) => p.root);
  const envKeys = useApp((st) => st.envKeys);
  const [scope, setScope] = useState('');
  const count = (n: number): string => (n ? ` · ${n}` : '');
  const agent = useMyAgentName();
  const t = useT();
  return (
    <>
      <p className={e.intro}>{t('settings.env.intro', { agent, computer: thisComputer() })}</p>
      <Group>
        <Row label={t('settings.env.variablesFor')} detail={scope ? t('settings.env.forProject') : t('settings.env.forAll')}>
          <Select
            label={t('settings.env.variablesFor')}
            value={scope}
            onChange={setScope}
            options={[
              { value: '', label: `${t('settings.env.everywhere')}${count(envKeys.global.length)}` },
              ...projects.map((p) => ({ value: p.id, label: `${p.name}${count(envKeys.projects[p.root]?.keys.length ?? 0)}` })),
            ]}
          />
        </Row>
      </Group>
      <EnvEditor key={scope} projectId={scope} />
    </>
  );
}
