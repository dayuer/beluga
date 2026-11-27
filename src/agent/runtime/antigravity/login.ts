import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { agyGeminiHome } from './rules-free.js';

/**
 * How the Antigravity CLI is signed in, as its own settings say (`security.auth.selectedType` in
 * ~/.gemini/settings.json, which Beluga's Gemini folder links to): with a Gemini API key or Vertex
 * AI, or with your personal Google account.
 *
 * Google's Antigravity terms let a personal account's agy be used by you at it, and not driven by
 * other agents or apps (its FAQ: wrapping agy in another coding agent or app is not supported; its
 * terms, section 6: no third-party software to access the service). So on a personal sign-in Beluga
 * is only a screen for agy: it sends what you typed, and starts nothing on its own. An API key or
 * Vertex goes by the Gemini API's terms instead, which let an app drive it.
 *
 * Anything else (no settings, a type Beluga doesn't know) counts as personal: agy signs in with
 * Google by default, and the cautious answer is the one that can't break its terms.
 */
export type AgyLogin = 'api' | 'personal';

const API_TYPES = new Set(['gemini-api-key', 'vertex-ai', 'compute-default-credentials']);

/** Its settings file. */
export const agySettingsFile = (home: string = agyGeminiHome()): string => path.join(home, 'settings.json');

let cached: { readonly file: string; readonly mtimeMs: number; readonly login: AgyLogin } | undefined;

/** How agy is signed in now (read again when its settings change). */
export function agyLogin(file: string = agySettingsFile()): AgyLogin {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return 'personal';
  }
  if (cached && cached.file === file && cached.mtimeMs === mtimeMs) return cached.login;
  let login: AgyLogin = 'personal';
  try {
    const type = (JSON.parse(readFileSync(file, 'utf8')) as { security?: { auth?: { selectedType?: unknown } } })?.security?.auth?.selectedType;
    if (typeof type === 'string' && API_TYPES.has(type)) login = 'api';
  } catch {
    // Unreadable: as personal.
  }
  cached = { file, mtimeMs, login };
  return login;
}

// agent-wording: claude (the way out is the Claude runtime, by name)
export const AGY_PERSONAL =
  'Antigravity is signed in with your own Google account, and Google’s terms let only you drive it, not another app or agent. So Beluga sends it only what you type: plans, tasks, Sentinels, a Continue Beluga sends on its own and other agents don’t start it. Use Claude for those, or sign agy in with a Gemini API key.';
