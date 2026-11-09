import { baseName } from '@beluga/shared/os-path.js';
import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { TRUST_INFO, trustOf } from '@beluga/core/trust.js';
import { BRANCH_PREFIX_RE, EFFORTS, type LowPower } from '@beluga/shared/settings-schema.js';
import { agentChoices, agentForChoice, choiceForAgent } from '@beluga/ui/agent-choice.js';
import { EFFORT_INFO, agentEntries, modelInfo, myModel, myRuntime, setMyAgent } from '../chat/ModelPicker.js';
import { HIDEABLE_BUTTONS, TUNNEL_LABELS, TUNNEL_ORDER } from '@beluga/ui/settings-menus.js';
import { Icon } from '../components/Icon.js';
import { Avatar, Button, Dot, cx } from '../components/ui.js';
import { runtimeMark } from '@beluga/shared/agent-marks.js';
import type { RuntimeState } from '@beluga/shared/agent-runtimes.js';
import { CopyCommand, LOCAL_MODELS_ID, useAgents } from '../onboarding/AgentsStep.js';
import { fixLabel } from '../onboarding/agent-setup.js';
import { APP_VERSION, webServed } from '../lib/boot.js';
import { revealInFinder } from '../lib/files.js';
import { type SettingsPane, useApi, useApp, useBeluga, useUi } from '../lib/beluga.js';
import { ACCENTS, type Accent, setPrefs, useChosenPrefs, usePrefs } from '../lib/prefs.js';
import { themeFor } from '../lib/themes.js';
import { useDocTheme } from '../components/markdown/use-doc-theme.js';
import { ThemeGroups } from './ThemePicker.js';
import { foldsForCategories } from '../layout/attention-model.js';
import { EnvironmentSettings } from './EnvironmentSettings.js';
import { ReportProblemRow } from './ReportProblemRow.js';
import { ContextSettings } from './ContextSettings.js';
import { UsageLimitSettings } from './UsageLimitSettings.js';
import { ParallelSettings } from './ParallelSettings.js';
import { AgentThreadsSettings, ThreadLimitsSettings } from './AgentThreadsSettings.js';
import { ChatLimitSettings } from './ChatLimitSettings.js';
import { McpSettings } from './McpSettings.js';
import { t, useT, useLocale, tl } from '../i18n/index.js';
import { LaunchFlagsSettings } from './LaunchFlagsSettings.js';
import { LocalModelsSettings } from './LocalModelsSettings.js';
import { EarningsSettings } from './EarningsSettings.js';
import { NotificationSettings } from './NotificationSettings.js';
import { VoiceSettings } from './VoiceSettings.js';
import { KeyboardSettings } from './KeyboardSettings.js';
import { ExperimentalSettings } from './ExperimentalSettings.js';
import { WebAccessSettings } from './WebAccessSettings.js';
import { Group, Row, Select, Switch } from './settings-controls.js';
import { panes as settingsPanes } from './settings-index.js';
import { SettingsSearchField, SettingsSearchResults, useSettingsSearch } from './SettingsSearch.js';
import { MaintainerChip } from './SupportSheets.js';
import s from './settings.module.css';
import { TerminalSettings } from './TerminalSettings.js';
import { FireSettings } from './FireSettings.js';
import { MenuBarSettings } from './MenuBarSettings.js';
import { NetworkSettings } from '../network/NetworkSettings.js';
import { befriend, openFriendCard } from '../network/use-net.js';
import { PhoneSettings } from '../phone/Phone.js';
import { AccessSettings } from '../gateway/AccessSettings.js';
import { UpdateAboutRow, UpdateSettingsGroup } from './UpdateSettings.js';
import { GITHUB_URL, openSupport } from '../lib/support.js';
import { openExternal } from '../lib/system.js';
import { shortcutKeys } from '../lib/shortcuts.js';
import { keyPlatform } from '../lib/shortcuts-model.js';
import { cmdReturn, returnName, revealLabel, yourComputer } from '../lib/os-words.js';

