import path from 'node:path';
import { claudeHome } from '../../../core/claude-code/launch.js';
import { buildPrompt } from '../../prompt.js';
import { runInstructions } from '../../run-instructions.js';
import { runToolSuites } from '../../run-tools.js';
import { sideCalls } from '../../side-calls.js';
import { syncProbes } from '../../sync-main.js';
import { gateTool } from '../../tool-gate.js';
import { ToolHost } from '../../tool-host.js';
import type { AgentBackend, AgentRunInput, FollowUp, LiveStatus, RoomBridge, Steer } from '../../types.js';
import { ViewShelf } from '../../view-tools.js';
import { INTERRUPT_TIMEOUT_MS } from '../types.js';
import { type ConfigOption, type ContentBlock, type PermissionRequest, type PromptResponse, type SessionResponse, type SessionUpdate, permissionAnswer } from '../opencode/acp.js';
import { OpenCodeEvents as AcpEvents, type TurnSink, contextEvent, usageEvent } from '../opencode/events.js';
import { promptBlocks } from '../opencode/runner.js';
import { mapOpenCodeSlash as mapSlash } from '../opencode/skills.js';
import { httpServers } from '../copilot/run-parts.js';
import { agyComplete } from './complete.js';
import { type AgyConnect, type AgyConnection, agyArgs, findAgy, spawnAgy } from './connection.js';
import { agyFailure, agyModel, agyThought, declinedNote, modeValue, systemMeta } from './run-parts.js';
import { agyBrainDir, agyDataDir } from './sessions.js';
import { agyStatus } from './status.js';
import { AGY_DIALECT, agyCalls, belugaToolOf } from './tools.js';

export interface AgyBackendOptions {
  readonly cwd: string;
  readonly autoEdit: boolean;
  readonly additionalDirectories: readonly string[];
  readonly bridge: RoomBridge;
  readonly model?: string;
  /** The Antigravity CLI's executable; unset: findAgy(). */
  readonly bin?: string;
  /** How to reach Antigravity (tests: a scripted one). */
  readonly connect?: AgyConnect;
  /** Where Beluga's tools are served to the run over HTTP (one per daemon). */
  readonly toolHost?: ToolHost;
  /** Where Antigravity keeps its conversations (its own notes, a plan or a task list, are written there). */
  readonly dataDir?: string;
}

const AGY_AGENT = { runtime: 'antigravity', label: 'Antigravity' } as const;
/** A plan sent back for changes this many times: the run ends with the last plan as its answer. */
const PLAN_ROUNDS = 5;
/** Beluga's tools whose target is a path: one Antigravity didn't name is turned down, never judged as the folder. */
const PATHED = new Set(['Read', 'Write', 'Edit']);
const WRITES = new Set(['Write', 'Edit']);

let sharedHost: ToolHost | undefined;
const toolHost = (): ToolHost => (sharedHost ??= new ToolHost());

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  promise.catch(() => undefined);
  return { promise, resolve, reject };
};

/**
 * Runs turns on Antigravity through `agy acp`, the CLI's own ACP server signed in with your Google
 * account: one process per run, one conversation per place (its id is the place's session, so it
 * goes on with session/load), the model, thinking level and mode set as the session's options,
 * Beluga's instructions added to its system prompt (`_meta`), each request a prompt, its updates
 * streamed into onEvent/onStep the way Claude's are (opencode/events.ts with Antigravity's tool
 * names). Every step it asks about (commands, writes, MCP tools) is judged by the same gate as
 * Claude's; what it runs without asking (reading files) is why it gets no friends' tasks or guests.
 * Beluga's tools reach it over HTTP, gated per call there.
 */
