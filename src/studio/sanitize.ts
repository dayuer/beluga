/**
 * Words a customer may read (Synon Studio, decision no-code-leak): free text written by agents
 * or by you, with code, paths, file names, branches, ids, agent and model names, task KEYs and
 * secrets taken out. Pure string work, no imports, so the daemon, the hub and the app share it.
 * It runs its own fence rules rather than stripCode (whose imports aren't browser-safe here, and
 * which keeps inline code). See docs/superpowers/specs/2026-11-10-beluga-studio-design.md §4.2.
 *
 * It is the last line, not the only one: the view is built from a whitelist of fields first.
 * Lookalikes are folded first (full-width letters, other dashes and slashes, zero-width and
 * format characters, Cyrillic and Greek letters inside Latin words), so ｃlaude, cl​aude and
 * BLG‑52 are caught like claude and BLG-52. Every repetition is bounded: linear on long input.
 */

export const OMITTED = '（技术细节已省略）';
export const CODE_OMITTED = '（代码已省略）';

/** Input past this is cut before any rule runs (a view's texts are 4000 at most). */
const MAX_INPUT = 20_000;

const EXT =
  'tsx?|jsx?|mjs|cjs|mts|cts|json5?|jsonc|ya?ml|toml|lock|env|sh|bash|zsh|fish|ps1|bat|py|pyc|rb|go|rs|java|kt|kts|swift|m|mm|h|hpp|c|cc|cpp|cs|php|vue|svelte|astro|css|scss|sass|less|html?|wxml|wxss|wxs|md|mdx|sql|prisma|graphql|gql|proto|gradle|plist|xcconfig|pbxproj|xcodeproj|xcworkspace|entitlements|storyboard|xib|dart|ini|cfg|conf|log|txt|csv|tsv|xml|wasm|map|patch|diff|pem|key|crt|cer|p12|pfx|jks|keystore|mobileprovision|sqlite|db|npmrc|gitignore|dockerignore|editorconfig|apk|aab|ipa|jar|war|tf|tfvars|png|jpe?g|gif|svg|webp|ico|zip|tar|gz|tgz|dmg|pdf';


/** Agents, runtimes and models (any case), with their versions (claude-opus-5-5, GPT-5.1-codex-max, Sonnet4.5, [1m]). */
const MODELS =
  /\b(?:claude|opus|sonnet|haiku|fable|codex|chatgpt|gpt|gemini|llama|mistral|ollama|qwen|deepseek|anthropic|openai|copilot|grok|kimi|glm|minimax|doubao)(?:[-_.]?[\w.]{0,12})(?:[-_.[][\w.\]]{1,14}){0,6}|\bo[134](?:-mini)?\b|\bagent sdk\b|\bmcp(?:__\w{1,80})?\b/gi;

/** Two lowercase words around a slash that are prose, not a path. */
const PROSE_PAIRS = new Set(['and/or', 'either/or', 'he/she', 'his/her', 'him/her', 'km/h', 'm/s', 'w/o', 'n/a', 'yes/no', 'on/off', 'read/write', 'input/output', 'client/server', 'light/dark', 'true/false', 'i/o', 'pass/fail', 'day/night', 'am/pm']);
/** Names that end like a file and are products. */
const PRODUCT_FILES = /^(?:node|vue|next|nuxt|three|d3|express|react|chart|ember|backbone|angular|svelte|solid|alpine|moment|day|p5)\.js$/i;
/** iPhone-like words that look like identifiers. */
const PRODUCT_WORDS = new Set(['iphone', 'ipad', 'ios', 'ipados', 'macos', 'watchos', 'tvos', 'visionos', 'ebay', 'icloud', 'imessage', 'ipod', 'itunes', 'imac', 'airpods', 'wechat', 'youtube', 'github', 'gitlab', 'paypal', 'linkedin', 'javascript', 'typescript', 'webview', 'mysql', 'postgresql', 'mongodb']);
/** KEY-like words that are names of things (TOP-10, IOS-17, COVID-19). */
const NOT_KEY_PREFIX = new Set(['TOP', 'IOS', 'ANDROID', 'COVID', 'ISO', 'UTF', 'SHA', 'MP', 'H', 'WCAG', 'IPV', 'TLS', 'HTTP', 'USB', 'PS', 'RTX', 'GTX', 'GPT', 'A', 'B', 'C', 'F', 'M', 'Q', 'V', 'X', 'Y', 'Z', 'PM', 'AM', 'SARS', 'MIL', 'EN', 'GB', 'ES', 'IEC', 'RFC', 'PCI', 'SOC', 'HIPAA', 'MPEG', 'AES', 'RSA', 'SHA', 'WPA', 'DDR', 'LPDDR', 'PCIE', 'USB']);

