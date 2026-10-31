import { previewFile, readNote } from './files.js';

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const keyPattern = /^[a-z][a-z0-9_]{0,63}$/;
const types = ['INTEGER', 'DECIMAL', 'CATEGORY', 'TEXT', 'DATE'];
let workspace;

function storage() {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('ot-research-local', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('data');
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(new Error('無法開啟本機暫存，請檢查瀏覽器設定'));
  });
}
async function readStored() {
  const db = await storage();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('data', 'readonly');
    const request = tx.objectStore('data').get('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('無法讀取本機資料'));
    tx.oncomplete = () => db.close();
  });
}
async function save() {
  const db = await storage();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('data', 'readwrite');
    tx.objectStore('data').put(workspace, 'workspace');
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(new Error('無法儲存本機資料；請檢查可用儲存空間'));
  });
}
async function ready() {
  if (workspace) return;
  workspace = await readStored();
  if (!workspace) {
    const project = { id: uid(), name: '我的研究', description: '', schema_version: 1, created_at: now() };
    workspace = { projects: [project], variables: [], subjects: [], notes: [], drafts: [], records: [], imports: [], workbooks: {} };
    await save();
  }
}
const findProject = id => {
  const project = workspace.projects.find(p => p.id === id);
  if (!project) throw new Error('找不到專案');
  return project;
};
const vars = id => workspace.variables.filter(v => v.project_id === id && !v.retired).sort((a, b) => a.sort_order - b.sort_order);
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
function valueFor(variable, raw) {
  if (raw === '' || raw == null) {
    if (variable.required) throw new Error(`${variable.label} 為必填欄位`);
    return null;
  }
  if (variable.type === 'CATEGORY') {
    const code = variable.codes.find(c => String(c.code) === String(raw) || [c.label, ...(c.aliases || [])].some(a => String(a).toLowerCase() === String(raw).trim().toLowerCase()));
    if (!code) throw new Error(`${variable.label} 沒有對應代碼`);
    return code.code;
  }
  if (variable.type === 'INTEGER' || variable.type === 'DECIMAL') {
    const value = Number(raw);
    if (!Number.isFinite(value) || variable.type === 'INTEGER' && !Number.isInteger(value)) throw new Error(`${variable.label} 必須是數字`);
    if ([-99,-98].includes(value)) throw new Error('-99 和 -98 保留作缺值代碼');
    if (variable.min_value != null && value < variable.min_value || variable.max_value != null && value > variable.max_value) throw new Error(`${variable.label} 超出允許範圍`);
    return value;
  }
  if (variable.type === 'DATE' && !validDate(raw)) throw new Error(`${variable.label} 日期格式不正確`);
  return String(raw).slice(0, 1000);
}
const normalize = (list, raw) => Object.fromEntries(list.map(v => [v.key, valueFor(v, raw?.[v.key])]));
const reasonsFor = (list, values, raw = {}) => Object.fromEntries(list.filter(v => values[v.key] == null).map(v => [v.key, raw[v.key] === 'NOT_ASSESSABLE' ? 'NOT_ASSESSABLE' : 'NOT_RECORDED']));
const state = projectId => {
  const project = findProject(projectId || workspace.projects[0]?.id);
  const subjects = workspace.subjects.filter(s => s.project_id === project.id).sort((a,b) => a.code.localeCompare(b.code));
  const notes = workspace.notes.filter(n => n.project_id === project.id).map(n => ({ ...n, subject_code: subjects.find(s => s.id === n.subject_id)?.code, draft_id: workspace.drafts.find(d => d.note_id === n.id)?.id, draft_status: workspace.drafts.find(d => d.note_id === n.id)?.status })).sort((a,b) => b.created_at.localeCompare(a.created_at));
  const records = workspace.records.filter(r => r.project_id === project.id).map(r => ({ ...r, subject_code: subjects.find(s => s.id === r.subject_id)?.code })).sort((a,b) => b.assessment_date.localeCompare(a.assessment_date) || b.created_at.localeCompare(a.created_at));
  return { projects: workspace.projects, project, variables: vars(project.id), subjects, notes, records, imports: workspace.imports.filter(i => i.project_id === project.id).sort((a,b) => b.created_at.localeCompare(a.created_at)), activity: [] };
};
function redact(input) {
  return input.replace(/\b[A-Z]{1,2}\d{6}\(?[0-9A]\)?(?=$|[\s,;.])/gi, '[HKID]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]')
    .replace(/(?:\+?852[\s-]?)?[5689]\d{3}[\s-]?\d{4}\b/g, '[PHONE]')
    .replace(/(^|\n)(\s*(?:Patient Name|Name|姓名|病人姓名|Address|地址)\s*[:：]\s*)[^\n]+/gi, '$1$2[REDACTED]');
}
function extract(input, list) {
  const candidate = {}, confidence = {}, evidence = {};
  const lines = input.split(/\r?\n/);
  for (const variable of list) {
    const names = [variable.key.replaceAll('_', ' '), variable.label];
    if (variable.key === 'moca_total') names.push('MoCA');
    if (variable.key === 'mbi_total') names.push('MBI', 'Modified Barthel Index');
    if (variable.key === 'ftuhe_total') names.push('FTUHE');
    let found;
    for (const line of lines) {
      const label = names.find(name => line.toLowerCase().includes(name.toLowerCase()));
      if (!label) continue;
      const tail = line.slice(line.toLowerCase().indexOf(label.toLowerCase()) + label.length);
      let value = null;
      if (variable.type === 'CATEGORY') value = variable.codes.find(c => [c.label, ...(c.aliases || [])].some(a => tail.toLowerCase().includes(String(a).toLowerCase())))?.code ?? null;
      else if (['INTEGER','DECIMAL'].includes(variable.type)) value = Number(tail.match(/(?:[:：=\s]|score\s*)*([-+]?\d+(?:\.\d+)?)/i)?.[1] ?? NaN);
      else value = tail.replace(/^\s*[:：=]\s*/, '').trim() || null;
      if (value !== null && !Number.isNaN(value)) { found = { value, line }; break; }
    }
    candidate[variable.key] = found?.value ?? null;
    confidence[variable.key] = found ? 0.82 : 0;
    evidence[variable.key] = found ? { page: 1, quote: found.line.trim().slice(0, 240) } : null;
  }
  return { candidate, confidence, evidence };
}
function validateVariable(input, previous) {
  const key = previous?.key || String(input.key || '').trim().toLowerCase();
  if (!keyPattern.test(key) || ['all','and','by','eq','ge','gt','le','lt','ne','not','or','to','with'].includes(key)) throw new Error('變數名稱必須符合 SPSS 命名規則');
  if (!types.includes(input.type) || !String(input.label || '').trim()) throw new Error('請輸入變數標籤及型別');
  const codes = input.type === 'CATEGORY' ? (input.codes || []).map(c => ({ code: Number(c.code), label: String(c.label || '').trim(), aliases: c.aliases || [] })) : [];
  if (input.type === 'CATEGORY' && (!codes.length || codes.some(c => !Number.isInteger(c.code) || [-99,-98].includes(c.code) || !c.label) || new Set(codes.map(c => c.code)).size !== codes.length)) throw new Error('類別代碼無效或重複');
  const min_value = input.min === '' || input.min == null ? null : Number(input.min);
  const max_value = input.max === '' || input.max == null ? null : Number(input.max);
  if (min_value != null && !Number.isFinite(min_value) || max_value != null && !Number.isFinite(max_value) || min_value != null && max_value != null && min_value > max_value) throw new Error('數值範圍無效');
  return { ...previous, key, label: input.label.trim(), type: input.type, unit: String(input.unit || '').trim(), required: input.required ?? previous?.required ?? false, min_value, max_value, codes };
}
export async function localRequest(url, options = {}) {
  await ready();
  const path = new URL(url, location.href).pathname;
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : {};
  if (path === '/api/state') return state(new URL(url, location.href).searchParams.get('projectId'));
  if (path === '/api/projects' && method === 'POST') {
    if (!String(body.name || '').trim()) throw new Error('請輸入專案名稱');
    const project = { id: uid(), name: body.name.trim(), description: String(body.description || ''), schema_version: 1, created_at: now() };
    workspace.projects.push(project); await save(); return { id: project.id };
  }
  let match = path.match(/^\/api\/projects\/([^/]+)\/variables$/);
  if (match && method === 'POST') {
    const project = findProject(match[1]);
    if (vars(project.id).some(v => v.key === String(body.key).toLowerCase())) throw new Error('變數名稱已存在');
    const variable = { ...validateVariable(body), id: uid(), project_id: project.id, sort_order: vars(project.id).length, retired: 0 };
    workspace.variables.push(variable); project.schema_version++; await save(); return { id: variable.id };
  }
  match = path.match(/^\/api\/projects\/([^/]+)\/variables\/([^/]+)$/);
  if (match) {
    const project = findProject(match[1]);
    const index = workspace.variables.findIndex(v => v.id === match[2] && v.project_id === project.id && !v.retired);
    if (index < 0) throw new Error('找不到變數');
    const previous = workspace.variables[index];
    if (method === 'DELETE') workspace.variables[index].retired = 1;
    else if (method === 'PATCH') {
      const updated = validateVariable(body, previous);
      const values = [...workspace.records.filter(r => r.project_id === project.id).map(r => r.values[previous.key]), ...workspace.drafts.filter(d => workspace.notes.some(n => n.id === d.note_id && n.project_id === project.id)).map(d => d.candidate[previous.key])].filter(v => v != null && v !== '');
      if (updated.type !== previous.type && values.length) throw new Error('已有數值的變數需先遷移資料才能改型別');
      values.forEach(value => valueFor(updated, value));
      workspace.variables[index] = updated;
    }
    project.schema_version++; await save(); return { ok: true };
  }
  match = path.match(/^\/api\/projects\/([^/]+)\/subjects$/);
  if (match && method === 'POST') {
    findProject(match[1]); const code = String(body.code || '').trim();
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(code) || workspace.subjects.some(s => s.project_id === match[1] && s.code === code)) throw new Error('受試者編號無效或已存在');
    const subject = { id: uid(), project_id: match[1], code, created_at: now() };
    workspace.subjects.push(subject); await save(); return { id: subject.id };
  }
  match = path.match(/^\/api\/projects\/([^/]+)\/notes$/);
  if (match && method === 'POST') {
    findProject(match[1]);
    if (!workspace.subjects.some(s => s.id === body.subjectId && s.project_id === match[1])) throw new Error('請先選擇受試者');
    if (!vars(match[1]).length) throw new Error('請先設定研究變數或匯入舊資料');
    if (!validDate(body.assessmentDate)) throw new Error('請選擇有效評估日期');
    const file = new File([Uint8Array.from(atob(body.contentBase64), c => c.charCodeAt(0))], body.filename, { type: body.mimeType });
    if (file.size > 12 * 1024 * 1024) throw new Error('檔案不可超過 12 MB');
    const redacted_text = redact(await readNote(file));
    if (!redacted_text.trim()) throw new Error('文件沒有可讀取的文字');
    const parsed = extract(redacted_text, vars(match[1]));
    const note = { id: uid(), project_id: match[1], subject_id: body.subjectId, file_name: body.filename, redacted_text, assessment_date: body.assessmentDate, created_at: now() };
    const draft = { id: uid(), note_id: note.id, ...parsed, missingReasons: reasonsFor(vars(match[1]), parsed.candidate), status: 'pending', updated_at: now() };
    workspace.notes.push(note); workspace.drafts.push(draft); await save(); return { noteId: note.id, draftId: draft.id };
  }
  match = path.match(/^\/api\/drafts\/([^/]+)$/);
  if (match) {
    const draft = workspace.drafts.find(d => d.id === match[1]);
    if (!draft) throw new Error('找不到草稿');
    const note = workspace.notes.find(n => n.id === draft.note_id);
    if (method === 'GET') return { ...draft, ...note, id: draft.id, subject_code: workspace.subjects.find(s => s.id === note.subject_id)?.code, variables: vars(note.project_id) };
    if (method === 'PATCH') {
      if (draft.status !== 'pending') throw new Error('草稿不可修改');
      draft.candidate = normalize(vars(note.project_id), body.candidate || {});
      draft.missingReasons = reasonsFor(vars(note.project_id), draft.candidate, body.missingReasons);
      draft.updated_at = now(); await save(); return { ok: true };
    }
  }
  match = path.match(/^\/api\/drafts\/([^/]+)\/approve$/);
  if (match && method === 'POST') {
    const draft = workspace.drafts.find(d => d.id === match[1]);
    if (!draft || draft.status !== 'pending') throw new Error('找不到待覆核草稿');
    const note = workspace.notes.find(n => n.id === draft.note_id);
    const project = findProject(note.project_id);
    const values = normalize(vars(project.id), draft.candidate);
    const record = { id: uid(), project_id: project.id, subject_id: note.subject_id, note_id: note.id, import_id: null, assessment_date: note.assessment_date, values, missingReasons: reasonsFor(vars(project.id), values, draft.missingReasons), schema_version: project.schema_version, created_at: now() };
    workspace.records.push(record); draft.status = 'approved'; await save(); return { recordId: record.id };
  }
  match = path.match(/^\/api\/projects\/([^/]+)\/imports\/preview$/);
  if (match && method === 'POST') { findProject(match[1]); const parsed = await previewFile(body.filename, body.contentBase64); if (!parsed.headers.length || parsed.rows.length > 10000) throw new Error('檔案沒有欄位或超過 10,000 行'); return parsed; }
  match = path.match(/^\/api\/projects\/([^/]+)\/imports\/commit$/);
  if (match && method === 'POST') {
    const project = findProject(match[1]); const list = vars(project.id), mapping = { ...body.mapping }, rows = body.rows;
    if (!Array.isArray(rows) || !rows.length || rows.length > 10000 || !mapping.subject_id || !mapping.assessment_date) throw new Error('請對應受試者編號和評估日期');
    const additions = (body.newVariables || []).map((item, index) => ({ ...validateVariable({ ...item, min: null, max: null }), id: uid(), project_id: project.id, sort_order: list.length + index, retired: 0, column: item.column }));
    if (new Set([...list, ...additions].map(v => v.key)).size !== list.length + additions.length) throw new Error('新變數名稱重複');
    for (const variable of additions) { if (!variable.column || Object.values(mapping).includes(variable.column)) throw new Error(`新變數 ${variable.label} 的來源欄位重複`); mapping[variable.key] = variable.column; }
    const allVars = [...list, ...additions];
    const prepared = rows.map((row, index) => {
      const code = String(row[mapping.subject_id] || '').trim(), date = String(row[mapping.assessment_date] || '').trim();
      if (!/^[A-Za-z0-9_-]{2,40}$/.test(code) || !validDate(date)) throw new Error(`第 ${index + 2} 行受試者編號或評估日期無效`);
      const values = normalize(allVars, Object.fromEntries(allVars.map(v => [v.key, row[mapping[v.key]] ?? null])));
      return { code, date, values, missingReasons: reasonsFor(allVars, values) };
    });
    const importId = uid(); if (additions.length) project.schema_version++;
    workspace.variables.push(...additions.map(({ column, ...variable }) => variable));
    workspace.imports.push({ id: importId, project_id: project.id, source_name: body.filename, row_count: prepared.length, mapping_json: mapping, created_at: now() });
    for (const item of prepared) {
      let subject = workspace.subjects.find(s => s.project_id === project.id && s.code === item.code);
      if (!subject) { subject = { id: uid(), project_id: project.id, code: item.code, created_at: now() }; workspace.subjects.push(subject); }
      workspace.records.push({ id: uid(), project_id: project.id, subject_id: subject.id, note_id: null, import_id: importId, assessment_date: item.date, values: item.values, missingReasons: item.missingReasons, schema_version: project.schema_version, created_at: now() });
    }
    await save(); return { importId, rowCount: prepared.length, variablesCreated: additions.length };
  }
  throw new Error('找不到本機操作');
}
export async function saveWorkbook(projectId, workbook) { await ready(); workspace.workbooks[projectId] = workbook; await save(); }
export async function getWorkbook(projectId) { await ready(); return workspace.workbooks[projectId] || null; }
export async function exportWorkspace() { await ready(); return JSON.stringify(workspace); }
export async function importWorkspace(source) {
  const data = JSON.parse(source);
  if (!Array.isArray(data.projects) || !Array.isArray(data.records) || !Array.isArray(data.variables)) throw new Error('不是有效的研究備份');
  workspace = data; await save();
}
