import { useLayoutEffect, useRef, useState } from 'react';
import type { Issue } from '@beluga/core/board/model.js';
import { Checkbox } from '../components/Alert.js';
import { Icon, type IconName } from '../components/Icon.js';
import { Segmented, Tip, cx } from '../components/ui.js';
import { usePrefs } from '../lib/prefs.js';
import { chordLabel } from '../lib/shortcuts-model.js';
import { useIssueActions } from './use-issues.js';
import h from '../views/project-home.module.css';
import d from '../chat/draft.module.css';
import s from './issues.module.css';
import { t, useT } from '../i18n/index.js';

/**
 * Handing an issue to Claude, the way a project's home starts work: pick what Claude does
 * (Investigate, Fix It, Make a Task), say anything it should know if you like, and go. One box,
 * one button, and a line that says what happens; Make a Task can look at the code first.
 */

type Way = 'investigate' | 'fix' | 'task';

interface WayInfo {
  readonly label: string;
  readonly icon: IconName;
  readonly hint: string;
  readonly placeholder: string;
  /** What happens, in the box's bar. */
  readonly what: (n: number) => string;
  readonly whatIcon: IconName;
  readonly go: string;
}

const WAYS: Readonly<Record<Way, WayInfo>> = {
  investigate: {
    get label() { return t('issues.parts.investigate'); },
    icon: 'search',
    get hint() { return t('issues.composer.investigateHint'); },
    get placeholder() { return t('issues.composer.investigatePlaceholder'); },
    what: () => t('issues.composer.investigateWhat'),
    whatIcon: 'branch',
    get go() { return t('issues.parts.investigate'); },
  },
  fix: {
    get label() { return t('issues.parts.fixIt'); },
    icon: 'wrench',
    get hint() { return t('issues.composer.fixHint'); },
    get placeholder() { return t('issues.composer.fixPlaceholder'); },
    what: (n) => t('issues.composer.fixWhat', { n }),
    whatIcon: 'pr',
    get go() { return t('issues.parts.fixIt'); },
  },
  task: {
    get label() { return t('issues.parts.makeTask'); },
    icon: 'task',
    get hint() { return t('issues.composer.taskHint'); },
    get placeholder() { return t('issues.composer.taskPlaceholder'); },
    what: () => t('issues.composer.taskWhat'),
    whatIcon: 'task',
    get go() { return t('issues.composer.taskGo'); },
  },
};

export function IssueComposer({ projectId, number, task }: { projectId: string; number: number; task?: Issue }) {
  const a = useIssueActions();
  useT();
  const prefs = usePrefs();
  const ways: readonly Way[] = task ? ['investigate', 'fix'] : ['investigate', 'fix', 'task'];
  const [way, setWay] = useState<Way>('investigate');
  const [note, setNote] = useState('');
  const [look, setLook] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const shown = ways.includes(way) ? way : 'investigate';
  const info = WAYS[shown];
  // Claude still writing the task (Make a Task): working on it waits for its words, so not yet.
  const writing = Boolean(task?.drafting);
  const ready = !busy && !writing;
  const sendKeys = prefs.sendWith === 'enter' ? '↩' : chordLabel('Cmd+Enter');

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 8 * 20 + 20)}px`;
  }, [note]);

  const go = async (): Promise<void> => {
    if (!ready) return;
    setBusy(true);
    const done = shown === 'investigate' ? await a.investigate(projectId, number, note) : shown === 'fix' ? await a.fix(projectId, number, note) : await a.toTask(projectId, number, look, note);
    setBusy(false);
    if (done) setNote('');
  };

  return (
    <section className={cx(h.composer, s.composer)} aria-label={t('issues.composer.hand', { n: number })}>
      <div className={h.composerHead}>
        <h2 className={cx(h.prompt, s.composerPrompt)}>{task ? t('issues.composer.onBoard', { key: task.key }) : t('issues.composer.whatShould')}</h2>
        <Segmented<Way>
          label={t('issues.composer.whatDoes')}
          value={shown}
          onChange={(w) => {
            setWay(w);
            box.current?.focus();
          }}
          options={ways.map((w) => ({ value: w, label: WAYS[w].label, icon: WAYS[w].icon, hint: WAYS[w].hint }))}
        />
      </div>
      <div className={cx(h.box, busy && h.busy)}>
        <textarea
          ref={box}
          className={cx(h.input, s.composerInput, 'selectable')}
          aria-label={t('issues.composer.note')}
          placeholder={info.placeholder}
          value={note}
          rows={2}
          spellCheck
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.key !== 'Enter') return;
            const modKey = e.metaKey || e.ctrlKey;
            if (prefs.sendWith === 'enter' ? e.shiftKey || modKey : !modKey) return;
            e.preventDefault();
            void go();
          }}
        />
        <div className={h.bar}>
          <span className={h.note}>
            <Icon name={writing ? 'pencil' : info.whatIcon} size={12} />
            {writing ? t('issues.composer.stillWriting', { key: task!.key }) : info.what(number)}
          </span>
          <span className={h.flex} />
          {shown === 'task' ? (
            <span className={s.composerCheck}>
              <Checkbox checked={look} onChange={setLook} label={t('issues.composer.lookFirst')} />
            </span>
          ) : null}
          <Tip label={shown === 'task' && look ? t('issues.composer.lookHint') : info.hint} keys={sendKeys}>
            <button type="button" className={cx(d.create, ready && d.createReady)} aria-disabled={!ready} onClick={() => void go()} data-testid="issue-go">
              <Icon name={info.icon} size={12} />
              {busy ? t('issues.composer.starting') : info.go}
              <span className={d.createKey}>{sendKeys}</span>
            </button>
          </Tip>
        </div>
      </div>
    </section>
  );
}
