import { expect, test, type Page } from './fixtures.js';
import { expectPicked, pick } from './helpers.js';

/**
 * 「我的共享」（M7 · BLG-218，docs/calm/sharing.md）：一个默认 + 少数例外。
 *
 * 真实路径用演示房间里的人（bob、mia）：设成例外 → 出现在「例外」里 → 恢复默认后行原地保留、
 * 可撤销；批量改两人只有一条汇总 toast；改默认先确认。200 圈用页面自己的演示源
 * （localStorage `beluga.fork.sharing.demo.v1`，只在开发构建里生效）：打开到可操作 < 500ms、
 * 滚到底、改一行时其他行不挪位、搜索。沉稳关时这一页不出现，仍是上游的「In the room」。
 */

test.describe.configure({ mode: 'serial' });

const sharing = (page: Page) => page.locator('[data-sharing]');
const rows = (page: Page) => sharing(page).locator('[role="listitem"]');
/** A row by name and where it comes from: the demo has a bob in the room and a friend bob. */
const row = (page: Page, name: string, kind: 'Friend' | 'Room' | 'Remembered') =>
  rows(page).filter({ has: page.getByText(name, { exact: true }) }).filter({ hasText: kind });

async function openPeople(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible();
  await page.keyboard.press('Meta+,');
  await page.getByRole('button', { name: 'People & access' }).click();
  await expect(sharing(page)).toBeVisible();
  await sharing(page).getByText('My sharing', { exact: true }).scrollIntoViewIfNeeded();
}

test('a circle becomes an exception, goes back to the default in place, and can be undone', async ({ page }) => {
  await openPeople(page);
  // Look at every circle first, then give bob a level of his own.
  await pick(sharing(page), 'Filter', 'All');
  await expect(row(page, 'bob', 'Friend')).toBeVisible();
  await pick(sharing(page), 'Trust for bob (Friend)', 'Trusted');

  // Only circles that differ from the default are listed.
  await pick(sharing(page), 'Filter', 'Exceptions');
  await expect(row(page, 'bob', 'Friend')).toBeVisible();

  // Restoring it keeps the row where it was, saying so, with Undo.
  await row(page, 'bob', 'Friend').getByRole('button', { name: 'Restore default' }).click();
  const kept = row(page, 'bob', 'Friend');
  await expect(kept).toHaveAttribute('data-kept', '');
  await expect(kept).toContainText('Restored to default');
  await expect(kept.getByRole('button', { name: 'Undo' })).toBeVisible();

  // Undo puts the level back; bob is an exception again.
  await kept.getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'bob', 'Friend')).not.toHaveAttribute('data-kept', '');
  await expectPicked(popup(page, 'Trust for bob (Friend)'), 'trusted');
});

test('changing two circles together ends in one summary toast', async ({ page }) => {
  await openPeople(page);
  await pick(sharing(page), 'Filter', 'All');
  await expect(row(page, 'bob', 'Friend')).toBeVisible();
  await expect(row(page, 'mia', 'Friend')).toBeVisible();
  await sharing(page).getByRole('checkbox', { name: 'Select bob (Friend)' }).check();
  await sharing(page).getByRole('checkbox', { name: 'Select mia (Friend)' }).check();
  await expect(sharing(page)).toContainText('2 selected');

  await pick(sharing(page), 'Set the selected circles to', 'Full trust');
  // Two is under the confirmation threshold: it just happens, with one summary toast.
  const toast = page.locator('[data-one-toast="global"]');
  await expect(toast).toContainText('2 circles are now Full trust.', { timeout: 10_000 });
  await expect(toast).not.toContainText('bob:');
  await expect(sharing(page)).toContainText('Select circles to change them together.');
});

test('changing the default asks first and says what it affects', async ({ page }) => {
  await openPeople(page);
  await pick(sharing(page), 'Default level', 'Trusted');
  const alert = page.getByRole('alertdialog', { name: 'Use Trusted for every circle?' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('follow the default change at once');
  await alert.getByRole('button', { name: 'Change the Default' }).click();
  await expect(page.locator('[data-one-toast="global"]')).toContainText('Every circle without its own level is now Trusted.', { timeout: 10_000 });
  await expectPicked(popup(page, 'Default level'), 'trusted');
});

test('200 circles: opens at once, scrolls, changes without moving rows, and searches', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('beluga.fork.sharing.demo.v1', '200'));
  await page.addInitScript(() => localStorage.setItem('beluga.onboarding.v1', JSON.stringify({ version: 'e2e', at: 0, how: 'finished' })));
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible();
  await page.keyboard.press('Meta+,');

  const started = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: 'People & access' }).click();
  await expect(popup(sharing(page), 'Default level')).toBeEnabled();
  await expect(rows(page).first()).toBeVisible();
  const opened = await page.evaluate((t0) => performance.now() - t0, started);
  expect(opened, `opened in ${Math.round(opened)}ms`).toBeLessThan(500);
  await expect(sharing(page)).toContainText('182 following the default · 18 exceptions');

  // The long list scrolls to the end.
  const list = sharing(page).locator('[role="list"]');
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(rows(page).last()).toBeVisible();
  await expect(popup(sharing(page), 'Filter')).toBeVisible();

  // Change a row in the middle of the list: it stays exactly where it was, and so do its neighbours.
  await list.evaluate((el) => {
    el.scrollTop = 50 * 36;
  });
  const target = rows(page).nth(5);
  await target.scrollIntoViewIfNeeded();
  const id = await target.getAttribute('data-circle');
  const before = await target.boundingBox();
  await target.getByRole('combobox').click();
  await page.getByRole('listbox').getByRole('option', { name: 'Full trust' }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(target).toHaveAttribute('data-circle', id!);
  const after = await target.boundingBox();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1);

  // Search by name (in the whole list, not only the exceptions).
  await pick(sharing(page), 'Filter', 'All');
  const search = sharing(page).getByRole('searchbox', { name: 'Search circles by name' });
  await search.fill('mia');
  await expect(rows(page).first()).toContainText('mia');
  for (const text of await rows(page).allInnerTexts()) expect(text.toLowerCase()).toContain('mia');
  await search.fill('');
});

test('with calm mode off, People & access is upstream’s two groups', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('beluga.fork.calm.v1', JSON.stringify({ calm: false })));
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible();
  await page.keyboard.press('Meta+,');
  await page.getByRole('button', { name: 'People & access' }).click();
  await expect(page.getByText('In the room', { exact: true })).toBeVisible();
  await expect(sharing(page)).toHaveCount(0);
});

/** The pop-up named `label` inside the sharing page (it is a Radix combobox). */
function popup(scope: Page | ReturnType<typeof sharing>, label: string) {
  return scope.getByRole('combobox', { name: label });
}
