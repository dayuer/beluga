import { type MouseEvent, useState } from 'react';
import { type Issue, type Proof, STATUS_INFO, blocking, childrenOf, issueById, progressOf, taskFiles, taskProof } from '@beluga/core/board/model.js';
import { Thumb } from '../chat/ChatImages.js';
import { localImage } from '../chat/md-images.js';
import { GraphBlock } from '../components/graph/GraphBlock.js';
import { Icon } from '../components/Icon.js';
import { ActionsDropdown } from '../components/SpecMenu.js';
import { IconButton, Tip, cx } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { inApp, webServed } from '../lib/boot.js';
import { AssigneeMark, StatusIcon } from './marks.js';
import { ProofGone, ProofPreview, preloadReader } from './ProofPreview.js';
import { TaskPicker } from './pickers.js';
import { ago } from './tasks-model.js';
import { formatBytes } from '@beluga/shared/format.js';
import { useBoard, useSelfId, useSolo, useTaskActions } from './use-tasks.js';
import t from './tasks.module.css';
import { t as tNow, useT } from '../i18n/index.js';
import { primaryKey, primaryLabel } from '../lib/shortcuts-model.js';

/** A task page's lists: its sub-tasks, what waits on what, the files added for the work, and the proof that it works. */

function TaskLine({ issue, onRemove, removeLabel }: { issue: Issue; onRemove?: () => void; removeLabel?: string }) {
  const selfId = useSelfId();
  const solo = useSolo(issue.projectId);
  const { open } = useTaskActions();
  const tr = useT();
  return (
    <li className={t.line}>
      <button type="button" className={t.lineMain} onClick={() => open(issue)}>
        <StatusIcon status={issue.status} labelled />
        <span className={t.key}>{issue.key}</span>
        <span className={cx(t.lineTitle, !STATUS_INFO[issue.status].open && t.titleClosed)}>{issue.title}</span>
      </button>
      {solo ? null : <AssigneeMark assignee={issue.assignee} selfId={selfId} size={16} />}
      {onRemove ? <IconButton icon="x" label={removeLabel ?? tr('plans.outline.remove')} className={t.lineRemove} onClick={onRemove} /> : null}
    </li>
  );
}

export function SubTasks({ issue }: { issue: Issue }) {
  const board = useBoard();
  const { api, act } = useTaskActions();
  const kids = childrenOf(board, issue);
  const progress = progressOf(board, issue);
  const [title, setTitle] = useState('');
  const tr = useT();
  const add = async (): Promise<void> => {
    const text = title.trim();
    if (!text) return;
    if (await act(() => api.create({ projectId: issue.projectId, title: text, parent: issue.id, status: issue.status === 'backlog' ? 'backlog' : 'todo' }))) setTitle('');
  };
  return (
    <section className={t.block} aria-label={tr('tasks.sections.subTasks')}>
      <header className={t.blockHead}>
        <h3 className={t.sectionTitle}>{tr('tasks.sections.subTasks')}</h3>
        {progress.total ? (
          <span className={cx(t.sectionCount, progress.done === progress.total && t.sectionCountDone)}>
            {tr('tasks.sections.nOf', { done: progress.done, total: progress.total })}
          </span>
        ) : null}
      </header>
      {kids.length ? (
        <ul className={t.lines}>
          {kids.map((k) => (
            <TaskLine key={k.id} issue={k} onRemove={() => void act(() => api.update(k.id, { parent: null }))} removeLabel={tr('tasks.prop.unparent')} />
          ))}
        </ul>
      ) : null}
      <div className={t.addLine}>
        <Icon name="plus" size={12} />
        <input
          value={title}
          placeholder={tr('tasks.sections.addSubTask')}
          aria-label={tr('tasks.sections.newSubTask')}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            } else if (e.key === 'Escape') setTitle('');
          }}
        />
      </div>
    </section>
  );
}

