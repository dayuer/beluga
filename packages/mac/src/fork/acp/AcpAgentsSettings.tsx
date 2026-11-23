import { useEffect, useState } from 'react';
import { Button, Dot } from '../../components/ui.js';
import { useApi } from '../../lib/beluga.js';
import { thisComputer } from '../../lib/os-words.js';
import { Group, Row } from '../../dialogs/settings-controls.js';
import s from '../../dialogs/settings.module.css';

/** One ACP agent as the daemon lists it (src/ipc/acp-handlers.ts). */
interface AgentView {
  readonly id: string;
  readonly label: string;
  readonly source: 'builtin' | 'registry' | 'local';
  readonly command: string;
  readonly args: readonly string[];
  readonly version?: string;
  readonly installed: boolean;
  readonly hidden?: boolean;
  readonly install?: string;
  readonly description?: string;
}

/** One ACP Registry result (src/agent/runtime/acp-agents/registry.ts RegistryHit). */
interface Hit {
  readonly id: string;
  readonly runtime: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly kind?: 'binary' | 'npx' | 'uvx';
  readonly installed?: string;
  readonly repository?: string;
  readonly website?: string;
}

interface Draft {
  readonly label: string;
  readonly command: string;
  readonly args: string;
  readonly env: string;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message.replace(/^Bad arguments for [\w.]+: /, '') : String(err));

/** Arguments as typed: split on spaces, "quoted words" kept together. */
export function splitArgs(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
}

/** Variables as typed, one NAME=value a line. */
export function parseEnv(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );
}

const SOURCE: Readonly<Record<AgentView['source'], string>> = { builtin: 'Built in', registry: 'From the ACP Registry', local: 'Your command' };
const KIND: Readonly<Record<NonNullable<Hit['kind']>, string>> = { binary: 'downloads its program', npx: 'runs through npx', uvx: 'runs through uvx' };

/**
 * Settings › Claude › ACP agents (fork, BLG-ACP): every Agent Client Protocol agent this computer
 * offers in the agent pickers. The built-in ones (Cursor, Grok Build, Kiro, Muse Code, Pi, fx,
 * Gemini CLI, Qwen Code…) show once their CLI is here; any agent in the ACP Registry installs with
 * a press, after it says what it downloads; and a command of yours that speaks ACP adds as one.
 */