/** Your profile picture: friends and people in your groups get it once and keep it (net/mesh/avatars.ts). */
function PictureRow() {
  const api = useApi();
  const me = useApp((st) => st.network.self);
  const on = useApp((st) => st.network.enabled);
  const fallbackName = useApp((st) => st.self?.name ?? '');
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const run = (b64: string | null): void => {
    setBusy(true);
    setError(undefined);
    api.network['avatar.set'](b64).then(
      () => setBusy(false),
      (err: unknown) => {
        setBusy(false);
        setError(err instanceof Error ? err.message : String(err));
      },
    );
  };
  const pick = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      run(await squarePicture(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const detail = !on ? t('settings.general.pictureOff') : (error ?? t('settings.general.pictureDetail'));
  return (
    <Row label={t('settings.general.picture')} detail={detail}>
      <span className={s.pictureRow}>
        {me ? <Avatar name={me.name || fallbackName} id={me.peerId} size={32} /> : null}
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/heic" hidden onChange={(e) => void pick(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
        <Button size="small" icon="image" disabled={!on || busy} onClick={() => input.current?.click()}>
          {me?.avatar ? t('settings.general.pictureChange') : t('settings.general.pictureChoose')}
        </Button>
        {me?.avatar ? (
          <Button size="small" variant="quiet" disabled={busy} onClick={() => run(null)}>
            {t('settings.common.remove')}
          </Button>
        ) : null}
      </span>
    </Row>
  );
}

/** A picture cropped to its middle square and shrunk to 256 px, small enough to send (base64). */
async function squarePicture(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(t('settings.general.pictureCantOpen'));
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.min(256, side);
  const g = canvas.getContext('2d');
  if (!g) throw new Error(t('settings.general.pictureCantDraw'));
  g.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string, quality: number): Promise<Blob | null> => new Promise((done) => canvas.toBlob(done, type, quality));
  // WebP where the browser writes it (WebKit doesn't: JPEG there), a little rougher until it fits.
  for (const quality of [0.88, 0.78, 0.65, 0.5]) {
    let blob = await encode('image/webp', quality);
    if (blob?.type !== 'image/webp') blob = await encode('image/jpeg', quality);
    if (blob && blob.size <= 90 * 1024) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin);
    }
  }
  throw new Error(t('settings.general.pictureTooBig'));
}

function General() {
  const api = useApi();
  const state = useApp((st) => st);
  const prefs = usePrefs();
  const t = useT();
  const [name, setName] = useState(state.self?.name ?? '');
  return (
    <>
      <Group>
        <Row label={t('settings.general.name')} detail={t('settings.general.nameDetail')}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void api.session.rename(name);
            }}
          >
            <input id="settings-name" aria-label={t('settings.general.name')} className={s.text} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== state.self?.name && void api.session.rename(name)} />
          </form>
        </Row>
        <PictureRow />
        <Row label={t('settings.general.requests')} detail={t('settings.general.requestsDetail')}>
          <Select
            label={t('settings.general.defaultPolicy')}
            value={state.policy}
            onChange={(v) => void api.session.setClaudeSharing(v)}
            options={[
              { value: 'ask', label: t('settings.general.askEachTime') },
              { value: 'auto', label: t('settings.general.allowEveryone') },
              { value: 'deny', label: t('settings.general.keepPrivate') },
            ]}
          />
        </Row>
      </Group>
      {/* A browser runs the build its server serves: the server's Beluga updates, not the page. */}
      {webServed() ? null : <UpdateSettingsGroup />}
      <Group title={t('settings.writing.title')}>
        <Row label={t('settings.writing.sendWith')} detail={prefs.sendWith === 'enter' ? t('settings.writing.shiftReturnNewLine') : t('settings.writing.returnNewLine')}>
          <Select
            label={t('settings.writing.sendWith')}
            value={prefs.sendWith}
            onChange={(v) => setPrefs({ sendWith: v })}
            options={[
              { value: 'enter', label: returnName() },
              { value: 'cmd-enter', label: cmdReturn(' ') },
            ]}
          />
        </Row>
        <Row label={t('settings.writing.duringTurn')} detail={t('settings.writing.duringTurnDetail')}>
          <Select
            label={t('settings.writing.duringTurn')}
            value={prefs.sendDuringTurn}
            onChange={(v) => setPrefs({ sendDuringTurn: v })}
            options={[
              { value: 'queue', label: t('settings.writing.queue') },
              { value: 'steer', label: t('settings.writing.steer') },
            ]}
          />
        </Row>
        <Row label={t('settings.writing.times')}>
          <Switch label={t('settings.writing.timesSwitch')} on={prefs.timestamps} onChange={(v) => setPrefs({ timestamps: v })} />
        </Row>
        <Row label={t('settings.writing.steps')} detail={t('settings.writing.stepsDetail')}>
          <Select
            label={t('settings.writing.stepsSwitch')}
            value={prefs.doneSteps}
            onChange={(v) => setPrefs({ doneSteps: v })}
            options={[
              { value: 'fold', label: t('settings.writing.fold') },
              { value: 'show', label: t('settings.writing.show') },
            ]}
          />
        </Row>
      </Group>
      <EarningsSettings />
    </>
  );
}

