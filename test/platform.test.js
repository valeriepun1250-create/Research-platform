import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = mkdtempSync(join(tmpdir(), 'ot-platform-test-'));
const port = 33000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.js'], { cwd: process.cwd(), env: { ...process.env, DATA_DIR: dir, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', () => {});
server.stderr.on('data', () => {});

async function ready() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(base + '/api/state'); if (r.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server did not start');
}
async function api(path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(data)}`);
  return data;
}

test('project, note review, import and SPSS export workflow', async () => {
  try {
    await ready();
    const { id: projectId } = await api('/api/projects', 'POST', { name: 'Workflow test' });
    await api(`/api/projects/${projectId}/variables`, 'POST', { key: 'moca_total', label: 'MoCA total', type: 'INTEGER', min: 0, max: 30 });
    await api(`/api/projects/${projectId}/variables`, 'POST', { key: 'premorbid_adl', label: 'Premorbid ADL', type: 'CATEGORY', codes: [{ code: 1, label: 'Independent', aliases: [] }, { code: 2, label: 'Assist', aliases: [] }] });
    const { id: subjectId } = await api(`/api/projects/${projectId}/subjects`, 'POST', { code: 'T-001' });
    const text = 'Patient Name: Jane Smith\nPhone: 9123 4567\nMoCA: 0/30\nPremorbid ADL: Assist';
    const uploaded = await api(`/api/projects/${projectId}/notes`, 'POST', { subjectId, filename: 'note.txt', mimeType: 'text/plain', assessmentDate: '2026-10-20', contentBase64: Buffer.from(text).toString('base64') });
    const draft = await api(`/api/drafts/${uploaded.draftId}`);
    assert.ok(!draft.redacted_text.includes('Jane Smith'));
    assert.ok(!draft.redacted_text.includes('9123 4567'));
    assert.equal(draft.candidate.moca_total, 0);
    assert.equal(draft.candidate.premorbid_adl, 2);
    await api(`/api/drafts/${uploaded.draftId}`, 'PATCH', { candidate: { moca_total: 0, premorbid_adl: null }, missingReasons: { premorbid_adl: 'NOT_ASSESSABLE' } });
    await api(`/api/drafts/${uploaded.draftId}/approve`, 'POST', {});
    const repeat = await api(`/api/drafts/${uploaded.draftId}/approve`, 'POST', {});
    assert.ok(repeat.recordId);
    const importResult = await api(`/api/projects/${projectId}/imports/commit`, 'POST', { filename: 'old.csv', rows: [{ code: 'T-002', date: '2026-10-21', score: '14' }], mapping: { subject_id: 'code', assessment_date: 'date', moca_total: 'score' } });
    assert.equal(importResult.rowCount, 1);
    const state = await api(`/api/state?projectId=${projectId}`);
    assert.equal(state.records.length, 2);
    const csv = await (await fetch(`${base}/api/projects/${projectId}/export?format=csv`)).text();
    assert.match(csv, /T-001,2026-10-20,0,-98/);
    assert.match(csv, /T-002,2026-10-21,14,-99/);
    const sps = await (await fetch(`${base}/api/projects/${projectId}/export?format=sps`)).text();
    assert.match(sps, /MISSING VALUES moca_total premorbid_adl \(-99, -98\)/);
    const xlsx = await fetch(`${base}/api/projects/${projectId}/export?format=xlsx`);
    assert.equal(xlsx.status, 200);
    const workbook = Buffer.from(await xlsx.arrayBuffer());
    assert.equal(workbook.subarray(0, 2).toString(), 'PK');
    const preview = await api(`/api/projects/${projectId}/imports/preview`, 'POST', { filename: 'export.xlsx', contentBase64: workbook.toString('base64') });
    assert.deepEqual(preview.headers.slice(0, 2), ['subject_id', 'assessment_date']);
    assert.equal(preview.rows.length, 2);
    const mapping = { subject_id: 'subject_id', assessment_date: 'assessment_date', moca_total: 'moca_total', premorbid_adl: 'premorbid_adl' };
    const mergedResponse = await fetch(`${base}/api/projects/${projectId}/export/template`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'previous.xlsx', contentBase64: workbook.toString('base64'), mapping })
    });
    assert.equal(mergedResponse.status, 200);
    const merged = Buffer.from(await mergedResponse.arrayBuffer());
    const unchangedSheet = spawnSync('python3', ['-c', 'import io,sys,zipfile; a=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(a.read("xl/worksheets/sheet2.xml").hex())'], { input: workbook });
    const preservedSheet = spawnSync('python3', ['-c', 'import io,sys,zipfile; a=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(a.read("xl/worksheets/sheet2.xml").hex())'], { input: merged });
    assert.equal(unchangedSheet.status, 0);
    assert.equal(preservedSheet.status, 0);
    assert.equal(preservedSheet.stdout.toString(), unchangedSheet.stdout.toString());
    const mergedPreview = await api(`/api/projects/${projectId}/imports/preview`, 'POST', { filename: 'updated.xlsx', contentBase64: merged.toString('base64') });
    assert.equal(mergedPreview.rows.length, 2);
    assert.equal(mergedPreview.rows.find(row => row.subject_id === 'T-001').moca_total, '0');
    const repeated = await fetch(`${base}/api/projects/${projectId}/export/template`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'updated.xlsx', contentBase64: merged.toString('base64'), mapping })
    });
    assert.equal(repeated.status, 200);
    const repeatedPreview = await api(`/api/projects/${projectId}/imports/preview`, 'POST', { filename: 'again.xlsx', contentBase64: Buffer.from(await repeated.arrayBuffer()).toString('base64') });
    assert.equal(repeatedPreview.rows.length, 2);
    await api(`/api/projects/${projectId}/imports/commit`, 'POST', { filename: 'new.csv', rows: [{ code: 'T-003', date: '2026-10-22', score: '17' }], mapping: { subject_id: 'code', assessment_date: 'date', moca_total: 'score' } });
    const addedResponse = await fetch(`${base}/api/projects/${projectId}/export/template`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'previous.xlsx', contentBase64: workbook.toString('base64'), mapping })
    });
    assert.equal(addedResponse.status, 200);
    const addedPreview = await api(`/api/projects/${projectId}/imports/preview`, 'POST', { filename: 'added.xlsx', contentBase64: Buffer.from(await addedResponse.arrayBuffer()).toString('base64') });
    assert.equal(addedPreview.rows.length, 3);
    assert.equal(addedPreview.rows.find(row => row.subject_id === 'T-003').moca_total, '17');
    const variableToRemove = (await api(`/api/state?projectId=${projectId}`)).variables.find(v => v.key === 'premorbid_adl');
    await api(`/api/projects/${projectId}/variables/${variableToRemove.id}`, 'DELETE');
    const afterRemoval = await api(`/api/state?projectId=${projectId}`);
    assert.ok(!afterRemoval.variables.some(v => v.key === 'premorbid_adl'));
    assert.equal(afterRemoval.records.find(r => r.subject_code === 'T-001').values.premorbid_adl, null);
    const csvAfterRemoval = await (await fetch(`${base}/api/projects/${projectId}/export?format=csv`)).text();
    assert.ok(!csvAfterRemoval.includes('premorbid_adl'));
    const repeatedRemoval = await fetch(`${base}/api/projects/${projectId}/variables/${variableToRemove.id}`, { method: 'DELETE' });
    assert.equal(repeatedRemoval.status, 404);
  } finally {
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repairs drafts written after a legacy column-order migration', async () => {
  const legacyDir = mkdtempSync(join(tmpdir(), 'ot-legacy-test-'));
  const legacyPort = port + 1;
  const legacyDb = new DatabaseSync(join(legacyDir, 'platform.sqlite'));
  legacyDb.exec(`CREATE TABLE drafts (
    id TEXT PRIMARY KEY, note_id TEXT NOT NULL, candidate TEXT NOT NULL,
    confidence TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL,
    updated_at TEXT NOT NULL, missing_reasons TEXT NOT NULL
  );`);
  legacyDb.prepare('INSERT INTO drafts VALUES (?,?,?,?,?,?,?,?)').run(
    'draft-1', 'note-1', '{}', '{}', '{}', '{"moca_total":"NOT_RECORDED"}',
    'pending', '2026-10-25T16:08:54.928Z'
  );
  legacyDb.close();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(), env: { ...process.env, DATA_DIR: legacyDir, PORT: String(legacyPort) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(`http://127.0.0.1:${legacyPort}/api/state`)).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const repaired = new DatabaseSync(join(legacyDir, 'platform.sqlite'), { readOnly: true });
    const draft = repaired.prepare('SELECT status, updated_at, missing_reasons FROM drafts WHERE id=?').get('draft-1');
    repaired.close();
    assert.equal(draft.status, 'pending');
    assert.equal(draft.updated_at, '2026-10-25T16:08:54.928Z');
    assert.equal(draft.missing_reasons, '{"moca_total":"NOT_RECORDED"}');
  } finally {
    child.kill();
    rmSync(legacyDir, { recursive: true, force: true });
  }
});

