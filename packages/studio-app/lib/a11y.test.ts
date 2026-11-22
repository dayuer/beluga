import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A10 走查（SS-93）：屏幕上的每个可点元素都要有角色和名字，VoiceOver / TalkBack 才有得读。
 * 这里扫一遍组件与路由源码里的 `<Pressable>`：开的标签里必须有 `accessibilityRole`，
 * 并且要么有 `accessibilityLabel`，要么元素里面有 `<Text>`（文字自己就是名字）。
 *
 * 状态变化由 `accessibilityLiveRegion="polite"` 朗读：Card 的状态、StatusDot、SyncBanner、
 * ReceiptLine、UndoBar、InlineHint、PrimaryButton 的错误行各自有单测断言。
 */
const ROOT = path.resolve(__dirname, '..');

function walk(dir: string, files: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (full.endsWith('.tsx') && !full.includes('.test.')) files.push(full);
  }
}

/** 从 `<Pressable` 的开头找到这个元素的结束 `</Pressable>`（处理花括号与字符串）。 */
function elementEnd(src: string, start: number): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (inString) {
      if (ch === inString && src[i - 1] !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && src.startsWith('</Pressable>', i + 1)) {
      return i + 1 + '</Pressable>'.length;
    }
  }
  return src.length;
}

function openingTagEnd(src: string, start: number): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (inString) {
      if (ch === inString && src[i - 1] !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return i + 1;
  }
  return src.length;
}

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly problem: string;
}

function scan(): { findings: Finding[]; checked: number } {
  const files: string[] = [];
  walk(path.join(ROOT, 'components'), files);
  walk(path.join(ROOT, 'app'), files);

  const findings: Finding[] = [];
  let checked = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const opens = [...src.matchAll(/<Pressable\b/g)];
    for (const open of opens) {
      checked += 1;
      const start = open.index ?? 0;
      const tagEnd = openingTagEnd(src, start + '<Pressable'.length);
      const end = elementEnd(src, start);
      const opening = src.slice(start, tagEnd);
      const body = src.slice(tagEnd, end);
      const line = src.slice(0, start).split('\n').length;

      if (!/accessibilityRole=/.test(opening)) {
        findings.push({ file: path.relative(ROOT, file), line, problem: 'no accessibilityRole' });
      }
      if (!/accessibilityLabel=/.test(opening) && !/<Text\b/.test(body)) {
        findings.push({ file: path.relative(ROOT, file), line, problem: 'no accessibilityLabel and no <Text>' });
      }
    }
  }
  return { findings, checked };
}

describe('a11y: every tappable element has a role and a name', () => {
  it('finds no unlabelled or role-less Pressable', () => {
    const { findings, checked } = scan();
    expect(checked).toBeGreaterThan(30);
    expect(findings.map((f) => `${f.file}:${f.line} ${f.problem}`)).toEqual([]);
  });

  it('announces state changes politely', () => {
    const live = [
      'card/Card.tsx',
      'StatusDot.tsx',
      'SyncBanner.tsx',
      'ReceiptLine.tsx',
      'UndoBar.tsx',
      'InlineHint.tsx',
    ];
    for (const file of live) {
      const src = fs.readFileSync(path.join(ROOT, 'components', file), 'utf8');
      expect(src, file).toContain('accessibilityLiveRegion="polite"');
    }
  });
});