export function createAgyBackend(opts: AgyBackendOptions): AgentBackend {
  let sessionId: string | undefined;
  const connect = opts.connect ?? spawnAgy;
  const host = (): ToolHost => opts.toolHost ?? toolHost();
  const bin = (): string | undefined => opts.bin ?? (opts.connect ? undefined : findAgy());
  const side = { ...(opts.connect ? { connect: opts.connect, drop: async () => undefined } : {}), ...(opts.bin ? { bin: opts.bin } : {}) };
  const data = opts.dataDir ?? agyDataDir();

  return {
    async run(input: AgentRunInput): Promise<string> {
      if (input.signal.aborted) throw new Error('aborted');
      const bridge = input.channel && opts.bridge.inChannel ? opts.bridge.inChannel(input.channel) : opts.bridge;
      const place = input.place;
      const cwd = place?.cwd ?? opts.cwd;
      const extraDirs = place ? place.additionalDirectories : opts.additionalDirectories;
      const askOnly = place?.askOnly;
      const readOnly = Boolean(askOnly) || Boolean(input.dialogue?.readOnly);
      const autoEdit = !readOnly && (place?.autoEdit ?? opts.autoEdit);
      const fixup = place?.fixup;
      const syncMain = askOnly ? place?.syncMain : undefined;
      const policy = { cwd, roots: [cwd, ...extraDirs, ...(fixup ? [fixup] : [])], autoEdit, scope: input.scope, guest: input.guest, boardAsks: input.boardAsks, dotenv: Boolean(input.canUseSecret) && !input.guest, askOnly: Boolean(askOnly), ...(syncMain ? { syncMain: syncProbes(cwd, syncMain) } : {}), ...(fixup ? { fixup } : {}), ...(place?.alsoEdit?.length ? { alsoEdit: place.alsoEdit } : {}), ...(input.customerTurn ? { customerTurn: true } : {}) };
      const remember = (id: string): void => (place ? place.onSession(id) : void (sessionId = id));
      const shelf = new ViewShelf();

      // Beluga's tools, served for this run alone and gated per call (vetTool, policy, you).
      const mounted = await host().mount(runToolSuites(input, bridge, shelf, cwd), (name, args) => gateTool(name, args, input, policy));
      const suites = Object.keys(mounted.http);
      const env = { ...process.env, ...input.env };
      const instructions = systemMeta(runInstructions(input, opts.bridge.selfName(), AGY_AGENT));

      let planning = Boolean(input.plan);
      let wanted = agyModel(input.model ?? place?.model ?? opts.model);
      /** The model the session is on (its own default until it says). */
      let model = wanted ?? '';
      let lastContext: string | undefined;
      /** A /compact turn is running: its summary and meter stay out of the chat. */
      let compacting = false;
      /** Antigravity's own commands here (its built-ins and the skills it loaded). */
      let commands = new Set<string>();
      const events = new AcpEvents(cwd, { onEvent: input.onEvent, ...(input.onStep ? { onStep: input.onStep } : {}) }, {
        onFileTouched: input.onFileTouched,
        expand: (t) => shelf.expand(t),
        suites,
        onContext: (used, size) => {
          const ev = contextEvent(used, size, model || undefined);
          if (ev && ev !== lastContext && !compacting) input.onEvent('context', (lastContext = ev));
        },
        quiet: () => compacting,
        dialect: AGY_DIALECT,
      });
      let conn: AgyConnection | undefined;
      let failed = true;
      let closed = false;
      try {
        conn = await connect({ cwd, env, args: agyArgs({ addDirs: [...extraDirs, ...(fixup ? [fixup] : [])] }), ...(opts.bin ? { bin: opts.bin } : {}) });
        const link = conn;
        input.onProcess?.(link.proc);
        const { rpc } = link;
        const stopped = deferred<never>();
        void rpc.closed.then(() => {
          if (!closed) stopped.reject(agyFailure({ error: 'Antigravity exited before the turn ended', stderr: link.stderr() }));
        });

        // Updates count from the session's own id on: a loaded session's replay (its history) comes before.
        let sid = '';
        let options: readonly ConfigOption[] = [];
        /** Why Beluga turned this turn's steps down. */
        const declined: string[] = [];
        rpc.onNotification((method, params) => {
          if (method !== 'session/update' || !sid || params.sessionId !== sid) return;
          const update = params.update as SessionUpdate;
          if (update.sessionUpdate === 'available_commands_update') commands = new Set(update.availableCommands.map((c) => c.name));
          if (update.sessionUpdate === 'config_option_update') options = update.configOptions;
          events.handle(update);
        });
        rpc.onRequest(async (method, params) => {
          if (method !== 'session/request_permission') throw new Error(`${method} isn’t supported in Beluga`);
          const req = params as unknown as PermissionRequest;
          const why = await judge(req);
          if (why) {
            events.denied.set(req.toolCall.toolCallId, why);
            declined.push(why);
          }
          return permissionAnswer(req, !why);
        });
        /** Antigravity's own notes for this conversation (its plan, its task list), in its notes folder: never yours, never judged. */
        const ownNote = (file: unknown): boolean => {
          if (typeof file !== 'string' || !file || !sid) return false;
          const rel = path.relative(agyBrainDir(sid, data), file);
          return !rel.startsWith('..') && !path.isAbsolute(rel);
        };
        /** Why a step Antigravity asks about may not run (undefined: it may). */
        const judge = async (req: PermissionRequest): Promise<string | undefined> => {
          const call = await events.callOf(req.toolCall);
          if (!call) return 'Antigravity didn’t say which tool this is.';
          // Beluga's own tools are judged where they run (the tool host's gate), not twice.
          if (belugaToolOf(call.tool, suites)) return undefined;
          const calls = agyCalls(call.tool, call.raw, cwd, suites);
          if (calls.every((c) => WRITES.has(c.name) && ownNote(c.input.file_path))) return undefined;
          if ((planning || readOnly) && calls.some((c) => WRITES.has(c.name))) return planning ? 'Planning only looks: nothing changes until you approve the plan.' : 'This conversation only looks: nothing may change here.';
          for (const c of calls) {
            if (PATHED.has(c.name) && !c.input.file_path) return 'Antigravity didn’t say which file, so Beluga turned it down.';
            const denied = await gateTool(c.name, c.input, input, policy);
            if (denied) return denied;
          }
          return undefined;
        };

        const servers = httpServers(mounted.http);
        const resume = place ? place.resume : sessionId;
        let opened: SessionResponse | undefined;
        if (resume && !place?.forkSession) {
          opened = await rpc.request<SessionResponse>('session/load', { sessionId: resume, cwd, mcpServers: servers, _meta: instructions }).catch(() => undefined);
          if (opened) opened = { ...opened, sessionId: resume };
          else input.onEvent('progress', 'Started a new Antigravity conversation (the last one couldn’t be opened)');
        }
        try {
          opened ??= await rpc.request<SessionResponse>('session/new', { cwd, mcpServers: servers, _meta: instructions });
        } catch (err) {
          throw agyFailure({ error: err instanceof Error ? err.message : String(err), stderr: link.stderr() });
        }
        sid = opened.sessionId!;
        options = opened.configOptions ?? [];
        remember(sid);
        if (input.signal.aborted) throw new Error('aborted');

        /** Set one of the session's options (model, thinking level, mode) when it offers that value and isn't on it already. */
        const choose = async (id: string, value: string | undefined): Promise<boolean> => {
          const option = options.find((o) => o.id === id);
          if (!value || !option || option.currentValue === value || !option.options.some((o) => o.value === value)) return false;
          const res = await rpc.request<{ configOptions?: ConfigOption[] }>('session/set_config_option', { sessionId: sid, configId: id, value });
          options = res.configOptions ?? options;
          return true;
        };
        const current = (): string => options.find((o) => o.id === 'model')?.currentValue ?? '';
        /** A model picked for a later message: the session's own option when it offers it; else it stays on the one it has. */
        const switchModel = async (pick: string | undefined, sink: TurnSink): Promise<void> => {
          wanted = pick;
          if (!pick || pick === current()) return;
          if (await choose('model', pick)) model = current() || pick;
          else sink.onEvent('progress', `Antigravity has no ${pick} on your plan: it stays on ${current() || 'its own model'}`);
        };
        if (wanted && !(await choose('model', wanted)) && wanted !== current()) input.onEvent('progress', `Antigravity has no ${wanted} on your plan: it runs on ${current() || 'its own model'}`);
        model = current() || model;
        await choose('thought_level', agyThought(input.effort ?? place?.effort));
        await choose('mode', modeValue(options, planning ? 'plan' : 'default'));

        // Stop: cancel the turn (same contract as Claude), then the process for sure.
        let aborted = false;
        const abort = deferred<never>();
        let active: { readonly done: ReturnType<typeof deferred<PromptResponse>> } | undefined;
        const cancelTurn = async (): Promise<boolean> => {
          const turn = active;
          if (!turn) return false;
          events.stopping = true;
          rpc.notify('session/cancel', { sessionId: sid });
          let timer: NodeJS.Timeout | undefined;
          const late = new Promise<false>((r) => (timer = setTimeout(() => r(false), INTERRUPT_TIMEOUT_MS)));
          return Promise.race([turn.done.promise.then(() => true, () => true), late]).finally(() => clearTimeout(timer));
        };
        const onAbort = (): void => {
          aborted = true;
          void cancelTurn().finally(() => {
            abort.reject(new Error('aborted'));
            void link.proc.kill();
          });
        };
        input.signal.addEventListener('abort', onAbort, { once: true });
        if (input.signal.aborted) throw new Error('aborted');

        /** One turn: what it said last, and how it ended. Antigravity ends a turn silently when a step is declined: then it's told why, once, and answers. */
        const runTurn = async (sink: TurnSink, blocks: ContentBlock[], again = true): Promise<{ text: string; res: PromptResponse }> => {
          declined.length = 0;
          events.beginTurn(sink);
          const done = deferred<PromptResponse>();
          active = { done };
          try {
            rpc.request<PromptResponse>('session/prompt', { sessionId: sid, prompt: blocks }).then(done.resolve, (err: unknown) => done.reject(agyFailure({ error: err instanceof Error ? err.message : String(err), stderr: link.stderr() })));
            const res = await Promise.race([done.promise, stopped.promise, abort.promise]);
            const text = events.endTurn(res.stopReason !== 'cancelled');
            const used = usageEvent(res.usage, sid);
            if (used) sink.onEvent('usage', used);
            if (again && !text && res.stopReason === 'end_turn' && declined.length) {
              active = undefined;
              return runTurn(sink, [{ type: 'text', text: declinedNote(declined) }], false);
            }
            return { text, res };
          } catch (err) {
            events.endTurn(false);
            throw err;
          } finally {
            active = undefined;
          }
        };

        // Messages that came in while a turn worked (Send now): a turn of their own after it.
        const pending: FollowUp[] = [];
        let interrupting: string | undefined;
        const status = (): LiveStatus => {
          const tool = [...events.tools.values()].sort((a, b) => a.since - b.since)[0];
          return { ...(tool ? { tool } : {}), lastEventAt: events.lastEventAt, between: !active, ...(events.thinking ? { thinking: true } : {}), alive: link.proc.alive() };
        };
        const interrupt = async (followUp: FollowUp, note: string): Promise<boolean> => {
          if (closed || !active || interrupting !== undefined) return false;
          interrupting = note;
          pending.unshift(followUp);
          const ok = await cancelTurn();
          if (!ok) {
            const at = pending.indexOf(followUp);
            if (at !== -1) pending.splice(at, 1);
            interrupting = undefined;
          }
          return ok;
        };
        // Antigravity takes one prompt at a time: a message can't go into a running turn (Beluga queues it), only stop it.
        const steer = Object.assign((_f: FollowUp) => false, { status, interrupt }) satisfies Steer;
        input.onSteer?.(steer);

        /** A turn's end as its answer: an interrupted one ends with the note it was stopped with. */
        const answerOf = (r: { text: string; res: PromptResponse }, sink: TurnSink): string => {
          if (r.res.stopReason === 'cancelled') {
            if (interrupting === undefined) throw new Error('aborted');
            const note = interrupting;
            interrupting = undefined;
            sink.onEvent('text', note);
            return r.text ? `${shelf.finish(r.text)}\n\n${note}` : note;
          }
          if (r.res.stopReason === 'refusal' && !r.text) return 'Antigravity’s model declined to answer this.';
          return shelf.finish(r.text);
        };
        /** What didn't carry over to Antigravity, said in the chat now and kept at the top of the answer. */
        const noted = (notes: readonly string[], sink: TurnSink): ((answer: string) => string) => {
          for (const note of notes) sink.onEvent('text', note);
          return (answer) => (notes.length ? `${notes.join('\n')}\n\n${answer}` : answer);
        };
        /** /compact: Antigravity's own, its summary kept out of the chat, and how full the window is before and after. */
        const compact = async (sink: TurnSink): Promise<string> => {
          const pre = events.context.used;
          events.context = { used: 0, size: events.context.size };
          compacting = true;
          try {
            await runTurn(sink, [{ type: 'text', text: '/compact' }]);
          } finally {
            compacting = false;
          }
          sink.onEvent('compact', JSON.stringify({ pre, post: events.context.used, trigger: 'manual', ...(events.context.size ? { window: events.context.size } : {}) }));
          return '';
        };
        /** A message as a turn: a /command mapped (opencode/skills.ts), pictures with it. */
        const turnFor = async (sink: TurnSink, prompt: string, built: (p: string) => string): Promise<string> => {
          if (/^\/compact(\s|$)/.test(prompt.trim())) return compact(sink);
          const mapped = await mapSlash(prompt, cwd, claudeHome(), commands, 'Antigravity');
          const said = noted(mapped.notes, sink);
          const text = mapped.prompt.startsWith('/') ? mapped.prompt : built(mapped.prompt);
          return said(answerOf(await runTurn(sink, promptBlocks(text, prompt, Boolean(link.init.agentCapabilities?.promptCapabilities?.image))), sink));
        };

        const original: TurnSink = { onEvent: input.onEvent, ...(input.onStep ? { onStep: input.onStep } : {}) };
        const answers: string[] = [];
        let answer = await turnFor(original, input.prompt, (p) => (planning ? `${buildPrompt({ ...input, prompt: p })}\n\n${PLAN_NOTE}` : buildPrompt({ ...input, prompt: p })));
        // Plan mode, Antigravity's own: the plan comes to you, and once you approve it the session goes
        // back to its default mode and does the work.
        let askedToDefine = false;
        for (let round = 0; planning && input.askUser && round < PLAN_ROUNDS; round++) {
          if (input.planTask?.needsDefinition() && !askedToDefine) {
            askedToDefine = true;
            answer = answerOf(await runTurn(original, [{ type: 'text', text: DEFINE_NOTE }]), original);
          }
          const verdict = await input.askUser({ kind: 'plan', plan: (answer || '(Antigravity proposed a plan)').slice(0, 60_000) });
          if (verdict.kind !== 'plan') break;
          if (verdict.approve) {
            input.planTask?.approved();
            planning = false;
            await choose('mode', modeValue(options, 'default'));
          }
          const next = verdict.approve ? 'The plan is approved. Do the work now.' : verdict.feedback ? `Change the plan: ${verdict.feedback}\n\n${PLAN_NOTE}` : NOT_YET_NOTE;
          answer = answerOf(await runTurn(original, [{ type: 'text', text: next }]), original);
          if (verdict.approve || next === NOT_YET_NOTE) break;
        }
        answers.push(answer);
        input.onAnswered?.(answer);

        // Then each message that waits for a turn of its own (one sent with Send now).
        while (!aborted) {
          const followUp = pending.shift();
          if (!followUp) break;
          const sink: TurnSink = { onEvent: followUp.onEvent, ...(followUp.onStep ? { onStep: followUp.onStep } : {}) };
          followUp.onStart?.();
          try {
            if (followUp.model !== undefined && agyModel(followUp.model) !== wanted) await switchModel(agyModel(followUp.model), sink);
            followUp.onDone(await turnFor(sink, followUp.prompt, (p) => buildPrompt({ ...followUp, prompt: p })));
          } catch (err) {
            if (aborted) throw err;
            followUp.onError(err instanceof Error ? err.message : String(err));
          }
        }
        if (aborted) throw new Error('aborted');
        input.signal.removeEventListener('abort', onAbort);
        failed = false;
        return answers.join('\n\n');
      } finally {
        closed = true;
        input.onSteer?.(undefined);
        events.finish(failed || input.signal.aborted);
        mounted.close();
        await conn?.proc.kill();
      }
    },

    // Side calls (naming, drafting, chat answers…) through a one-off Antigravity conversation each.
    ...sideCalls((req) => agyComplete(req, side), opts.cwd, opts.model),

    // Its models: what a session offers (the ones your plan has).
    listModels: async () => {
      const found = await agyStatus({ ...(bin() ? { bin: bin()! } : {}), ...(opts.connect ? { connect: opts.connect } : {}) });
      return found.state === 'ready' ? [...found.models] : undefined;
    },
  };
}

const PLAN_NOTE = 'Plan only: look around read-only, change nothing, and answer with a step-by-step plan for the person to approve.';
const DEFINE_NOTE =
  'Before the plan goes to the person for approval, call the beluga_board task_define tool with the task this plan is for (title, goal in your own words, context, acceptance criteria, decisions, open questions, estimate, priority). Then answer with the plan again, in full.';
const NOT_YET_NOTE = 'The person did not approve the plan yet. Ask them what they would like to change, and change nothing.';
