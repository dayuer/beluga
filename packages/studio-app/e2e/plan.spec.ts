import { expect, test } from '@playwright/test';
import { controlPost, openHome, sessionLogin, shot } from './helpers';
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
