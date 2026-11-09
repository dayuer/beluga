import { useState } from 'react';
import { CAP_INFO, CAP_LEVEL_INFO, CAP_ORDER, type CapLevel, type CapRow, type CapTrust, DECISION_INFO, type Rule, type RuleDecision, expiryLabel, ruleLabel } from '@beluga/core/gateway/access.js';
import { TRUST_INFO } from '@beluga/core/trust.js';
import { Button, cx } from '../components/ui.js';
import { Group, Select } from '../dialogs/settings-controls.js';
import { canPickFolders, inApp } from '../lib/boot.js';
import { pickFolders } from '../lib/projects.js';
import { useApi, useApp, useBeluga } from '../lib/beluga.js';
import s from './access.module.css';
import { currentLocale, t, tl, useT } from '../i18n/index.js';

/** The shared tables' words in the language shown (their English when a word is missing). */
const capLabel = (need: (typeof CAP_ORDER)[number]): string => tl('CAP_INFO', need, 'label', CAP_INFO[need].label);
const capDetail = (need: (typeof CAP_ORDER)[number]): string => tl('CAP_INFO', need, 'detail', CAP_INFO[need].detail);
const trustLabel = (trust: CapTrust): string => tl('TRUST_INFO', trust, 'label', TRUST_INFO[trust].label);
const levelLabel = (l: CapLevel): string => tl('CAP_LEVEL_INFO', l, 'label', CAP_LEVEL_INFO[l]);
const decisionLabel = (d: RuleDecision): string => tl('DECISION_INFO', d, 'label', DECISION_INFO[d]);

/**
 * Settings › People & access, for tasks between Claudes: what friends' Claudes may do here, per
 * capability and trust level (with the folders they may use and your "Ask me for…" note), and
 * your rules for people's requests, which "Always" on a request writes. The rules of one person
 * also show on their card.
 */

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const COLUMNS: readonly CapTrust[] = ['ask', 'trusted', 'full'];

function useSay(): (what: string, call: Promise<unknown>, done?: string) => void {
  const { client } = useBeluga();
  return (what, call, done) =>
    void call
      .then(() => (done ? client.store.dispatch({ type: 'toast', text: done, level: 'success' }) : undefined))
      .catch((err: unknown) => client.store.dispatch({ type: 'toast', text: t('gateway.access.couldnt', { what, error: message(err) }), level: 'error' }));
}

/** Pick a folder (the Mac's open panel; in a served page Beluga's picker of the server's folders; else a typed path). */
async function pickFolder(): Promise<string | undefined> {
  if (!inApp()) return (await pickFolders(t('gateway.access.pickFolder')))?.[0];
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ directory: true, multiple: false, title: t('gateway.access.pickFolder') });
  return typeof picked === 'string' ? picked : undefined;
}

function Folders() {
  useT();
  const api = useApi();
  const say = useSay();
  const folders = useApp((st) => st.gateway.capabilities.folders);
  const [typed, setTyped] = useState('');
  const set = (next: readonly string[]): void => say(t('gateway.access.changeFolders'), api.gateway.setCapabilities({ folders: [...next] }));
  const add = async (): Promise<void> => {
    const folder = typed.trim() || (await pickFolder());
    if (!folder || folders.includes(folder)) return;
    set([...folders, folder]);
    setTyped('');
  };
  return (
    <div className={s.folders} role="group" aria-label={t('gateway.access.foldersLabel')}>
      <div className={s.capName}>{t('gateway.access.foldersFor')}</div>
      <div className={s.capDetail}>{t('gateway.access.foldersDetail')}</div>
      {folders.map((f) => (
        <div key={f} className={s.folder}>
          <span title={f}>{f}</span>
          <Button size="small" variant="quiet" aria-label={t('gateway.access.removeFolder', { folder: f })} onClick={() => set(folders.filter((x) => x !== f))}>
            {t('gateway.access.remove')}
          </Button>
        </div>
      ))}
      <div className={s.folderAdd}>
        {canPickFolders() ? null : <input className={s.input} aria-label={t('gateway.access.folderPath')} placeholder="/Users/you/Shared" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />}
        <Button size="small" onClick={() => void add()} disabled={!canPickFolders() && !typed.trim()}>
          {t('gateway.access.addFolder')}
        </Button>
      </div>
    </div>
  );
}

