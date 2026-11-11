import { expect, test } from '@playwright/test';
import { controlPost, delivered, openHome, sessionLogin, shot } from './helpers';
import { views } from './fixtures/views';

test.describe.configure({ mode: 'serial' });

/**
 * The plan page against the fake daemon (BLG-91): the pushed view arrives over the hub's socket,
 * every phase says who it is waiting on, the outline and activity draw, and neither offline state
 * loses the last version. BLG-92/93/96 extend this with chat, primary actions and the draft diff.
 */
test('the plan page follows the daemon and keeps its last view offline', async ({ page }, info) => {
  await sessionLogin(page);
  await openHome(page);
  await page.getByTestId('plan-row-plan1').click();
  await page.waitForURL(/\/plan\/plan1\?project=/);
  await page.getByTestId('plan-header').waitFor({ timeout: 20_000 });
  await expect(page.getByTestId('plan-status')).toContainText('AI 在做');
  await shot(page, 'plan-map', info);

  // A daemon change shows up in a couple of seconds through the hub's socket.
  await controlPost('view', { view: views.confirm });
  await expect(page.getByTestId('plan-status')).toContainText('确认计划', { timeout: 4000 });
  await expect(page.getByTestId('plan-header')).toContainText('计划已拟好');
  await shot(page, 'plan-confirm', info);

  // The other two tabs draw from the same view.
  await page.getByTestId('tab-outline').click();
  await expect(page.getByTestId('tab-panel-outline')).toContainText('记录喝水');
  await shot(page, 'plan-outline', info);
  await page.getByTestId('tab-activity').click();
  await expect(page.getByTestId('tab-panel-activity')).toContainText('开始整理需求');
  await shot(page, 'plan-activity', info);
  await page.getByTestId('tab-map').click();

  // Submitted, then the Mac approves the start gate.
  await controlPost('view', { view: views.awaitingStart });
  await expect(page.getByTestId('plan-status')).toContainText('在等工作室批准开工', { timeout: 4000 });
  await shot(page, 'plan-awaiting-start', info);
  await controlPost('approve');
  await expect(page.getByTestId('plan-status')).not.toContainText('在等工作室批准开工', { timeout: 4000 });

  // The rest of the phase table: decisions, review, a changed draft, done.
  await controlPost('view', { view: views.decide });
  await expect(page.getByTestId('plan-status')).toContainText('回答 1 个问题', { timeout: 4000 });
  await shot(page, 'plan-decide', info);

  await controlPost('view', { view: views.review });
  await expect(page.getByTestId('plan-status')).toContainText('验收', { timeout: 4000 });
  await shot(page, 'plan-review', info);

  await controlPost('view', { view: views.changes });
  await expect(page.getByTestId('plan-status')).toContainText('查看计划改动', { timeout: 4000 });
  await shot(page, 'plan-changes', info);

  await controlPost('view', { view: views.done });
  await expect(page.getByTestId('plan-status')).toContainText('已完成', { timeout: 4000 });
  await shot(page, 'plan-done', info);

  // The daemon goes away: the last view stays, and the page says the studio is offline.
  await controlPost('stop');
  await expect(page.getByTestId('studio-offline')).toBeVisible({ timeout: 15_000 });
  await shot(page, 'plan-studio-offline', info);
  await controlPost('start');
  await expect(page.getByTestId('studio-offline')).toBeHidden({ timeout: 25_000 });

  // The customer's own network goes away: the cached view stays and the banner says so.
  await page.context().setOffline(true);
  await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 5000 });
  await shot(page, 'plan-you-offline', info);
  await page.context().setOffline(false);

  // Nothing internal is visible: no paths, no planRef/opId words, no task keys.
  const text = await page.locator('body').innerText();
  expect(text).not.toContain('/Users/');
  expect(text).not.toContain('planRef');
  expect(text).not.toContain('opId');
  expect(text).not.toMatch(/\b[A-Z]{2,}-\d+\b/);
});

