import { baseName, isAbsolutePath, joinPath } from '@beluga/shared/os-path.js';
import { type ReactNode, lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Location } from '@beluga/core/store.js';
import type { StepRecord } from '@beluga/shared/steps.js';
import { toolFamily } from '@beluga/shared/steps.js';
import { stripAnsi } from '@beluga/shared/ansi.js';
import { addedLines, editDiff } from '@beluga/shared/line-diff.js';
import type { DiffLine } from '@beluga/shared/diff-lines.js';
import { Icon } from '../../components/Icon.js';
import { cx } from '../../components/ui.js';
import { copyText } from '../../lib/copy.js';
import { useActions } from '../../lib/actions.js';
import { toast, useApi, useBeluga } from '../../lib/beluga.js';
import { Thumb } from '../ChatImages.js';
import { imageSource, localImage } from '../md-images.js';
import { isPdfFile } from '../../views/reader/reader-model.js';
import { UnifiedDiff } from '../../views/DiffView.js';
import { Markdown } from '../Markdown.js';
import { AnsiText } from './AnsiText.js';
import { t as tr } from '../../i18n/index.js';
import s from './steps.module.css';

/**
 * What an opened step shows, by kind of tool: Bash's command and output (as the terminal
 * coloured it), the file Read and the lines it read, an edit's diff, a search's pattern and
 * matches, a page fetched, a sub-agent's task and answer, any other tool's input and output as
 * JSON, and Claude's thinking.
 */

/** Notes Claude Code adds to tool results for Claude, not for you. */
const REMINDERS = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const tidy = (out: string | undefined): string => (out ?? '').replace(REMINDERS, '').replace(/\s+$/, '');
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function useCopy(): (text: string, what: string) => void {
  const { client } = useBeluga();
  return (text, what) => void copyText(text).then(() => toast(client, tr('chat.messageMenu.copied', { what }), 'success'));
}

/** A box that stops growing at its height, with "Show all" when there's more. */
function Capped({ children, tall = false, fade = false, label }: { children: ReactNode; tall?: boolean; fade?: boolean; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [all, setAll] = useState(false);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setOver(el.scrollHeight > el.clientHeight + 4);
  });
  return (
    <div className={s.cappedWrap}>
      <div ref={ref} className={cx(s.capped, tall && s.cappedTall, all && s.cappedAll, fade && over && !all && s.cappedFade)}>
        {children}
      </div>
      {over || all ? (
        <button type="button" className={s.showAll} onClick={() => setAll(!all)}>
          {all ? tr('chat.items.showLess') : (label ?? tr('chat.items.showAll'))}
        </button>
      ) : null}
    </div>
  );
}

