/**
 * Words a customer may read (Synon Studio, decision no-code-leak): free text written by agents
 * or by you, with code, paths, file names, branches, ids, agent and model names, task KEYs and
 * secrets taken out. Pure string work, no imports, so the daemon, the hub and the app share it.
 * It runs its own fence rules rather than stripCode (whose imports aren't browser-safe here, and
 * which keeps inline code). See docs/superpowers/specs/2026-11-10-beluga-studio-design.md §4.2.
 *
 * It is the last line, not the only one: the view is built from a whitelist of fields first.
 */

export const OMITTED = '（技术细节已省略）';
export const CODE_OMITTED = '（代码已省略）';

const EXT =
  'tsx?|jsx?|mjs|cjs|json5?|ya?ml|toml|lock|env|sh|bash|zsh|py|rb|go|rs|java|kt|kts|swift|m|mm|h|hpp|c|cc|cpp|cs|php|vue|svelte|css|scss|less|html?|md|mdx|sql|gradle|plist|xcconfig|pbxproj|storyboard|xib|dart|ini|cfg|conf|log|txt|csv|xml|wasm|map|patch|diff';

/** Words that look like a KEY and aren't one. */
const NOT_KEYS = new Set(['COVID-19', 'ISO-8601', 'UTF-8', 'UTF-16', 'SHA-1', 'SHA-256', 'MP-3', 'H-5', 'WCAG-2', 'IPV-4', 'IPV-6', 'TLS-1', 'HTTP-2']);

/** Agents, runtimes and models (any case). Words a customer would say too (Apple, Google) aren't here. */
const MODELS =
  /\b(?:claude(?:[-\s](?:code|opus|sonnet|haiku|fable|instant))?(?:[-\s]?\d+(?:[-.]\d+)*)?|opus(?:[-\s]?\d+(?:[-.]\d+)*)?|sonnet(?:[-\s]?\d+(?:[-.]\d+)*)?|haiku(?:[-\s]?\d+(?:[-.]\d+)*)?|fable(?:[-\s]?\d+(?:[-.]\d+)*)?|codex|gpt[-\s]?\d+(?:[-.]\w+)*|gpt|o[134](?:-mini)?|gemini(?:[-\s]?\d+(?:[-.]\w+)*)?|llama[-\s]?\d*|mistral|ollama|qwen\d*|deepseek|anthropic|openai|agent sdk|mcp)\b/gi;