const lowPowerOptions = (): ReadonlyArray<{ value: LowPower; label: string }> => [
  { value: 'off', label: t('settings.common.off') },
  { value: 'battery', label: t('settings.lowPower.battery') },
  { value: 'always', label: t('settings.common.always') },
];

const IDLE_DAYS: readonly number[] = [0, 1, 3, 7, 14, 30];
const idleWords = (days: number): string => (days === 0 ? t('settings.common.never') : t('settings.layout.afterDays', { days }));

function Appearance() {
  const prefs = useChosenPrefs();
  const t = useT();
  const api = useApi();
  const lowPower = useApp((st) => st.prefs.lowPower ?? 'off');
  const saving = useApp((st) => st.powerSaving);
  const savingNote = saving ? t('settings.appearance.savingOff') : undefined;
  const theme = themeFor(useDocTheme(), prefs);
  const themeAccent = theme.accent !== undefined;
  const daemonPrefs = useApp((st) => st.prefs);
  const idleChoices = [...new Set([...IDLE_DAYS, daemonPrefs.settleIdleDays])].sort((x, y) => x - y);
  // Your folds come back when it's off.
  const turnCategories = (on: boolean): void => {
    setPrefs(foldsForCategories(on, prefs));
    void api.session.setPrefs({ chatCategories: on });
  };
  return (
    <>
      <Group>
        <Row label={t('settings.appearance.language')} detail={t('settings.appearance.languageDetail')}>
          <Select
            label={t('settings.appearance.language')}
            value={prefs.language}
            onChange={(v) => setPrefs({ language: v })}
            options={[
              { value: 'system', label: t('settings.appearance.languageSystem') },
              { value: 'en', label: 'English' },
              { value: 'zh-CN', label: '简体中文' },
            ]}
          />
        </Row>
        <Row label={t('settings.appearance.appearance')} {...(prefs.appearance === 'system' ? { detail: t('settings.appearance.appearanceDetail', { computer: yourComputer() }) } : {})}>
          <Select
            label={t('settings.appearance.appearance')}
            value={prefs.appearance}
            onChange={(v) => setPrefs({ appearance: v })}
            options={[
              { value: 'system', label: t('settings.appearance.matchSystem') },
              { value: 'light', label: t('settings.appearance.light') },
              { value: 'dark', label: t('settings.appearance.dark') },
            ]}
          />
        </Row>
        <Row label={t('settings.appearance.accent')} detail={t('settings.appearance.accentDetail', { computer: yourComputer(), themeOwn: themeAccent ? t('settings.appearance.accentThemeOwn', { theme: theme.name }) : '' })}>
          <div className={s.swatches}>
            {(Object.keys(ACCENTS) as Accent[]).filter((a) => a !== 'theme' || themeAccent || prefs.accent === 'theme').map((a) => (
              <button key={a} type="button" aria-label={a === 'theme' ? t('settings.appearance.themeOwn', { theme: theme.name }) : a} {...(a === 'theme' ? { title: t('settings.appearance.themeOwn', { theme: theme.name }) } : {})} aria-pressed={prefs.accent === a} className={cx(s.swatch, prefs.accent === a && s.swatchOn)} style={{ background: a === 'system' ? 'conic-gradient(#3b82f6, #8b5cf6, #e11d48, #d97706, #059669, #3b82f6)' : ACCENTS[a] }} onClick={() => setPrefs({ accent: a })} />
            ))}
          </div>
        </Row>
      </Group>
      <ThemeGroups />
      <Group title={t('settings.lowPower.title')}>
        <Row
          label={t('settings.lowPower.mode')}
          detail={t('settings.lowPower.detail', { now: saving ? t('settings.lowPower.savingNow') : '' })}
        >
          <Select label={t('settings.lowPower.mode')} value={lowPower} onChange={(v) => void api.session.setPrefs({ lowPower: v })} options={lowPowerOptions().map((o) => ({ ...o }))} />
        </Row>
      </Group>
      <Group title={t('settings.layout.title')}>
        <Row label={t('settings.layout.textSize')} detail={t('settings.layout.textSizeDetail', { size: prefs.textSize, keys: [shortcutKeys('zoom-in'), shortcutKeys('zoom-out')].filter(Boolean).join(t('settings.layout.and')) || t('settings.layout.zoomMenu') })}>
          <input className={s.slider} type="range" min={11} max={17} step={1} value={prefs.textSize} onChange={(e) => setPrefs({ textSize: Number(e.target.value) })} />
        </Row>
        <Row label={t('settings.layout.density')}>
          <Select
            label={t('settings.layout.density')}
            value={prefs.density}
            onChange={(v) => setPrefs({ density: v })}
            options={[
              { value: 'comfortable', label: t('settings.layout.comfortable') },
              { value: 'compact', label: t('settings.layout.compact') },
            ]}
          />
        </Row>
        <Row label={t('settings.layout.width')}>
          <Select
            label={t('settings.layout.widthShort')}
            value={prefs.chatWidth}
            onChange={(v) => setPrefs({ chatWidth: v, chatWidthPicked: true })}
            options={[
              { value: 'narrow', label: t('settings.layout.narrow') },
              { value: 'wide', label: t('settings.layout.wide') },
              { value: 'full', label: t('settings.layout.full') },
            ]}
          />
        </Row>
        <Row label={t('settings.layout.categories')} detail={t('settings.layout.categoriesDetail')}>
          <Switch label={t('settings.layout.categories')} on={daemonPrefs.chatCategories} onChange={turnCategories} />
        </Row>
        {daemonPrefs.chatCategories ? (
          <>
            <Row label={t('settings.layout.settleMerge')} detail={t('settings.layout.settleMergeDetail')}>
              <Switch label={t('settings.layout.settleMerge')} on={daemonPrefs.settleOnMerge} onChange={(v) => void api.session.setPrefs({ settleOnMerge: v })} />
            </Row>
            <Row label={t('settings.layout.settleIdle')} detail={t('settings.layout.settleIdleDetail')}>
              <Select label={t('settings.layout.settleIdle')} value={String(daemonPrefs.settleIdleDays)} onChange={(v) => void api.session.setPrefs({ settleIdleDays: Number(v) })} options={idleChoices.map((d) => ({ value: String(d), label: idleWords(d) }))} />
            </Row>
          </>
        ) : (
          <Row label={t('settings.layout.unread')} detail={t('settings.layout.unreadDetail')}>
            <Switch label={t('settings.layout.unread')} on={prefs.unreadSection} onChange={(v) => setPrefs({ unreadSection: v })} />
          </Row>
        )}
        <Row label={t('settings.layout.sidebarWidth')}>
          <input className={s.slider} type="range" min={200} max={360} step={4} value={prefs.sidebarWidth} onChange={(e) => setPrefs({ sidebarWidth: Number(e.target.value) })} />
        </Row>
        <Row label={t('settings.layout.reduceMotion')} {...(savingNote ? { detail: savingNote } : {})}>
          <Switch label={t('settings.layout.reduceMotion')} on={prefs.reduceMotion} onChange={(v) => setPrefs({ reduceMotion: v })} />
        </Row>
        {keyPlatform() === 'mac' && !webServed() && (
          <Row label={t('settings.layout.reduceTransparency')} detail={savingNote ?? t('settings.layout.reduceTransparencyDetail')}>
            <Switch label={t('settings.layout.reduceTransparency')} on={prefs.reduceTransparency} onChange={(v) => setPrefs({ reduceTransparency: v })} />
          </Row>
        )}
      </Group>
    </>
  );
}