function Section({ label, copy, children, tone }: { label: string; copy?: { text: string; what: string }; children: ReactNode; tone?: 'error' }) {
  const doCopy = useCopy();
  return (
    <div className={cx(s.section, tone === 'error' && s.sectionError)}>
      <div className={s.sectionHead}>
        <span>{label}</span>
        {copy ? (
          <button type="button" className={s.copy} onClick={() => doCopy(copy.text, copy.what)} aria-label={tr('chat.stepDetail.copyWhat', { what: copy.what })}>
            <Icon name="copy" size={11} />
            {tr('chat.items.copy')}
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** A file path you can click to open it in the Files panel. */
function PathLink({ path, line }: { path: string; line?: number }) {
  const actions = useActions();
  if (!path) return null;
  return (
    <button type="button" className={s.path} title={tr('chat.messageMenu.open', { name: path })} onClick={() => actions.openLink({ kind: 'local', path, dir: false, ...(line ? { line } : {}) })}>
      <Icon name="file" size={11} />
      <span>{path}</span>
    </button>
  );
}

function Output({ record, label, ansi = true }: { record: StepRecord; label?: string; ansi?: boolean }) {
  const out = tidy(record.output);
  if (record.status === 'running' && !out) return <div className={s.waiting}>{tr('chat.stepDetail.waitingResult')}</div>;
  return (
    <Section label={record.isError ? tr('chat.stepDetail.failed') : (label ?? tr('chat.stepDetail.output'))} copy={out ? { text: stripAnsi(out), what: tr('chat.items.theOutput') } : undefined} tone={record.isError ? 'error' : undefined}>
      {out ? (
        <Capped>
          <pre className={cx(s.term, 'selectable')}>{ansi ? <AnsiText text={out} /> : out}</pre>
        </Capped>
      ) : (
        <div className={s.quiet}>{tr('chat.stepDetail.noOutput')}</div>
      )}
    </Section>
  );
}

function BashDetail({ record }: { record: StepRecord }) {
  const input = record.input ?? {};
  const command = str(input.command);
  return (
    <>
      <Section label={str(input.description) || tr('chat.stepDetail.command')} copy={command ? { text: command, what: tr('chat.items.theCommand') } : undefined}>
        <pre className={cx(s.command, 'selectable')}>
          <span className={s.prompt}>$ </span>
          {command || record.title}
        </pre>
        {input.run_in_background === true ? <div className={s.quiet}>{tr('chat.stepDetail.background')}</div> : null}
      </Section>
      <Output record={record} />
    </>
  );
}

const PdfView = lazy(() => import('../../views/reader/PdfView.js').then((m) => ({ default: m.PdfView })));

/** A PDF on this Mac, drawn small (it opens in full from its path above). */
function LocalPdf({ path }: { path: string }) {
  const api = useApi();
  const [at, setAt] = useState<Location>();
  useEffect(() => {
    let alive = true;
    api.session.localLocation(path, false).then((l) => alive && setAt(l), () => undefined);
    return () => {
      alive = false;
    };
  }, [path]);
  return <div className={s.pdfPeek}>{at ? <Suspense fallback={null}><PdfView at={at} controls={false} /></Suspense> : null}</div>;
}

/** What Claude looked at, when it's a picture or a PDF: the thing itself (its "lines" are just "[image]"). */
function Seen({ file }: { file: string }) {
  const src = imageSource(file);
  const name = baseName(file) || file;
  if (src.kind === 'local') {
    const image = localImage(src.path, name);
    return (
      <Section label={tr('chat.mention.image')}>
        <div className={s.seen}>
          <Thumb image={image} all={[image]} index={0} tiled={false} />
        </div>
      </Section>
    );
  }
  if (isAbsolutePath(file) && isPdfFile(file)) {
    return (
      <Section label="PDF">
        <LocalPdf path={file} />
      </Section>
    );
  }
  return null;
}

function ReadDetail({ record }: { record: StepRecord }) {
  const input = record.input ?? {};
  const file = str(input.file_path) || str(input.notebook_path);
  const from = typeof input.offset === 'number' ? input.offset : undefined;
  const count = typeof input.limit === 'number' ? input.limit : undefined;
  return (
    <>
      <div className={s.pathRow}>
        <PathLink path={file} {...(from ? { line: from } : {})} />
        {from || count ? <span className={s.quiet}>{from ? `from line ${from}` : ''}{from && count ? ', ' : ''}{count ? `${count} lines` : ''}</span> : null}
      </div>
      {isAbsolutePath(file) && (imageSource(file).kind === 'local' || isPdfFile(file)) && !record.isError ? <Seen file={file} /> : <Output record={record} label={tr('chat.stepDetail.linesRead')} ansi={false} />}
    </>
  );
}

function diffOf(record: StepRecord): DiffLine[] {
  const input = record.input ?? {};
  if (record.tool === 'Write') return addedLines(str(input.content));
  if (record.tool === 'NotebookEdit') return addedLines(str(input.new_source));
  if (record.tool === 'MultiEdit' && Array.isArray(input.edits)) {
    return (input.edits as Array<Record<string, unknown>>).flatMap((e, i) => [...(i ? [{ kind: 'hunk' as const, text: tr('chat.stepDetail.editN', { n: i + 1 }) }] : []), ...editDiff(str(e.old_string), str(e.new_string))]);
  }
  return editDiff(str(input.old_string), str(input.new_string));
}

function EditDetail({ record }: { record: StepRecord }) {
  const input = record.input ?? {};
  const file = str(input.file_path) || str(input.notebook_path);
  const lines = useMemo(() => diffOf(record), [record]);
  const added = lines.filter((l) => l.kind === 'add').length;
  const removed = lines.filter((l) => l.kind === 'del').length;
  return (
    <>
      <div className={s.pathRow}>
        <PathLink path={file} />
        <span className={s.counts}>
          {added ? <span className={s.add}>+{added}</span> : null}
          {removed ? <span className={s.del}>−{removed}</span> : null}
        </span>
      </div>
      {lines.length ? (
        <Capped>
          <div className={cx(s.diff, 'selectable')}>
            <UnifiedDiff lines={lines} compact />
          </div>
        </Capped>
      ) : null}
      {record.isError ? <Output record={record} /> : record.status === 'running' ? <div className={s.waiting}>{tr('chat.stepDetail.applying')}</div> : null}
    </>
  );
}

/** A search's matches: lines that start with a path open that file. */
function Matches({ text, base }: { text: string; base?: string }) {
  const lines = text.split('\n').filter(Boolean);
  return (
    <div className={cx(s.matches, 'selectable')}>
      {lines.slice(0, 500).map((line, i) => {
        const m = /^((?:[A-Za-z]:[\\/]|\/|[\w.@-]+[\\/])[^\s:]*[^\s:\\/])(?::(\d+))?(?::(.*))?$/.exec(line);
        const p = m?.[1];
        const abs = p ? (isAbsolutePath(p) ? p : base ? joinPath(base, p) : undefined) : undefined;
        if (!m || !abs) return <div key={i}>{line}</div>;
        return (
          <div key={i} className={s.match}>
            <PathLink path={abs} {...(m[2] ? { line: Number(m[2]) } : {})} />
            {m[2] ? <span className={s.quiet}>:{m[2]}</span> : null}
            {m[3] !== undefined ? <span className={s.matchText}>{m[3]}</span> : null}
          </div>
        );
      })}
      {lines.length > 500 ? <div className={s.quiet}>…and {lines.length - 500} more</div> : null}
    </div>
  );
}

function SearchDetail({ record }: { record: StepRecord }) {
  const input = record.input ?? {};
  const where = str(input.path);
  const out = tidy(record.output);
  return (
    <>
      <Section label={record.tool === 'Glob' ? tr('chat.stepDetail.filesMatching') : record.tool === 'LS' ? tr('chat.mention.folder') : tr('chat.stepDetail.pattern')}>
        <pre className={cx(s.command, 'selectable')}>
          {str(input.pattern) || where}
          {input.glob ? <span className={s.quiet}> in {str(input.glob)}</span> : null}
          {where && input.pattern ? <span className={s.quiet}> in {where}</span> : null}
        </pre>
      </Section>
      {record.status === 'running' && !out ? (
        <div className={s.waiting}>{tr('chat.stepDetail.searching')}</div>
      ) : (
        <Section label={record.isError ? tr('chat.stepDetail.failed') : tr('chat.stepDetail.matches')} tone={record.isError ? 'error' : undefined}>
          {out ? (
            <Capped>
              <Matches text={out} {...(isAbsolutePath(where) ? { base: where } : {})} />
            </Capped>
          ) : (
            <div className={s.quiet}>{tr('chat.find.none')}</div>
          )}
        </Section>
      )}
    </>
  );
}

function WebDetail({ record }: { record: StepRecord }) {
  const input = record.input ?? {};
  const actions = useActions();
  const url = str(input.url);
  const out = tidy(record.output);
  return (
    <>
      <div className={s.pathRow}>
        {url ? (
          <button type="button" className={s.path} onClick={() => actions.openLink({ kind: 'url', url })}>
            <Icon name="globe" size={11} />
            <span>{url}</span>
          </button>
        ) : (
          <span className={s.query}>“{str(input.query)}”</span>
        )}
      </div>
      {str(input.prompt) ? <div className={s.quiet}>{str(input.prompt)}</div> : null}
      {record.status === 'running' && !out ? (
        <div className={s.waiting}>{tr('chat.stepDetail.fetching')}</div>
      ) : (
        <Section label={record.isError ? tr('chat.stepDetail.failed') : tr('chat.stepDetail.result')} tone={record.isError ? 'error' : undefined}>
          <Capped>
            <div className={s.prose}>{out ? <Markdown text={out} /> : <span className={s.quiet}>{tr('chat.stepDetail.nothingBack')}</span>}</div>
          </Capped>
        </Section>
      )}
    </>
  );
}

function AgentDetail({ record }: { record: StepRecord }) {
  const input = record.input ?? {};
  const out = tidy(record.output);
  return (
    <>
      {str(input.prompt) ? (
        <Section label={str(input.subagent_type) ? tr('chat.stepDetail.taskFor', { type: str(input.subagent_type) }) : tr('chat.composer.askingTask')}>
          <Capped fade>
            <div className={s.prose}>
              <Markdown text={str(input.prompt)} />
            </div>
          </Capped>
        </Section>
      ) : null}
      {out ? (
        <Section label={record.isError ? tr('chat.stepDetail.failed') : tr('chat.stepDetail.itsAnswer')} tone={record.isError ? 'error' : undefined}>
          <Capped fade>
            <div className={s.prose}>
              <Markdown text={out} />
            </div>
          </Capped>
        </Section>
      ) : record.status === 'running' ? (
        <div className={s.waiting}>{tr('chat.stepDetail.working')}</div>
      ) : null}
    </>
  );
}

/** A message to another session (SendMessage): to whom, and what it said. */
function MessageDetail({ record }: { record: StepRecord }) {
  const input = record.input ?? {};
  const words = str(input.message) || str(input.content);
  return (
    <>
      {str(input.summary) ? <div className={s.quiet}>{str(input.summary)}</div> : null}
      <Section label={tr('chat.stepDetail.message')} copy={words ? { text: words, what: tr('chat.messageMenu.theMessage') } : undefined}>
        <Capped fade>
          <div className={s.prose}>{words ? <Markdown text={words} /> : <span className={s.quiet}>{tr('chat.stepDetail.empty')}</span>}</div>
        </Capped>
      </Section>
      {record.isError ? <Output record={record} /> : null}
    </>
  );
}

function TodoDetail({ record }: { record: StepRecord }) {
  const todos = Array.isArray(record.input?.todos) ? (record.input.todos as Array<Record<string, unknown>>) : [];
  if (!todos.length) return <JsonDetail record={record} />;
  return (
    <ul className={s.todos}>
      {todos.map((t, i) => (
        <li key={i} className={cx(t.status === 'completed' && s.todoDone)}>
          <Icon name={t.status === 'completed' ? 'check' : t.status === 'in_progress' ? 'chevronRight' : 'minus'} size={11} />
          {str(t.content) || str(t.activeForm)}
        </li>
      ))}
    </ul>
  );
}

const pretty = (v: unknown): string => JSON.stringify(v, null, 2);
function prettyText(text: string): string {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return text;
  try {
    return pretty(JSON.parse(t));
  } catch {
    return text;
  }
}

function JsonDetail({ record }: { record: StepRecord }) {
  const input = record.input ?? {};
  const json = pretty(input);
  const out = tidy(record.output);
  return (
    <>
      <div className={s.quiet}>{record.tool}</div>
      {Object.keys(input).length ? (
        <Section label={tr('chat.stepDetail.input')} copy={{ text: json, what: tr('chat.stepDetail.theInput') }}>
          <Capped>
            <pre className={cx(s.json, 'selectable')}>{json}</pre>
          </Capped>
        </Section>
      ) : null}
      {record.status === 'running' && !out ? (
        <div className={s.waiting}>{tr('chat.stepDetail.waitingResult')}</div>
      ) : (
        <Section label={record.isError ? tr('chat.stepDetail.failed') : tr('chat.stepDetail.output')} copy={out ? { text: out, what: tr('chat.items.theOutput') } : undefined} tone={record.isError ? 'error' : undefined}>
          {out ? (
            <Capped>
              <pre className={cx(s.json, 'selectable')}>{prettyText(out)}</pre>
            </Capped>
          ) : (
            <div className={s.quiet}>{tr('chat.stepDetail.noOutput')}</div>
          )}
        </Section>
      )}
    </>
  );
}

export function ThinkingDetail({ record }: { record: StepRecord }) {
  if (!record.text) return <div className={s.quiet}>{tr('chat.stepDetail.noThoughts')}</div>;
  return (
    <Capped fade label={tr('chat.stepDetail.showMore')}>
      <div className={s.thought}>
        <Markdown text={record.text} />
      </div>
    </Capped>
  );
}

export function StepDetail({ record }: { record: StepRecord }) {
  const body = (() => {
    if (record.kind === 'thinking') return <ThinkingDetail record={record} />;
    switch (toolFamily(record.tool)) {
      case 'bash':
        return <BashDetail record={record} />;
      case 'read':
        return <ReadDetail record={record} />;
      case 'edit':
        return <EditDetail record={record} />;
      case 'search':
        return <SearchDetail record={record} />;
      case 'web':
        return <WebDetail record={record} />;
      case 'agent':
        return <AgentDetail record={record} />;
      case 'message':
        return <MessageDetail record={record} />;
      case 'todo':
        return <TodoDetail record={record} />;
      default:
        return <JsonDetail record={record} />;
    }
  })();
  return (
    <div className={s.detail} data-step-detail={record.kind === 'thinking' ? 'thinking' : toolFamily(record.tool)}>
      {body}
      {record.truncated ? <div className={s.note}>{tr('chat.stepDetail.truncated')}</div> : null}
    </div>
  );
}
