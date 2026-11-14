import path from 'node:path';
import type { AcpDialect } from '../opencode/events.js';
import type { ToolCall } from '../opencode/acp.js';
import type { BelugaCall } from '../opencode/tools.js';

/**
 * Antigravity's tools as the tools Beluga already draws and judges, in Claude Code's names and
 * fields. Its ACP calls carry the tool's own `name` (`run_command`, `read_file`, `write_file`,
 * `edit_file`…) with its input in PascalCase (`CommandLine`, `Path`, `Target`, `Replacement`), as
 * agy 1.5.8 sends them (recorded from a real one); a tool it names that Beluga doesn't know is read
 * by its ACP `kind`. An MCP tool is `mcp_<server>_<tool>` (`mcp_beluga_board_task_get` →
 * mcp__beluga_board__task_get), and its arguments aren't sent: Beluga's own are judged where they run.
 */

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const abs = (cwd: string, p: string | undefined): string | undefined => (p ? path.resolve(cwd, p) : undefined);

/** The first of `keys` the input has (any case: `Path`, `path`). */
function field(raw: Record<string, unknown>, ...keys: string[]): string | undefined {
  const lower = new Map(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
  for (const key of keys) {
    const v = str(lower.get(key.toLowerCase()));
    if (v) return v;
  }
  return undefined;
}

/** Beluga's MCP tool name for an Antigravity one (`mcp_<server>_<tool>`), or undefined: not one of Beluga's. */
export function belugaToolOf(name: string, suites: readonly string[]): string | undefined {
  const suite = [...suites].sort((a, b) => b.length - a.length).find((s) => name.startsWith(`mcp_${s}_`));
  return suite ? `mcp__${suite}__${name.slice(suite.length + 5)}` : undefined;
}

/** A call's tool: its own name, else its kind, else its title. */
export function agyTool(call: Pick<ToolCall, 'name' | 'kind' | 'title'>): string {
  return call.name ?? (call.kind && call.kind !== 'other' ? call.kind : (call.title ?? 'tool'));
}

/** A call's input as fields, without its words for people (`toolSummary`); where it is, from its locations when the input doesn't say. */
export function agyInput(call: Pick<ToolCall, 'rawInput' | 'locations'>): Record<string, unknown> {
  const raw: unknown = call.rawInput;
  const { toolSummary: _summary, ...fields } = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const at = call.locations?.[0]?.path;
  return at && !field(fields, 'Path', 'AbsolutePath', 'TargetFile', 'FilePath') ? { ...fields, Path: at } : fields;
}

const READS = new Set(['read_file', 'view_file', 'view_file_outline', 'view_code_item', 'read']);
const WRITES_NEW = new Set(['write_file', 'write_to_file', 'create_file']);
const EDITS = new Set(['edit_file', 'replace_file_content', 'multi_replace_file_content', 'delete_file', 'edit', 'delete', 'move']);
const COMMANDS = new Set(['run_command', 'send_command_input', 'execute']);
const LISTS = new Set(['list_dir', 'list_directory', 'find_by_name', 'glob']);
const GREPS = new Set(['grep_search', 'grep', 'codebase_search', 'search']);
const SEARCHES = new Set(['search_web', 'web_search']);
const FETCHES = new Set(['read_url_content', 'fetch']);

/** One Antigravity call as Beluga's. */
export function agyCalls(tool: string, raw: Record<string, unknown>, cwd: string, suites: readonly string[] = []): BelugaCall[] {
  const file = abs(cwd, field(raw, 'Path', 'AbsolutePath', 'TargetFile', 'FilePath', 'File'));
  if (READS.has(tool)) return [{ name: 'Read', input: { file_path: file ?? '' } }];
  if (WRITES_NEW.has(tool)) return [{ name: 'Write', input: { file_path: file ?? '' } }];
  if (EDITS.has(tool)) {
    const target = field(raw, 'Target', 'TargetContent');
    const replacement = typeof raw.Replacement === 'string' ? raw.Replacement : typeof raw.ReplacementContent === 'string' ? raw.ReplacementContent : undefined;
    return [{ name: 'Edit', input: { file_path: file ?? '', ...(target ? { old_string: target } : {}), ...(replacement !== undefined ? { new_string: replacement } : {}) } }];
  }
  if (COMMANDS.has(tool)) return [{ name: 'Bash', input: { command: field(raw, 'CommandLine', 'Command', 'Input') ?? '' } }];
  if (LISTS.has(tool)) return [{ name: 'Glob', input: { pattern: field(raw, 'Pattern', 'Glob') ?? '*', path: abs(cwd, field(raw, 'DirectoryPath', 'SearchDirectory', 'SearchPath', 'Path')) ?? cwd } }];
  if (GREPS.has(tool)) return [{ name: 'Grep', input: { pattern: field(raw, 'Query', 'Pattern') ?? '', path: abs(cwd, field(raw, 'SearchPath', 'SearchDirectory', 'DirectoryPath', 'Path')) ?? cwd } }];
  if (SEARCHES.has(tool)) return [{ name: 'WebSearch', input: { query: field(raw, 'Query') ?? '' } }];
  if (FETCHES.has(tool)) return [{ name: 'WebFetch', input: { url: field(raw, 'Url', 'URL') ?? '' } }];
  const mcp = belugaToolOf(tool, suites);
  return [{ name: mcp ?? `mcp__antigravity__${tool.replace(/\W+/g, '_')}`, input: raw }];
}

/** Antigravity's ACP dialect: every call's input comes with its `tool_call`, so nothing waits for it. */
export const AGY_DIALECT: AcpDialect = {
  toolOf: agyTool,
  inputOf: agyInput,
  callsOf: agyCalls,
  needsInput: new Set(),
  inputKeys: new Set(['Path', 'CommandLine', 'Query', 'Url', 'DirectoryPath']),
  writes: new Set([...WRITES_NEW, ...EDITS]),
};