const replacers: ReadonlyArray<readonly [RegExp, string]> = [
  // Markdown images, whole (alt text too); links keep their words.
  [/!\[[^\]]*\]\([^)]*\)/g, ''],
  [/\[([^\]]*)\]\([^)]*\)/g, '$1'],
  // Secrets.
  [/\bBearer\s+[\w.~+/=-]+/gi, ''],
  [/\b(?:sk|pk|rk)-[\w-]{6,}/g, ''],
  [/\b(?:ghp|gho|ghs|ghu|github_pat|xox[abprs]|glpat)_[\w-]{4,}/g, ''],
  [/\bAKIA[0-9A-Z]{8,}/g, ''],
  [/\beyJ[\w-]{8,}(?:\.[\w-]+){0,2}/g, ''],
  [/\b[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/g, ''],
  // URLs: only the scheme and host stay, and none that carry a token.
  [/https?:\/\/[^\s)<>"'，。]*(?:token|key|secret|sig|signature|auth|password)=[^\s)<>"'，。]*/gi, ''],
  [/(https?:\/\/[^\s/?#)<>"'，。]+)[^\s)<>"'，。]*/g, '$1'],
  [/\bfile:\/\/\S+/gi, ''],
  // Ids: conversations, workspaces, plans; long hex and base64.
  [/\b(?:conv|ws|client|plan|topic):[\w:.-]+/gi, ''],
  [/\b(?:pl|ws|wt|iss|dev|sess|op)_[\w-]{4,}/g, ''],
  [/\b[0-9a-f]{16,}\b/gi, ''],
  [/\b[A-Za-z0-9+/]{24,}={0,2}(?![\w/])/g, ''],
  // Branches.
  [/\b(?:plan|beluga|feature|feat|fix|bugfix|hotfix|release|chore|refs\/heads|origin)\/[\w./-]+/gi, ''],
  // Paths: absolute, home, relative, Windows, and three or more segments.
  [/(?:^|(?<=[\s(（"'“‘：:，,、；;。]))(?:~|\.{1,2})?\/[\w.@-]+(?:\/[\w.@-]*)*/g, ''],
  [/\b[A-Za-z]:\\[^\s]*/g, ''],
  [/(?:\.{1,2}\\|\b[\w.@-]+\\)[\w.@-]+(?:\\[\w.@-]+)*/g, ''],
  [/\b[\w.@-]+(?:\/[\w.@-]+){2,}\/?/g, ''],
  // File names: with a known extension, or a dot file.
  [new RegExp(`\\b[\\w@-]+(?:\\.[\\w@-]+)*\\.(?:${EXT})\\b`, 'gi'), ''],
  [/(?:^|(?<=[\s(（"'“‘：:，,、；;。]))\.[A-Za-z][\w.-]*/g, ''],
  [/\b(?:Podfile|Gemfile|Dockerfile|Makefile|Procfile|Brewfile|Rakefile)\b(?:\.lock)?/g, ''],
  // Models and agents.
  [MODELS, ''],
];

/** A task KEY (BLG-52), unless it's a word like COVID-19. */
const KEY = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

const CODE_WORDS = /^\s*(?:import\s|export\s|from\s|const\s|let\s|var\s|function\s|class\s|interface\s|type\s+\w+\s*=|return\b|def\s|async\s|await\s|if\s*\(|for\s*\(|while\s*\(|public\s|private\s|func\s|struct\s|enum\s|#include|package\s|<\/?[a-zA-Z][\w-]*[\s>/]|\}|\{|\/\/|#!)/;
const CODE_MARKS = /[{};]|=>|::|->|\(\)|\$\(|<\/|\/>|&&|\|\||===|!==/g;

/** Is this line code (not prose)? */
function codeLike(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  const marks = t.match(CODE_MARKS)?.length ?? 0;
  if (CODE_WORDS.test(t) && (marks >= 1 || /[=(<]/.test(t))) return true;
  if (marks >= 3) return true;
  // Mostly symbols: indentation plus punctuation, few letters of a language.
  const letters = (t.match(/[\p{L}]/gu) ?? []).length;
  return t.length >= 8 && marks >= 2 && letters / t.length < 0.5;
}

/** Fenced blocks (``` and ~~~, closed or not) → one placeholder each. */
function dropFences(text: string): string {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of text.split('\n')) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length && line.trim() === m[1]) fence = undefined;
      continue;
    }
    if (m) {
      fence = m[1];
      out.push(CODE_OMITTED);
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/** Code without a fence: a run of two or more code-like lines, or one line heavy with code. */
function dropBareCode(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    let j = i;
    while (j < lines.length && codeLike(lines[j]!)) j++;
    const run = j - i;
    if (run >= 2 || (run === 1 && (lines[i]!.match(CODE_MARKS)?.length ?? 0) >= 3)) {
      out.push(CODE_OMITTED);
      i = j;
    } else if (run === 1) {
      out.push(lines[i]!);
      i = j;
    } else {
      out.push(lines[i]!);
      i++;
    }
  }
  return out.join('\n');
}

/** How much there is to read: each CJK character, and each word of other scripts, counts one. */
const visible = (s: string): number => {
  const t = s.replaceAll(CODE_OMITTED, '');
  return (t.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []).length + (t.match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(w)).length;
};

/** Spaces and punctuation left behind by what was taken out. */
function tidy(s: string): string {
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/\(\s*\)|（\s*）|\[\s*\]|「\s*」|“\s*”|"\s*"|'\s*'/g, '')
    .replace(/\s+([，。、；：！？,.;:!?）)])/g, '$1')
    .replace(/([（(])\s+/g, '$1')
    .replace(/([，。、；：！？])\s+/g, '$1')
    .replace(/[、，；：]+([。！？])/g, '$1')
    .replace(/(?:和|与|及|或|and|or)\s*(?=[，,、；;。.！!？?]|$)/gm, '')
    .replace(/[，、,；;：:]\s*(?=[，、,；;：:])/g, '')
    .replace(/^[\s，、,；;：:]+/gm, '')
    .replace(/(?:\s*(?:的|在|用|和|与|，|,|、))+\s*([。.！!？?])/g, '$1')
    .replace(/ +$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Free text → words a customer may read, at most `max` characters. When most of a sentence was
 * technical, the whole of it becomes a placeholder rather than a broken half.
 */
export function sanitizeText(input: string, max = 4000): string {
  if (!input) return '';
  let s = input.replace(/\r\n?/g, '\n');
  s = dropFences(s);
  s = s.replace(/`{1,2}[^`\n]*`{1,2}/g, '');
  s = s.replace(/`/g, '');
  s = dropBareCode(s);
  const before = visible(s);
  for (const [re, to] of replacers) s = s.replace(re, to);
  s = s.replace(KEY, (k) => (NOT_KEYS.has(k.toUpperCase()) ? k : ''));
  s = tidy(tidy(s));
  const after = visible(s);
  if (before >= 20 && (after < 4 || after < before * 0.25)) s = OMITTED;
  else if (!after && before) s = s.includes(CODE_OMITTED) ? CODE_OMITTED : OMITTED;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** One line (a title, a criterion): sanitized, newlines folded. */
export const sanitizeLine = (input: string, max = 400): string => sanitizeText(input.replace(/\s*\n\s*/g, ' '), max);

/** Does the text still carry anything the rules take out? (for tests and for the hub's own check) */
export const looksTechnical = (text: string): boolean => sanitizeText(text, Number.MAX_SAFE_INTEGER) !== tidy(text.replace(/\r\n?/g, '\n'));