const TONE: Record<RuntimeState, 'ok' | 'warn' | 'muted'> = { ready: 'ok', signed_out: 'warn', missing: 'muted', no_endpoint: 'muted' };

/**
 * Your agents (BLG-507): each one Beluga can run with where it stands on this Mac, and its one fix
 * (Sign In, Get Codex, Set Up…); Check Again asks them all now. The same rows as onboarding's.
 */
function AgentsGroup({ mine }: { mine: string }) {
  const { rows, checking, check, act } = useAgents();
  const t = useT();
  return (
    <Group title={t('settings.agent.agents')}>
      {rows.map((row) => (
        <div key={row.id} className={s.row} data-testid={`settings-agent-${row.id}`}>
          <Icon name={runtimeMark(row.id)} size={18} />
          <div className={s.rowText}>
            <div className={s.rowLabel}>
              {row.label}
              {row.id === mine && row.state === 'ready' ? <span className={s.agentYours}>{t('settings.agent.yours')}</span> : null}
            </div>
            <div className={s.rowDetail}>
              {row.detail}
              {row.fix === 'install' ? (
                <>
                  {' '}
                  <CopyCommand className={s.agentCommand} runtime={row.id} />
                </>
              ) : null}
            </div>
          </div>
          <div className={s.control}>
            <Dot tone={row.state ? TONE[row.state] : 'muted'} />
            {row.words}
            {row.fix ? (
              <Button size="small" onClick={() => act(row)}>
                {fixLabel(row)}
              </Button>
            ) : null}
          </div>
        </div>
      ))}
      <Row label={t('settings.agent.justNow')} detail={t('settings.agent.justNowDetail')}>
        <Button variant="quiet" icon="refresh" disabled={checking} onClick={() => void check()}>
          {checking ? t('settings.common.checking') : t('settings.common.checkAgain')}
        </Button>
      </Row>
    </Group>
  );
}

