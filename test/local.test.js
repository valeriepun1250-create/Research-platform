import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const port = 41000 + Math.floor(Math.random() * 1000);
const url = `http://127.0.0.1:${port}/`;
const server = spawn('npm', ['run', 'preview', '--', '--port', String(port)], { stdio: 'ignore' });

async function ready() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Vite did not start');
}

async function untranslatedEnglish(page) {
  return page.evaluate(() => {
    const found = [];
    const walker = document.createTreeWalker(document.querySelector('#app'), NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest('#language-select, .document-content, .note-title')) continue;
      if (/[\p{Script=Han}]/u.test(node.nodeValue)) found.push(node.nodeValue.trim());
    }
    document.querySelectorAll('#app [placeholder], #app [aria-label], #app [title]').forEach(element => {
      for (const name of ['placeholder', 'aria-label', 'title']) {
        const value = element.getAttribute(name);
        if (value && /[\p{Script=Han}]/u.test(value)) found.push(`${name}: ${value}`);
      }
    });
    return [...new Set(found)];
  });
}

test('browser stores drafts locally and downloads approved Excel', async () => {
  let browser;
  try {
    await ready();
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    const backendCalls = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/api/')) backendCalls.push(request.url()); });
    await page.goto(url);
    await page.getByRole('heading', { name: 'Study overview' }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    await page.screenshot({ path: '/private/tmp/ot-english-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '/private/tmp/ot-english-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('.side-nav [data-nav="variables"]').click();
    await page.locator('[data-action="new-variable"]').first().click();
    await page.locator('[name="key"]').fill('draft_key');
    await page.locator('#language-select').selectOption('zh-Hant');
    assert.equal(await page.locator('[name="key"]').inputValue(), 'draft_key');
    await page.locator('[data-action="close-modal"]').first().click();
    await page.locator('.side-nav [data-nav="overview"]').click();
    await page.getByRole('heading', { name: '研究概覽' }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: '研究概覽' }).waitFor();
    await page.screenshot({ path: '/private/tmp/ot-local-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.sidebar').count(), 1);
    await page.screenshot({ path: '/private/tmp/ot-local-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.locator('[data-nav="variables"]').click();
    await page.locator('[data-action="new-variable"]').first().click();
    await page.locator('[name="key"]').fill('moca_total');
    await page.locator('[name="label"]').fill('MoCA 總分');
    await page.locator('#modal-form button[type="submit"]').click();
    await page.getByText('moca_total', { exact: true }).waitFor();

    await page.locator('.side-nav [data-nav="intake"]').click();
    await page.locator('[data-action="new-subject"]').click();
    await page.locator('[name="code"]').fill('OT-001');
    await page.locator('#modal-form button[type="submit"]').click();
    await page.locator('#note-file').setInputFiles({ name: 'progress.txt', mimeType: 'text/plain', buffer: Buffer.from('Patient Name: Example\nMoCA: 24/30\n') });
    await page.locator('#assessment-date').fill('2026-10-31');
    await page.locator('#upload-form button[type="submit"]').click();
    await page.getByRole('heading', { name: '覆核隊列' }).waitFor();
    assert.match(await page.locator('.document-content').innerText(), /\[REDACTED\]/);
    assert.equal(await page.locator('#review-moca_total').inputValue(), '24');

    const downloading = page.waitForEvent('download');
    await page.locator('[data-action="approve-draft"]').click();
    const download = await downloading;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(await download.path());
    assert.equal(workbook.worksheets[0].getRow(2).getCell(1).value, 'OT-001');
    assert.equal(workbook.worksheets[0].getRow(2).getCell(3).value, 24);

    await page.locator('[data-nav="export"]').click();
    await page.locator('#export-template').setInputFiles({ name: 'research.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await readFile(await download.path()) });
    await page.locator('.export-mapping').first().waitFor();
    const merging = page.waitForEvent('download');
    await page.locator('[data-action="merge-export"]').click();
    const merged = await merging;
    assert.equal(merged.suggestedFilename(), 'research_updated.xlsx');
    await page.getByText('目前連結：research.xlsx').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '/private/tmp/ot-local-export-mobile.png' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.locator('[data-nav="import"]').click();
    const legacyBook = new ExcelJS.Workbook();
    const legacySheet = legacyBook.addWorksheet('Legacy');
    legacySheet.addRow(['subject_id', 'assessment_date', 'moca_total']);
    legacySheet.addRow(['OT-003', '2026-10-29', 18]);
    const legacyZip = await JSZip.loadAsync(await legacyBook.xlsx.writeBuffer());
    legacyZip.file('xl/worksheets/sheet99.xml', '');
    const legacyXlsx = await legacyZip.generateAsync({ type: 'nodebuffer' });
    await page.locator('#import-file').setInputFiles({ name: 'legacy.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: legacyXlsx });
    await page.locator('.mapping-select').first().waitFor();
    assert.match(await page.locator('.selected-file').innerText(), /legacy\.xlsx/);
    await page.locator('#import-file').setInputFiles({ name: 'legacy.csv', mimeType: 'text/csv', buffer: Buffer.from('subject_id,assessment_date,moca_total\nOT-002,2026-10-30,19\n') });
    await page.locator('.mapping-select').first().waitFor();
    const importing = page.waitForEvent('download');
    await page.locator('[data-action="commit-import"]').click();
    const updated = await importing;
    const updatedBook = new ExcelJS.Workbook();
    await updatedBook.xlsx.readFile(await updated.path());
    assert.equal(updatedBook.worksheets[0].getRow(3).getCell(1).value, 'OT-002');
    assert.equal(updatedBook.worksheets[0].getRow(3).getCell(3).value, 19);

    await page.reload();
    await page.getByRole('heading', { name: '研究概覽' }).waitFor();
    assert.match(await page.locator('.stats').innerText(), /2/);

    const imageBase64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 700; canvas.height = 180;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 700, 180);
      ctx.fillStyle = 'black'; ctx.font = 'bold 60px Arial'; ctx.fillText('MoCA: 23', 30, 105);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('.side-nav [data-nav="intake"]').click();
    await page.locator('#subject-id').selectOption({ label: 'OT-001' });
    await page.locator('#assessment-date').fill('2026-10-29');
    await page.locator('#note-file').setInputFiles({ name: 'scan.png', mimeType: 'image/png', buffer: Buffer.from(imageBase64, 'base64') });
    await page.locator('#upload-form button[type="submit"]').click();
    await page.getByRole('heading', { name: '覆核隊列' }).waitFor({ timeout: 30000 });
    assert.match(await page.locator('.document-content').innerText(), /MoCA/i);

    const printPage = await context.newPage();
    await printPage.setContent('<p style="font-size:24px">MoCA: 21</p>');
    const pdf = await printPage.pdf();
    await printPage.close();
    await page.locator('.side-nav [data-nav="intake"]').click();
    await page.locator('#subject-id').selectOption({ label: 'OT-001' });
    await page.locator('#assessment-date').fill('2026-10-28');
    await page.locator('#note-file').setInputFiles({ name: 'report.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.locator('#upload-form button[type="submit"]').click();
    try { await page.getByRole('heading', { name: '覆核隊列' }).waitFor({ timeout: 10000 }); }
    catch { throw new Error(`PDF upload: ${await page.locator('.toast').allInnerTexts()} / ${errors.join('; ')}`); }
    assert.equal(await page.locator('#review-moca_total').inputValue(), '21');

    await page.locator('[data-nav="export"]').click();
    const backingUp = page.waitForEvent('download');
    await page.locator('[data-action="backup-workspace"]').click();
    const backup = await backingUp;
    const secondContext = await browser.newContext({ acceptDownloads: true });
    const secondPage = await secondContext.newPage();
    await secondPage.goto(url);
    await secondPage.getByRole('heading', { name: 'Study overview' }).waitFor();
    for (const section of ['overview', 'intake', 'review', 'dataset', 'variables', 'import', 'export']) {
      await secondPage.locator(`.side-nav [data-nav="${section}"]`).click();
      if (section === 'import') {
        await secondPage.locator('#import-file').setInputFiles({ name: 'sample.csv', mimeType: 'text/csv', buffer: Buffer.from('subject_id,assessment_date,score\nOT-003,2026-10-31,20\n') });
        await secondPage.locator('.mapping-select').first().waitFor();
      }
      if (section === 'export') {
        await secondPage.locator('#export-template').setInputFiles({ name: 'sample.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await readFile(await download.path()) });
        await secondPage.locator('.export-mapping').first().waitFor();
      }
      assert.deepEqual(await untranslatedEnglish(secondPage), [], `${section} has untranslated text`);
    }
    for (const action of ['new-project', 'new-subject', 'new-variable']) {
      if (action === 'new-project') await secondPage.locator('.project-trigger').click();
      if (action === 'new-subject') await secondPage.locator('[data-nav="intake"]').first().click();
      if (action === 'new-variable') await secondPage.locator('[data-nav="variables"]').first().click();
      await secondPage.locator(`[data-action="${action}"]`).first().click();
      assert.deepEqual(await untranslatedEnglish(secondPage), [], `${action} dialog has untranslated text`);
      await secondPage.locator('[data-action="close-modal"]').first().click();
    }
    await secondPage.locator('[data-nav="export"]').click();
    secondPage.once('dialog', dialog => dialog.accept());
    await secondPage.locator('#restore-workspace').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: await readFile(await backup.path()) });
    await secondPage.getByRole('heading', { name: 'Study overview' }).waitFor();
    assert.match(await secondPage.locator('.stats').innerText(), /2/);
    await secondContext.close();
    await page.locator('#language-select').selectOption('en');
    await page.getByRole('heading', { name: 'Export center' }).waitFor();
    await page.getByText('Download files').waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Study overview' }).waitFor();
    assert.deepEqual(errors, []);
    assert.deepEqual(backendCalls, []);
  } finally {
    await browser?.close();
    server.kill();
  }
});