// Path segments: the first ASCII (a path starts like one), the rest any letters (源码/登录.ts).
const SEG0 = '[A-Za-z0-9_.@$\\[\\]-]{1,120}';
const SEG = '[\\p{L}\\p{N}_.@$\\[\\]()-]{1,120}';

type Replacer = string | ((match: string, ...groups: string[]) => string);

const replacers: ReadonlyArray<readonly [RegExp, Replacer]> = [
  // HTML: scripts and styles whole, other tags.
  [/<(script|style)\b[^>]{0,500}>[\s\S]{0,20000}?<\/\1\s*>/gi, ''],
  [/<\/?[a-zA-Z][\w-]{0,40}(?:\s[^<>]{0,500})?\/?>/g, ''],
  // Markdown: images whole (alt text too); links and reference links keep their words; definitions go.
  [/!\[[^\]\n]{0,500}\]\([^)\n]{0,2000}\)/g, ''],
  [/!\[[^\]\n]{0,500}\]\[[^\]\n]{0,200}\]/g, ''],
  [/\[([^\]\n]{0,500})\]\([^)\n]{0,2000}\)/g, '$1'],
  [/\[([^\]\n]{0,500})\]\[[^\]\n]{0,200}\]/g, '$1'],
  [/^[ \t]{0,3}\[[^\]\n]{1,200}\]:[^\n]*$/gm, ''],
  // Secrets: PEM blocks, tokens, key = value.
  [/-----BEGIN [A-Z ]{1,40}-----[\s\S]{0,20000}?(?:-----END [A-Z ]{1,40}-----|$)/g, ''],
  [/\bBearer\s+[\w.~+/=-]{1,4000}/gi, ''],
  [/\b(?:sk|pk|rk)[-_](?:live[-_]|test[-_]|ant[-_]|proj[-_])?[\w-]{3,400}/g, ''],
  [/((?:密码|口令|密钥|私钥|令牌|秘钥)\s{0,3}(?:是|为|:|：)?\s{0,3})[!-~]{3,200}/g, '$1'],
  [/\b(?:ghp|gho|ghs|ghu|ghr|github_pat|glpat|xox[abprs]|xapp)[-_][\w-]{4,400}/g, ''],
  [/\bAKIA[0-9A-Z]{8,40}/g, ''],
  [/\bAIza[\w-]{20,60}/g, ''],
  [/\beyJ[\w-]{8,4000}(?:\.[\w-]{0,4000}){0,2}/g, ''],
  [/["']?\b[\w-]{0,40}(?:key|token|secret|passwd|password|pwd|credential|auth)[\w-]{0,40}["']?\s*[:=]\s*(?:"[^"\n]{0,2000}"|'[^'\n]{0,2000}'|[^\s,，;；}、。]{1,2000})/gi, ''],
  [/\b[A-Z][A-Z0-9_]{2,60}\s*=\s*(?:"[^"\n]{0,2000}"|'[^'\n]{0,2000}'|\S{1,2000})/g, ''],
  // Remotes and URLs: git@host:path, any URL with a login or a token, other schemes; http(s) keeps only its host.
  [/\b[\w.-]{1,100}@[\w.-]{1,200}:[\w./~-]{1,500}/g, ''],
  [/\b[a-z][\w+.-]{1,20}:\/\/[^\s/@]{1,200}@[^\s)<>"'，。]{0,2000}/gi, ''],
  [/https?:\/\/[^\s)<>"'，。]{0,2000}?(?:token|key|secret|sig|signature|auth|password|code)=[^\s)<>"'，。]{0,2000}/gi, ''],
  [/\b(?!https?:)[a-z][\w+.-]{1,20}:\/\/[^\s)<>"'，。]{1,2000}/gi, ''],
  [/(https?:\/\/[^\s/?#)<>"'，。]{1,200})[^\s)<>"'，。]{0,2000}/g, '$1'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, ''],
  [/\blocalhost(?::\d{1,5})?\b/gi, ''],
  [/(\b[\w-]{1,63}(?:\.[\w-]{1,63}){0,10}\.[a-z]{2,10})\/[^\s，。、)]{0,2000}/gi, '$1'],
  [/\S{0,2000}%(?:2F|5C)\S{0,2000}/gi, ''],
  // Ids: UUIDs, conversations, workspaces, plans, questions; long hex, commit hashes, base64.
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ''],
  [/\b(?:conv|ws|client|plan|topic|decide|ask|approval|issue|task):[\w:.-]{1,200}/gi, ''],
  [/\b(?:pl|ws|wt|iss|dev|sess|op|ap|ev|run)[_-][\w-]{2,100}/g, ''],
  [/\b[0-9a-f]{16,}\b/gi, ''],
  [/\b(?=[0-9a-f]{0,40}\d)(?=[0-9a-f]{0,40}[a-f])[0-9a-f]{7,40}\b/gi, ''],
  [/(?<![\w/])[A-Za-z0-9+/]{24,4000}={0,2}(?![\w/])/g, ''],
  // Internal method names (plans.approve, session.submit…).
  [/\b(?:plans|session|questions|host|companion|board|files|git|studio|views|voice|sentinel|workspace|worktree|issues|tasks)\.[a-z][\w]{1,60}(?:\.[a-z]\w{0,60}){0,3}\b/g, ''],
  // Shell commands.
  [/\b(?:npm|npx|yarn|pnpm|bun|git|pip3?|brew|curl|wget|sudo|docker|kubectl|cargo|xcodebuild|gradlew?|pod|tsc|vitest|jest|node|python3?|deno|wrangler|expo|eas|fastlane|asc|beluga|rm|mkdir|chmod|cd|export|ssh|scp)\s+[-\w:@./=~]{1,200}(?:\s+[-\w:@./=~]{1,200}){0,4}/g, ''],
  [/\s*(?:&&|\|\|)\s*/g, ' '],
  // Branches.
  [/\b(?:plan|beluga|feature|feat|fix|bugfix|hotfix|release|chore|refs\/heads|origin|claude|codex)\/[\w./-]{1,200}/gi, ''],
  [/\b[a-z]{2,8}-\d{1,6}-[\w-]{1,100}\b/gi, ''],
  // Paths: absolute and home (two segments or more), relative, Windows, three or more segments.
  [new RegExp(`(?<![A-Za-z0-9_.])(?:~|\\.{1,2})?\\/${SEG0}(?:\\/${SEG}){1,40}\\/?`, 'gu'), ''],
  [new RegExp(`(?<![A-Za-z0-9_.])(?:~|\\.{1,2})\\/${SEG}`, 'gu'), ''],
  [/\b[A-Za-z]:\\[^\s]{0,2000}/g, ''],
  [/(?:\.{1,2}\\|\b[\w.@-]{1,120}\\)[\w.@-]{1,120}(?:\\[\w.@-]{1,120}){0,40}/g, ''],
  [new RegExp(`\\b${SEG0}(?:\\/${SEG}){2,40}\\/?`, 'gu'), ''],
  [/(?<![\w./])[a-z][\w.-]{0,60}\/[a-z][\w.-]{0,80}(?![\w/])/g, (m) => (PROSE_PAIRS.has(m.toLowerCase()) ? m : '')],
  // File names: a/b.ext, name.ext, dot files, well-known ones.
  [new RegExp(`\\b[\\w.@-]{1,120}\\/[\\p{L}\\p{N}_.@-]{1,120}\\.(?:${EXT})\\b`, 'giu'), ''],
  [new RegExp(`(?<![\\w.])[\\p{L}\\p{N}_@$-]{1,120}(?:\\.[\\p{L}\\p{N}_@$-]{1,60}){0,6}\\.(?:${EXT})\\b`, 'giu'), (f) => (PRODUCT_FILES.test(f) ? f : '')],
  [/(?<![\w.])\.[A-Za-z][\w.-]{0,60}/g, ''],
  [/\b(?:Podfile|Gemfile|Dockerfile|Makefile|Procfile|Brewfile|Rakefile|Fastfile|Appfile|Cartfile)\b(?:\.lock)?/g, ''],
  // Identifiers: snake_case (tools, folders), camelCase (functions).
  [/\b_{0,2}[a-z][a-z0-9]{0,40}(?:_{1,2}[a-z0-9]{1,40}){1,10}_{0,2}\b/g, ''],
  [/\b[a-z][a-z0-9]{0,40}(?:[A-Z][a-z0-9]{0,40}){1,10}\b/g, (w) => (PRODUCT_WORDS.has(w.toLowerCase()) ? w : '')],
  // Models and agents.
  [MODELS, ''],
];

/** A task KEY (BLG-52), unless it's a word like COVID-19. */
const KEY = /#?\b([A-Z][A-Z0-9]{0,9})[-_#]\d{1,6}[a-z]?\b/g;

const CODE_WORDS =
  /^\s*(?:import\s|export\s|from\s|const\s|let\s|var\s|function\b|class\s|interface\s|type\s+\w+\s*=|return\b|def\s|async\s|await\s|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|public\s|private\s|func\s|struct\s|enum\s|#include|package\s|<\/?[a-zA-Z][\w-]*[\s>/]|\}|\{|\/\/|#!|\$\s)/;
const CODE_MARKS = /[{}]|;\s*$|=>|::|->|\(\)|\$\(|<\/|\/>|&&|\|\||===|!==/g;
const CALL = /\b[A-Za-z_$][\w$]{0,60}(?:\.[A-Za-z_$][\w$]{0,60}){0,6}\([^()\n]{0,200}\)/;

/** Is this line code (not prose)? */
function codeLike(line: string): boolean {
  const t = line.replace(/^[\s>]*/, '');
  if (!t) return false;
  const marks = t.match(CODE_MARKS)?.length ?? 0;
  if (CODE_WORDS.test(t) && (marks >= 1 || /[=(<]/.test(t))) return true;
  if (marks >= 3) return true;
  // Mostly symbols: punctuation and identifiers, few words of a language.
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  return t.length >= 8 && marks >= 2 && letters / t.length < 0.5;
}

/** A fence's opening (``` or ~~~), after any quote, list marker or indentation. */
const FENCE = /^(?:[ \t]*(?:>[ \t]?)*(?:[-*+]|\d{1,3}[.)])?[ \t]*)(`{3,}|~{3,})/;

/** Fenced blocks (closed or not, quoted, in a list, indented) → one placeholder each. */
function dropFences(text: string): string {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of text.split('\n')) {
    const m = FENCE.exec(line);
    if (fence) {
      if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length) fence = undefined;
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

const indented = (line: string): boolean => /^(?: {4}|\t)/.test(line) && line.trim() !== '';

/** Code without a fence: a run of code-like or indented lines, or one line that is plainly code. */
function dropBareCode(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    let j = i;
    while (j < lines.length && (codeLike(lines[j]!) || (indented(lines[j]!) && (j > i || (j + 1 < lines.length && indented(lines[j + 1]!)))))) j++;
    const run = j - i;
    const one = lines[i]!;
    if (run >= 2 || (run === 1 && ((one.match(CODE_MARKS)?.length ?? 0) >= 3 || CODE_WORDS.test(one.replace(/^[\s>]*/, '')) || (indented(one) && CALL.test(one))))) {
      out.push(CODE_OMITTED);
      i = j;
    } else {
      out.push(one);
      i = Math.max(j, i + 1);
    }
  }
  return out.join('\n');
}

// ---- Lookalikes ----

const DASHES = /[‐-―−⁃﹘﹣－­]/g;
const SLASHES = /[／⁄∕⧸]/g;
const BACKSLASHES = /[＼∖⧹]/g;
/** Zero-width, joiners, bidi and other format characters (not visible, used to split words). */
const INVISIBLE = /[\p{Cf}᠎ㅤﾠᅟᅠ]/gu;
/** Cyrillic and Greek letters drawn like Latin ones. */
const HOMOGLYPHS: Readonly<Record<string, string>> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', к: 'k', м: 'm', т: 't', н: 'h', в: 'b', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ӏ: 'l', ԛ: 'q', ԝ: 'w', г: 'r',
  А: 'A', Е: 'E', О: 'O', Р: 'P', С: 'C', У: 'Y', Х: 'X', К: 'K', М: 'M', Т: 'T', Н: 'H', В: 'B', І: 'I', Ј: 'J', Ѕ: 'S', Ԁ: 'D', Ӏ: 'I',
  ο: 'o', α: 'a', ε: 'e', ρ: 'p', ν: 'v', κ: 'k', τ: 't', ι: 'i', υ: 'u', χ: 'x', γ: 'y', ω: 'w',
  Ο: 'O', Α: 'A', Ε: 'E', Ρ: 'P', Ν: 'N', Κ: 'K', Τ: 'T', Ι: 'I', Υ: 'Y', Χ: 'X', Β: 'B', Ζ: 'Z', Η: 'H', Μ: 'M',
};
const HOMOGLYPH = new RegExp(`[${Object.keys(HOMOGLYPHS).join('')}]`, 'g');

/**
 * Fold what hides a path, a name or a KEY: full-width ASCII (letters, digits and code punctuation;
 * the Chinese comma, full stop and brackets stay), other dashes and slashes, invisible characters,
 * and Cyrillic or Greek letters inside a word that also has Latin ones.
 */
export function foldLookalikes(text: string): string {
  return text
    .replace(INVISIBLE, '')
    .replace(/[０-９Ａ-Ｚａ-ｚ＃＄％＆＊＋．＜＝＞＠［］＾＿｀｛｜｝～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(DASHES, '-')
    .replace(SLASHES, '/')
    .replace(BACKSLASHES, '\\')
    .replace(/[\p{L}\p{N}_-]{1,200}/gu, (w) => (/[A-Za-z0-9]/.test(w) || allLookalike(w) ? w.replace(HOMOGLYPH, (c) => HOMOGLYPHS[c]!) : w));
}

/** A word made only of lookalikes (сlaude spelled in Cyrillic): treat it as Latin. */
const allLookalike = (w: string): boolean => w.length >= 3 && [...w].every((c) => /[A-Za-z0-9_-]/.test(c) || Object.hasOwn(HOMOGLYPHS, c));

const visibleRe = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
/** How much there is to read: each CJK character, and each word of other scripts, counts one. */
const visible = (s: string): number => {
  const t = s.replaceAll(CODE_OMITTED, '');
  return (t.match(visibleRe) ?? []).length + (t.match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(w)).length;
};

/** Spaces and punctuation left behind by what was taken out. */
function tidy(s: string): string {
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/\(\s*\)|（\s*）|\[\s*\]|「\s*」|“\s*”|"\s*"|'\s*'|<\s*>/g, '')
    .replace(/\s+([，。、；：！？,.;:!?）)])/g, '$1')
    .replace(/([（(])\s+/g, '$1')
    .replace(/([，。、；：！？])\s+/g, '$1')
    .replace(/(?:和|与|及|或|(?<![\w/])(?:and|or))\s{0,3}(?=[，,、；;。.！!？?]|$)/gm, '')
    .replace(/[，、,；;：:]\s{0,3}(?=[，、,；;：:])/g, '')
    .replace(/[、，；：]+([。！？])/g, '$1')
    .replace(/^[\s，、,；;：:]+/gm, '')
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
  let s = foldLookalikes(input.slice(0, Math.min(MAX_INPUT, Math.max(max * 4, 2000))).replace(/\r\n?/g, '\n'));
  s = dropFences(s);
  // Inline code of any number of backticks, across a line break or two.
  s = s.replace(/(`+)(?:(?!\1)[\s\S]){0,2000}?\1/g, '');
  s = s.replace(/`/g, '');
  s = dropBareCode(s);
  const before = visible(s);
  for (const [re, to] of replacers) s = typeof to === 'string' ? s.replace(re, to) : s.replace(re, to);
  s = s.replace(KEY, (k, prefix: string) => (NOT_KEY_PREFIX.has(prefix) ? k : ''));
  s = tidy(tidy(s));
  const after = visible(s);
  if (before >= 20 && (after < 4 || after < before * 0.25)) s = OMITTED;
  else if (!after && before) s = s.includes(CODE_OMITTED) ? CODE_OMITTED : OMITTED;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** One line (a title, a criterion): sanitized, newlines folded. */
export const sanitizeLine = (input: string, max = 400): string => sanitizeText(input.slice(0, MAX_INPUT).replace(/\s*\n\s*/g, ' '), max);