/**
 * Your agent (BLG-497): one pick of runtime and model, for every conversation that picked none of
 * its own and for @you; then how hard it thinks (only the levels its model takes) and the rest.
 */
function AgentPane() {
  const api = useApi();
  const macPrefs = usePrefs();
  const { ui } = useBeluga();
  const t = useT();
  const state = useApp((st) => st);
  const p = state.prefs;
  const runtime = myRuntime(p);
  const model = myModel(p);
  const choices = agentChoices(state.runtimes, state.models);
  // A model its runtime doesn't list (yet) takes every level.
  const efforts = new Set<string>(modelInfo(state, runtime, model)?.efforts ?? EFFORTS);
  const effortOptions = EFFORTS.filter((e) => efforts.has(e) || e === p.effort);
  return (
    <>
      <Group>
        <Row label={t('settings.agent.yourAgent')} detail={t('settings.agent.yourAgentDetail')}>
          <Select
            label={t('settings.agent.yourAgent')}
            value={choiceForAgent({ runtime, label: '', ...(model ? { model } : {}) })}
            onChange={(v) => {
              const ref = agentForChoice(v, state.runtimes);
              setMyAgent(api, ref.runtime, ref.label, ref.model ?? '');
            }}
            options={agentEntries(choices)}
            placeholder={choices.find((c) => c.runtime === runtime)?.group ?? runtime}
          />
        </Row>
        <Row label={t('settings.agent.effort')} detail={efforts.size < EFFORTS.length ? t('settings.agent.effortLevels') : undefined}>
          <Select label={t('settings.agent.effortShort')} value={p.effort ?? ''} onChange={(v) => void api.session.setPrefs({ effort: (v || null) as (typeof EFFORTS)[number] | null })} options={[{ value: '', label: t('settings.agent.auto'), description: t('settings.agent.autoDetail') }, ...effortOptions.map((e) => ({ value: e, label: EFFORT_INFO[e].label, description: EFFORT_INFO[e].detail, ...(efforts.has(e) ? {} : { disabled: true }) }))]} />
        </Row>
        <Row label={t('settings.agent.askFirst')} detail={t('settings.agent.askFirstDetail')}>
          <Switch label={t('settings.agent.selfApproval')} on={p.selfApproval === 'ask'} onChange={(v) => void api.session.setPrefs({ selfApproval: v ? 'ask' : 'never' })} />
        </Row>
      </Group>
      <AgentsGroup mine={runtime} />
      <LaunchFlagsSettings />
      <McpSettings />
      <div id={LOCAL_MODELS_ID}>
        <LocalModelsSettings />
      </div>
      <Group title={t('settings.agent.inChat')}>
        <Row label={t('settings.agent.subagents')}>
          <Select
            label={t('settings.agent.subagents')}
            value={p.subagents}
            onChange={(v) => void api.session.setPrefs({ subagents: v })}
            options={[
              { value: 'full', label: t('settings.agent.everyStep') },
              { value: 'compact', label: t('settings.agent.oneLine') },
              { value: 'hidden', label: t('settings.agent.justCount') },
            ]}
          />
        </Row>
      </Group>
      <ContextSettings />
      <UsageLimitSettings />
      <ParallelSettings />
      <ChatLimitSettings />
      {p.agentThreads ? <ThreadLimitsSettings /> : null}
      <Group title={t('settings.agent.scratch')}>
        <Row label={t('settings.agent.scratchGive')} detail={t('settings.agent.scratchGiveDetail')}>
          <Switch label={t('settings.agent.scratch')} on={p.scratchFolder} onChange={(v) => void api.session.setPrefs({ scratchFolder: v })} />
        </Row>
        <Row label={t('settings.agent.scratchTab')} detail={t('settings.agent.scratchTabDetail', { keys: shortcutKeys('panel-scratch') ? ` (${shortcutKeys('panel-scratch')})` : '' })}>
          <Switch label={t('settings.agent.scratchTabShort')} on={macPrefs.scratchTab} onChange={(v) => setPrefs({ scratchTab: v })} />
        </Row>
      </Group>
      <Group title={t('settings.agent.prTemplates')}>
        <Row label={t('settings.agent.prInstructions')} detail={state.prCustom ? t('settings.agent.customized') : t('settings.agent.builtIn')}>
          <Button onClick={() => void api.workbench.editPrPrompt()}>{t('settings.common.edit')}</Button>
          {state.prCustom ? (
            <Button variant="quiet" onClick={() => void api.workbench.resetPrPrompt()}>
              {t('settings.common.reset')}
            </Button>
          ) : null}
        </Row>
        <Row label={t('settings.agent.templates')} detail={t('settings.agent.templatesDetail', { n: state.templates.length })}>
          <Button onClick={() => ui.patch({ settings: undefined, menu: { menu: { kind: 'templates', manage: true }, selected: 0 } })}>{t('settings.agent.manage')}</Button>
        </Row>
      </Group>
    </>
  );
}

