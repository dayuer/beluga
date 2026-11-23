import { claudeHome } from '../../../core/claude-code/launch.js';
import { buildPrompt } from '../../prompt.js';
import { isYourRun } from '../../policy.js';
import { runInstructions } from '../../run-instructions.js';
import { runToolSuites } from '../../run-tools.js';
import { sideCalls } from '../../side-calls.js';
import { syncProbes } from '../../sync-main.js';
import { gateTool } from '../../tool-gate.js';
import { ToolHost } from '../../tool-host.js';
import type { AgentBackend, AgentRunInput, FollowUp, LiveStatus, RoomBridge, Steer } from '../../types.js';
import { ViewShelf } from '../../view-tools.js';
import { INTERRUPT_TIMEOUT_MS } from '../types.js';
import { type ConfigOption, type ContentBlock, type PermissionRequest, type PromptResponse, type SessionUpdate, permissionAnswer } from '../opencode/acp.js';
import { OpenCodeEvents as AcpEvents, type TurnSink, contextEvent, usageEvent } from '../opencode/events.js';
import { promptBlocks } from '../opencode/runner.js';
import { mapOpenCodeSlash as mapSlash } from '../opencode/skills.js';
import { acpComplete } from './complete.js';
import { type AcpConnect, type AcpConnection, findAcpCommand, spawnAcp } from './connection.js';
import { acpCalls, acpDialect, belugaToolOf } from './dialect.js';
import { type AcpSession, acpFailure, acpMode, acpModel, httpServers, stdioServers, withInstructions } from './parts.js';
import type { AcpAgentSpec } from './spec.js';
import { acpStatus } from './status.js';

export interface AcpBackendOptions {
  readonly cwd: string;
  readonly autoEdit: boolean;
  readonly additionalDirectories: readonly string[];
  readonly bridge: RoomBridge;
  readonly model?: string;
  /** The agent's executable; unset: findAcpCommand(spec). */
  readonly bin?: string;
  /** How to reach the agent (tests: a scripted one). */
  readonly connect?: AcpConnect;
  /** Where Beluga's tools are served to the run (one per daemon). */
  readonly toolHost?: ToolHost;
}

/** A plan sent back for changes this many times: the run ends with the last plan as its answer. */
const PLAN_ROUNDS = 5;
/** Beluga's tools whose target is a path: one the agent didn't name is turned down, never judged as the folder. */
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

/** The effort for a run: its own, else the conversation's (null: Auto picked there, so none). */
const effortOf = (input: Pick<AgentRunInput, 'effort'>, place: AgentRunInput['place']): string | undefined => input.effort ?? place?.effort ?? undefined;

/**
 * Runs turns on any ACP agent (BLG-ACP): one process per run, one session per place (its id is the
 * place's session, so the conversation goes on with session/load when the agent can load one),
 * each message a prompt, its updates streamed into onEvent/onStep the way Claude's are
 * (opencode/events.ts, with the generic dialect: dialect.ts). Every step the agent asks about is
 * judged by the same gate as Claude's; what it runs without asking is why it gets no friends'
 * tasks or guests (ACP_CAPABILITIES). Its model, thinking level and plan mode are set through its
 * session's options; Beluga's instructions go ahead of the first message, and Beluga's tools reach
 * it over HTTP when it takes them so, else over stdio, gated per call where they run.
 */
