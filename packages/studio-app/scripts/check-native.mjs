import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['lib', 'app', 'components'];
const FORBIDDEN = /(?<!\.)\b(window|document|localStorage|navigator)\b/;

/**
 * 剥离单行/多行注释与字符串字面量（'...'、"..."、`...`），保留换行符以便准确定位行号。
 * 模板字符串中的 `${...}` 表达式内容会被保留，以便继续检测其中的浏览器全局访问。
 */
export function stripCommentsAndStrings(source) {
  const out = [];
  const len = source.length;
  let i = 0;

  // 状态栈：'code' | 'single' | 'double' | 'template' | 'line-comment' | 'block-comment'
  // 遇到模板插值 `${` 时压入 `'tpl-expr'`，遇到配对 `}` 时弹回 `'template'`。
  const stack = ['code'];
  let braceDepth = 0;
  const tplBraceStack = [];

  const top = () => stack[stack.length - 1];

  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];
    const state = top();

    if (state === 'line-comment') {
      if (ch === '\n') {
        stack.pop();
        out.push('\n');
      } else {
        out.push(' ');
      }
      i += 1;
      continue;
    }

    if (state === 'block-comment') {
      if (ch === '*' && next === '/') {
        stack.pop();
        out.push('  ');
        i += 2;
      } else {
        out.push(ch === '\n' ? '\n' : ' ');
        i += 1;
      }
      continue;
    }

    if (state === 'single' || state === 'double') {
      const quote = state === 'single' ? "'" : '"';
      if (ch === '\\' && i + 1 < len) {
        out.push(next === '\n' ? ' \n' : '  ');
        i += 2;
        continue;
      }
      if (ch === quote || ch === '\n') {
        stack.pop();
        out.push(ch === '\n' ? '\n' : ' ');
      } else {
        out.push(' ');
      }
      i += 1;
      continue;
    }

    if (state === 'template') {
      if (ch === '\\' && i + 1 < len) {
        out.push(next === '\n' ? ' \n' : '  ');
        i += 2;
        continue;
      }
      if (ch === '`') {
        stack.pop();
        out.push(' ');
        i += 1;
        continue;
      }
      if (ch === '$' && next === '{') {
        tplBraceStack.push(braceDepth);
        braceDepth += 1;
        stack.push('code');
        out.push('  ');
        i += 2;
        continue;
      }
      out.push(ch === '\n' ? '\n' : ' ');
      i += 1;
      continue;
    }

    // state === 'code'
    if (ch === '/' && next === '/') {
      stack.push('line-comment');
      out.push('  ');
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      stack.push('block-comment');
      out.push('  ');
      i += 2;
      continue;
    }
    if (ch === "'") {
      stack.push('single');
      out.push(' ');
      i += 1;
      continue;
    }
    if (ch === '"') {
      stack.push('double');
      out.push(' ');
      i += 1;
      continue;
    }
    if (ch === '`') {
      stack.push('template');
      out.push(' ');
      i += 1;
      continue;
    }
    if (ch === '{') {
      braceDepth += 1;
    } else if (ch === '}') {
      braceDepth -= 1;
      if (
        tplBraceStack.length > 0 &&
        braceDepth === tplBraceStack[tplBraceStack.length - 1]
      ) {
        tplBraceStack.pop();
        stack.pop();
        out.push(' ');
        i += 1;
        continue;
      }
    }

    out.push(ch);
    i += 1;
  }

  return out.join('');
}

export function scanSourceForBrowserGlobals(source) {
  const rawLines = source.split('\n');
  const cleanLines = stripCommentsAndStrings(source).split('\n');
  const hits = [];

  for (let i = 0; i < cleanLines.length; i++) {
    const m = FORBIDDEN.exec(cleanLines[i] ?? '');
    if (m) {
      hits.push({
        line: i + 1,
        globalName: m[1],
        raw: (rawLines[i] ?? '').trim(),
      });
    }
  }
  return hits;
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

function runCli() {
  const hits = [];
  for (const d of DIRS) {
    for (const file of walk(join(ROOT, d))) {
      const source = readFileSync(file, 'utf8');
      for (const hit of scanSourceForBrowserGlobals(source)) {
        hits.push(`${relative(ROOT, file)}:${hit.line}: ${hit.globalName} -> ${hit.raw}`);
      }
    }
  }

  if (hits.length > 0) {
    console.error('check:native failed — browser globals found:\n' + hits.join('\n'));
    process.exit(1);
  }
  console.log('check:native passed: 0 browser globals in lib/, app/, components/.');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  runCli();
}
