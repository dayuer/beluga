import fs from 'node:fs';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

/** Env from e2e/run.mjs. The tests never see a session; each one asks for a fresh magic link. */
export const base = process.env.E2E_BASE ?? 'http://localhost:8790';
export const hub = process.env.E2E_HUB ?? 'http://127.0.0.1:8787';
export const operator = process.env.E2E_OPERATOR ?? 'e2e-operator';
export const customerId = process.env.E2E_CUSTOMER ?? '';
export const projectId = process.env.E2E_PROJECT_ID ?? '';
export const project2Id = process.env.E2E_PROJECT2_ID ?? '';
export const control = process.env.E2E_CONTROL ?? 'http://127.0.0.1:8791';
export const daemonLog = process.env.E2E_DAEMON_LOG ?? '';
/** A session the run made once for the extra tests: the magic-link mail is capped at 5 an hour. */
export const sessionJson = process.env.E2E_SESSION ?? '';
export const scratch = process.env.E2E_SCRATCH ?? path.resolve(process.cwd(), '../../.beluga/scratch/m5');

export const home = (page: Page) => page.getByTestId('project-home').last();
export const fresh = (page: Page) => page.getByTestId('new-screen').last();

/**
 * Wait for what a screen shows once it is drawn (BLG-153), never a fixed pause; when it doesn't
 * come, say which screen, where the page is and what it shows (a spinner, an error, the login).
 */
export async function ready(page: Page, testId: string, what: string, timeout = 20_000): Promise<void> {
  try {
    await page.getByTestId(testId).last().waitFor({ state: 'visible', timeout });
  } catch {
    const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`${what}: [data-testid=${testId}] did not show in ${timeout} ms. The page is ${page.url()} and shows: ${text || '(nothing yet)'}`);
  }
}

/** A single-use link, minted for this test; the customer's token never goes to a log. */
export async function freshLink(): Promise<string> {
  const res = await fetch(`${hub}/v1/admin/customers/${customerId}/login-link`, {
    method: 'POST',
    headers: { authorization: `Bearer ${operator}` },
  });
  if (!res.ok) throw new Error(`login-link failed: ${res.status}`);
  const body = (await res.json()) as { link: string };
  return body.link;
}

export async function login(page: Page): Promise<void> {
  const link = await freshLink();
  // The login screenshot visited /login first; a link that only changes the hash would be a
  // same-document navigation and the app would never re-run its token effect.
  await page.goto('about:blank');
  await page.goto(link, { waitUntil: 'networkidle' });
  await page.waitForURL(`${base}/`, { timeout: 20_000 });
  await ready(page, `project-card-${projectId}`, 'the projects after the magic link');
}

/** For the tests after the first: the same session, set before the app boots, so one magic link
 * does not get spent per test (the hub allows five an hour). */
export async function sessionLogin(page: Page): Promise<void> {
  if (!sessionJson) throw new Error('E2E_SESSION is missing');
  await page.addInitScript((raw: string) => localStorage.setItem('synon:session', raw), sessionJson);
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await ready(page, `project-card-${projectId}`, 'the projects with the saved session');
}

export async function openHome(page: Page): Promise<void> {
  await page.getByTestId(`project-card-${projectId}`).click();
  await page.waitForURL(new RegExp(`/project/${projectId}$`));
  await ready(page, 'project-home', 'the project home');
  await home(page).getByTestId('plan-row-plan1').waitFor({ timeout: 20_000 });
}

export async function goNew(page: Page): Promise<void> {
  await home(page).getByTestId('primary').click();
  await page.waitForURL(new RegExp(`/new\\?project=${projectId}`));
  await fresh(page).getByTestId('goal-input').waitFor({ timeout: 10_000 });
}

export async function fillRequest(page: Page, goal: string): Promise<void> {
  await fresh(page).getByTestId('goal-input').fill(goal);
  await fresh(page).getByTestId('platform-ios').click();
}

export async function shot(page: Page, name: string, info: TestInfo): Promise<void> {
  fs.mkdirSync(scratch, { recursive: true });
  await page.screenshot({ path: path.join(scratch, `${name}-${info.project.name}.png`) });
}

/** How many actions of a kind reached the fake daemon. */
export function delivered(kind: string): number {
  if (!daemonLog || !fs.existsSync(daemonLog)) return 0;
  return fs
    .readFileSync(daemonLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    })
    .filter((entry) => entry.kind === 'deliver' && entry.actionKind === kind).length;
}

/** How many `plan.create` actions reached the fake daemon. One after one request, however many
 * times the app asked the hub. */
export const delivers = (): number => delivered('plan.create');

export async function controlPost(action: 'stop' | 'start' | 'view' | 'approve' | 'reset', body?: unknown): Promise<void> {
  const res = await fetch(`${control}/daemon/${action}`, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`control ${action} failed: ${res.status}`);
}
