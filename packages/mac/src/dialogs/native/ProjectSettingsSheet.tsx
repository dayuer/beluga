import { useEffect, useState } from 'react';
import type { ResolvedScripts } from '@beluga/workspaces/scripts.js';
import { agentMark } from '@beluga/shared/agent-marks.js';
import { agentChoices, agentForChoice, choiceForAgent } from '@beluga/ui/agent-choice.js';
import { agentEntries } from '../../chat/ModelPicker.js';
import { Checkbox, Field, FormSheet, Popup, SourceTag, TextInput } from '../../components/FormSheet.js';
import { agentName, useMyAgent } from '../../lib/agent-words.js';
import { useApi, useApp } from '../../lib/beluga.js';
import type { NativeMenuProps } from './index.js';
import { type Key, t as tNow, useT } from '../../i18n/index.js';

type Kind = 'setup' | 'run';
type Source = NonNullable<ResolvedScripts['setup']>['source'];

const SOURCE: Record<Source, { label: Key | string; tone: 'team' | 'mine' | 'guess'; detail: Key }> = {
  yours: { label: 'more.project.source.yours', tone: 'mine', detail: 'more.project.source.yoursDetail' },
  claude: { label: 'more.project.source.claude', tone: 'guess', detail: 'more.project.source.claudeDetail' },
  'beluga.json': { label: 'beluga.json', tone: 'team', detail: 'more.project.source.shared' },
  'klaud.json': { label: 'klaud.json', tone: 'team', detail: 'more.project.source.shared' },
  'conductor.json': { label: 'conductor.json', tone: 'team', detail: 'more.project.source.conductor' },
  detected: { label: 'more.project.source.detected', tone: 'guess', detail: 'more.project.source.detectedDetail' },
};
/** A source's words in the language shown (a file's name stays as it is). */
const sourceLabel = (source: Source): string => (SOURCE[source].label.startsWith('more.') ? tNow(SOURCE[source].label as Key) : SOURCE[source].label);

/**
 * A project's Setup and Run commands, as a form: where each one comes from now, and whether to
 * keep yours to yourself or save them in the project's beluga.json for the whole team.
 */
export function ProjectSettingsSheet({ menu, close }: NativeMenuProps<'scripts'>) {
  const api = useApi();
  const t = useT();
  const project = useApp((st) => st.projects.find((p) => p.id === menu.projectId));
  const autoSetup = useApp((st) => st.prefs.autoSetup);
  const projectAgents = useApp((st) => st.prefs.projectAgents);
  const models = useApp((st) => st.models);
  const runtimes = useApp((st) => st.runtimes);
  const mine = useMyAgent();
  const scripts = project?.scripts ?? {};
  const [values, setValues] = useState<Record<Kind, string>>({ setup: scripts.setup?.command ?? '', run: scripts.run?.command ?? '' });
  const [team, setTeam] = useState(false);
  const [auto, setAuto] = useState(autoSetup);
  const [touched, setTouched] = useState(false);
  // '~': the same agent as yours (Settings); anything else is this project's own.
  const agentNow = project && projectAgents?.[project.name] ? choiceForAgent(projectAgents[project.name]) : '~';
  const [agent, setAgent] = useState(agentNow);
  // Until you type, the fields follow what's saved (it can arrive just after the sheet opens).
  const setupNow = scripts.setup?.command ?? '';
  const runNow = scripts.run?.command ?? '';
  useEffect(() => {
    if (!touched) setValues({ setup: setupNow, run: runNow });
  }, [setupNow, runNow]);
  if (!project) return null;

  const saved = (kind: Kind): string => scripts[kind]?.command ?? '';
  const edited = (kind: Kind): boolean => values[kind].trim() !== saved(kind);
  const tag = (kind: Kind) => {
    const s = scripts[kind];
    if (edited(kind)) return <SourceTag tone={team ? 'team' : 'mine'}>{team ? t('more.project.willGoTeam') : t('more.project.willBeYours')}</SourceTag>;
    return s ? (
      <span title={t(SOURCE[s.source].detail)}>
        <SourceTag tone={SOURCE[s.source].tone}>{sourceLabel(s.source)}</SourceTag>
      </span>
    ) : (
      <SourceTag tone="guess">{t('more.project.none')}</SourceTag>
    );
  };
  // Guessed values say so (once), so you check them.
  const hint = (kind: Kind, what: string) => (!edited(kind) && scripts[kind]?.source === 'detected' ? t('more.project.hintGuessed', { what }) : !edited(kind) && scripts[kind]?.source === 'claude' ? t('more.project.hintAgent', { what }) : what);
  const changed = edited('setup') || edited('run') || team || auto !== autoSetup || agent !== agentNow;

  const save = (): void => {
    for (const kind of ['setup', 'run'] as const) {
      const value = values[kind].trim();
      // Saving for the team writes both commands into beluga.json, or the older klaud.json it has (and drops your own ones).
      if (team && (value || scripts[kind])) void api.workbench.setScript(project.id, kind, value, true);
      else if (!team && edited(kind)) void api.workbench.setScript(project.id, kind, value);
    }
    if (auto !== autoSetup) void api.session.setPrefs({ autoSetup: auto });
    if (agent !== agentNow) {
      const { [project.name]: _, ...others } = projectAgents ?? {};
      void api.session.setPrefs({ projectAgents: agent === '~' ? others : { ...others, [project.name]: agentForChoice(agent, runtimes) } });
    }
    close();
  };

  return (
    <FormSheet
      title={t('more.project.title', { name: project.name })}
      icon="terminal"
      intro={t('more.project.intro')}
      submitLabel={t('more.project.save')}
      canSubmit={changed}
      onSubmit={save}
      onCancel={close}
      width={560}
      footer={<Checkbox checked={team} onChange={setTeam} label={t('more.project.saveTeam')} detail={t('more.project.saveTeamDetail')} />}
    >
      <Field label={t('more.project.setup')} htmlFor="script-setup" hint={hint('setup', t('more.project.setupHint'))} aside={tag('setup')}>
        <TextInput id="script-setup" value={values.setup} onChange={(v) => (setTouched(true), setValues({ ...values, setup: v }))} mono placeholder="npm install" />
      </Field>
      <Field label={t('more.project.run')} htmlFor="script-run" hint={hint('run', t('more.project.runHint'))} aside={tag('run')}>
        <TextInput id="script-run" value={values.run} onChange={(v) => (setTouched(true), setValues({ ...values, run: v }))} mono placeholder="npm run dev" />
      </Field>
      <Field label={t('more.project.agent')} htmlFor="project-agent" hint={t('more.project.agentHint')}>
        <Popup id="project-agent" value={agent} onChange={setAgent} options={[{ value: '~', label: t('more.project.sameAsYours', { agent: agentName(mine) }), icon: agentMark(mine) }, ...agentEntries(agentChoices(runtimes, models))]} />
      </Field>
      <Field label="">
        <Checkbox checked={auto} onChange={setAuto} label={t('more.project.autoSetup')} detail={t('more.project.autoSetupDetail')} />
      </Field>
    </FormSheet>
  );
}
