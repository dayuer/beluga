import { useState } from 'react';
import { CLAUDE_AI_CONNECTORS_URL, type McpServerRow } from '@beluga/shared/mcp.js';
import { runtimeMark } from '@beluga/shared/agent-marks.js';
import { Button, Dot, Segmented } from '../components/ui.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { myRuntime } from '../chat/ModelPicker.js';
import { MCP_FROM, MCP_STATUS, checkMcp, mcpRuntimeOf, setMcpEnabled, signInMcp, useMcp } from '../lib/mcp.js';
import { openExternal } from '../lib/system.js';
import { Group, Row, Switch } from './settings-controls.js';
import s from './settings.module.css';
import { type Key, useT, tl } from '../i18n/index.js';

type McpRuntime = 'claude' | 'codex';

/** What each agent's list says, in its own words. */
const WORDS: Record<McpRuntime, { readonly name: string; readonly app: string; readonly where: Key; readonly none: Key }> = {
  claude: { name: 'Claude', app: 'Claude Code', where: 'settings.mcp.claudeWhere', none: 'settings.mcp.claudeNone' },
  codex: { name: 'Codex', app: 'Codex', where: 'settings.mcp.codexWhere', none: 'settings.mcp.codexNone' },
};

/**
 * Settings › Agent › MCP servers (BLG-251, BLG-518): the servers your own agent gets, how each is,
 * Sign In for one that needs it, and (Codex) a switch to turn one off. Claude's come from Claude
 * Code (agent/owner-mcp.ts), Codex's from its config.toml (runtime/codex/mcp.ts); with both set up,
 * a tab for each, yours first. Each keeps its own logins, so a sign-in here counts there too.
 */
export function McpSettings() {
  const { client } = useBeluga();
  const t = useT();
  // Your agent as Settings sets it (Settings › Agent › Your agent).
  const mine = mcpRuntimeOf(useApp((st) => myRuntime(st.prefs)));
  // Both agents set up on this Mac: one tab each.
  const setUp = useApp(
    (st) => (['claude', 'codex'] as const).filter((id) => st.runtimes?.some((r) => r.id === id && r.available)),
    (a, b) => a.join() === b.join(),
  );
  const tabs: readonly McpRuntime[] = setUp.length > 1 ? [mine, ...setUp.filter((id) => id !== mine)] : [mine];
  const [picked, pick] = useState<McpRuntime>(mine);
  const runtime = tabs.includes(picked) ? picked : mine;
  const words = WORDS[runtime];
  const { rows, checking, signingIn, turning } = useMcp(client, runtime);

  return (
    <Group title={t('settings.mcp.title')}>
      {tabs.length > 1 ? (
        <div className={s.row}>
          <Segmented label={t('settings.mcp.whose')} value={runtime} onChange={pick} options={tabs.map((id) => ({ value: id, label: id === mine ? t('settings.mcp.yours', { name: WORDS[id].name }) : WORDS[id].name, icon: runtimeMark(id) }))} />
        </div>
      ) : null}
      <Row label={t('settings.mcp.servers', { name: words.name })} detail={t('settings.mcp.serversDetail', { where: t(words.where) })}>
        <Button variant="quiet" icon="refresh" disabled={checking} onClick={() => void checkMcp(client, runtime)}>
          {checking ? t('settings.common.checking') : t('settings.common.checkAgain')}
        </Button>
      </Row>
      {rows === undefined ? (
        <div className={s.note}>{t('settings.mcp.asking', { app: words.app })}</div>
      ) : rows.length === 0 ? (
        <div className={s.note}>{t(words.none)}</div>
      ) : (
        rows.map((row) => {
          const status = MCP_STATUS[row.status];
          const why = row.status === 'failed' && row.error ? `: ${row.error}` : '';
          const tools = row.tools !== undefined ? t('settings.mcp.tools', { n: row.tools }) : '';
          return (
            <Row key={row.name} label={row.label} detail={`${MCP_FROM[row.from](row.where)} · ${tl('MCP_STATUS', row.status, 'words', status.words)}${tools}${why}`}>
              {row.canSignIn ? (
                <Button disabled={signingIn !== undefined} onClick={() => void signInMcp(client, row, runtime)}>
                  {signingIn === row.name ? t('settings.mcp.waiting') : t('settings.mcp.signIn')}
                </Button>
              ) : row.from === 'claude.ai' && row.status === 'needs-auth' ? (
                <Button variant="quiet" onClick={() => void openExternal(CLAUDE_AI_CONNECTORS_URL)}>
                  {t('settings.mcp.openClaudeAi')}
                </Button>
              ) : row.canTurnOff ? null : (
                <Dot tone={status.tone} />
              )}
              {row.canTurnOff ? <Switch label={t('settings.mcp.on', { label: row.label })} on={row.status !== 'disabled'} onChange={(on) => turning === undefined && void setMcpEnabled(client, row, on, runtime)} /> : null}
            </Row>
          );
        })
      )}
    </Group>
  );
}