/** Projects you hid from the sidebar, each with Show (it comes back where it was). */
function HiddenProjectsGroup() {
  const api = useApi();
  const hidden = useApp((st) => st.hiddenProjects);
  const t = useT();
  return (
    <Group title={t('settings.workspaces.hidden')}>
      {hidden.length ? (
        hidden.map((root) => (
          <Row key={root} label={baseName(root) || root} detail={root}>
            <Button onClick={() => void api.workspaces.showProject(root)} aria-label={t('settings.workspaces.showProject', { name: baseName(root) || root })}>
              {t('settings.workspaces.show')}
            </Button>
          </Row>
        ))
      ) : (
        <Row label={t('settings.workspaces.none')} detail={t('settings.workspaces.hiddenNone')}>
          {null}
        </Row>
      )}
    </Group>
  );
}

/** What new worktrees' branches start with: saved when you leave the field, if git would take it. */
function BranchPrefixRow() {
  const api = useApi();
  const saved = useApp((st) => st.prefs.branchPrefix);
  const t = useT();
  const [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved]);
  const ok = BRANCH_PREFIX_RE.test(value);
  const save = (): void => {
    if (ok && value !== saved) void api.session.setPrefs({ branchPrefix: value });
  };
  return (
    <Row label={t('settings.workspaces.branchPrefix')} detail={ok ? t('settings.workspaces.branchPrefixDetail', { value }) : t('settings.workspaces.branchPrefixBad')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input aria-label={t('settings.workspaces.branchPrefix')} className={s.text} value={value} placeholder={t('settings.common.none')} spellCheck={false} onChange={(e) => setValue(e.target.value.trim())} onBlur={save} />
      </form>
    </Row>
  );
}

function Workspaces() {
  const api = useApi();
  const p = useApp((st) => st.prefs);
  const t = useT();
  return (
    <>
      <Group>
        <Row label={t('settings.workspaces.setup')} detail={t('settings.workspaces.setupDetail')}>
          <Switch label={t('settings.workspaces.autoSetup')} on={p.autoSetup} onChange={(v) => void api.session.setPrefs({ autoSetup: v })} />
        </Row>
        <BranchPrefixRow />
        <Row label={t('settings.workspaces.pushToPr')} detail={t('settings.workspaces.pushToPrDetail')}>
          <Switch label={t('settings.workspaces.pushToPr')} on={p.pushToPr} onChange={(v) => void api.session.setPrefs({ pushToPr: v })} />
        </Row>
        <Row label={t('settings.workspaces.friends')} detail={t('settings.workspaces.friendsDetail')}>
          <Switch label={t('settings.workspaces.friendWorktrees')} on={p.friendWorktrees === 'ask'} onChange={(v) => void api.session.setFriendWorktrees(v ? 'ask' : 'off')} />
        </Row>
      </Group>
      <HiddenProjectsGroup />
      <Group title={t('settings.workspaces.toolbar')}>
        {HIDEABLE_BUTTONS.map(([id, label]) => (
          <Row key={id} label={label}>
            <Switch label={label} on={!p.hiddenButtons.includes(id)} onChange={(v) => void api.session.setPrefs({ hiddenButtons: v ? p.hiddenButtons.filter((b) => b !== id) : [...p.hiddenButtons, id] })} />
          </Row>
        ))}
      </Group>
    </>
  );
}

