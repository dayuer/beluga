import { useEffect, useState } from 'react';
import { type ArgsRuntime, MAX_AGENT_ARGS, agentArgsProblem } from '@beluga/shared/agent-args.js';
import { joinArgs, splitArgs } from '@beluga/shared/shells.js';
import { cx } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { Group, Row } from './settings-controls.js';
import s from './settings.module.css';
import t from './terminal-settings.module.css';
import { type Key, useT } from '../i18n/index.js';

const FLAGS: ReadonlyArray<{ readonly runtime: ArgsRuntime; readonly field: 'claudeArgs' | 'codexArgs'; readonly label: string; readonly example: string; readonly detail: Key }> = [
  { runtime: 'claude', field: 'claudeArgs', label: 'Claude Code', example: '--dangerously-skip-permissions', detail: 'settings.flags.claudeDetail' },
  { runtime: 'codex', field: 'codexArgs', label: 'Codex', example: '-c key=value', detail: 'settings.flags.codexDetail' },
];

/**
 * Settings › Agents › Launch flags: your own flags for `claude` and `codex`, as you'd type them in
 * Terminal. Only your own runs get them, never a friend's; Beluga's rules (secrets, a friend's
 * trust) still come first.
 */
export function LaunchFlagsSettings() {
  const tr = useT();
  return (
    <Group title={tr('settings.flags.title')}>
      {FLAGS.map((f) => (
        <FlagsRow key={f.runtime} {...f} />
      ))}
    </Group>
  );
}

function FlagsRow({ runtime, field, label, example, detail }: (typeof FLAGS)[number]) {
  const api = useApi();
  const saved = useApp((st) => st.prefs[field]);
  const tr = useT();
  const [text, setText] = useState(joinArgs(saved));
  useEffect(() => setText(joinArgs(saved)), [saved]);
  const args = splitArgs(text).slice(0, MAX_AGENT_ARGS);
  const problem = agentArgsProblem(runtime, args);
  const save = (): void => {
    if (!problem && joinArgs(args) !== joinArgs(saved)) void api.session.setPrefs({ [field]: args });
  };
  return (
    <Row label={label} detail={problem ?? tr('settings.flags.detail', { detail: tr(detail) })}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input className={cx(s.text, t.mono)} aria-label={tr('settings.flags.aria', { label })} aria-invalid={Boolean(problem)} value={text} placeholder={example} spellCheck={false} onChange={(e) => setText(e.target.value)} onBlur={save} />
      </form>
    </Row>
  );
}
