import * as Popover from '@radix-ui/react-popover';
import { type ReactNode, useRef } from 'react';
import type { AppState } from '@beluga/core/store.js';
import { findWorkspace } from '@beluga/ui/workspace-models.js';
import type { Workspace } from '@beluga/workspaces/types.js';
import { Alert } from '../../components/Alert.js';
import { Icon, type IconName } from '../../components/Icon.js';
import { Button } from '../../components/ui.js';
import { useApi, useApp } from '../../lib/beluga.js';
import type { AskedWork } from '../../lib/work-confirm.js';
import { MergeReview } from './MergeReview.js';
import s from './work-confirm.module.css';
import { primaryKey } from '../../lib/shortcuts-model.js';
import { rich } from './pick.js';
import { t, useT } from '../../i18n/index.js';

/**
 * Before a workspace action that starts Claude working or changes git: what will happen, in a
 * sentence or two, then Start / Cancel. Anchored to its toolbar button when that's on screen
 * (a popover, as Safari's and Xcode's toolbar items do); otherwise a small alert.
 */

interface Words {
  readonly title: string;
  readonly message: ReactNode;
  readonly confirm: string;
  readonly icon: IconName;
}

/** What each action does, in this workspace's terms. */
export function wordsFor(state: AppState, ws: Workspace, action: AskedWork): Words {
  const project = state.projects.find((p) => p.id === ws.projectId);
  const branch = ws.branch ?? ws.name;
  const changed = ws.status?.changed ?? 0;
  const ahead = ws.status?.ahead ?? 0;
  switch (action) {
    case 'review_claude':
      return {
        title: t('dialogs.work.reviewTitle'),
        message: (
          <>
            <p>{t('dialogs.work.reviewMessage')}</p>
            <p className={s.quiet}>{t('dialogs.work.reviewQuiet')}</p>
          </>
        ),
        confirm: t('dialogs.work.reviewConfirm'),
        icon: 'review',
      };
    case 'commit':
      return {
        title: t('dialogs.work.commitTitle'),
        message: (
          <p>{rich(t('dialogs.work.commitMessage', { count: t('dialogs.n.changedFile', { n: changed }) }), { branch: <strong>{branch}</strong> })}</p>
        ),
        confirm: t('dialogs.work.commitConfirm'),
        icon: 'commit',
      };
    case 'merge':
      return {
        title: t('dialogs.work.mergeTitle', { project: project?.name ?? t('dialogs.work.theProject') }),
        message: (
          <p>{rich(t('dialogs.work.mergeMessage', { count: t('dialogs.n.commit', { n: ahead }) }), { branch: <strong>{branch}</strong> })}</p>
        ),
        confirm: t('dialogs.work.mergeConfirm'),
        icon: 'merge',
      };
    case 'merge_claude': {
      const files = state.conflicts[ws.id]?.length ?? 0;
      return {
        title: t('dialogs.work.solveTitle'),
        message: <p>{t('dialogs.work.solveMessage', { branch, files: files ? t('dialogs.work.solveIn', { count: t('dialogs.n.file', { n: files }) }) : '' })}</p>,
        confirm: t('dialogs.work.solveConfirm'),
        icon: 'merge',
      };
    }
    case 'compact':
      return {
        title: t('dialogs.work.compactTitle'),
        message: <p>{t('dialogs.work.compactMessage')}</p>,
        confirm: t('dialogs.work.compactConfirm'),
        icon: 'gauge',
      };
    case 'fix_checks': {
      const pr = state.prs[ws.id];
      return {
        title: t('dialogs.work.fixTitle'),
        message: <p>{t('dialogs.work.fixMessage', { pr: pr ? t('dialogs.work.prChecks', { number: pr.number }) : t('dialogs.work.thePrChecks') })}</p>,
        confirm: t('dialogs.work.fixConfirm'),
        icon: 'wand',
      };
    }
    case 'resolve_pr': {
      const pr = state.prs[ws.id];
      return {
        title: t('dialogs.work.resolveTitle'),
        message: (
          <>
            <p>{rich(t('dialogs.work.resolveMessage', { pr: pr ? t('dialogs.work.prNumber', { number: pr.number }) : t('dialogs.work.thePr') }), { branch: <strong>{branch}</strong> })}</p>
            <p className={s.quiet}>{t('dialogs.work.resolveQuiet')}</p>
          </>
        ),
        confirm: t('dialogs.work.resolveConfirm'),
        icon: 'merge',
      };
    }
    case 'continue_after_merge': {
      const pr = state.prs[ws.id];
      return {
        title: t('dialogs.work.continueTitle'),
        message: (
          <>
            <p>{rich(t('dialogs.work.continueMessage', { pr: pr ? t('dialogs.work.prNumber', { number: pr.number }) : t('dialogs.work.thePr') }), { branch: <strong>{branch}</strong> })}</p>
            <p className={s.quiet}>{t('dialogs.work.continueQuiet')}</p>
          </>
        ),
        confirm: t('dialogs.work.continueConfirm'),
        icon: 'branch',
      };
    }
  }
}

