import { describe, expect, it } from 'vitest';
import {
  parseCard,
  parseRequestSummary,
  parseRequestView,
  parseSettingsView,
  WaitReasonSchema,
} from './views';

describe('WaitReasonSchema', () => {
  it('accepts all four wait reasons and rejects invalid ones', () => {
    for (const reason of ['offline', 'queued', 'quota', 'needs-human'] as const) {
      expect(WaitReasonSchema.parse(reason)).toBe(reason);
    }
    expect(WaitReasonSchema.safeParse('unknown-reason').success).toBe(false);
  });
});

describe('parseCard', () => {
  it('parses all ten known card kinds', () => {
    const samples = [
      { id: 'c1', kind: 'design', fileCount: 12, totalBytes: 2048, imageCount: 10, specCount: 2, skipped: [] },
      { id: 'c2', kind: 'question', prompt: '需要支持微信登录吗？', options: [{ id: 'o1', label: '需要' }] },
      { id: 'c3', kind: 'understanding', points: ['支持扫码登录'], outOfScope: ['暂不做第三方绑定'] },
      { id: 'c4', kind: 'start', planTitle: '登录改版', stepCount: 4, estimateLabel: '约 2 小时' },
      { id: 'c5', kind: 'changes', summary: '调整登录流程', added: ['短信验证'], modified: [], removed: [] },
      { id: 'c6', kind: 'steps', steps: [{ id: 's1', title: '搭建页面', status: 'active' }] },
      { id: 'c7', kind: 'wait', reason: 'offline', message: '执行机器暂时离线' },
      { id: 'c8', kind: 'delivery', round: 1, summary: '第一轮交付已完成', previewUrl: 'https://p.example.com' },
      { id: 'c9', kind: 'code', repoUrl: 'https://git.example.com/app', pushState: 'pushed' },
      { id: 'c10', kind: 'release', envId: 'prod', envTitle: '正式', version: '1.2.0' },
    ];

    for (const sample of samples) {
      const parsed = parseCard(sample);
      expect(parsed.kind).toBe(sample.kind);
      expect(parsed.id).toBe(sample.id);
    }
  });

  it('parses wait cards for every wait reason', () => {
    for (const reason of ['offline', 'queued', 'quota', 'needs-human'] as const) {
      const card = parseCard({ id: `w_${reason}`, kind: 'wait', reason, message: '等待中' });
      expect(card.kind).toBe('wait');
      if (card.kind === 'wait') {
        expect(card.reason).toBe(reason);
      }
    }
  });

  it('does not throw on unknown fields or unknown card kinds', () => {
    const withExtra = parseCard({
      id: 'c_extra',
      kind: 'delivery',
      round: 2,
      summary: 'ok',
      extraServerField: { nested: true },
    });
    expect(withExtra.kind).toBe('delivery');

    const unknownCard = parseCard({
      id: 'c_future',
      kind: 'future_card_v2',
      createdAt: 1000,
      payload: [1, 2, 3],
    });
    expect(unknownCard.kind).toBe('unknown');
    if (unknownCard.kind === 'unknown') {
      expect(unknownCard.rawKind).toBe('future_card_v2');
      expect(unknownCard.id).toBe('c_future');
    }

    expect(parseCard(null).kind).toBe('unknown');
  });
});

describe('Request and Settings views', () => {
  it('parses RequestSummary, RequestView, and SettingsView with extra fields', () => {
    const summary = parseRequestSummary({
      id: 'req_1',
      projectId: 'proj_1',
      projectName: '商城 App',
      title: '商品详情页改版',
      platform: 'ios',
      status: 'needs-you',
      statusLine: '等你批准开工',
      updatedAt: 1700000000,
      futureBadge: 'hot',
    });
    expect(summary?.id).toBe('req_1');

    const view = parseRequestView({
      summary,
      messages: [{ id: 'm1', role: 'customer', text: '帮我改版', createdAt: 1700000000 }],
      cards: [{ id: 'c_unk', kind: 'new_kind', foo: 'bar' }],
    });
    expect(view?.cards[0]?.kind).toBe('unknown');

    const settings = parseSettingsView({
      projects: [{ id: 'proj_1', name: '商城 App', platform: 'ios', runMode: 'auto-delivery' }],
      envs: {
        proj_1: [
          {
            id: 'test',
            title: '测试',
            protected: false,
            target: { platform: 'ios', mode: 'TestFlight' },
            vars: [{ name: 'API_BASE', value: 'https://api.example.com', at: 1, by: { name: '我', via: 'studio' } }],
            secrets: [{ name: 'APPLE_KEY', purpose: '签名证书', at: 1, by: { name: '我', via: 'studio' } }],
          },
        ],
      },
      forges: [{ projectId: 'proj_1', mode: 'preview-only', hasToken: false }],
      runners: [{ id: 'r1', name: 'Mac mini', online: true, accepting: true, activeRequestCount: 1 }],
      devices: [{ id: 'd1', name: 'iPhone 15', platform: 'ios', registeredAt: 1 }],
      account: { email: 'user@example.com', pushEnabled: true, appearance: 'light' },
      extraSetting: 123,
    });
    expect(settings?.account.email).toBe('user@example.com');
  });
});