export function createAcpBackend(spec: AcpAgentSpec, opts: AcpBackendOptions): AgentBackend {
  let sessionId: string | undefined;
  const connect = opts.connect ?? spawnAcp(spec);
  const host = (): ToolHost => opts.toolHost ?? toolHost();
  const bin = (): string | undefined => opts.bin ?? (opts.connect ? undefined : findAcpCommand(spec));
  const side = { ...(opts.connect ? { connect: opts.connect } : {}), ...(opts.bin ? { bin: opts.bin } : {}) };
  const agent = { runtime: spec.id, label: spec.label } as const;
  const failure = (error: string, conn: AcpConnection | undefined) => acpFailure({ error, ...(conn ? { stderr: conn.stderr() } : {}) }, spec.id);

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
      const policy = { cwd, roots: [cwd, ...extraDirs, ...(fixup ? [fixup] : [])], autoEdit, scope: input.scope, guest: input.guest, boardAsks: input.boardAsks, dotenv: Boolean(input.canUseSecret) && !input.guest, yourRun: isYourRun(input), askOnly: Boolean(askOnly), ...(syncMain ? { syncMain: syncProbes(cwd, syncMain) } : {}), ...(fixup ? { fixup } : {}), ...(place?.alsoEdit?.length ? { alsoEdit: place.alsoEdit } : {}) };
      const remember = (id: string): void => (place ? place.onSession(id) : void (sessionId = id));
      const shelf = new ViewShelf();

      // Beluga's tools, served for this run alone and gated per call (vetTool, policy, you).
      const mounted = await host().mount(runToolSuites(input, bridge, shelf, cwd), (name, args) => gateTool(name, args, input, policy));
      const suites = Object.keys(mounted.http);
      const env = { ...process.env, ...input.env };
      const instructions = runInstructions(input, opts.bridge.selfName(), agent);

      let planning = Boolean(input.plan);
      let model = acpModel(input.model ?? place?.model ?? opts.model);
      let lastContext: string | undefined;
      /** The agent's own commands here (its built-ins and skills). */
      let commands = new Set<string>();
      const events = new AcpEvents(cwd, { onEvent: input.onEvent, ...(input.onStep ? { onStep: input.onStep } : {}) }, {
        onFileTouched: input.onFileTouched,
        expand: (t) => shelf.expand(t),
        suites,
        onContext: (used, size) => {
          const ev = contextEvent(used, size, model);
          if (ev && ev !== lastContext) input.onEvent('context', (lastContext = ev));
        },
        dialect: acpDialect(() => suites),
      });
      let conn: AcpConnection | undefined;
      let failed = true;
      let closed = false;
      try {
        conn = await connect({ cwd, env, ...(opts.bin ? { bin: opts.bin } : {}) });
        const link = conn;
        input.onProcess?.(link.proc);
        const { rpc } = link;
        const stopped = deferred<never>();
        void rpc.closed.then(() => {
          if (!closed) stopped.reject(failure(`${spec.label} exited before the turn ended`, link));
        });

        // Updates count from the session's own id on: a loaded session's replay (its history) comes before.
        let sid = '';
        let session: AcpSession = {};
        rpc.onNotification((method, params) => {
          if (method !== 'session/update' || !sid || params.sessionId !== sid) return;
          const update = params.update as SessionUpdate;
          if (update.sessionUpdate === 'available_commands_update') commands = new Set(update.availableCommands.map((c) => c.name));
          if (update.sessionUpdate === 'config_option_update') session = { ...session, configOptions: update.configOptions };
          if (update.sessionUpdate === 'current_mode_update' && session.modes) session = { ...session, modes: { ...session.modes, currentModeId: update.currentModeId } };
          events.handle(update);
        });
        rpc.onRequest(async (method, params) => {
          if (method !== 'session/request_permission') throw new Error(`${method} isn’t supported in Beluga`);
          const req = params as unknown as PermissionRequest;
          const why = await judge(req);
          if (why) events.denied.set(req.toolCall.toolCallId, why);
          return permissionAnswer(req, !why);
        });
        /** Why a step the agent asks about may not run (undefined: it may). */
        const judge = async (req: PermissionRequest): Promise<string | undefined> => {
          const call = await events.callOf(req.toolCall);
          if (!call) return `${spec.label} didn’t say which tool this is.`;
          // Beluga's own tools are judged where they run (the tool host's gate), not twice.
          if (belugaToolOf(call.tool, suites)) return undefined;
          const calls = acpCalls(call.tool, call.raw, cwd, suites);
          if ((planning || readOnly) && calls.some((c) => WRITES.has(c.name))) return planning ? 'Planning only looks: nothing changes until you approve the plan.' : 'This conversation only looks: nothing may change here.';
          for (const c of calls) {
            if (PATHED.has(c.name) && !c.input.file_path) return `${spec.label} didn’t say which file, so Beluga turned it down.`;
            const denied = await gateTool(c.name, c.input, input, policy);
            if (denied) return denied;
          }
          return undefined;
        };

        // Beluga's tools: over HTTP when it says it takes them so, else stdio (ACP's baseline).
        const servers = link.init.agentCapabilities?.mcpCapabilities?.http ? httpServers(mounted.http) : stdioServers(mounted.servers);
        const resume = place ? place.resume : sessionId;
        let opened: AcpSession | undefined;
        if (resume && !place?.forkSession && link.init.agentCapabilities?.loadSession) {
          opened = await rpc.request<AcpSession>('session/load', { sessionId: resume, cwd, mcpServers: servers }).catch(() => undefined);
          if (opened) opened = { ...opened, sessionId: resume };
        }
        if (resume && !opened) input.onEvent('progress', `Started a new ${spec.label} conversation (the last one couldn’t be opened)`);
        try {
          opened ??= await rpc.request<AcpSession>('session/new', { cwd, mcpServers: servers });
        } catch (err) {
          throw failure(err instanceof Error ? err.message : String(err), link);
        }
        sid = opened.sessionId!;
        session = opened;
        remember(sid);
        if (input.signal.aborted) throw new Error('aborted');

        /** Set one of the session's select options when it offers that value and isn't on it already. */
        const choose = async (ids: readonly string[], value: string | undefined): Promise<boolean> => {
          const option = session.configOptions?.find((o) => ids.includes(o.id) || (o.category !== undefined && ids.includes(o.category)));
          if (!value || !option || option.currentValue === value || !option.options.some((o) => o.value === value)) return false;
          const res = await rpc.request<{ configOptions?: ConfigOption[] }>('session/set_config_option', { sessionId: sid, configId: option.id, value }).catch(() => undefined);
          if (!res) return false;
          session = { ...session, configOptions: res.configOptions ?? session.configOptions };
          return true;
        };
        /** Its model: through its options, else ACP's older set_model. */
        const setModel = async (pick: string | undefined, sink: TurnSink): Promise<void> => {
          if (!pick) return;
          if (await choose(['model'], pick)) return;
          const offered = session.models?.availableModels?.some((m) => m.modelId === pick);
          if (offered && session.models?.currentModelId !== pick) {
            const ok = await rpc.request('session/set_model', { sessionId: sid, modelId: pick }).then(() => true, () => false);
            if (ok) return void (session = { ...session, models: { ...session.models, currentModelId: pick } });
          }
          if (!offered && !session.configOptions?.some((o) => o.id === 'model' && o.options.some((x) => x.value === pick))) sink.onEvent('progress', `${spec.label} doesn’t offer ${pick} here, so it uses its own model`);
        };
        /** Plan mode or its working mode, when it has modes. */
        const setMode = async (name: 'plan' | 'work'): Promise<boolean> => {
          const mode = acpMode(session, name);
          if (!mode) return false;
          if (mode.via === 'config') return choose(['mode'], mode.value) || session.configOptions?.find((o) => o.id === 'mode')?.currentValue === mode.value;
          if (session.modes?.currentModeId === mode.value) return true;
          const ok = await rpc.request('session/set_mode', { sessionId: sid, modeId: mode.value }).then(() => true, () => false);
          if (ok) session = { ...session, modes: { ...session.modes, currentModeId: mode.value } };
          return ok;
        };
        const original: TurnSink = { onEvent: input.onEvent, ...(input.onStep ? { onStep: input.onStep } : {}) };
        await setModel(model, original);
        const effort = effortOf(input, place);
        if (effort) await choose(['thought_level', 'effort', 'reasoning_effort'], effort);
        // Its own plan mode when it has one; Beluga's either way (its writes turned down until you approve).
        if (planning) await setMode('plan');

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

        /** One turn: what it said last, and how it ended. */
        const runTurn = async (sink: TurnSink, blocks: ContentBlock[]): Promise<{ text: string; res: PromptResponse }> => {
          events.beginTurn(sink);
          const done = deferred<PromptResponse>();
          active = { done };
          try {
            rpc.request<PromptResponse>('session/prompt', { sessionId: sid, prompt: blocks }).then(done.resolve, (err: unknown) => done.reject(failure(err instanceof Error ? err.message : String(err), link)));
            const res = await Promise.race([done.promise, stopped.promise, abort.promise]);
            const text = events.endTurn(res.stopReason !== 'cancelled');
            const used = usageEvent(res.usage, sid);
            if (used) sink.onEvent('usage', used);
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
        // One prompt at a time: a message can't go into a running turn (Beluga queues it), only stop it.
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
          if (r.res.stopReason === 'refusal' && !r.text) return `${spec.label}’s model declined to answer this.`;
          return shelf.finish(r.text);
        };
        /** What didn't carry over, said in the chat now and kept at the top of the answer. */
        const noted = (notes: readonly string[], sink: TurnSink): ((answer: string) => string) => {
          for (const note of notes) sink.onEvent('text', note);
          return (answer) => (notes.length ? `${notes.join('\n')}\n\n${answer}` : answer);
        };
        let first = true;
        /** A message as a turn: a /command mapped (opencode/skills.ts), pictures with it, Beluga's instructions ahead of the first. */
        const turnFor = async (sink: TurnSink, prompt: string, built: (p: string) => string): Promise<string> => {
          const mapped = await mapSlash(prompt, cwd, claudeHome(), commands, spec.label);
          const said = noted(mapped.notes, sink);
          const text = mapped.prompt.startsWith('/') ? mapped.prompt : built(mapped.prompt);
          const sent = first && !text.startsWith('/') ? withInstructions(instructions, text) : text;
          first = false;
          return said(answerOf(await runTurn(sink, promptBlocks(sent, prompt, Boolean(link.init.agentCapabilities?.promptCapabilities?.image))), sink));
        };

        const answers: string[] = [];
        let answer = await turnFor(original, input.prompt, (p) => (planning ? `${buildPrompt({ ...input, prompt: p })}\n\n${PLAN_NOTE}` : buildPrompt({ ...input, prompt: p })));
        // Plan mode: the plan comes to you, and once you approve it the session goes back to work.
        let askedToDefine = false;
        for (let round = 0; planning && input.askUser && round < PLAN_ROUNDS; round++) {
          if (input.planTask?.needsDefinition() && !askedToDefine) {
            askedToDefine = true;
            answer = answerOf(await runTurn(original, [{ type: 'text', text: DEFINE_NOTE }]), original);
          }
          const verdict = await input.askUser({ kind: 'plan', plan: (answer || `(${spec.label} proposed a plan)`).slice(0, 60_000) });
          if (verdict.kind !== 'plan') break;
          if (verdict.approve) {
            input.planTask?.approved();
            planning = false;
            await setMode('work');
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
            if (followUp.model !== undefined && acpModel(followUp.model) !== model) {
              model = acpModel(followUp.model);
              await setModel(model, sink);
            }
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

    // Side calls (naming, drafting, chat answers…) through a one-off session each.
    ...sideCalls((req) => acpComplete(spec, req, side), opts.cwd, opts.model),

    // Its models: what a session offers.
    listModels: async () => {
      const found = await acpStatus(spec, { ...(bin() ? { bin: bin()! } : {}), ...(opts.connect ? { connect: opts.connect } : {}) });
      return found.state === 'ready' ? [...found.models] : undefined;
    },
  };
}

const PLAN_NOTE = 'Plan only: look around read-only, change nothing, and answer with a step-by-step plan for the person to approve.';
const DEFINE_NOTE =
  'Before the plan goes to the person for approval, call the beluga_board task_define tool with the task this plan is for (title, goal in your own words, context, acceptance criteria, decisions, open questions, estimate, priority). Then answer with the plan again, in full.';
const NOT_YET_NOTE = 'The person did not approve the plan yet. Ask them what they would like to change, and change nothing.';