function AskMeFor() {
  useT();
  const api = useApi();
  const say = useSay();
  const saved = useApp((st) => st.gateway.note);
  const [text, setText] = useState<string | undefined>();
  const save = (): void => {
    if (text === undefined || text === saved) return;
    say(t('gateway.access.saveIt'), api.gateway.setNote(text).then(() => setText(undefined)), t('gateway.access.saved'));
  };
  return (
    <div className={s.folders}>
      <div className={s.capName}>{t('gateway.access.askMeFor')}</div>
      <div className={s.capDetail}>{t('gateway.access.askMeForDetail')}</div>
      <input className={s.input} aria-label={t('gateway.access.askMeForLabel')} placeholder={t('gateway.access.askMeForPlaceholder')} value={text ?? saved} maxLength={280} onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} />
    </div>
  );
}

/** Friends your Claude asks without checking with you first (you said Always on its "Ask X's Claude?" card). */
function AskFreely() {
  useT();
  const api = useApi();
  const say = useSay();
  const peers = useApp((st) => st.gateway.askFreely ?? []);
  const friends = useApp((st) => st.network.friends);
  const roomPeers = useApp((st) => st.peers);
  const nameOf = (id: string): string => friends.find((f) => f.peerId === id)?.name ?? roomPeers.find((p) => p.peerId === id)?.name ?? t('gateway.access.someone');
  if (!peers.length) return null;
  return (
    <div className={s.folders} role="group" aria-label={t('gateway.access.freelyLabel')}>
      <div className={s.capName}>{t('gateway.access.freely')}</div>
      <div className={s.capDetail}>{t('gateway.access.freelyDetail')}</div>
      {peers.map((id) => (
        <div key={id} className={s.folder}>
          <span>{nameOf(id)}</span>
          <Button size="small" variant="quiet" aria-label={t('gateway.access.askFirstAbout', { name: nameOf(id) })} onClick={() => say(t('gateway.access.changeIt'), api.gateway.setAskFreely(id, false), t('gateway.access.asksFirst'))}>
            {t('gateway.access.askMeFirst')}
          </Button>
        </div>
      ))}
    </div>
  );
}

