import type { Approval, DomainState } from '../../../../src/core/store.js';
import { CAP_INFO } from '../../../../src/core/gateway/access.js';
import { type TaskView, oneLine, requestGist } from '../../../../src/core/gateway/model.js';
import { placeName, planOfChannel } from '../../../../src/core/notify.js';
import { isDecisionQid } from '../../../../src/core/plans/decisions.js';
import { planTitle } from '../../../../src/core/plans/model.js';
import { planView } from '../../../../src/core/plans/progress.js';
import type { RequestAction } from './request-actions.js';
import { t, tl } from '../i18n/index.js';

/**
 * The floating card a friend's request gets on top of whatever you're doing (the app shell's
 * "request-popup" window): a few words of what they want, the full ask behind See more, and
 * Allow / Allow Always / Decline. This is what it shows, worked out from the shared state.
 * Plain data, so the app shell can hand it to the card's own window.
 */

export interface PopupRequest {
  /** The approval card it answers. */
  readonly approval: string;
  readonly task: string;
  readonly peerId: string;
  readonly peerName: string;
  /** Their Claude asks (not the person themself). */
  readonly claude: boolean;
  readonly kind: TaskView['kind'];
  /** "take a screenshot of your desktop": the sender's summary, else the start of the ask. A command or a file is always named as it is. */
  readonly gist: string;
  /** Under the gist: what the request really is when the gist is the sender's own words (the start of the ask, or their reason). */
  readonly said?: string;
  /** Everything their Claude sent: the ask (or the command, or the file). */
  readonly full: string;
  /** What it needs here, in words ("See the screen"). */
  readonly needs: readonly string[];
  readonly where: string;
  readonly back: string;
  readonly askedAt: number;
  /** A file request for a secret ("your private SSH key id_ed25519"): the card says so, and offers only Allow once / Decline. */
  readonly secret?: string;
}

/** Requests one card shows at once (the rest: "2 more waiting"). */
export const POPUP_MAX = 3;

/** Where a request would run or read, in words (the request sheet says the same). */
export const whereLine = (task: TaskView): string =>
  task.kind === 'file' ? (task.path ?? t('gateway.popup.aFile')) : task.project ? t('gateway.popup.inProject', { project: task.project }) : task.kind === 'run' ? (task.folder ?? task.cwd ?? t('gateway.popup.sharedFolder')) : t('gateway.popup.scratch');

/** What goes back to them, in words. */
export const backLine = (task: TaskView): string =>
  task.kind === 'run' ? t('gateway.popup.backRun') : task.kind === 'file' ? t('gateway.popup.backFile') : task.expects === 'files' ? t('gateway.popup.backFiles') : task.expects ? t('gateway.popup.backData') : t('gateway.popup.backSummary');

/** The sender chooses the summary, so a command or a file is named as it is, never by their words alone. */
const gistOf = (task: TaskView): string => {
  if (task.kind === 'run') return t('gateway.popup.run', { command: oneLine(task.command ?? '', 80) });
  if (task.kind === 'file') return t('gateway.popup.get', { path: task.path ?? t('gateway.popup.aFile') });
  return requestGist(task, 90);
};

/** The sender's words beside a command or a file ("why"), or the real start of an ask they summarised. */
const saidOf = (t: TaskView): string | undefined => {
  if (t.kind !== 'ask') return t.summary ? `“${t.summary}”` : undefined;
  return t.summary ? oneLine(t.ask, 140) : undefined;
};

const fullOf = (task: TaskView): string => {
  if (task.kind === 'run') return `$ ${task.command ?? ''}${task.ask && task.ask !== task.command ? `\n\n${t('gateway.popup.why', { why: task.ask })}` : ''}`;
  if (task.kind === 'file') return `${task.path ?? ''}${task.ask && !task.ask.startsWith('Send me ') ? `\n\n${t('gateway.popup.why', { why: task.ask })}` : ''}`;
  return task.ask;
};

/**
 * Friends' requests waiting for you, newest first, as the card shows them. Nothing while you're
 * on Do Not Disturb or appear offline: they still wait in Beluga and the menu bar, quietly.
 */