/** The conversation: a drawer on the phone, a docked panel on the desktop, one send per tap. */
test('chat: drawer on phone, dock on desktop, one action per double tap', async ({ page }, info) => {
  await sessionLogin(page);
  await openHome(page);
  await page.getByTestId('plan-row-plan1').click();
  await page.waitForURL(/\/plan\/plan1\?project=/);
  await page.getByTestId('plan-header').waitFor({ timeout: 20_000 });

  const now = Date.now();
  const chatView = {
    ...views.running,
    turns: [
      { id: 't-studio', who: 'studio' as const, name: '小王', text: '我从 Mac 这边看一下', at: now },
      { id: 't-ai', who: 'ai' as const, text: '开始做提醒了', at: now },
    ],
  };
  await controlPost('view', { view: chatView });
  await page.waitForTimeout(600);

  if (info.project.name === 'phone') {
    await expect(page.getByTestId('chat-open')).toBeVisible();
    await page.getByTestId('chat-open').click();
    await expect(page.getByTestId('chat-input')).toBeVisible();
  } else {
    await expect(page.getByTestId('chat-list')).toBeVisible();
    expect(await page.getByTestId('chat-open').count()).toBe(0);
  }
  await expect(page.getByTestId('chat-list')).toContainText('小王 · Studio');

  const before = delivered('chat.send');
  await page.getByTestId('chat-input').fill('你好');
  await page.getByTestId('chat-send').dblclick();
  await expect(page.getByTestId('chat-list')).toContainText('你好');
  await page.waitForTimeout(800);
  expect(delivered('chat.send') - before).toBe(1);
  await shot(page, 'plan-chat', info);

  // A new message arriving while the customer types does not take the keyboard.
  await page.getByTestId('chat-input').click();
  await controlPost('view', { view: { ...chatView, turns: [...chatView.turns, { id: 't-new', who: 'ai', text: '新的回复', at: Date.now() + 1000 }] } });
  await page.waitForTimeout(700);
  const focused = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return active !== null && (active.getAttribute('data-testid') === 'chat-input' || active.closest('[data-testid="chat-input"]') !== null);
  });
  expect(focused).toBe(true);

  if (info.project.name === 'phone') {
    await page.getByTestId('drawer-close').click();
    await controlPost('view', {
      view: { ...chatView, turns: [...chatView.turns, { id: 't-unread', who: 'ai', text: '你不在时的新消息', at: Date.now() + 2000 }] },
    });
    await expect(page.getByTestId('chat-unread')).toBeVisible({ timeout: 4000 });
    await page.getByTestId('chat-open').click();
    await page.getByTestId('drawer-close').click();
    await expect(page.getByTestId('chat-unread')).toBeHidden({ timeout: 4000 });
  }

  // A failed send keeps the text in its bubble; retry sends the same message again.
  if (info.project.name === 'phone') {
    await page.getByTestId('chat-open').click();
    await expect(page.getByTestId('chat-input')).toBeVisible();
  }
  await page.getByTestId('chat-input').fill('断网也要留住');
  await page.context().setOffline(true);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-list')).toContainText('断网也要留住');
  await expect(page.getByTestId('chat-list')).toContainText('没发出去 · 重试', { timeout: 4000 });
  await page.context().setOffline(false);
  const failedBefore = delivered('chat.send');
  await page.locator('[data-testid^="chat-retry-"]').last().click();
  await expect(page.getByTestId('chat-list')).toContainText('断网也要留住');
  await page.waitForTimeout(800);
  expect(delivered('chat.send')).toBe(failedBefore + 1);
});

/** The keyboard proxy (390×500): the input sits on the bottom of the visible drawer. */
test('chat drawer: the input rides the keyboard', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone only');
  await sessionLogin(page);
  await openHome(page);
  await page.getByTestId('plan-row-plan1').click();
  await page.getByTestId('plan-header').waitFor({ timeout: 20_000 });
  await page.getByTestId('chat-open').click();
  await page.getByTestId('chat-input').waitFor();
  await page.setViewportSize({ width: 390, height: 500 });
  await page.waitForTimeout(600);
  const box = await page.getByTestId('chat-input').boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(501);
  await page.setViewportSize({ width: 390, height: 844 });
});
