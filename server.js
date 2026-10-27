import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(root, '.data');
const noteDir = join(dataDir, 'notes');
mkdirSync(noteDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, 'platform.sqlite'));
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  schema_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS variables (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  key TEXT NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '',
  required INTEGER NOT NULL DEFAULT 0, min_value REAL, max_value REAL,
  codes TEXT NOT NULL DEFAULT '[]', sort_order INTEGER NOT NULL DEFAULT 0,
  retired INTEGER NOT NULL DEFAULT 0, UNIQUE(project_id, key)
);
CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  code TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id, code)
);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  subject_id TEXT NOT NULL REFERENCES subjects(id), file_name TEXT NOT NULL,
  file_path TEXT NOT NULL, mime_type TEXT NOT NULL, sha256 TEXT NOT NULL,
  redacted_text TEXT NOT NULL, status TEXT NOT NULL, assessment_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY, note_id TEXT NOT NULL UNIQUE REFERENCES notes(id),
  candidate TEXT NOT NULL, confidence TEXT NOT NULL, evidence TEXT NOT NULL,
  missing_reasons TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending', updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  subject_id TEXT NOT NULL REFERENCES subjects(id), note_id TEXT REFERENCES notes(id),
  import_id TEXT, assessment_date TEXT NOT NULL, values_json TEXT NOT NULL,
  missing_reasons TEXT NOT NULL DEFAULT '{}', schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(note_id)
);
CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  source_name TEXT NOT NULL, row_count INTEGER NOT NULL, mapping_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS records_project_date ON records(project_id, assessment_date);
CREATE INDEX IF NOT EXISTS notes_project_date ON notes(project_id, created_at);
`);
if (!db.prepare('PRAGMA table_info(drafts)').all().some(column => column.name === 'missing_reasons')) {
  db.exec("ALTER TABLE drafts ADD COLUMN missing_reasons TEXT NOT NULL DEFAULT '{}'");
}
// Repair drafts written by an older build that relied on column order after ALTER TABLE.
db.exec(`UPDATE drafts
  SET missing_reasons = status, status = updated_at, updated_at = missing_reasons
  WHERE status LIKE '{%}' AND updated_at IN ('pending', 'approved', 'rejected')`);

const now = () => new Date().toISOString();
const uid = () => randomUUID();
const json = (value) => JSON.stringify(value);
const parse = (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } };
const all = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);

function audit(projectId, action, entityType, entityId, metadata = {}) {
  run('INSERT INTO audit_events VALUES (?,?,?,?,?,?,?)', uid(), projectId, action, entityType, entityId, json(metadata), now());
}

function seed() {
  if (one('SELECT id FROM projects LIMIT 1')) return;
  const pid = uid();
  run('INSERT INTO projects VALUES (?,?,?,?,?)', pid, '認知復康成效研究', '門診職業治療評估數據', 1, now());
  const variables = [
    ['moca_total', 'MoCA 總分', 'INTEGER', '分', 0, 30, []],
    ['mbi_total', 'MBI 總分', 'INTEGER', '分', 0, 100, []],
    ['premorbid_adl', 'Premorbid ADL', 'CATEGORY', '', null, null, [{ code: 1, label: 'Independent', aliases: ['independent', '獨立'] }, { code: 2, label: 'Assist', aliases: ['assist', '需協助'] }]],
    ['ftuhe_total', 'FTUHE 總分', 'DECIMAL', '分', null, null, []]
  ];
  variables.forEach(([key, label, type, unit, min, max, codes], i) => {
    run('INSERT INTO variables VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', uid(), pid, key, label, type, unit, 0, min, max, json(codes), i, 0);
  });
  const subjects = ['OT-001', 'OT-002', 'OT-003', 'OT-004'];
  subjects.forEach((code, i) => {
    const sid = uid();
    run('INSERT INTO subjects VALUES (?,?,?,?)', sid, pid, code, now());
    if (i < 3) {
      const values = [
        { moca_total: 22, mbi_total: 75, premorbid_adl: 1 },
        { moca_total: 18, mbi_total: 60, premorbid_adl: 2 },
        { moca_total: 26, mbi_total: 90, premorbid_adl: 1 }
      ][i];
      run('INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?)', uid(), pid, sid, null, null, `2026-10-${String(8 + i * 4).padStart(2, '0')}`, json(values), '{}', 1, now());
    }
  });
  audit(pid, 'project.created', 'project', pid, { seeded: true });
}
seed();

function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(json(data));
}
function fail(res, status, message) { send(res, status, { error: message }); }
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) throw new Error('檔案不可超過 12 MB');
    chunks.push(chunk);
  }
  return parse(Buffer.concat(chunks).toString('utf8'), {});
}
function validProject(id) {
  const project = one('SELECT * FROM projects WHERE id=?', id);
  if (!project) throw new Error('找不到專案');
  return project;
}
function variables(projectId) {
  return all('SELECT * FROM variables WHERE project_id=? AND retired=0 ORDER BY sort_order, rowid', projectId)
    .map(v => ({ ...v, required: !!v.required, codes: parse(v.codes, []) }));
}
function redact(text) {
  return text
    .replace(/\b[A-Z]{1,2}\d{6}\(?[0-9A]\)?(?=$|[\s,;.])/gi, '[HKID]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]')
    .replace(/(?:\+?852[\s-]?)?[5689]\d{3}[\s-]?\d{4}\b/g, '[PHONE]')
    .replace(/(^|\n)(\s*(?:Patient Name|Name|姓名|病人姓名)\s*[:：]\s*)[^\n]+/gi, '$1$2[NAME]')
    .replace(/(^|\n)(\s*(?:Address|地址)\s*[:：]\s*)[^\n]+/gi, '$1$2[ADDRESS]');
}
function extract(text, vars) {
  const candidate = {}, confidence = {}, evidence = {};
  const lines = text.split(/\r?\n/);
  for (const variable of vars) {
    const names = [variable.key.replaceAll('_', ' '), variable.label];
    if (variable.key === 'moca_total') names.push('MoCA');
    if (variable.key === 'mbi_total') names.push('MBI', 'Modified Barthel Index');
    if (variable.key === 'ftuhe_total') names.push('FTUHE');
    if (variable.key === 'premorbid_adl') names.push('Premorbid ADL');
    let found = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const label = names.find(name => line.toLowerCase().includes(name.toLowerCase()));
      if (!label) continue;
      const tail = line.slice(line.toLowerCase().indexOf(label.toLowerCase()) + label.length);
      let value = null;
      if (variable.type === 'CATEGORY') {
        const code = variable.codes.find(c => [c.label, ...(c.aliases || [])].some(a => tail.toLowerCase().includes(String(a).toLowerCase())));
        value = code?.code ?? null;
      } else if (variable.type === 'INTEGER' || variable.type === 'DECIMAL') {
        const match = tail.match(/(?:[:：=\s]|score\s*)*([-+]?\d+(?:\.\d+)?)/i);
        value = match ? Number(match[1]) : null;
      } else {
        value = tail.replace(/^\s*[:：=]\s*/, '').trim() || null;
      }
      if (value !== null) { found = { value, line: line.trim(), page: 1 }; break; }
    }
    candidate[variable.key] = found?.value ?? null;
    confidence[variable.key] = found ? 0.82 : 0;
    evidence[variable.key] = found ? { page: found.page, quote: found.line.slice(0, 240) } : null;
  }
  return { candidate, confidence, evidence };
}
async function extractWithModel(text, vars) {
  const base = extract(text, vars);
  const endpoint = process.env.OLLAMA_URL;
  if (!endpoint) return base;
  const url = new URL(endpoint);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('OLLAMA_URL 必須指向本機');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(new URL('/api/chat', url), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: json({
        model: process.env.OLLAMA_MODEL || 'qwen2.5:7b', stream: false,
        format: {
          type: 'object', properties: { values: { type: 'array', items: {
            type: 'object', properties: {
              key: { type: 'string', enum: vars.map(v => v.key) },
              value_text: { type: ['string', 'null'] },
              quote: { type: ['string', 'null'] }
            }, required: ['key', 'value_text', 'quote']
          } } }, required: ['values']
        },
        messages: [
          { role: 'system', content: '你是職業治療研究資料擷取器。只根據去識別化筆記的明確證據填值；缺漏用 null。不得推測或輸出個人識別資料。每欄提供簡短原文證據。' },
          { role: 'user', content: `欄位：${json(vars.map(v => ({ key: v.key, label: v.label, type: v.type, codes: v.codes })))}\n\n筆記：\n${text}` }
        ]
      })
    });
    if (!response.ok) throw new Error(`本地模型回應 ${response.status}`);
    const payload = await response.json();
    const parsed = parse(payload.message?.content, {});
    if (!Array.isArray(parsed.values)) throw new Error('本地模型輸出格式無效');
    for (const item of parsed.values) {
      const variable = vars.find(v => v.key === item.key);
      if (!variable || item.value_text == null || !item.quote) continue;
      const quote = String(item.quote).slice(0, 240);
      if (!text.includes(quote)) continue;
      try {
        base.candidate[variable.key] = validateValue(variable, item.value_text);
        base.confidence[variable.key] = 0.72;
        base.evidence[variable.key] = { page: null, quote };
      } catch { /* Out-of-range output remains available for manual review. */ }
    }
    return base;
  } finally { clearTimeout(timer); }
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function validateValue(variable, input) {
  if (input === '' || input === null || input === undefined) {
    if (variable.required) throw new Error(`${variable.label} 為必填欄位`);
    return null;
  }
  if (variable.type === 'CATEGORY') {
    const code = variable.codes.find(c => String(c.code) === String(input) || [c.label, ...(c.aliases || [])].some(a => String(a).toLowerCase() === String(input).trim().toLowerCase()));
    if (!code) throw new Error(`${variable.label} 沒有對應代碼`);
    return code.code;
  }
  if (variable.type === 'INTEGER' || variable.type === 'DECIMAL') {
    const value = Number(input);
    if (!Number.isFinite(value) || (variable.type === 'INTEGER' && !Number.isInteger(value))) throw new Error(`${variable.label} 必須是${variable.type === 'INTEGER' ? '整數' : '數字'}`);
    if (value === -99 || value === -98) throw new Error(`${variable.label} 的 -99 和 -98 保留作缺值代碼`);
    if (variable.min_value !== null && value < variable.min_value) throw new Error(`${variable.label} 低於允許範圍`);
    if (variable.max_value !== null && value > variable.max_value) throw new Error(`${variable.label} 高於允許範圍`);
    return value;
  }
  if (variable.type === 'DATE') {
    if (!validDate(String(input))) throw new Error(`${variable.label} 日期格式不正確`);
    return String(input);
  }
  return String(input).slice(0, 1000);
}
function normalizeValues(vars, input) {
  const output = {};
  for (const variable of vars) output[variable.key] = validateValue(variable, input?.[variable.key]);
  return output;
}
function normalizeMissingReasons(vars, values, input) {
  const reasons = {};
  for (const variable of vars) {
    if (values[variable.key] !== null) continue;
    const reason = input?.[variable.key] || 'NOT_RECORDED';
    if (!['NOT_RECORDED', 'NOT_ASSESSABLE'].includes(reason)) throw new Error(`${variable.label} 的缺值原因無效`);
    reasons[variable.key] = reason;
  }
  return reasons;
}
function transaction(callback) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = callback(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function state(projectId) {
  const projects = all('SELECT * FROM projects ORDER BY created_at');
  const project = validProject(projectId || projects[0]?.id);
  const vars = variables(project.id);
  const subjects = all('SELECT * FROM subjects WHERE project_id=? ORDER BY code', project.id);
  const notes = all(`SELECT n.*, s.code AS subject_code, d.id AS draft_id, d.status AS draft_status
    FROM notes n JOIN subjects s ON s.id=n.subject_id LEFT JOIN drafts d ON d.note_id=n.id
    WHERE n.project_id=? ORDER BY n.created_at DESC`, project.id);
  const records = all(`SELECT r.*, s.code AS subject_code FROM records r JOIN subjects s ON s.id=r.subject_id
    WHERE r.project_id=? ORDER BY r.assessment_date DESC, r.created_at DESC`, project.id)
    .map(r => ({ ...r, values: parse(r.values_json, {}), missingReasons: parse(r.missing_reasons, {}) }));
  const imports = all('SELECT * FROM imports WHERE project_id=? ORDER BY created_at DESC', project.id);
  const activity = all('SELECT * FROM audit_events WHERE project_id=? ORDER BY created_at DESC LIMIT 8', project.id);
  return { projects, project, variables: vars, subjects, notes, records, imports, activity };
}
function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); if (row.some(v => v !== '')) rows.push(row);
      row = []; cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('CSV 引號沒有正確關閉');
  row.push(cell); if (row.some(v => v !== '')) rows.push(row);
  const headers = (rows.shift() || []).map((h, i) => i === 0 ? h.replace(/^\uFEFF/, '').trim() : h.trim());
  return { headers, rows: rows.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']))) };
}
function csvCell(value) {
  const raw = String(value ?? '');
  const safe = /^[=+@-]/.test(raw) && !/^[-+]\d+(\.\d+)?$/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
function csv(rows) { return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
function exportRows(projectId) {
  const vars = variables(projectId);
  const records = state(projectId).records;
  const headers = ['subject_id', 'assessment_date', ...vars.map(v => v.key)];
  const rows = records.map(r => [r.subject_code, r.assessment_date, ...vars.map(v => {
    const value = r.values[v.key];
    return value === null || value === undefined ? (['INTEGER', 'DECIMAL', 'CATEGORY'].includes(v.type) ? (r.missingReasons[v.key] === 'NOT_ASSESSABLE' ? -98 : -99) : '') : value;
  })]);
  return { vars, headers, rows };
}
function spssSyntax({ vars }) {
  const names = vars.map(v => v.key);
  const numeric = vars.filter(v => ['INTEGER', 'DECIMAL', 'CATEGORY'].includes(v.type));
  const definitions = ['subject_id A40', 'assessment_date A10', ...vars.map(v => `${v.key} ${v.type === 'TEXT' || v.type === 'DATE' ? 'A255' : 'F12.3'}`)].join('\n ');
  const labels = vars.map(v => `VARIABLE LABELS ${v.key} '${v.label.replaceAll("'", "''")}'.`).join('\n');
  const valueLabels = vars.filter(v => v.codes.length).map(v => `VALUE LABELS ${v.key} ${v.codes.map(c => `${c.code} '${c.label.replaceAll("'", "''")}'`).join(' ')}.`).join('\n');
  return `* CSV and syntax files must be saved in the same folder.\nGET DATA /TYPE=TXT /FILE='data.csv' /ENCODING='UTF8' /DELCASE=LINE /DELIMITERS="," /QUALIFIER='"' /ARRANGEMENT=DELIMITED /FIRSTCASE=2 /VARIABLES=\n ${definitions}.\n${labels}\n${valueLabels}\n${numeric.length ? `MISSING VALUES ${numeric.map(v => v.key).join(' ')} (-99, -98).` : ''}\nEXECUTE.\n`;
}
function contentType(path) {
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream';
}
function staticFile(res, path) {
  const file = resolve(root, 'public', path === '/' ? 'index.html' : path.slice(1));
  if (!file.startsWith(resolve(root, 'public') + '/') || !existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
}

async function api(req, res, url) {
  const method = req.method;
  const path = url.pathname;
  if (method === 'GET' && path === '/api/state') return send(res, 200, state(url.searchParams.get('projectId')));
  if (method === 'POST' && path === '/api/projects') {
    const b = await body(req); if (!String(b.name || '').trim()) throw new Error('請輸入專案名稱');
    const id = uid(); run('INSERT INTO projects VALUES (?,?,?,?,?)', id, String(b.name).trim(), String(b.description || '').trim(), 1, now());
    audit(id, 'project.created', 'project', id); return send(res, 201, { id });
  }
  let match = path.match(/^\/api\/projects\/([^/]+)\/variables$/);
  if (method === 'POST' && match) {
    const project = validProject(match[1]); const b = await body(req);
    const key = String(b.key || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || ['all','and','by','eq','ge','gt','le','lt','ne','not','or','to','with'].includes(key)) throw new Error('變數名稱需以英文字母開頭，只可包含英文字母、數字及底線，最多 64 字元，且不可使用 SPSS 保留字');
    if (!['INTEGER', 'DECIMAL', 'CATEGORY', 'TEXT', 'DATE'].includes(b.type)) throw new Error('資料型別無效');
    if (!String(b.label || '').trim()) throw new Error('請輸入欄位標籤');
    const codes = b.type === 'CATEGORY' ? (b.codes || []).map(c => ({ code: Number(c.code), label: String(c.label || '').trim(), aliases: Array.isArray(c.aliases) ? c.aliases : [] })) : [];
    if (b.type === 'CATEGORY' && (!codes.length || codes.some(c => !Number.isInteger(c.code) || [-99, -98].includes(c.code) || !c.label) || new Set(codes.map(c => c.code)).size !== codes.length)) throw new Error('類別欄位需要不重複的數值代碼與標籤，且不可使用 -99 或 -98');
    const id = uid();
    transaction(() => {
      run('INSERT INTO variables VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, project.id, key, String(b.label).trim(), b.type, String(b.unit || ''), b.required ? 1 : 0, b.min === '' || b.min == null ? null : Number(b.min), b.max === '' || b.max == null ? null : Number(b.max), json(codes), variables(project.id).length, 0);
      run('UPDATE projects SET schema_version=schema_version+1 WHERE id=?', project.id);
      audit(project.id, 'variable.created', 'variable', id, { key });
    });
    return send(res, 201, { id });
  }
  match = path.match(/^\/api\/projects\/([^/]+)\/variables\/([^/]+)$/);
  if (method === 'PATCH' && match) {
    const project = validProject(match[1]);
    const previous = one('SELECT * FROM variables WHERE id=? AND project_id=? AND retired=0', match[2], project.id);
    if (!previous) return fail(res, 404, '找不到變數');
    const b = await body(req);
    const label = String(b.label || '').trim();
    const type = String(b.type || '');
    const unit = String(b.unit || '').trim();
    const min = b.min === '' || b.min == null ? null : Number(b.min);
    const max = b.max === '' || b.max == null ? null : Number(b.max);
    if (!label || label.length > 200) throw new Error('請輸入 200 字以內的顯示標籤');
    if (!['INTEGER', 'DECIMAL', 'CATEGORY', 'TEXT', 'DATE'].includes(type)) throw new Error('資料型別無效');
    if (unit.length > 60) throw new Error('單位不可超過 60 字');
    if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max)) || (min !== null && max !== null && min > max)) throw new Error('數值範圍無效');
    const codes = type === 'CATEGORY' ? (Array.isArray(b.codes) ? b.codes : []).map(c => ({ code: Number(c.code), label: String(c.label || '').trim(), aliases: Array.isArray(c.aliases) ? c.aliases.map(String) : [] })) : [];
    if (type === 'CATEGORY' && (!codes.length || codes.some(c => !Number.isInteger(c.code) || [-99, -98].includes(c.code) || !c.label) || new Set(codes.map(c => c.code)).size !== codes.length)) throw new Error('類別變數需要不重複的數值代碼，且不可使用 -99 或 -98');
    const updated = { ...previous, label, type, unit, min_value: min, max_value: max, codes };
    const stored = all('SELECT values_json FROM records WHERE project_id=?', project.id).map(r => parse(r.values_json, {})[previous.key]);
    const staged = all('SELECT d.candidate FROM drafts d JOIN notes n ON n.id=d.note_id WHERE n.project_id=? AND d.status=?', project.id, 'pending').map(d => parse(d.candidate, {})[previous.key]);
    if (type !== previous.type && [...stored, ...staged].some(value => value !== undefined && value !== null && value !== '')) {
      throw new Error('此變數已有正式紀錄或待覆核數值；更改型別需要先遷移資料，請另建變數');
    }
    for (const value of [...stored, ...staged]) {
      if (value === undefined || value === null || value === '') continue;
      try { validateValue(updated, value); }
      catch { throw new Error(`已有紀錄或待覆核草稿的 ${previous.key} 值「${String(value).slice(0, 50)}」與新設定不相容；請先修正資料或保留原型別／範圍／代碼`); }
    }
    transaction(() => {
      run('UPDATE variables SET label=?, type=?, unit=?, min_value=?, max_value=?, codes=? WHERE id=?', label, type, unit, min, max, json(codes), previous.id);
      run('UPDATE projects SET schema_version=schema_version+1 WHERE id=?', project.id);
      audit(project.id, 'variable.updated', 'variable', previous.id, { key: previous.key, before: { label: previous.label, type: previous.type, unit: previous.unit, min: previous.min_value, max: previous.max_value, codes: parse(previous.codes, []) }, after: { label, type, unit, min, max, codes } });
    });
    return send(res, 200, { ok: true });
  }
  if (method === 'DELETE' && match) {
    const project = validProject(match[1]);
    const variable = one('SELECT * FROM variables WHERE id=? AND project_id=? AND retired=0', match[2], project.id);
    if (!variable) return fail(res, 404, '找不到變數');
    transaction(() => {
      run('UPDATE variables SET retired=1 WHERE id=?', variable.id);
      run('UPDATE projects SET schema_version=schema_version+1 WHERE id=?', project.id);
      audit(project.id, 'variable.retired', 'variable', variable.id, { key: variable.key });
    });
    return send(res, 200, { ok: true });
  }
  match = path.match(/^\/api\/projects\/([^/]+)\/subjects$/);
  if (method === 'POST' && match) {
    const project = validProject(match[1]); const b = await body(req);
    const code = String(b.code || '').trim(); if (!/^[A-Za-z0-9_-]{2,40}$/.test(code)) throw new Error('受試者編號需為 2 至 40 個英文字母、數字、- 或 _');
    const id = uid(); run('INSERT INTO subjects VALUES (?,?,?,?)', id, project.id, code, now());
    audit(project.id, 'subject.created', 'subject', id); return send(res, 201, { id });
  }
  match = path.match(/^\/api\/projects\/([^/]+)\/notes$/);
  if (method === 'POST' && match) {
    const project = validProject(match[1]); const b = await body(req);
    const subject = one('SELECT * FROM subjects WHERE id=? AND project_id=?', b.subjectId, project.id);
    if (!subject) throw new Error('請先選擇受試者');
    if (!validDate(b.assessmentDate)) throw new Error('請選擇有效評估日期');
    const filename = String(b.filename || 'note.txt').slice(0, 180);
    const extension = extname(filename).toLowerCase();
    if (!['.txt', '.pdf', '.png', '.jpg', '.jpeg'].includes(extension)) throw new Error('只支援 TXT、PDF、PNG 和 JPG');
    const bytes = Buffer.from(String(b.contentBase64 || ''), 'base64');
    if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw new Error('檔案必須介乎 1 byte 至 12 MB');
    const id = uid(), filePath = join(noteDir, id + extension);
    writeFileSync(filePath, bytes, { mode: 0o600 });
    let text;
    try {
      if (extension === '.txt') text = bytes.toString('utf8');
      else {
      const ocrBinary = join(dataDir, 'ocr');
      if (!existsSync(ocrBinary)) {
        const compile = spawnSync('clang', ['-fobjc-arc', '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'PDFKit', '-framework', 'Vision', join(root, 'scripts', 'ocr.m'), '-o', ocrBinary], { encoding: 'utf8', timeout: 60000 });
        if (compile.status !== 0) throw new Error(`本地 OCR 編譯失敗：${(compile.stderr || '').trim().slice(0, 160)}`);
      }
      const ocr = spawnSync(ocrBinary, [filePath], { encoding: 'utf8', timeout: 90000, maxBuffer: 6 * 1024 * 1024 });
      if (ocr.status !== 0) throw new Error(`無法讀取文件：${(ocr.stderr || '').trim().slice(0, 160) || '本地 OCR 失敗'}`);
      text = ocr.stdout;
      }
      if (!text.trim()) throw new Error('文件沒有可讀取的文字');
    } catch (error) { unlinkSync(filePath); throw error; }
    const clean = redact(text);
    const projectVars = variables(project.id);
    const extracted = await extractWithModel(clean, projectVars);
    const missingReasons = normalizeMissingReasons(projectVars, extracted.candidate, {});
    const draftId = uid();
    transaction(() => {
      run('INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)', id, project.id, subject.id, filename, filePath, String(b.mimeType || 'application/octet-stream'), createHash('sha256').update(bytes).digest('hex'), clean, 'ready', b.assessmentDate, now());
      run('INSERT INTO drafts (id, note_id, candidate, confidence, evidence, missing_reasons, status, updated_at) VALUES (?,?,?,?,?,?,?,?)', draftId, id, json(extracted.candidate), json(extracted.confidence), json(extracted.evidence), json(missingReasons), 'pending', now());
      audit(project.id, 'note.uploaded', 'note', id, { fileType: extension, draftId });
    });
    return send(res, 201, { noteId: id, draftId });
  }
  match = path.match(/^\/api\/drafts\/([^/]+)$/);
  if (match && method === 'GET') {
    const draft = one(`SELECT d.*, n.redacted_text, n.assessment_date, n.file_name, n.project_id, n.subject_id, s.code AS subject_code
      FROM drafts d JOIN notes n ON n.id=d.note_id JOIN subjects s ON s.id=n.subject_id WHERE d.id=?`, match[1]);
    if (!draft) return fail(res, 404, '找不到草稿');
    return send(res, 200, { ...draft, candidate: parse(draft.candidate, {}), confidence: parse(draft.confidence, {}), evidence: parse(draft.evidence, {}), missingReasons: parse(draft.missing_reasons, {}), variables: variables(draft.project_id) });
  }
  if (match && method === 'PATCH') {
    const draft = one('SELECT d.*, n.project_id FROM drafts d JOIN notes n ON n.id=d.note_id WHERE d.id=?', match[1]);
    if (!draft || draft.status !== 'pending') throw new Error('草稿不可修改');
    const b = await body(req); const vars = variables(draft.project_id); const values = normalizeValues(vars, b.candidate || {});
    const reasons = normalizeMissingReasons(vars, values, b.missingReasons || parse(draft.missing_reasons, {}));
    run('UPDATE drafts SET candidate=?, missing_reasons=?, updated_at=? WHERE id=?', json(values), json(reasons), now(), draft.id);
    audit(draft.project_id, 'draft.edited', 'draft', draft.id);
    return send(res, 200, { ok: true });
  }
  match = path.match(/^\/api\/drafts\/([^/]+)\/approve$/);
  if (match && method === 'POST') {
    const draft = one(`SELECT d.*, n.project_id, n.subject_id, n.assessment_date FROM drafts d
      JOIN notes n ON n.id=d.note_id WHERE d.id=?`, match[1]);
    if (!draft) return fail(res, 404, '找不到草稿');
    if (draft.status === 'approved') {
      const existing = one('SELECT id FROM records WHERE note_id=?', draft.note_id);
      return send(res, 200, { recordId: existing?.id });
    }
    const project = validProject(draft.project_id);
    const vars = variables(project.id);
    const values = normalizeValues(vars, parse(draft.candidate, {}));
    const reasons = normalizeMissingReasons(vars, values, parse(draft.missing_reasons, {}));
    const id = uid();
    transaction(() => {
      run('INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?)', id, project.id, draft.subject_id, draft.note_id, null, draft.assessment_date, json(values), json(reasons), project.schema_version, now());
      run('UPDATE drafts SET status=?, updated_at=? WHERE id=?', 'approved', now(), draft.id);
      audit(project.id, 'record.approved', 'record', id, { noteId: draft.note_id });
    });
    return send(res, 201, { recordId: id });
  }
  match = path.match(/^\/api\/projects\/([^/]+)\/imports\/preview$/);
  if (match && method === 'POST') {
    validProject(match[1]); const b = await body(req);
    const extension = extname(String(b.filename || '')).toLowerCase();
    const bytes = Buffer.from(String(b.contentBase64 || ''), 'base64');
    let parsed;
    if (extension === '.csv') parsed = parseCsv(bytes.toString('utf8'));
    else if (extension === '.xlsx') {
      const result = spawnSync('python3', [join(root, 'scripts', 'xlsx.py'), 'read'], { input: bytes, maxBuffer: 15 * 1024 * 1024 });
      if (result.status !== 0) throw new Error('無法讀取 Excel 檔案：' + result.stderr.toString('utf8').slice(0, 120));
      parsed = parse(result.stdout.toString('utf8'));
    } else throw new Error('只支援 CSV 或 XLSX');
    if (!parsed?.headers?.length || parsed.rows.length > 10000) throw new Error('檔案沒有欄位，或超過 10,000 行');
    return send(res, 200, { ...parsed, rows: parsed.rows.slice(0, 10000) });
  }
  match = path.match(/^\/api\/projects\/([^/]+)\/imports\/commit$/);
  if (match && method === 'POST') {
    const project = validProject(match[1]); const b = await body(req);
    const currentVars = variables(project.id), rows = b.rows || [], mapping = b.mapping || {};
    if (!Array.isArray(rows) || !rows.length || rows.length > 10000) throw new Error('沒有可匯入的資料列');
    if (!mapping.subject_id || !mapping.assessment_date) throw new Error('請對應受試者編號及評估日期');
    const additions = Array.isArray(b.newVariables) ? b.newVariables : [];
    if (additions.length > 100) throw new Error('一次最多建立 100 個變數');
    const usedKeys = new Set(currentVars.map(v => v.key));
    const usedColumns = new Set(Object.values(mapping).filter(Boolean));
    const newVars = additions.map((item, index) => {
      const key = String(item.key || '').trim().toLowerCase();
      const label = String(item.label || '').trim();
      const type = String(item.type || 'TEXT');
      const column = String(item.column || '');
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || ['all','and','by','eq','ge','gt','le','lt','ne','not','or','to','with'].includes(key) || usedKeys.has(key)) throw new Error(`新變數 ${index + 1} 的名稱無效或重複`);
      if (!label || !['INTEGER', 'DECIMAL', 'TEXT', 'DATE'].includes(type)) throw new Error(`新變數 ${index + 1} 的標籤或型別無效`);
      if (!column || usedColumns.has(column) || !rows.every(row => Object.hasOwn(row, column))) throw new Error(`新變數 ${label} 的來源欄位無效或重複`);
      usedKeys.add(key); usedColumns.add(column);
      return { id: uid(), project_id: project.id, key, label, type, unit: '', required: false, min_value: null, max_value: null, codes: [], sort_order: currentVars.length + index, retired: 0, column };
    });
    const vars = [...currentVars, ...newVars];
    for (const variable of newVars) mapping[variable.key] = variable.column;
    const prepared = rows.map((row, i) => {
      const code = String(row[mapping.subject_id] || '').trim();
      const date = String(row[mapping.assessment_date] || '').trim();
      if (!/^[A-Za-z0-9_-]{2,40}$/.test(code)) throw new Error(`第 ${i + 2} 行受試者編號無效`);
      if (!validDate(date)) throw new Error(`第 ${i + 2} 行評估日期需為 YYYY-MM-DD`);
      const raw = Object.fromEntries(vars.map(v => [v.key, mapping[v.key] ? row[mapping[v.key]] : null]));
      try { const values = normalizeValues(vars, raw); return { code, date, values, reasons: normalizeMissingReasons(vars, values, {}) }; }
      catch (error) { throw new Error(`第 ${i + 2} 行：${error.message}`); }
    });
    const importId = uid();
    transaction(() => {
      for (const variable of newVars) {
        run('INSERT INTO variables (id,project_id,key,label,type,unit,required,min_value,max_value,codes,sort_order,retired) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', variable.id, project.id, variable.key, variable.label, variable.type, '', 0, null, null, '[]', variable.sort_order, 0);
        audit(project.id, 'variable.created', 'variable', variable.id, { key: variable.key, source: 'legacy-import' });
      }
      if (newVars.length) run('UPDATE projects SET schema_version=schema_version+1 WHERE id=?', project.id);
      run('INSERT INTO imports VALUES (?,?,?,?,?,?)', importId, project.id, String(b.filename || 'legacy.csv').slice(0, 180), prepared.length, json(mapping), now());
      for (const item of prepared) {
        let subject = one('SELECT id FROM subjects WHERE project_id=? AND code=?', project.id, item.code);
        if (!subject) { const id = uid(); run('INSERT INTO subjects VALUES (?,?,?,?)', id, project.id, item.code, now()); subject = { id }; }
        run('INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?)', uid(), project.id, subject.id, null, importId, item.date, json(item.values), json(item.reasons), project.schema_version + (newVars.length ? 1 : 0), now());
      }
      audit(project.id, 'import.committed', 'import', importId, { rowCount: prepared.length });
    });
    return send(res, 201, { importId, rowCount: prepared.length, variablesCreated: newVars.length });
  }
  match = path.match(/^\/api\/projects\/([^/]+)\/export\/template$/);
  if (match && method === 'POST') {
    const project = validProject(match[1]); const b = await body(req);
    if (extname(String(b.filename || '')).toLowerCase() !== '.xlsx') throw new Error('請選擇 .xlsx 檔案');
    const contentBase64 = String(b.contentBase64 || '');
    if (!contentBase64 || Buffer.byteLength(contentBase64, 'base64') > 12 * 1024 * 1024) throw new Error('Excel 檔案不可超過 12 MB');
    const data = exportRows(project.id);
    const mapping = b.mapping || {};
    if (!mapping.subject_id || !mapping.assessment_date) throw new Error('請對應受試者編號及評估日期');
    if (!data.vars.some(v => mapping[v.key])) throw new Error('請至少對應一個研究變數');
    const result = spawnSync('python3', [join(root, 'scripts', 'xlsx.py'), 'merge'], {
      input: Buffer.from(json({ contentBase64, data, mapping })), maxBuffer: 25 * 1024 * 1024
    });
    if (result.status !== 0) throw new Error('無法更新指定 Excel：' + result.stderr.toString('utf8').slice(0, 220));
    const output = result.stdout;
    audit(project.id, 'export.created', 'project', project.id, { format: 'template-xlsx', rowCount: data.rows.length });
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="study_updated.xlsx"',
      'Content-Length': output.length, 'Cache-Control': 'no-store'
    });
    return res.end(output);
  }
  match = path.match(/^\/api\/projects\/([^/]+)\/export$/);
  if (match && method === 'GET') {
    const project = validProject(match[1]); const format = url.searchParams.get('format') || 'csv';
    const data = exportRows(project.id);
    let output, type, filename;
    if (format === 'csv') { output = Buffer.from(csv([data.headers, ...data.rows])); type = 'text/csv; charset=utf-8'; filename = 'data.csv'; }
    else if (format === 'codebook') {
      const rows = [['variable', 'label', 'type', 'unit', 'missing_codes', 'value_labels', 'schema_version'],
        ...data.vars.map(v => [v.key, v.label, v.type, v.unit, ['INTEGER', 'DECIMAL', 'CATEGORY'].includes(v.type) ? '-99=Not recorded; -98=Not assessable' : '', v.codes.map(c => `${c.code}=${c.label}`).join('; '), project.schema_version])];
      output = Buffer.from(csv(rows)); type = 'text/csv; charset=utf-8'; filename = 'codebook.csv';
    } else if (format === 'sps') { output = Buffer.from(spssSyntax(data)); type = 'text/plain; charset=utf-8'; filename = 'import.sps'; }
    else if (format === 'xlsx') {
      const result = spawnSync('python3', [join(root, 'scripts', 'xlsx.py'), 'write'], { input: Buffer.from(json({ data, project })), maxBuffer: 20 * 1024 * 1024 });
      if (result.status !== 0) throw new Error('Excel 匯出失敗：' + result.stderr.toString('utf8').slice(0, 140));
      output = result.stdout; type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; filename = 'study_export.xlsx';
    } else throw new Error('不支援的匯出格式');
    audit(project.id, 'export.created', 'project', project.id, { format, rowCount: data.rows.length });
    res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${filename}"`, 'Content-Length': output.length, 'Cache-Control': 'no-store' });
    return res.end(output);
  }
  return fail(res, 404, '找不到 API 路由');
}

const port = Number(process.env.PORT || 3000);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else staticFile(res, url.pathname);
  } catch (error) {
    const message = error?.message || '伺服器錯誤';
    console.error(message);
    if (!res.headersSent) fail(res, /UNIQUE constraint/.test(message) ? 409 : 400, /UNIQUE constraint/.test(message) ? '資料已存在' : message);
  }
});
server.listen(port, '127.0.0.1', () => console.log(`OT Research Platform: http://127.0.0.1:${port}`));