export function AcpAgentsSettings() {
  const api = useApi();
  const [agents, setAgents] = useState<readonly AgentView[] | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly Hit[] | undefined>(undefined);
  const [confirm, setConfirm] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | undefined>(undefined);

  const load = async (): Promise<void> => setAgents(((await api.acp.agents()) as { agents: AgentView[] }).agents);
  useEffect(() => {
    void load().catch(() => setAgents([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const run = async (what: string, work: () => Promise<unknown>): Promise<void> => {
    setBusy(what);
    setError('');
    try {
      const out = (await work()) as { ok?: boolean; error?: string } | undefined;
      if (out && out.ok === false && out.error) setError(out.error);
      await load();
      if (hits) setHits((await api.acp.search(query)) as Hit[]);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(undefined);
      setConfirm(undefined);
    }
  };

  const search = async (): Promise<void> => {
    setBusy('search');
    setError('');
    try {
      setHits((await api.acp.search(query.trim())) as Hit[]);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(undefined);
    }
  };

  const shown = (agents ?? []).filter((a) => a.source !== 'builtin' || a.installed);
  const notHere = (agents ?? []).filter((a) => a.source === 'builtin' && !a.installed);

  return (
    <Group title="ACP agents">
      {/* agent-wording: claude (friends’ tasks and guests go to the Claude runtime, by name) */}
      <Row label="Agents that speak ACP" detail={`Cursor, Grok Build, Kiro, Gemini CLI and any other Agent Client Protocol agent, with its own sign-in and models. Pick one in the agent box you type in. They can run some steps without asking, so friends’ tasks and guests stay with Claude.`}>
        <Button
          icon="plus"
          disabled={Boolean(busy)}
          onClick={() => {
            setError('');
            setDraft({ label: '', command: '', args: 'acp', env: '' });
          }}
        >
          Add Command…
        </Button>
      </Row>
      {draft ? (
        <form
          className={s.endpointForm}
          onSubmit={(ev) => {
            ev.preventDefault();
            const env = parseEnv(draft.env);
            void run('add', () => api.acp.addLocal({ label: draft.label.trim(), command: draft.command.trim(), args: splitArgs(draft.args), ...(Object.keys(env).length ? { env } : {}) })).then(() => setDraft(undefined));
          }}
        >
          <label className={s.endpointField}>
            <span>Name</span>
            <input className={s.text} aria-label="Name" value={draft.label} placeholder="DeepSeek Harness" onChange={(ev) => setDraft({ ...draft, label: ev.target.value })} autoFocus />
          </label>
          <label className={s.endpointField}>
            <span>Command</span>
            <input className={s.text} aria-label="Command" value={draft.command} spellCheck={false} placeholder="dsh, or a full path" onChange={(ev) => setDraft({ ...draft, command: ev.target.value })} />
          </label>
          <label className={s.endpointField}>
            <span>Arguments</span>
            <input className={s.text} aria-label="Arguments" value={draft.args} spellCheck={false} placeholder="--profile acp" onChange={(ev) => setDraft({ ...draft, args: ev.target.value })} />
          </label>
          <label className={s.endpointField}>
            <span>Variables</span>
            <textarea className={s.text} aria-label="Variables" rows={2} value={draft.env} spellCheck={false} placeholder="NAME=value, one a line" onChange={(ev) => setDraft({ ...draft, env: ev.target.value })} />
          </label>
          {error ? <div className={s.endpointError}>{error}</div> : null}
          <div className={s.endpointBar}>
            <Button variant="quiet" onClick={() => setDraft(undefined)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={Boolean(busy) || !draft.label.trim() || !draft.command.trim()}>
              {busy === 'add' ? 'Adding…' : 'Add'}
            </Button>
          </div>
        </form>
      ) : null}
      {agents === undefined ? (
        <div className={s.note}>Looking…</div>
      ) : (
        shown.map((a) => (
          <Row key={a.id} label={a.label} detail={`${SOURCE[a.source]}${a.version ? ` ${a.version}` : ''} · ${[a.command.split(/[\\/]/).pop(), ...a.args].join(' ')}${a.hidden ? ' · turned off' : ''}${a.installed || a.source !== 'local' ? '' : ` · not found on ${thisComputer()}`}`}>
            <Dot tone={a.hidden ? 'muted' : a.installed || a.source === 'registry' ? 'ok' : 'warn'} />
            {a.hidden ? (
              <Button variant="quiet" disabled={Boolean(busy)} onClick={() => void run(a.id, () => api.acp.restore(a.id))}>
                Turn On
              </Button>
            ) : (
              <Button variant="quiet" disabled={Boolean(busy)} onClick={() => void run(a.id, () => api.acp.remove(a.id))}>
                {a.source === 'builtin' ? 'Turn Off' : a.source === 'registry' ? 'Uninstall' : 'Remove'}
              </Button>
            )}
          </Row>
        ))
      )}
      {notHere.length ? <div className={s.note}>{`Not on ${thisComputer()} yet: ${notHere.map((a) => a.label).join(', ')}. Install one with its own installer, or from the ACP Registry below.`}</div> : null}
      <Row label="ACP Registry" detail="The agents listed at agentclientprotocol.com. They’re other people’s code: look at an agent’s source and license before you install it.">
        <input
          className={s.text}
          aria-label="Search the ACP Registry"
          value={query}
          placeholder="Search"
          spellCheck={false}
          onChange={(ev) => setQuery(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') void search();
          }}
        />
        <Button variant="quiet" icon="refresh" disabled={Boolean(busy)} onClick={() => void search()}>
          {busy === 'search' ? 'Looking…' : hits ? 'Search' : 'Browse'}
        </Button>
      </Row>
      {error && !draft ? <div className={s.endpointError}>{error}</div> : null}
      {hits?.length === 0 ? <div className={s.note}>No agent in the Registry has those words.</div> : null}
      {hits?.map((h) => (
        <Row key={h.id} label={`${h.name} ${h.version}`} detail={`${h.description ?? h.id}${h.kind ? ` · ${KIND[h.kind]}` : ` · doesn’t run on ${thisComputer()}`}${h.installed ? ` · installed ${h.installed}` : ''}`}>
          {confirm === h.id ? (
            <>
              <Button variant="quiet" onClick={() => setConfirm(undefined)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={Boolean(busy)} onClick={() => void run(h.id, () => api.acp.install(h.id))}>
                {busy === h.id ? 'Installing…' : h.kind === 'binary' ? 'Download and Install' : 'Install'}
              </Button>
            </>
          ) : (
            <Button variant="quiet" disabled={Boolean(busy) || !h.kind || h.installed === h.version} onClick={() => setConfirm(h.id)}>
              {h.installed ? (h.installed === h.version ? 'Installed' : 'Update') : 'Install…'}
            </Button>
          )}
        </Row>
      ))}
    </Group>
  );
}
