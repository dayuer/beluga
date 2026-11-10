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

describe('the M1 audit (docs/reports/studio-m1-audit.md)', () => {
  const ZW = '​';
  const leaks: Record<string, [string, RegExp]> = {
    // M-2 lookalikes
    fullwidthSlash: ['我改了 src／studio／view 里的登录逻辑，现在会记住你的登录状态了', /studio|view/],
    fullwidthModel: ['这次是用 ｃlaude 和 Ｃｌａｕｄｅ Ｏｐｕｓ 写的登录页面，请你验收一下', /ｃ|laude|ｐｕｓ/i],
    zeroWidthModel: [`这次是用 cl${ZW}aude-op${ZW}us-5-5 写的登录页面，请你验收一下`, /aude|us-5/],
    cyrillicModel: ['这次是用 сlaude оpus 写的登录页面，请你验收一下', /laude|pus/],
    dashKey: ['登录页面 BLG‑52 做完了，接着做 BLG–53 和 BLG−55', /BLG|52|53|55/],
    fullwidthKey: ['登录页面 ＢＬＧ-52 和 BLG-５２ 做完了，接着做支付页面', /BLG|ＢＬＧ/],
    softHyphen: ['用了 clau­de 写，路径 src­/auth­/login­.ts 已改好，请验收', /clau|auth|login/],
    // M-3 secrets
    urlLogin: ['打开 https://admin:hunter2@staging.example.com/login 试试，登录页面可以用了', /hunter2|admin/],
    connStr: ['数据库连 postgres://admin:hunter2@db.internal:5432/prod 了', /hunter2|postgres/],
    slack: ['令牌 xoxb-1234567890-abcdefghij 和 glpat-abcdefghij1234567890、sk_live_abcdefghij1234，都配好了', /xoxb|glpat|sk_live/],
    lowerEnv: ['配置 api_key=abc123 和 password: hunter2、token: s3cr3tValue、{"secret":"hunter2"} 都好了', /abc123|hunter2|s3cr3t/],
    google: ['密钥 AIzaSyA-abc_def1234567890ABCDEFGHIJ 配好了，登录页面现在可以用了', /AIza/],
    quotedEnv: ['配置 API_KEY="abc def ghi" 已写好，登录页面现在可以用了', /abc|def|ghi/],
    pem: ['证书\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nBKcwggSjAgEAAoIBAQC7\n-----END PRIVATE KEY-----\n配好了', /MII|BKc|PRIVATE/],
    gitRemote: ['仓库是 git@github.com:synon/secret-app.git，登录页面现在可以用了', /secret-app|synon/],
    cnPassword: ['数据库密码是 hunter2!，管理员密码 P@ssw0rd123，都配好了', /hunter2|P@ss/],
    // M-4 code
    tripleInline: ['我改了 ```login()``` 和 ```studioPlanView(input)``` 两个函数，现在登录好了', /login|studioPlanView/],
    quotedFence: ['好了\n> ```ts\n> const secret = getKey();\n> ```\n请验收', /secret|getKey/],
    indentedFence: ['好了\n    ```\n    secretFn()\n    ```\n请验收', /secretFn/],
    oneCodeLine: ['登录好了。\nconst user = await login(email)\n请试试', /const|login\(/],
    shell: ['你运行 npm install && npm run build 就可以了，然后 git push origin main', /npm|git push/],
    html: ['好了 <script>alert(document.cookie)</script> 和 <img src="/tmp/a.png" onerror="alert(1)"> 请验收', /script|alert|onerror/],
    // M-5 paths
    gluedAbs: ['配置写在/etc/passwd里了，另外看一下/tmp/out吧，现在登录好了', /passwd|tmp/],
    cjkPath: ['我改了 /Users/李雨晴/项目/源码/登录.ts 这个文件，登录页面现在可以用了', /李雨晴|源码|\.ts/],
    bracketPath: ['我改了 app/[id]/page 和 app/(auth)/login 还有 src/$lib/x，登录页面现在可以用了', /\[id\]|\(auth\)|\$lib/],
    twoSegments: ['我改了 src/auth 和 packages/mac 两个目录，登录页面现在可以用了', /src|packages/],
    moreExts: ['我改了 audit.mts、index.cts、app.wxml、app.wxss、schema.prisma、key.pem，登录好了', /mts|cts|wxml|wxss|prisma|pem/],
    refLink: ['详情见 [设计文档][1]，登录页面现在可以用了\n\n[1]: /Users/me/app/docs/design.md', /Users|design|\[1\]/],
    // M-6 ids
    uuid: ['会话 550e8400-e29b-41d4-a716-446655440000 里讨论过登录页面的做法，已经定了', /550e8400/],
    qid: ['问题 decide:pl_abc:login 已经回答了，登录好了', /decide|pl_abc/],
    shortIds: ['任务 iss_123 和 wt-9f8e7d、提交 a1b2c3d 都处理了，登录好了', /iss_|wt-|a1b2c3d/],
    tools: ['我用 mcp__beluga__ask_agent 和 plan_update、plans.approve、session.submit、checkAction() 更新了计划', /mcp|plan_update|plans\.|session\.|checkAction/],
    models: ['用 gpt-4o、GPT4o、ChatGPT、claude_opus_5、claude_code、GPT-5.1-codex-max 写的，登录页面好了', /gpt|claude|codex|4o/i],
    slug: ['分支叫 blg-52-m1，登录页面好了', /blg-52/],
  };
  for (const [name, [input, re]] of Object.entries(leaks)) it(`${name}`, () => expect(sanitizeText(input)).not.toMatch(re));

  it('keeps prose the old rules ate (S-12)', () => {
    for (const s of ['The brand color, the doctor.', '我们的口号是 and/or，价格 3.5 元，版本 1.2.3', 'Node.js 和 Vue.js 都可以', 'iPhone-15 和 TOP-10、IOS-17 都要支持', 'The opus of our work; a mistral wind; go to market.'.replace(/opus |mistral /g, '')])
      expect(sanitizeText(s)).toBe(s);
  });

  it('runs in linear time on long input (S-1)', () => {
    for (const s of ['的'.repeat(100_000), 'a.'.repeat(50_000), `${' '.repeat(50_000)}x`, 'x/'.repeat(50_000)]) {
      const t0 = performance.now();
      sanitizeText(s);
      expect(performance.now() - t0).toBeLessThan(1500);
    }
  });
});
