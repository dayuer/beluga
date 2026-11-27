import path from 'node:path';
import type { AcpExtension } from '../acp/extension.js';
import { dropAgyLog, agyLogDir } from './connection.js';
import { AGY_ASK_TOOL, agyAnswerPrompt, agyQuestion } from './questions.js';
import { agyRulesFreeDir, rulesFreeArgs } from './rules-free.js';
import { type AgySignIn, agyApiArgs, agyApiDataDir, agySignInEnv } from './sign-in.js';
import { agyFailure, agyModel, agyThought, systemMeta } from './run-parts.js';
import { agyBrainDir, agyDataDir, dropAgySession, tidyAgyData } from './sessions.js';
import { agyDialect, belugaToolOf } from './tools.js';

/** What of Beluga's tools Antigravity gets, in bytes of their definitions (it keeps about 42 KB). */
export const AGY_TOOL_BUDGET = 36_000;

export interface AgyExtensionOptions {
  /** Where Antigravity keeps its conversations (its own notes are written there). */
  readonly dataDir?: string;
  /** The Antigravity CLI's executable; unset: findAgy(). */
  readonly bin?: string;
  /** Which of the two it is (sign-in.ts): your Google account (the default) or a Gemini API key. */
  readonly signIn?: AgySignIn;
}

/**
 * What Antigravity does past ACP, for the core: its instructions in its system prompt (`_meta`), its
 * thinking levels, its tools' names, its own notes, its ask_question, /compact, its failures in its
 * own words, what its looks leave behind, and its sign-in (sign-in.ts): on your Google account it's
 * for you at it alone; on an API key, a folder of its own. Its quota isn't read: only its internal
 * APIs have it, and Google said reading them can get an account flagged.
 */
export function antigravityExtension(opts: AgyExtensionOptions = {}): AcpExtension {
  const api = opts.signIn === 'api-key';
  const data = opts.dataDir ?? (api ? agyApiDataDir() : agyDataDir());
  return {
    instructions: systemMeta,
    // Over HTTP, as before the core: agy takes MCP servers over HTTP without saying so in its initialize.
    mount: 'http',
    tools: { dialect: agyDialect, belugaToolOf },
    model: agyModel,
    effort: (effort) => {
      const value = agyThought(effort);
      return value ? { id: 'thought_level', value } : undefined;
    },
    // Its notes folder, by either path: agy may name it through Beluga's Gemini folder (rules-free.ts), a link to the same one.
    ownNote: (sessionId, file) =>
      [data, ...(opts.dataDir || api ? [] : [path.join(agyRulesFreeDir(), 'antigravity-cli')])].some((dir) => {
        const rel = path.relative(agyBrainDir(sessionId, dir), file);
        return !rel.startsWith('..') && !path.isAbsolute(rel);
      }),
    questions: { tool: AGY_ASK_TOOL, detect: agyQuestion, answer: agyAnswerPrompt },
    compact: true,
    // run_command past its WaitMsBeforeAsync goes on as a background task; agy tells its model to end the turn and wait.
    backgroundCommands: true,
    // It keeps about 42 KB of a client's tool definitions and drops the larger ones past it (tool-budget.ts): Beluga's fit in less.
    toolBudget: AGY_TOOL_BUDGET,
    // On your Google account, agy is yours to drive alone (sign-in.ts).
    failure: agyFailure,
    tidy: () => tidyAgyData(data),
    dropSession: (sessionId) => dropAgySession(sessionId, data),
    afterLook: (pid) => dropAgyLog(pid, agyLogDir(data)),
    // Your project's rules, not Antigravity's global ones; on an API key, its own folder.
    launch: () => (api ? agyApiArgs() : rulesFreeArgs()),
    // What picks its sign-in is its own, never inherited from your shell.
    environment: (env) => agySignInEnv(api ? 'api-key' : 'google', env),
  };
}
