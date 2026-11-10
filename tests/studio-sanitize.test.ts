import { describe, expect, it } from 'vitest';
import { CODE_OMITTED, OMITTED, sanitizeLine, sanitizeText } from '../src/studio/sanitize.js';

/** What must never reach a customer, whatever the case or the wrapping. */
const LEAKS = [
  /\//, // a path or a branch (prose here has no slashes of its own)
  /\.(?:ts|tsx|js|json|env|swift|kt|py|md|lock)\b/i,
  /`/,
  /~~~|```/,
  /\b(?:claude|opus|sonnet|haiku|fable|codex|gpt)/i,
  /\b[A-Z]{2,}-\d+\b/,
  /\b(?:ws|conv|pl)[:_]/,
  /sk-|ghp_|AKIA|Bearer/,
];

const clean = (s: string): void => {
  for (const re of LEAKS) expect(s, `${re} in «${s}»`).not.toMatch(re);
};

describe('sanitizeText: adversarial', () => {
  const cases: Record<string, string> = {
    inline: '我改了 `login()` 函数，然后跑了 `npm run build`，现在可以登录了',
    fence: '登录页做好了。\n```ts\nexport const a = 1;\n```\n请试一下。',
    tildeFence: '登录页做好了。\n~~~\nconst secret = process.env.KEY;\n~~~\n请试一下。',
    unclosed: '看这里：\n```\nrm -rf /\nmore code',
    absolute: '我改了 /Users/me/app/src/auth.ts 里的登录逻辑，现在会记住你',
    home: '配置在 ~/.beluga/daemon.json 里，已经更新好了，不用你操心',
    relative: '参照 ./src/a 和 ../lib/b 完成了登录页的样式调整',
    windows: '文件 C:\\repo\\a.ts 已经更新，登录页的按钮现在更大了',
    threeSegments: '改动在 src/studio/view.ts，客户视图现在只显示需要的内容',
    fileNames: '更新了 login.tsx、.env 和 package.json，还有 Podfile.lock，登录可以用了',
    branches: '代码在分支 plan/synon-studio-p1 和 beluga/blg-52-m1 上，feature/login 也合进来了',
    ids: '会话 ws:abc123def 和 conv:ws:9f8e7d6c5b4a3921 里讨论过，计划 pl_1a2b3c4d 也一样',
    models: '这次用 claude-opus-5-5 写，Claude Sonnet 检查，OPUS 复审，gpt-5 和 Codex、FaBlE 都没用',
    keys: 'BLG-52 做完了，接着做 BLG-44 和 KLD-7，登录页就能用了',
    secrets: '密钥 sk-ant-abc123def456 和 ghp_abcdEFGH1234，AKIAABCDEFGHIJKL，Bearer eyJhbGciOiJIUzI1NiJ9.x.y，API_KEY=abc 都配好了',
    links: '[文档](https://x.dev/a?token=1) 和 ![截图](/tmp/a.png) 都放好了，登录页可以看了',
    chineseWithPath: '我把src/auth/login.ts改好了，分支plan/ab12，用了claude-opus，登录可以用了',
    bareCode: '登录做好了：\n  const user = await login(email);\n  if (!user) { return null; }\n请试试',
    oneHeavyLine: '修好了 if (a && b) { run(); } 的问题，现在可以登录了',
  };

  for (const [name, input] of Object.entries(cases)) {
    it(name, () => {
      const out = sanitizeText(input);
      clean(out);
    });
  }

  it('fences become one placeholder and the prose around stays', () => {
    const out = sanitizeText(cases.fence!);
    expect(out).toContain('登录页做好了');
    expect(out).toContain(CODE_OMITTED);
    expect(out).toContain('请试一下');
    expect(out).not.toContain('export');
    expect(sanitizeText(cases.tildeFence!)).not.toContain('process');
    expect(sanitizeText(cases.unclosed!)).not.toContain('rm -rf');
  });

  it('keeps the words around what it takes out', () => {
    expect(sanitizeText(cases.absolute!)).toContain('登录逻辑');
    expect(sanitizeText(cases.keys!)).toContain('登录页就能用了');
    expect(sanitizeText(cases.links!)).toContain('文档');
    expect(sanitizeText(cases.links!)).not.toContain('截图');
    expect(sanitizeText(cases.links!)).not.toContain('token');
  });

  it('a sentence that was mostly technical becomes a placeholder', () => {
    expect(sanitizeText('`src/a.ts` `src/b.ts` `src/c.ts` plan/x BLG-1 BLG-2 claude-opus-5-5 ws:abcdef')).toBe(OMITTED);
    expect(sanitizeText('```\nonly code\n```')).toBe(CODE_OMITTED);
  });

  it('a URL keeps only its host', () => {
    expect(sanitizeText('打开 https://example.com/app/login?x=1 试试')).toBe('打开 https://example.com 试试');
  });

  it('caps the length', () => {
    expect(sanitizeText('好'.repeat(5000), 100)).toHaveLength(100);
  });
});

describe('sanitizeText: leaves clean words alone', () => {
  const plain = [
    '先做登录，再做支付。',
    '支持 iOS/Android 两个平台，第 3/8 个任务在做。',
    '日期 11/10 前交付，邮箱和/或手机号都能登录。',
    '按 COVID-19 期间的规定，时间用 ISO-8601，编码 UTF-8。',
    'Sign in with Apple 和 Google 登录都要有，Web 版也要。',
    'Make the login page friendlier: bigger buttons, clearer errors.',
    '价格是 99 元一个月，H5 页面也要适配。',
    '我们会在周五前给你看第一个版本。',
  ];
  for (const s of plain) it(s, () => expect(sanitizeText(s)).toBe(s));

  it('sanitizeLine folds lines', () => {
    expect(sanitizeLine('第一行\n第二行')).toBe('第一行 第二行');
  });

  it('is pure: the same input gives the same output', () => {
    const s = '我改了 `a.ts`，分支 plan/x';
    expect(sanitizeText(s)).toBe(sanitizeText(s));
  });
});
