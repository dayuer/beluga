import { promises as fs } from 'node:fs';
import path from 'node:path';
import { belugaHome } from '../../../core/home.js';
import { GLOBAL_RULES, agyGeminiHome, mirrorFolder } from './rules-free.js';

/**
 * Antigravity comes as two agents in Beluga, one per sign-in, each with its own `agy` folder:
 *
 * - **Antigravity** (`antigravity`): your Google account, the one `agy` in Terminal signs in to.
 *   Beluga runs it as any agent, plans and Sentinels included, once you've picked it. Google's own
 *   words on its forum ask that an app not drive a personal account on its own; that's yours to weigh.
 * - **Antigravity (API key)** (`antigravity-api`): a Gemini API key, in a folder of its own
 *   (~/.beluga/agy-api). The Gemini API's terms let an app drive it. Its key is GEMINI_API_KEY in Settings › Environment (your own variables), and it
 *   never falls back to your Google account: without a key it says so.
 *
 * Neither reads Antigravity's internal APIs (its quota): Google said that can get an account flagged.
 */
export type AgySignIn = 'google' | 'api-key';

/** The API-key agent's runtime id. */
export const AGY_API_ID = 'antigravity-api';

/** Variables that pick how agy signs in: never inherited, so a key in your shell doesn't change which account a run uses. */
export const AGY_SIGN_IN_VARS = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_CLOUD_QUOTA_PROJECT',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'GCLOUD_PROJECT',
  'CLOUDSDK_CORE_PROJECT',
  'GEMINI_HOME',
] as const;

const SIGN_IN_VARS = new Set<string>(AGY_SIGN_IN_VARS);

/** Where the key comes from (the daemon sets it to your Settings › Environment; unset: this process's GEMINI_API_KEY). */
let keySource: () => string | undefined = () => process.env.GEMINI_API_KEY;
export function setAgyApiKeySource(source: () => string | undefined): void {
  keySource = source;
}
export const agyApiKey = (): string | undefined => keySource()?.trim() || undefined;

/** A run's variables for this sign-in: none of yours that pick an account, and the key for the API one. */
export function agySignInEnv(signIn: AgySignIn, env: NodeJS.ProcessEnv, key: string | undefined = signIn === 'api-key' ? agyApiKey() : undefined): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  // Windows' variable names ignore case.
  for (const [name, value] of Object.entries(env)) if (!SIGN_IN_VARS.has(name.toUpperCase())) out[name] = value;
  return signIn === 'api-key' && key ? { ...out, GEMINI_API_KEY: key } : out;
}

/** The API-key agent's Gemini folder (~/.beluga/agy-api). */
export const agyApiHome = (home: string = belugaHome()): string => path.join(home, 'agy-api');
/** Where it keeps its conversations, notes and log (its own `antigravity-cli`, never yours). */
export const agyApiDataDir = (home: string = belugaHome()): string => path.join(agyApiHome(home), 'antigravity-cli');

/** What of ~/.gemini isn't linked into the API-key folder: the global rules, and agy's own data (its settings say how it signs in). */
const API_LEFT_OUT = (name: string): boolean => GLOBAL_RULES.has(name) || name === 'antigravity-cli';

let making: Promise<unknown> = Promise.resolve();

/**
 * The API-key agent's flags: `--gemini-dir` on its own folder, made ready now. Your skills,
 * settings and plugins are linked in from ~/.gemini (not the global rules); its `antigravity-cli` is
 * its own, with `auth.type` set to the API key in its settings, so it never signs in with Google.
 */
export function agyApiArgs(opts: { readonly real?: string; readonly dir?: string; readonly platform?: NodeJS.Platform } = {}): Promise<readonly string[]> {
  const run = async (): Promise<readonly string[]> => {
    const dir = opts.dir ?? agyApiHome();
    const data = path.join(dir, 'antigravity-cli');
    await fs.mkdir(data, { recursive: true, mode: 0o700 });
    // Links need rights you may not have on Windows: there it starts with an empty folder of its own.
    if ((opts.platform ?? process.platform) !== 'win32') {
      const real = opts.real ?? agyGeminiHome();
      await mirrorFolder(real, dir, API_LEFT_OUT);
      await mirrorFolder(path.join(real, 'config'), path.join(dir, 'config'), (n) => GLOBAL_RULES.has(n));
    }
    await writeAuth(path.join(data, 'settings.json'));
    return [`--gemini-dir=${dir}`];
  };
  const next = making.then(run, run);
  making = next.catch(() => undefined);
  return next;
}

/** Its settings with `auth.type` on the API key (what else agy keeps there stays). Never holds the key. */
async function writeAuth(file: string): Promise<void> {
  let settings: Record<string, unknown> = {};
  try {
    const read = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
    if (read && typeof read === 'object' && !Array.isArray(read)) settings = read as Record<string, unknown>;
  } catch {
    // None yet, or unreadable: a fresh one.
  }
  const auth = settings.auth && typeof settings.auth === 'object' ? (settings.auth as Record<string, unknown>) : {};
  if (auth.type === 'gemini-api-key') return;
  const next = JSON.stringify({ ...settings, auth: { ...auth, type: 'gemini-api-key' } }, null, 2);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${next}\n`, { mode: 0o600 });
  await fs.rename(tmp, file);
}

/** The API-key agent with no key. */
export const AGY_NO_KEY = 'Antigravity (API key) needs a Gemini API key: add GEMINI_API_KEY in Settings › Environment (aistudio.google.com/apikey).';