/** What friends' Claudes may do here: each capability by trust level (Allow / Ask me / Off). */
export function CapabilitySettings() {
  useT();
  const api = useApi();
  const say = useSay();
  const caps = useApp((st) => st.gateway.capabilities);
  const set = (need: (typeof CAP_ORDER)[number], trust: CapTrust, level: CapLevel): void => {
    const row: CapRow = { ...caps.levels[need], [trust]: level };
    say(t('gateway.access.changeIt'), api.gateway.setCapabilities({ levels: { [need]: row } }));
  };
  return (
    <Group title={t('gateway.access.capTitle')}>
      <table className={s.capTable} aria-label={t('gateway.access.capTable')}>
        <thead>
          <tr>
            <th />
            {COLUMNS.map((c) => (
              <th key={c}>{trustLabel(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CAP_ORDER.map((need) => (
            <tr key={need}>
              <td>
                <div className={s.capName}>{capLabel(need)}</div>
                <div className={s.capDetail}>{capDetail(need)}</div>
              </td>
              {COLUMNS.map((trust) => (
                <td key={trust} className={s.capCell}>
                  <Select<CapLevel>
                    label={t('gateway.access.capFor', { cap: capLabel(need), trust: trustLabel(trust) })}
                    value={caps.levels[need][trust]}
                    onChange={(v) => set(need, trust, v)}
                    // "Ask me each time" asks anyway: Allow there would mean the same as Ask me.
                    options={(trust === 'ask' ? (['ask', 'off'] as const) : (['allow', 'ask', 'off'] as const)).map((l) => ({ value: l, label: levelLabel(l) }))}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Folders />
      <AskMeFor />
      <AskFreely />
    </Group>
  );
}

/** One rule: what it covers, until when; change its answer, or delete it. */
function RuleRow({ rule }: { rule: Rule }) {
  useT();
  const api = useApi();
  const say = useSay();
  const { id, peerId, peerName, kind, needs, command, project, folder, expiresAt } = rule;
  const base = { id, peerId, peerName, kind, needs: [...needs], ...(command ? { command } : {}), ...(project ? { project } : {}), ...(folder ? { folder } : {}), ...(expiresAt ? { expiresAt } : {}) };
  return (
    <div className={s.rule} role="listitem" aria-label={t('gateway.access.rule', { rule: ruleLabel(rule) })}>
      <div className={s.ruleText}>
        <div className={s.ruleLabel}>{ruleLabel(rule)}</div>
        <div className={s.ruleMeta}>
          {t('gateway.access.made', { expiry: expiryLabel(rule), date: new Date(rule.createdAt).toLocaleDateString(currentLocale(), { month: 'short', day: 'numeric' }) })}
        </div>
      </div>
      <Select<RuleDecision> label={t('gateway.access.answerFor', { rule: ruleLabel(rule) })} value={rule.decision} onChange={(v) => say(t('gateway.access.changeRule'), api.gateway.saveRule({ ...base, decision: v }))} options={(['allow', 'ask', 'decline'] as const).map((d) => ({ value: d, label: decisionLabel(d) }))} />
      <Button size="small" variant="quiet" aria-label={t('gateway.access.deleteRuleLabel', { rule: ruleLabel(rule) })} onClick={() => say(t('gateway.access.deleteRule'), api.gateway.removeRule(rule.id), t('gateway.access.ruleDeleted'))}>
        {t('gateway.access.delete')}
      </Button>
    </div>
  );
}

/** One person's rules (their card in the inspector, Settings). */
export function PersonRules({ peerId, compact }: { peerId: string; compact?: boolean }) {
  const all = useApp((st) => st.gateway.rules);
  useT();
  const rules = all.filter((r) => r.peerId === peerId);
  if (!rules.length) return <div className={s.empty}>{t('gateway.access.noRulesPerson')}</div>;
  return (
    <div className={cx(s.cardRules, compact && s.compact)} role="list" aria-label={t('gateway.access.rules')}>
      {rules
        .slice()
        .reverse()
        .map((r) => (
          <RuleRow key={r.id} rule={r} />
        ))}
    </div>
  );
}

/** Every rule, by person. */
export function RuleSettings() {
  const rules = useApp((st) => st.gateway.rules);
  useT();
  const people = [...new Map(rules.map((r) => [r.peerId, r.peerName])).entries()];
  return (
    <Group title={t('gateway.access.rulesTitle')}>
      {people.length ? (
        <div role="list" aria-label={t('gateway.access.rulesBy')}>
          {people.map(([peerId, name]) => (
            <div key={peerId} role="listitem" aria-label={t('gateway.access.rulesFor', { name })}>
              <div className={s.person}>{name}</div>
              <PersonRules peerId={peerId} />
            </div>
          ))}
        </div>
      ) : (
        <div className={s.empty}>{t('gateway.access.noRules')}</div>
      )}
    </Group>
  );
}

/** Both, for Settings › People & access (only while the app runs the gateway). */
export function AccessSettings() {
  const enabled = useApp((st) => st.gateway.enabled);
  if (!enabled) return null;
  return (
    <>
      <CapabilitySettings />
      <RuleSettings />
    </>
  );
}