function People() {
  const api = useApi();
  const { client, ui } = useBeluga();
  const state = useApp((st) => st);
  const others = state.peers.filter((p) => p.peerId !== state.selfId);
  const remembered = Object.entries(state.remembered).filter(([id]) => !others.some((p) => p.peerId === id));
  const t = useT();
  return (
    <>
      <NetworkSettings />
      <AccessSettings />
      {/* Trust is shown here and set on each friend's card (BLG-202). */}
      <Group title={t('settings.people.room')}>
        {others.length ? (
          others.map((p) => {
            const friend = state.network.friends.some((f) => f.peerId === p.peerId);
            return (
              <Row key={p.peerId} label={p.name} detail={t('settings.people.trustDetail', { trust: tl('TRUST_INFO', trustOf(state, p.peerId), 'label', TRUST_INFO[trustOf(state, p.peerId)].label), how: friend ? t('settings.people.changeOnCard') : t('settings.people.befriendToSet') })}>
                <Avatar name={p.name} id={p.peerId} size={20} />
                {friend ? (
                  <Button
                    variant="quiet"
                    onClick={() => {
                      ui.patch({ settings: undefined });
                      openFriendCard(client, p.peerId);
                    }}
                  >
                    {t('settings.people.theirCard')}
                  </Button>
                ) : p.guest || state.guests[p.peerId] ? null : (
                  <Button variant="quiet" onClick={() => void befriend(client, p.peerId, p.name)}>
                    {t('settings.people.addFriend')}
                  </Button>
                )}
              </Row>
            );
          })
        ) : (
          <div className={s.note}>{t('settings.people.nobody')}</div>
        )}
      </Group>
      {remembered.length ? (
        <Group title={t('settings.people.remembered')}>
          {remembered.map(([id, r]) => (
            <Row key={id} label={r.name} detail={tl('TRUST_INFO', r.trust, 'label', TRUST_INFO[r.trust].label)}>
              <Button variant="quiet" onClick={() => void api.people.forget(id)}>
                {t('settings.people.forget')}
              </Button>
            </Row>
          ))}
        </Group>
      ) : null}
      <Group title={t('settings.people.remote')}>
        <Row label={t('settings.people.reach')} detail={t('settings.people.reachDetail')}>
          <Select label={t('settings.people.tunnel')} value={state.prefs.tunnel} onChange={(v) => void api.session.setPrefs({ tunnel: v })} options={TUNNEL_ORDER.map((id) => ({ value: id, label: tl('TUNNEL_LABELS', id, 'text', TUNNEL_LABELS[id]) }))} />
        </Row>
        {state.isHost ? (
          <Row label={t('settings.people.takeNew')} detail={state.roomOpen ? t('settings.people.roomOpenDetail') : t('settings.people.roomClosedDetail')}>
            <Switch label={t('settings.people.roomOpen')} on={state.roomOpen} onChange={(v) => void api.session.setRoomOpen(v)} />
          </Row>
        ) : null}
        <Row label={t('settings.people.invite')}>
          <Button onClick={() => void api.session.copyInvite()}>{t('settings.common.copy')}</Button>
          {state.isHost ? (
            <Button variant="quiet" onClick={() => void api.session.newInviteLink()}>
              {t('settings.people.newLink')}
            </Button>
          ) : null}
        </Row>
      </Group>
    </>
  );
}

