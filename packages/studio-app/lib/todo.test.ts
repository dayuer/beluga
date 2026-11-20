import { describe, expect, it } from 'vitest';
import { partitionTodos, sortNeedsYouTodos, type WaitingTodoItem } from './todo';
import type { TodoCard } from './todo-store';
import type { RequestSummary } from './views';

function makeTodo(overrides: Partial<TodoCard> & Pick<TodoCard, 'key' | 'kind'>): TodoCard {
  return {
    pid: 'proj-shop',
    planRef: 'req-login',
    title: '登录页改版',
    sub: '等你处理',
    projectName: '优选商城 App',
    updatedAt: 1_000,
    ...overrides,
  };
}

function makeReq(overrides: Partial<RequestSummary> & Pick<RequestSummary, 'id'>): RequestSummary {
  return {
    projectId: 'proj-shop',
    projectName: '优选商城 App',
    title: `需求 ${overrides.id}`,
    platform: 'ios',
    status: 'working',
    statusLine: '进行中',
    updatedAt: 1_000,
    ...overrides,
  };
}

describe('lib/todo grouping and urgency', () => {
  it('sorts needs-you todos by urgency (decision > review > changes > confirm) then arrival time', () => {
    const list: TodoCard[] = [
      makeTodo({ key: 'c1', kind: 'confirm', updatedAt: 500 }),
      makeTodo({ key: 'r2', kind: 'review', updatedAt: 2_000 }),
      makeTodo({ key: 'd1', kind: 'decision', updatedAt: 3_000 }),
      makeTodo({ key: 'r1', kind: 'review', updatedAt: 1_000 }),
      makeTodo({ key: 'ch1', kind: 'changes', updatedAt: 800 }),
    ];

    const sorted = sortNeedsYouTodos(list);
    expect(sorted.map((t) => t.key)).toEqual(['d1', 'r1', 'r2', 'ch1', 'c1']);
  });

  it('partitions into needsYou and read-only waiting groups with clear reason and eta', () => {
    const todos: TodoCard[] = [
      makeTodo({ key: 'c1', kind: 'confirm', updatedAt: 2_000 }),
      makeTodo({ key: 'd1', kind: 'decision', updatedAt: 1_000 }),
    ];
    const requests: RequestSummary[] = [
      makeReq({
        id: 'req-push',
        title: '发货通知模板消息',
        status: 'waiting',
        waitReason: 'offline',
        statusLine: '等待：执行机器暂时离线',
        updatedAt: 1_500,
      }),
      makeReq({
        id: 'req-quota',
        title: '智能客服接入',
        status: 'waiting',
        waitReason: 'quota',
        statusLine: '本月额度已用完',
        updatedAt: 2_500,
      }),
    ];
    const explicitWait: WaitingTodoItem[] = [
      {
        id: 'card-wait-1',
        requestId: 'req-pay',
        requestTitle: '支付对账',
        projectName: '优选商城 App',
        reason: 'queued',
        message: '前面还有 2 个任务在排队',
        etaText: '预计 10 分钟内开始',
        updatedAt: 500,
      },
    ];

    const { needsYou, waiting } = partitionTodos({ todos, requests, waitingCards: explicitWait, lang: 'zh' });
    expect(needsYou.map((t) => t.key)).toEqual(['d1', 'c1']);
    expect(waiting).toHaveLength(3);
    expect(waiting.map((w) => w.requestId)).toEqual(['req-pay', 'req-push', 'req-quota']);
    expect(waiting[1]?.message).toContain('离线');
    expect(waiting[1]?.etaText).toBeTruthy();
    expect(waiting[2]?.etaText).toBeTruthy();
  });
});