export function popupRequests(approvals: readonly Approval[], tasks: readonly TaskView[], quiet: boolean): PopupRequest[] {
  if (quiet) return [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return approvals
    .flatMap((a) => {
      const task = a.kind === 'request' && a.peer && a.task ? byId.get(a.task) : undefined;
      if (!task || task.direction !== 'received' || task.state !== 'awaiting_approval') return [];
      const item: PopupRequest = {
        approval: a.id,
        task: task.id,
        peerId: task.peerId,
        peerName: task.peerName,
        claude: task.by === 'agent',
        kind: task.kind,
        gist: gistOf(task),
        ...(saidOf(task) ? { said: saidOf(task)! } : {}),
        full: fullOf(task),
        needs: task.needs.map((n) => tl('CAP_INFO', n, 'label', CAP_INFO[n].label)),
        where: whereLine(task),
        back: backLine(task),
        askedAt: a.askedAt ?? task.createdAt,
        ...(task.secret ? { secret: task.secret.label } : {}),
      };
      return [item];
    })
    .sort((a, b) => b.askedAt - a.askedAt);
}

/** "Mia's Claude wants to" / "Mia wants to" (the card's first line). */
export const popupWho = (r: Pick<PopupRequest, 'peerName' | 'claude'>): string => (r.claude ? t('gateway.popup.theirAgent', { name: r.peerName }) : r.peerName);

/** What a button on the card does (answered by the main window, like a notification's). */
export const POPUP_BUTTONS: ReadonlyArray<{ readonly action: RequestAction; readonly label: string }> = [
  // Read when shown, so they follow the language.
  {
    action: 'decline',
    get label() {
      return t('gateway.popup.decline');
    },
  },
  {
    action: 'allow_always',
    get label() {
      return t('gateway.popup.allowAlways');
    },
  },
  {
    action: 'approve',
    get label() {
      return t('gateway.popup.allow');
    },
  },
];

/** The buttons one request gets: a file is allowed one at a time here (Always for files, with its folder spelled out, is on the request sheet; a secret never has one). */
export const popupButtons = (r: Pick<PopupRequest, 'kind'> & { readonly secret?: string }): typeof POPUP_BUTTONS =>
  r.secret ? POPUP_BUTTONS.filter((b) => b.action !== 'allow_always').map((b) => (b.action === 'approve' ? { ...b, label: t('gateway.popup.allowOnce') } : b)) : r.kind === 'file' ? POPUP_BUTTONS.filter((b) => b.action !== 'allow_always') : POPUP_BUTTONS;

// ------------------------------------------------------------------ when your own Claude needs you

/**
 * The same card for what your own Claude (or a plan) needs from you: a question, an approval, a
 * decision of yours in a plan, a milestone waiting for you to pass it. It says what, and Open
 * goes there (answered in Beluga, where there's room to choose and write); Later hides it.
 */
export interface PopupNeed {
  readonly need: true;
  /** Its id on the card ("need:q:<qid>", "need:a:<approval id>", "need:pass:<plan>:<milestone>"). */
  readonly approval: string;
  readonly task: '';
  readonly tag: 'question' | 'decision' | 'plan' | 'approval' | 'milestone';
  /** Where: "add-auth", "Card checkout · KLD-12" (the card's lead says what: "Claude asks you", "Your call"). */
  readonly title: string;
  /** The question, the command, what's ready. */
  readonly body: string;
  /** A question's choices, in a line (they're picked in Beluga). */
  readonly options?: readonly string[];
  /** Where Open goes: the conversation (a plan's opens the plan), or the plan itself. */
  readonly channel?: string;
  readonly plan?: string;
}

export type PopupItem = PopupRequest | PopupNeed;

export const isNeed = (r: PopupItem): r is PopupNeed => 'need' in r && r.need === true;

const NEED = 'need:';
export const isNeedId = (id: string | undefined): boolean => Boolean(id?.startsWith(NEED));

type NeedState = Pick<DomainState, 'approvals' | 'questions' | 'plans' | 'board' | 'projects' | 'shared' | 'peers' | 'prefs' | 'gateway'>;

/** A friend's request the card shows as theirs (Allow / Decline right there), not as something your Claude needs. */
const friendsRequest = (a: Approval, tasks: readonly TaskView[]): boolean => a.kind === 'request' && Boolean(a.peer) && Boolean(a.task) && tasks.some((t) => t.id === a.task);

const firstLine = (text: string, max = 160): string => oneLine(text.replace(/[*_`#>]/g, ''), max);

/** Where it's asked, in words: a plan's task ("Card checkout · KLD-12"), a plan, or the conversation's name. */
function placeOf(state: NeedState, channel: string | undefined): string {
  if (!channel) return 'Beluga';
  const place = planOfChannel(state, channel);
  if (place && place.plan.status !== 'draft') return place.issue ? `${planTitle(place.plan)} · ${place.issue.key}` : planTitle(place.plan);
  return placeName(state as DomainState, channel);
}

/**
 * What your own Claude and your plans wait on you for, as the card shows it (newest first). None
 * while you're on Do Not Disturb (or appear offline), with the pop-up or "Claude needs you" off in
 * Settings › Notifications, and nothing about what a Beluga window in front already shows you.
 */
export function popupNeeds(state: NeedState, opts: { readonly quiet: boolean; readonly showing?: (channel: string | undefined, plan?: string) => boolean }): PopupNeed[] {
  const prefs = state.prefs.notify;
  if (opts.quiet || prefs.popup === false || prefs.needsYou === false) return [];
  const showing = opts.showing ?? (() => false);
  const out: PopupNeed[] = [];
  for (const q of [...state.questions].reverse()) {
    if (showing(q.channel)) continue;
    const where = placeOf(state, q.channel);
    if (q.question.kind === 'plan') {
      out.push({ need: true, approval: `${NEED}q:${q.qid}`, task: '', tag: 'plan', title: where, body: t('gateway.popup.approvePlan'), channel: q.channel });
      continue;
    }
    const first = q.question.questions[0];
    const decision = isDecisionQid(q.qid);
    out.push({
      need: true,
      approval: `${NEED}q:${q.qid}`,
      task: '',
      tag: decision ? 'decision' : 'question',
      title: where,
      body: firstLine(first?.question ?? ''),
      ...(first?.options.length ? { options: first.options.map((o) => oneLine(o.label, 40)).slice(0, 4) } : {}),
      channel: q.channel,
    });
  }
  const tasks = state.gateway.tasks;
  for (const a of [...state.approvals].reverse()) {
    if (friendsRequest(a, tasks) || showing(a.channel)) continue;
    out.push({ need: true, approval: `${NEED}a:${a.id}`, task: '', tag: 'approval', title: placeOf(state, a.channel), body: firstLine(a.detail ? `${a.title}: ${a.detail}` : a.title), ...(a.channel ? { channel: a.channel } : {}) });
  }
  for (const plan of state.plans.plans) {
    if (plan.status !== 'active' || !plan.body || plan.paused || showing(plan.home, plan.id)) continue;
    const next = planView(plan, state.board).next;
    if (next.kind !== 'pass') continue;
    const m = next.milestone;
    out.push({
      need: true,
      approval: `${NEED}pass:${plan.id}:${m.milestone.id}`,
      task: '',
      tag: 'milestone',
      title: `${planTitle(plan)}: “${oneLine(m.milestone.title, 60)}”`,
      body: m.run.check?.verdict === 'pass' ? t('gateway.popup.checked') : t('gateway.popup.finished'),
      channel: plan.home,
      plan: plan.id,
    });
  }
  return out;
}

/** A pretend friend's request and a pretend decision, to see the card (⌘K › Preview Request Pop-up): their buttons do nothing. */
export const PREVIEW_PREFIX = 'preview:';

export const isPreviewId = (id: string | undefined): boolean => Boolean(id?.startsWith(PREVIEW_PREFIX));

export function previewItems(now: number): PopupItem[] {
  return [
    {
      approval: `${PREVIEW_PREFIX}request`,
      task: `${PREVIEW_PREFIX}task`,
      peerId: 'preview-mia',
      peerName: 'Mia',
      claude: true,
      kind: 'ask',
      gist: 'take a screenshot of your desktop and send it to me',
      said: 'A preview: nothing is asked, and nothing is sent.',
      full: 'This is how a friend’s request looks. Allow, Allow Always and Decline do nothing here.',
      needs: ['See the screen'],
      where: t('gateway.popup.scratch'),
      back: t('gateway.popup.backFiles'),
      askedAt: now,
    },
    {
      need: true,
      approval: `${PREVIEW_PREFIX}need`,
      task: '',
      tag: 'decision',
      title: 'Card checkout · KLD-12',
      body: 'Which payment providers should checkout offer at launch?',
      options: ['Stripe', 'Apple Pay', 'PayPal'],
    },
  ];
}