function About() {
  const { client, ui } = useBeluga();
  const home = useApp((st) => st.home);
  const logPath = `${home}/.beluga/logs/daemon.log`;
  const t = useT();
  return (
    <>
      <Group>
        <Row label={t('settings.about.app')}>{APP_VERSION}</Row>
        {webServed() ? null : <UpdateAboutRow />}
        <Row label={t('settings.about.daemon')}>{client.daemonVersion}</Row>
        <Row label={t('settings.about.windows')} detail={t('settings.about.windowsDetail')}>
          {client.clients}
        </Row>
        <Row label={t('settings.about.log')} detail="~/.beluga/logs/daemon.log">
          <Button size="small" onClick={() => void client.api.local.openFolder(logPath)}>
            {t('settings.about.openConsole')}
          </Button>
          <Button size="small" variant="quiet" onClick={() => void revealInFinder(client, logPath)}>
            {revealLabel()}
          </Button>
        </Row>
        <ReportProblemRow />
      </Group>
      <Group title={t('settings.about.support')}>
        <Row label={t('settings.about.free')} detail={
            <>
              {t('settings.about.builtBy')}<MaintainerChip />{t('settings.about.builtByEnd')}
            </>
          }>
          <Button size="small" icon="star" onClick={() => void openExternal(GITHUB_URL)}>
            {t('settings.about.star')}
          </Button>
          <Button
            size="small"
            icon="cup"
            onClick={() => {
              // The sheet opens where Settings was (Settings sits above sheets).
              ui.patch({ settings: undefined });
              openSupport('coffee');
            }}
          >
            {t('settings.about.coffee')}
          </Button>
        </Row>
      </Group>
    </>
  );
}

const BODY: Record<SettingsPane, () => ReactNode> = {
  general: General,
  appearance: Appearance,
  claude: AgentPane,
  notifications: NotificationSettings,
  workspaces: Workspaces,
  terminal: TerminalSettings,
  fire: FireSettings,
  menubar: MenuBarSettings,
  environment: EnvironmentSettings,
  people: People,
  phone: PhoneSettings,
  voice: VoiceSettings,
  keyboard: KeyboardSettings,
  advanced: Advanced,
  experimental: ExperimentalSettings,
  about: About,
};

function Advanced() {
  return (
    <>
      <WebAccessSettings />
      <AgentThreadsSettings />
    </>
  );
}

/** The app's own panes a browser has no use for (it has no menu bar icon). */
const APP_ONLY: ReadonlySet<SettingsPane> = new Set(['menubar']);

/** Beluga's settings: this window's look on the left panes, Beluga's shared settings on the rest. */
export function Settings() {
  const pane = useUi((u) => u.settings);
  return pane ? <SettingsWindow pane={pane} /> : null;
}

/**
 * The window, with the search above the panes (BLG-740): opened, the field has focus; ⌘F comes
 * back to it, Esc clears it, and a second Esc closes the window.
 */
function SettingsWindow({ pane }: { pane: SettingsPane }) {
  const { ui } = useBeluga();
  const t = useT();
  const locale = useLocale();
  const all = useMemo(() => settingsPanes(), [locale]);
  const panes = useMemo(() => (webServed() ? all.filter((p) => !APP_ONLY.has(p.id)) : all), [all]);
  const scroll = useRef<HTMLDivElement>(null);
  const search = useSettingsSearch(panes, pane, (id) => ui.patch({ settings: id }), scroll);
  const Body = BODY[pane];
  // Opened from the welcome (Set Up… on Your agents): over it, not hidden behind it.
  const overWelcome = document.querySelector('[data-welcome]') ? '' : undefined;
  return (
    <Dialog.Root open onOpenChange={(v) => (v ? undefined : ui.patch({ settings: undefined }))}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} data-over-welcome={overWelcome} />
        <Dialog.Content
          className={s.window}
          data-over-welcome={overWelcome}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            search.field.current?.focus();
          }}
          onEscapeKeyDown={(e) => {
            if (!search.query) return;
            e.preventDefault();
            search.clear();
          }}
        >
          <nav className={s.nav}>
            <Dialog.Title className={s.title}>{t('settings.window.title')}</Dialog.Title>
            <SettingsSearchField search={search} />
            {panes.map((p) => (
              <button
                key={p.id}
                type="button"
                className={cx(s.navItem, p.id === pane && !search.showing && s.navOn, search.showing && !search.matched.has(p.id) && s.navDim)}
                onClick={() => {
                  ui.patch({ settings: p.id });
                  search.browse();
                }}
              >
                <Icon name={p.icon} size={14} />
                {p.label}
              </button>
            ))}
          </nav>
          <div className={s.body}>
            <div className={s.bodyHead}>
              <h2 className={s.paneTitle}>{search.showing ? t('settings.window.search') : all.find((p) => p.id === pane)?.label}</h2>
              <Dialog.Close className={s.close} aria-label={t('settings.window.close')}>
                <Icon name="x" size={12} />
              </Dialog.Close>
            </div>
            <div ref={scroll} className={s.scroll}>
              {search.showing ? <SettingsSearchResults search={search} panes={panes} /> : <Body />}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