test('imports file columns as new project variables in one transaction', async () => {
  const importDir = mkdtempSync(join(tmpdir(), 'ot-auto-variables-'));
  const importPort = port + 2;
  const importBase = `http://127.0.0.1:${importPort}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(), env: { ...process.env, DATA_DIR: importDir, PORT: String(importPort) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(importBase + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    assert.ok(response.ok, `${response.status}: ${JSON.stringify(data)}`);
    return data;
  };
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(importBase + '/api/state')).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const { id: projectId } = await call('/api/projects', 'POST', { name: 'Auto variables test' });
    const input = {
      filename: 'baseline.csv',
      rows: [{ Subject: 'R-001', Date: '2026-10-27', MoCA: '21', MBI: '74', Comment: 'reviewed' }],
      mapping: { subject_id: 'Subject', assessment_date: 'Date' },
      newVariables: [
        { column: 'MoCA', key: 'moca', label: 'MoCA', type: 'INTEGER' },
        { column: 'MBI', key: 'mbi', label: 'MBI', type: 'INTEGER' },
        { column: 'Comment', key: 'comment', label: 'Comment', type: 'TEXT' }
      ]
    };
    const result = await call(`/api/projects/${projectId}/imports/commit`, 'POST', input);
    assert.equal(result.variablesCreated, 3);
    let state = await call(`/api/state?projectId=${projectId}`);
    assert.deepEqual(state.variables.map(v => v.key), ['moca', 'mbi', 'comment']);
    assert.equal(state.records[0].values.moca, 21);
    assert.equal(state.records[0].values.comment, 'reviewed');
    const moca = state.variables.find(v => v.key === 'moca');
    await call(`/api/projects/${projectId}/variables/${moca.id}`, 'PATCH', { label: 'MoCA revised', type: 'INTEGER', unit: 'points', min: 0, max: 30 });
    state = await call(`/api/state?projectId=${projectId}`);
    assert.equal(state.variables.find(v => v.key === 'moca').label, 'MoCA revised');
    const comment = state.variables.find(v => v.key === 'comment');
    await call(`/api/projects/${projectId}/variables/${comment.id}`, 'PATCH', { label: 'Comment category', type: 'CATEGORY', unit: '', codes: [{ code: 1, label: 'reviewed', aliases: [] }] }).then(
      () => assert.fail('Existing text values must not be reinterpreted as category codes'),
      error => assert.match(error.message, /更改型別/)
    );
    const { id: categoryId } = await call(`/api/projects/${projectId}/variables`, 'POST', { key: 'adl', label: 'ADL', type: 'CATEGORY', codes: [{ code: 1, label: 'Independent', aliases: [] }] });
    await call(`/api/projects/${projectId}/variables/${categoryId}`, 'PATCH', { label: 'ADL status', type: 'CATEGORY', unit: '', codes: [{ code: 1, label: 'Independent', aliases: ['獨立'] }, { code: 2, label: 'Assist', aliases: [] }] });
    state = await call(`/api/state?projectId=${projectId}`);
    assert.equal(state.variables.find(v => v.key === 'adl').codes.length, 2);
    assert.equal(state.variables.find(v => v.key === 'moca').unit, 'points');
    const incompatible = await fetch(`${importBase}/api/projects/${projectId}/variables/${moca.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Invalid range', type: 'INTEGER', unit: 'points', min: 22, max: 30 })
    });
    assert.equal(incompatible.status, 400);
    const typeChange = await fetch(`${importBase}/api/projects/${projectId}/variables/${moca.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Invalid type', type: 'TEXT', unit: '' })
    });
    assert.equal(typeChange.status, 400);
    state = await call(`/api/state?projectId=${projectId}`);
    assert.equal(state.variables.find(v => v.key === 'moca').label, 'MoCA revised');
    const invalid = await fetch(`${importBase}/api/projects/${projectId}/imports/commit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, rows: [{ ...input.rows[0], Subject: 'R-002', MoCA: 'bad' }], newVariables: [{ column: 'MoCA', key: 'new_score', label: 'New score', type: 'INTEGER' }] })
    });
    assert.equal(invalid.status, 400);
    state = await call(`/api/state?projectId=${projectId}`);
    assert.ok(!state.variables.some(v => v.key === 'new_score'));
    assert.equal(state.records.length, 1);
  } finally {
    child.kill();
    rmSync(importDir, { recursive: true, force: true });
  }
});