/** Blocked by, blocks, related: each a list with + to add (a task picker) and ✕ to take back. */
export function Relations({ issue }: { issue: Issue }) {
  const board = useBoard();
  const { api, act } = useTaskActions();
  const blockers = issue.blockedBy.map((id) => issueById(board, id)).filter((i): i is Issue => Boolean(i));
  const waiting = blocking(board, issue);
  const related = issue.related.map((id) => issueById(board, id)).filter((i): i is Issue => Boolean(i));
  const others = board.issues.filter((i) => i.id !== issue.id);
  const tr = useT();
  const groups = [
    { rel: 'blocked_by' as const, title: tr('tasks.sections.blockedBy'), items: blockers, hint: tr('tasks.sections.blockedByHint') },
    { rel: 'blocks' as const, title: tr('tasks.sections.blocks'), items: waiting, hint: tr('tasks.sections.blocksHint') },
    { rel: 'related' as const, title: tr('tasks.sections.related'), items: related, hint: tr('tasks.sections.relatedHint') },
  ];
  return (
    <section className={t.block} aria-label={tr('tasks.sections.relations')}>
      <div className={t.relations}>
        {groups.map((g) => (
          <div key={g.rel} className={t.relation}>
            <header className={t.blockHead}>
              <h3 className={t.sectionTitle}>{g.title}</h3>
              <TaskPicker label={tr('tasks.sections.addTo', { title: g.title })} candidates={others.filter((o) => !g.items.some((x) => x.id === o.id))} onPick={(other) => void act(() => api.relate(issue.id, g.rel, other.id, true))} align="end">
                <IconButton icon="plus" label={tr('tasks.sections.addHint', { hint: g.hint })} />
              </TaskPicker>
            </header>
            {g.items.length ? (
              <ul className={t.lines}>
                {g.items.map((other) => (
                  <TaskLine key={other.id} issue={other} onRemove={() => void act(() => api.relate(issue.id, g.rel, other.id, false))} removeLabel={tr('tasks.sections.removeFrom', { title: g.title })} />
                ))}
              </ul>
            ) : (
              <div className={t.relationEmpty}>{g.hint}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Files for a task: the Open panel; in a page the web port served, the browser's picker, uploaded to the server. */
async function pickFiles(title: string, multiple = false, failed: (why: Error) => void = () => undefined): Promise<string[]> {
  if (!inApp()) {
    if (!webServed()) return [];
    const { chooseLocalFiles, uploadFiles } = await import('../lib/web-files.js');
    const sent = await uploadFiles(await chooseLocalFiles({ multiple }), (file, err) => failed(new Error(tNow('tasks.sections.couldntUpload', { name: file.name, error: err instanceof Error ? err.message : String(err) }))));
    return sent.map((u) => u.path);
  }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ multiple, title });
  return picked === null ? [] : Array.isArray(picked) ? picked : [picked];
}

const IMAGE = /\.(png|jpe?g|gif|webp|heic|svg)$/i;

/**
 * Files someone added for the work (dropped on the task, its card or its row, or picked with +):
 * Beluga keeps a copy, they open in place, and the Claude doing the task gets their paths.
 */
export function FilesList({ issue }: { issue: Issue }) {
  const { api, act } = useTaskActions();
  const files = taskFiles(issue);
  const tr = useT();
  const add = async (): Promise<void> => {
    for (const path of await pickFiles(tr('tasks.sections.addFilesTitle'), true, (why) => void act(() => Promise.reject(why)))) {
      const name = path.split('/').pop() ?? path;
      await act(() => api.addProof(issue.id, { kind: IMAGE.test(path) ? 'image' : 'file', title: name.slice(0, 120), path, context: true }));
    }
  };
  return (
    <section className={t.block} aria-label={tr('tasks.sections.files')}>
      <header className={t.blockHead}>
        <h3 className={t.sectionTitle}>{tr('tasks.sections.files')}</h3>
        {files.length ? <span className={t.sectionCount}>{files.length}</span> : null}
        <span className={t.grow} />
        {inApp() || webServed() ? <IconButton icon="plus" label={tr('tasks.sections.addFiles')} onClick={() => void add()} /> : null}
      </header>
      {files.length ? (
        <ProofItems issue={issue} items={files} />
      ) : (
        <div className={t.relationEmpty}>{inApp() || webServed() ? tr('tasks.sections.filesEmpty') : tr('tasks.sections.filesEmptyWeb')}</div>
      )}
    </section>
  );
}

/** Proof: screenshots, pages, files, graphs and results that show the work, people's and Claude's. */
export function ProofList({ issue }: { issue: Issue }) {
  const { api, act } = useTaskActions();
  const [link, setLink] = useState<string>();
  const tr = useT();
  const addFile = async (): Promise<void> => {
    const [path] = await pickFiles(tr('tasks.sections.addProofTitle'), false, (why) => void act(() => Promise.reject(why)));
    if (!path) return;
    const name = path.split('/').pop() ?? path;
    await act(() => api.addProof(issue.id, { kind: IMAGE.test(path) ? 'image' : 'file', title: name, path }));
  };
  const addLink = async (): Promise<void> => {
    const url = link?.trim();
    if (!url) return;
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    let title = full;
    try {
      title = new URL(full).hostname;
    } catch {
      return;
    }
    if (await act(() => api.addProof(issue.id, { kind: 'url', title, url: full }))) setLink(undefined);
  };
  return (
    <section className={t.block} aria-label={tr('plans.details.proof')}>
      <header className={t.blockHead}>
        <h3 className={t.sectionTitle}>{tr('plans.details.proof')}</h3>
        <span className={t.grow} />
        <ActionsDropdown
          items={[
            ...(inApp() || webServed() ? [{ label: tr('tasks.sections.pictureOrFile'), icon: 'image' as const, onSelect: () => void addFile() }] : []),
            { label: tr('tasks.sections.linkItem'), icon: 'link', onSelect: () => setLink('') },
          ]}
        >
          <IconButton icon="plus" label={tr('tasks.sections.addProof')} />
        </ActionsDropdown>
      </header>
      {link !== undefined ? (
        <div className={t.addLine}>
          <Icon name="link" size={12} />
          <input
            autoFocus
            value={link}
            placeholder="https://preview.example.com/checkout"
            aria-label={tr('tasks.sections.link')}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addLink();
              else if (e.key === 'Escape') setLink(undefined);
            }}
            onBlur={() => !link?.trim() && setLink(undefined)}
          />
        </div>
      ) : null}
      {taskProof(issue).length ? (
        <ProofItems issue={issue} />
      ) : link === undefined ? (
        <div className={t.relationEmpty}>{tr('tasks.sections.proofEmpty')}</div>
      ) : null}
    </section>
  );
}

/** A task's proof (or its files: `items`), newest first (on its page, and in a plan's task details). */
/** `readOnly`: shown elsewhere (a plan's details), so without a remove button. */
export function ProofItems({ issue, items = taskProof(issue), readOnly = false }: { issue: Issue; items?: readonly Proof[]; readOnly?: boolean }) {
  const { api, act } = useTaskActions();
  // A gone file isn't asked for (it would only fail): it shows as gone, and the lightbox skips it.
  const images = items.filter((p) => p.kind === 'image' && p.path && !p.gone).map((p) => localImage(p.path!, p.title));
  return (
    <div className={t.proof}>
      {items
        .slice()
        .reverse()
        .map((p) => (
          <ProofItem key={p.id} proof={p} images={images} onRemove={readOnly ? undefined : () => void act(() => api.removeProof(issue.id, p.id))} />
        ))}
    </div>
  );
}

function ProofItem({ proof, images, onRemove }: { proof: Proof; images: ReturnType<typeof localImage>[]; onRemove: (() => void) | undefined }) {
  const actions = useActions();
  const [preview, setPreview] = useState(false);
  const tr = useT();
  const by = `${proof.by.kind === 'claude' ? tr('plans.sheets.agent') : proof.by.kind === 'person' ? proof.by.name : 'Beluga'} · ${ago(proof.at)}`;
  const remove = onRemove ? <IconButton icon="x" label={tr('tasks.sections.removeItem', { title: proof.title })} className={t.proofRemove} onClick={onRemove} /> : null;
  if (proof.kind === 'graph' && proof.body) {
    return (
      <figure className={cx(t.proofItem, t.proofWide)}>
        <GraphBlock code={proof.body} localImages />
        <figcaption className={t.proofCaption}>
          <span>{by}</span>
          {remove}
        </figcaption>
      </figure>
    );
  }
  if ((proof.kind === 'image' || proof.kind === 'file') && proof.gone && (proof.path || proof.bytes !== undefined)) {
    // Let go when its task was archived (it says how big it was), or removed with its worktree before it was kept.
    const why = proof.bytes !== undefined ? tr('tasks.sections.letGoWhy', { size: formatBytes(proof.bytes) }) : tr('tasks.sections.removedWhy', { path: `${proof.from ?? proof.path}` });
    return (
      <figure className={proof.kind === 'image' ? t.proofItem : cx(t.proofItem, t.proofCard)}>
        {proof.kind === 'image' ? <ProofGone /> : null}
        <figcaption className={t.proofCaption}>
          <Tip label={why}>
            <span className={t.proofTitle}>{proof.kind === 'image' ? proof.title : `${proof.title} · ${proof.bytes !== undefined ? tr('tasks.sections.letGo') : tr('tasks.sections.gone')}`}</span>
          </Tip>
          {remove}
        </figcaption>
      </figure>
    );
  }
  if (proof.kind === 'image' && proof.path) {
    const index = images.findIndex((i) => i.local === proof.path);
    return (
      <figure className={t.proofItem}>
        <div className={t.proofPicture}>
          <Thumb image={images[index] ?? localImage(proof.path, proof.title)} all={images} index={Math.max(0, index)} tiled />
        </div>
        <figcaption className={t.proofCaption}>
          {proof.thumb ? (
            <Tip label={tr('tasks.sections.keptSmallWhy', { size: formatBytes(proof.bytes ?? 0) })}>
              <span className={t.proofTitle}>{proof.title} · {tr('tasks.sections.keptSmall')}</span>
            </Tip>
          ) : (
            <span className={t.proofTitle}>{proof.title}</span>
          )}
          {remove}
        </figcaption>
      </figure>
    );
  }
  if (proof.kind === 'text') {
    return (
      <figure className={cx(t.proofItem, t.proofWide)}>
        <pre className={t.proofText}>{proof.body}</pre>
        <figcaption className={t.proofCaption}>
          <span className={t.proofTitle}>{proof.title}</span>
          <span>{by}</span>
          {remove}
        </figcaption>
      </figure>
    );
  }
  const url = proof.url;
  const path = proof.path;
  // A file opens over this page at once; ⌘-click shows it in the Files view (as it used to).
  const open = (e: MouseEvent): void => {
    if (url) actions.openLink({ kind: 'url', url });
    else if (path && primaryKey(e)) actions.openLink({ kind: 'local', path, dir: false });
    else if (path) setPreview(true);
  };
  return (
    <figure className={cx(t.proofItem, t.proofCard)}>
      {preview && path ? <ProofPreview proof={{ ...proof, path }} onClose={() => setPreview(false)} /> : null}
      <Tip label={url ?? (path ? tr('tasks.sections.clickToShow', { path, key: primaryLabel() }) : proof.title)}>
        <button type="button" className={t.proofLink} onClick={open} onPointerEnter={path && !url ? preloadReader : undefined}>
          <Icon name={url ? 'globe' : 'file'} size={14} />
          <span className={t.proofTitle}>{proof.title}</span>
        </button>
      </Tip>
      <figcaption className={t.proofCaption}>
        <span>{by}</span>
        {remove}
      </figcaption>
    </figure>
  );
}
