import path from 'node:path';
import type { AcpDialect } from '../opencode/events.js';
import type { ToolCall } from '../opencode/acp.js';
import { type BelugaCall, patchFiles } from '../opencode/tools.js';

/**
 * Any ACP agent's tools as the tools Beluga already draws and judges, in Claude Code's names and
 * fields, without knowing the agent: a call is known by ACP's own `kind` (read, edit, delete,
 * move, search, execute, fetch), its `locations` (the files it touches) and its input, read by the
 * names agents use for them in any case (`path`, `file_path`, `filePath`, `Path`, `command`,
 * `CommandLine`, `cmd`…). An MCP tool comes as `<server>-<tool>`, `<server>_<tool>`,
 * `mcp_<server>_<tool>`, `mcp__<server>__<tool>` or `<server>/<tool>`, by agent: Beluga's own are
 * known only by the suites mounted for the run.
 */

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** The first of `keys` the input has, in any case (`Path`, `path`, `filePath`). */
function field(raw: Record<string, unknown>, ...keys: string[]): string | undefined {
  const lower = new Map(Object.entries(raw).map(([k, v]) => [k.toLowerCase().replace(/[_-]/g, ''), v]));
  for (const key of keys) {
    const v = lower.get(key.toLowerCase().replace(/[_-]/g, ''));
    if (typeof v === 'string' && v) return v;
    if (Array.isArray(v) && v.every((x) => typeof x === 'string') && v.length) return v.join(' ');
  }
  return undefined;
}

const PATH_KEYS = ['file_path', 'path', 'filePath', 'absolutePath', 'targetFile', 'fileName', 'file', 'target', 'uri'];
const COMMAND_KEYS = ['command', 'commandLine', 'cmd', 'script', 'args'];

/** How an agent may name a tool of server `s`. */
const forms = (s: string): string[] => [`mcp__${s}__`, `mcp_${s}_`, `${s}-`, `${s}_`, `${s}/`, `${s}.`, `${s}__`];

/**
 * Beluga's MCP name for an agent's tool (`mcp__beluga_board__task_get`), or undefined: not one of
 * Beluga's. The longest suite that names it wins (`beluga_board` over `beluga`).
 */
export function belugaToolOf(name: string, suites: readonly string[]): string | undefined {
  for (const s of [...suites].sort((a, b) => b.length - a.length)) {
    const form = forms(s).find((f) => name.startsWith(f) && name.length > f.length);
    if (form) return `mcp__${s}__${name.slice(form.length)}`;
  }
  return undefined;
}

/** A call's tool: an MCP tool of Beluga's (or one shaped like one) by its name or title; else its kind; else its name, else its title. */
export function acpTool(call: Pick<ToolCall, 'name' | 'kind' | 'title'>, suites: readonly string[] = []): string {
  for (const said of [call.name, call.title]) if (said && belugaToolOf(said, suites)) return said;
  if (call.kind && call.kind !== 'other') return call.kind;
  return call.name ?? call.title ?? 'tool';
}

/** A call's input as fields: a bare string (a patch) as `patch`; where it is from its locations when the input doesn't say; every location kept. */
export function acpInput(call: Pick<ToolCall, 'rawInput' | 'locations'>): Record<string, unknown> {
  const raw: unknown = call.rawInput;
  const fields = typeof raw === 'string' ? { patch: raw } : raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const paths = (call.locations ?? []).map((l) => l.path).filter(Boolean);
  return { ...fields, ...(paths[0] && !field(fields, ...PATH_KEYS) ? { path: paths[0] } : {}), ...(paths.length > 1 ? { locations: paths } : {}) };
}

const abs = (cwd: string, p: string | undefined): string | undefined => (p ? path.resolve(cwd, p.replace(/^file:\/\//, '')) : undefined);

/** Every file a call says it touches, as full paths: its path, then its other locations. */
function filesOf(raw: Record<string, unknown>, cwd: string): string[] {
  const first = abs(cwd, field(raw, ...PATH_KEYS));
  const more = (Array.isArray(raw.locations) ? raw.locations : []).filter((p): p is string => typeof p === 'string' && Boolean(p)).map((p) => path.resolve(cwd, p));
  return [...new Set([...(first ? [first] : []), ...more])];
}

/** Whether an edit makes a new file (its diff from /dev/null, or a create's whole text and no old one). */
const creates = (raw: Record<string, unknown>): boolean => /^--- a?\/dev\/null$/m.test(str(raw.diff) ?? '') || ((typeof raw.file_text === 'string' || typeof raw.content === 'string') && raw.old_string === undefined && raw.oldText === undefined);

/** One agent's call as Beluga's: one per file it touches (an Edit or Write each, a Read each). */
export function acpCalls(tool: string, raw: Record<string, unknown>, cwd: string, suites: readonly string[] = []): BelugaCall[] {
  const mcp = belugaToolOf(tool, suites);
  if (mcp) return [{ name: mcp, input: raw }];
  const files = filesOf(raw, cwd);
  switch (tool) {
    case 'read':
      return files.length ? files.map((f) => ({ name: 'Read', input: { file_path: f } })) : [{ name: 'Read', input: { file_path: '' } }];
    case 'edit':
    case 'delete':
    case 'move': {
      const patch = str(raw.patch);
      const patched = patch ? patchFiles(patch, cwd) : [];
      if (patched.length) return patched.map((f) => ({ name: f.kind === 'add' ? 'Write' : 'Edit', input: { file_path: f.file } }));
      const name = tool === 'edit' && !creates(raw) ? 'Edit' : 'Write';
      return files.length ? files.map((f) => ({ name, input: { file_path: f } })) : [{ name, input: { file_path: '' } }];
    }
    case 'execute':
      return [{ name: 'Bash', input: { command: field(raw, ...COMMAND_KEYS) ?? '', ...(str(raw.description) ? { description: raw.description } : {}) } }];
    case 'search': {
      const pattern = field(raw, 'pattern', 'query', 'regex', 'glob') ?? '';
      const where = files[0] ?? cwd;
      return raw.glob !== undefined || (!field(raw, ...PATH_KEYS) && pattern.includes('*')) ? [{ name: 'Glob', input: { pattern: pattern || '*', path: where } }] : [{ name: 'Grep', input: { pattern, path: where } }];
    }
    case 'fetch':
      return field(raw, 'url') ? [{ name: 'WebFetch', input: { url: field(raw, 'url') } }] : [{ name: 'WebSearch', input: { query: field(raw, 'query') ?? '' } }];
    case 'think':
    case 'switch_mode':
      return [];
    default:
      return [{ name: `mcp__acp__${tool.replace(/\W+/g, '_')}`, input: raw }];
  }
}

/** The generic dialect: inputs come with the call or in its updates; only a permission waits for them. */
export function acpDialect(suites: () => readonly string[]): AcpDialect {
  return {
    toolOf: (call) => acpTool(call, suites()),
    inputOf: acpInput,
    callsOf: acpCalls,
    needsInput: new Set(['read', 'edit', 'delete', 'move', 'execute']),
    inputKeys: new Set(['path', 'Path', 'file_path', 'filePath', 'FilePath', 'absolutePath', 'AbsolutePath', 'command', 'Command', 'cmd', 'commandLine', 'CommandLine', 'pattern', 'Pattern', 'query', 'patch', 'url', 'Url', 'locations']),
    writes: new Set(['edit', 'delete', 'move']),
  };
}
