#!/usr/bin/env node
// End-to-end test for the notes app. Run against the live server:
//
//   node examples/notes/server.mjs  (in one terminal)
//   node examples/notes/e2e.mjs     (in another)
//
// Exits non-zero if anything fails. Used by CI / by hand.

import pw from '/opt/node22/lib/node_modules/playwright/index.js';

const BASE = process.env.NOTES_URL || 'http://localhost:8081';
const browser = await pw.chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(`PAGE: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('CERT')) errs.push(`err: ${m.text()}`);
});

const username = `e2e-${Date.now().toString(36)}`;
const password = 'hunter2';

const expect = (actual, expected, label) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}`);
  if (!ok) throw new Error(`expected ${JSON.stringify(expected)}`);
};

try {
  // ---- Initial page is SSR'd ----
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('x-auth h2', { timeout: 4000 });
  expect((await page.locator('x-auth h2').textContent()).trim(), 'Log in', 'SSR login form');

  // ---- Signup ----
  await page.locator('x-auth input[autocomplete=username]').fill(username);
  await page.locator('x-auth input[type=password]').fill(password);
  await page.locator('x-auth a').click(); // switch to signup
  await page.locator('x-auth button[type=submit]').click();
  await page.waitForSelector('x-notes-board', { timeout: 3000 });

  // ---- Create note ----
  await page.locator('button', { hasText: '+ New note' }).click();
  await page.waitForTimeout(150);
  expect(await page.locator('.note-item').count(), 1, 'create note');

  // ---- Edit via federated editor ----
  await page.waitForSelector('x-rich-editor', { timeout: 4000 });
  await page.locator('x-rich-editor').locator('textarea').fill('hello from the federated editor');
  await page.waitForTimeout(550); // debounce + save
  await page.locator('input.title').fill('My first note');
  await page.locator('input.title').blur();
  await page.waitForTimeout(200);
  expect((await page.locator('.note-item').first().locator('h3').textContent()).trim(),
    'My first note', 'title persisted');

  // ---- Logout ----
  await page.locator('.who a').click();
  await page.waitForSelector('x-auth h2', { timeout: 3000 });
  expect((await page.locator('x-auth h2').textContent()).trim(), 'Log in', 'logout returns to login');

  // ---- Login again ----
  await page.locator('x-auth input[autocomplete=username]').fill(username);
  await page.locator('x-auth input[type=password]').fill(password);
  await page.locator('x-auth button[type=submit]').click();
  await page.waitForSelector('x-notes-board', { timeout: 3000 });
  await page.waitForTimeout(150);

  expect(await page.locator('.note-item').count(), 1, 'notes restored after re-login');
  expect((await page.locator('.note-item').first().locator('h3').textContent()).trim(),
    'My first note', 'title round-trips through DB');
  const editorTextarea = page.locator('x-rich-editor').locator('textarea');
  await editorTextarea.waitFor({ timeout: 4000 });
  expect(await editorTextarea.inputValue(), 'hello from the federated editor',
    'body round-trips through DB');

  expect(errs.length, 0, 'no console errors');

  console.log('\nAll e2e checks passed.');
  process.exitCode = 0;
} catch (err) {
  console.error('\nFailed:', err.message);
  console.error('Console errors collected:', errs);
  process.exitCode = 1;
} finally {
  await browser.close();
}
