import { expect, test } from '@playwright/test';
import { base, controlPost, ready, delivers, fresh, goNew, home, login, openHome, project2Id, projectId, sessionLogin, shot } from './helpers';

test.describe.configure({ mode: 'serial' });

/** The four screens, then a request that reaches the fake daemon exactly once. */
test('signs in, sees the projects, opens a plan and sends one request', async ({ page }, info) => {
  await page.goto(`${base}/login`);
  // The login screen drawn (its field and its button), not a fixed pause: boundingBox() doesn't wait.
  await ready(page, 'email', 'the login screen');
  await ready(page, 'primary', 'the login screen’s button');
  await shot(page, 'login', info);

  const email = await page.getByTestId('email').boundingBox();
  const signIn = await page.getByTestId('primary').boundingBox();
  expect(email && email.height >= 44).toBeTruthy();
  expect(signIn && signIn.height >= 44).toBeTruthy();
  if (info.project.name === 'phone') expect(signIn!.y).toBeGreaterThanOrEqual(422);

  await login(page);
  await shot(page, 'projects', info);

  const first = page.getByTestId(`project-card-${projectId}`);
  await expect(first).toBeVisible();
  if (info.project.name === 'desktop' && project2Id) {
    const a = await first.boundingBox();
    const b = await page.getByTestId(`project-card-${project2Id}`).boundingBox();
    expect(a && b).toBeTruthy();
    if (a && b) {
      expect(Math.abs(a.y - b.y)).toBeLessThan(2);
      expect(b.x).toBeGreaterThan(a.x + 100);
    }
  }

  await openHome(page);
  await shot(page, 'home', info);
  if (info.project.name === 'phone') {
    const primary = await home(page).getByTestId('primary').boundingBox();
    expect(primary && primary.y >= 422).toBeTruthy();
  }

  await goNew(page);
  await fresh(page).getByTestId('goal-input').fill('做一个能记录每天喝水提醒的 App');
  await fresh(page).getByTestId('platform-ios').click();
  await fresh(page).getByTestId('platform-web').click();
  await page.waitForTimeout(400);
  await shot(page, 'new', info);

  if (info.project.name === 'phone') {
    const goal = await fresh(page).getByTestId('goal-input').boundingBox();
    const primary = await fresh(page).getByTestId('primary').boundingBox();
    expect(goal && goal.height >= 44 && goal.y >= 422).toBeTruthy();
    expect(primary && primary.y >= 422).toBeTruthy();
    expect(await fresh(page).getByTestId('primary').count()).toBe(1);
    const ios = await fresh(page).getByTestId('platform-ios').boundingBox();
    expect(ios && ios.height >= 44).toBeTruthy();
  }

  const before = delivers();
  await fresh(page).getByTestId('primary').dblclick();

  // The studio is online; the app shows 「已处理」 for a second and returns to the project. The
  // return is the terminal state, and the daemon count proves the double tap still made one action.
  await page.waitForURL(new RegExp(`/project/${projectId}$`), { timeout: 25_000 });
  expect(delivers() - before).toBe(1);
});

test('keeps the draft when leaving, reloading and shrinking the viewport', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone only');
  await sessionLogin(page);
  await openHome(page);
  await goNew(page);
  await fresh(page).getByTestId('goal-input').fill('草稿要留住');
  await fresh(page).getByTestId('platform-ios').click();
  await page.waitForTimeout(500);

  await fresh(page).getByTestId('back').click();
  await page.waitForURL(new RegExp(`/project/${projectId}$`));
  await goNew(page);
  await page.waitForTimeout(600);
  await expect(fresh(page).getByTestId('goal-input')).toHaveValue('草稿要留住');
  await expect(fresh(page).getByTestId('platform-ios')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('TEXTAREA');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await expect(fresh(page).getByTestId('goal-input')).toHaveValue('草稿要留住');

  await page.setViewportSize({ width: 390, height: 500 });
  await page.waitForTimeout(500);
  const goal = await fresh(page).getByTestId('goal-input').boundingBox();
  const primary = await fresh(page).getByTestId('primary').boundingBox();
  expect(goal && goal.y >= 0 && goal.y + goal.height <= 500).toBeTruthy();
  expect(primary && primary.y >= 0 && primary.y + primary.height <= 500).toBeTruthy();
});

test('a send made offline keeps its text and lands once after reconnect', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone only');
  await sessionLogin(page);
  await openHome(page);
  await goNew(page);
  await fresh(page).getByTestId('goal-input').fill('断网时不能丢字');
  await fresh(page).getByTestId('platform-ios').click();

  await page.context().setOffline(true);
  await fresh(page).getByTestId('primary').click();
  await expect(fresh(page).getByTestId('receipt-line')).toContainText('没发出去', { timeout: 10_000 });
  await expect(fresh(page).getByTestId('goal-input')).toHaveValue('断网时不能丢字');
  await expect(fresh(page).getByTestId('primary')).toContainText('重试');

  const before = delivers();
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  // The app retries once by itself and, on 「已处理」, returns to the project. If it is still
  // sitting on the failed form (the auto-retry was skipped), tap Retry.
  const returned = await page
    .waitForURL(new RegExp(`/project/${projectId}$`), { timeout: 25_000 })
    .then(() => true)
    .catch(() => false);
  if (!returned) {
    const primary = fresh(page).getByTestId('primary');
    if (!(await primary.isDisabled().catch(() => true))) await primary.click();
    await page.waitForURL(new RegExp(`/project/${projectId}$`), { timeout: 25_000 });
  }
  expect(delivers() - before).toBe(1);
});

test('a request waits while the daemon is down and lands once it is back', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone only');
  await controlPost('stop');
  await page.waitForTimeout(1000);
  await sessionLogin(page);
  await openHome(page);
  await goNew(page);
  await fresh(page).getByTestId('goal-input').fill('工作室离线也要收下');
  await fresh(page).getByTestId('platform-ios').click();
  await controlPost('stop');
  await page.waitForTimeout(1200);

  const before = delivers();
  await fresh(page).getByTestId('primary').click();
  await expect(fresh(page).getByTestId('receipt-line')).toContainText('已排队', { timeout: 15_000 });
  expect(delivers() - before).toBe(0);

  await controlPost('start');
  const done = await page
    .waitForURL(new RegExp(`/project/${projectId}$`), { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (!done) await expect(fresh(page).getByTestId('receipt-line')).toContainText('已处理', { timeout: 5_000 });
  expect(delivers() - before).toBe(1);
});