/** Do it (the confirmation was the asking). */
export function startWork(api: ReturnType<typeof useApi>, wsId: string, action: AskedWork): void {
  const w = api.workspaces;
  switch (action) {
    case 'review_claude':
      return void w.askClaudeToReview(wsId);
    case 'commit':
      return void w.commit(wsId);
    case 'merge':
      return void w.merge(wsId);
    case 'merge_claude':
      return void w.askClaudeToMerge(wsId);
    case 'compact':
      return void w.compact(wsId);
    case 'fix_checks':
      return void api.workbench.fixChecks(wsId);
    case 'resolve_pr':
      return void api.workbench.resolvePrConflicts(wsId);
    case 'continue_after_merge':
      return void api.workbench.continueAfterMerge(wsId);
  }
}

/** The toolbar button for this action in this workspace, else its ⋯ (where the action is), if on screen. */
function toolbarButton(wsId: string, action: AskedWork): HTMLElement | null {
  const find = (tool: string): HTMLElement | null => {
    const el = document.querySelector<HTMLElement>(`[data-tool="${tool}"][data-tool-ws="${CSS.escape(wsId)}"]`);
    return el && el.getClientRects().length ? el : null;
  };
  return find(action) ?? find('more');
}

export function WorkConfirm({ wsId, action, close }: { wsId: string; action: AskedWork; close: () => void }) {
  const t = useT();
  const api = useApi();
  const state = useApp((st) => st);
  const ws = findWorkspace(state.projects, wsId);
  const start = useRef<HTMLButtonElement>(null);
  if (!ws) return null;
  // Merging gets a closer look: where it goes, what comes along, and what would stop it.
  if (action === 'merge') return <MergeReview ws={ws} anchor={toolbarButton(ws.id, action)} close={close} />;
  const words = wordsFor(state, ws, action);
  const go = (): void => {
    close();
    startWork(api, ws.id, action);
  };
  const anchor = toolbarButton(ws.id, action);
  if (!anchor) return <Alert icon={words.icon} tone="info" title={words.title} message={words.message} confirm={{ label: words.confirm, onClick: go }} onCancel={close} />;
  return (
    <Popover.Root open onOpenChange={(open) => (open ? undefined : close())}>
      <Popover.Anchor virtualRef={{ current: anchor }} />
      <Popover.Portal>
        <Popover.Content
          className={s.popover}
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          aria-label={words.title}
          onOpenAutoFocus={(e) => (e.preventDefault(), start.current?.focus())}
          // Its own button pressed again closes it (see askBeforeWork), instead of closing and reopening.
          onPointerDownOutside={(e) => (anchor.contains(e.target as Node) ? e.preventDefault() : undefined)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || primaryKey(e) || e.shiftKey) return;
            if ((e.target as HTMLElement).tagName === 'BUTTON' && e.target !== start.current) return;
            e.preventDefault();
            go();
          }}
        >
          <div className={s.head}>
            <span className={s.icon} aria-hidden="true">
              <Icon name={words.icon} size={16} />
            </span>
            <Popover.Title className={s.title}>{words.title}</Popover.Title>
          </div>
          <Popover.Description asChild>
            <div className={s.message}>{words.message}</div>
          </Popover.Description>
          <div className={s.buttons}>
            <Button size="small" onClick={close}>
              {t('dialogs.work.cancel')}
            </Button>
            <Button ref={start} size="small" variant="primary" onClick={go}>
              {words.confirm}
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
