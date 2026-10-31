import { localRequest, saveWorkbook, getWorkbook, exportWorkspace, importWorkspace } from './local-api.js';
import { csvBlob, download, mergeWorkbook, newWorkbook, toBase64 } from './files.js';
import { getLanguage, setLanguage, translate, localize } from './i18n.js';

const root = document.querySelector('#app');
const nav = [
  { group: '工作台', items: [['overview', '概覽', '▦'], ['intake', '文件處理', '⇧'], ['review', '覆核隊列', '☷'], ['dataset', '資料集', '▤']] },
  { group: '研究管理', items: [['variables', '變數設定', '⚙'], ['import', '舊資料匯入', '↳'], ['export', '匯出中心', '⇩']] }
];
const today = new Date().toLocaleDateString('sv-SE');
const screenTitles = { overview: '研究概覽', intake: '文件處理', review: '覆核隊列', dataset: '研究資料集', variables: '變數設定', import: '舊資料匯入', export: '匯出中心' };
let state = null, view = 'overview', modal = null, editingVariableId = null, selectedFile = null, importData = null, exportTemplate = null, selectedDraft = null, search = '', recordSource = 'all', preferredSubjectId = null, linkedWorkbookName = '';
let toastTimer;

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const locale = () => getLanguage() === 'en' ? 'en-GB' : 'zh-HK';
const fmtDate = value => value ? new Date(value.includes('T') ? value : value + 'T00:00:00').toLocaleDateString(locale(), { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—';
const fmtTime = value => value ? new Date(value).toLocaleString(locale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const id = () => state?.project?.id;
const activeNotes = () => state?.notes.filter(n => n.draft_status === 'pending') || [];

async function request(url, options = {}) {
  return localRequest(url, options);
}
const post = (url, data) => request(url, { method: 'POST', body: JSON.stringify(data) });
const patch = (url, data) => request(url, { method: 'PATCH', body: JSON.stringify(data) });
async function refresh(projectId = id()) {
  try {
    state = await request(`/api/state${projectId ? '?projectId=' + encodeURIComponent(projectId) : ''}`);
  } catch (error) {
    if (!projectId || error.message !== '找不到專案') throw error;
    state = await request('/api/state');
  }
  localStorage.setItem('ot-project-id', state.project.id);
  linkedWorkbookName = (await getWorkbook(state.project.id))?.filename || '';
  render();
}
async function navigate(nextView) {
  view = nextView;
  modal = null;
  if (view === 'review' && activeNotes().length && !activeNotes().some(note => note.draft_id === selectedDraft?.id)) {
    selectedDraft = await request(`/api/drafts/${activeNotes()[0].draft_id}`);
  }
  render();
}
function notice(message, error = false) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); document.body.append(el); }
  el.className = `toast${error ? ' error' : ''}`;
  el.textContent = translate(message);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 4000);
}
async function act(fn) { try { await fn(); } catch (error) { notice(error.message, true); } }
function header(title, subtitle = '', actions = '') {
  return `<div class="page-head"><div><div class="eyebrow">${esc(state.project.name)} / ${esc(screenTitles[view])}</div><h1>${esc(title)}</h1>${subtitle ? `<p class="page-sub">${esc(subtitle)}</p>` : ''}</div><div class="head-actions">${actions}</div></div>`;
}
function button(label, action, type = '', extra = '') { return `<button class="button ${type}" data-action="${action}" ${extra}>${label}</button>`; }
function section(title, right = '') { return `<div class="section-heading"><h2>${title}</h2>${right}</div>`; }
function step(number, title, detail = '') { return `<div class="step-heading"><span class="step-number">${number}</span><div><h2>${title}</h2>${detail ? `<p>${detail}</p>` : ''}</div></div>`; }
function empty(title, caption = '', symbol = '◫') { return `<div class="empty"><div class="empty-symbol">${symbol}</div><strong>${title}</strong>${caption ? `<p>${caption}</p>` : ''}</div>`; }
function status(note) { return note.draft_status === 'approved' ? '<span class="status">已核准</span>' : '<span class="status pending">待覆核</span>'; }
function noteIcon(filename) { const ext = filename.split('.').pop().toLowerCase(); return `<span class="file-icon ${ext === 'pdf' ? 'pdf' : ['png','jpg','jpeg'].includes(ext) ? 'img' : ''}">${esc(ext.toUpperCase())}</span>`; }
function valueDisplay(variable, value) {
  if (value === null || value === undefined || value === '') return '<span class="muted">—</span>';
  if (variable.type === 'CATEGORY') return `<span class="score">${esc(value)}</span> <span class="muted">${esc(variable.codes.find(c => c.code === value)?.label || '')}</span>`;
  return `<span class="score">${esc(value)}</span>`;
}
function exportData() {
  const headers = ['subject_id', 'assessment_date', ...state.variables.map(v => v.key)];
  const rows = state.records.map(r => [r.subject_code, r.assessment_date, ...state.variables.map(v => {
    const value = r.values[v.key];
    return value == null ? (['INTEGER','DECIMAL','CATEGORY'].includes(v.type) ? (r.missingReasons?.[v.key] === 'NOT_ASSESSABLE' ? -98 : -99) : '') : value;
  })]);
  return { headers, rows };
}
async function downloadProject(format) {
  const { headers, rows } = exportData();
  const blob = format === 'csv' ? csvBlob(headers, rows) : await newWorkbook(headers, rows, state.variables);
  download(blob, format === 'csv' ? 'study_export.csv' : 'study_export.xlsx');
}
async function downloadUpdatedWorkbook(template) {
  const blob = await mergeWorkbook(template.contentBase64, template.mapping, state.records, state.variables);
  download(blob, template.filename.replace(/\.xlsx$/i, '') + '_updated.xlsx');
  return blob;
}
async function exportAfterApproval() {
  const template = await getWorkbook(id());
  if (template) {
    const blob = await downloadUpdatedWorkbook(template);
    await saveWorkbook(id(), { ...template, contentBase64: await toBase64(new File([blob], template.filename)) });
  } else await downloadProject('xlsx');
}
function renderShell(content) {
  const pending = activeNotes().length;
  root.innerHTML = `<div class="shell">
    <aside class="sidebar"><div class="brand"><div class="brand-mark">OT</div><div class="brand-name">OT Research<span class="brand-sub">CLINICAL DATA PLATFORM</span></div></div>
    <nav class="side-nav" aria-label="主要導覽">${nav.map(group => `<div class="side-section"><div class="side-caption">${group.group}</div>${group.items.map(([key, label, glyph]) => `<button class="nav-item ${view === key ? 'active' : ''}" data-nav="${key}" ${view === key ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${glyph}</span><span>${label}</span>${key === 'review' && pending ? `<span class="nav-count">${pending}</span>` : ''}</button>`).join('')}</div>`).join('')}</nav>
    <div class="side-bottom"><button class="workspace-pill" data-action="switch-project" title="切換研究專案"><span class="workspace-avatar">${esc(translate(state.project.name).slice(0,1))}</span><span class="workspace-label"><b>${esc(state.project.name)}</b><small>${state.projects.length} 個研究專案</small></span><span class="workspace-switch">⌄</span></button></div></aside>
    <div class="main"><header class="topbar"><button class="project-trigger" data-action="switch-project" title="切換研究專案"><span class="project-trigger-label">${esc(state.project.name)}</span><span aria-hidden="true">⌄</span></button><div class="top-actions"><label class="sr-only" for="language-select">介面語言</label><select class="language-select" id="language-select" aria-label="介面語言"><option value="en" ${getLanguage() === 'en' ? 'selected' : ''}>English</option><option value="zh-Hant" ${getLanguage() === 'zh-Hant' ? 'selected' : ''}>繁體中文</option></select><span class="top-date">${new Date().toLocaleDateString(locale(), { year:'numeric', month:'long', day:'numeric' })}</span></div></header><main class="content">${content}</main></div></div>${modal ? renderModal() : ''}`;
  localize(root);
  bind();
}
function overview() {
  const pending = activeNotes();
  const records = state.records.slice(0, 5);
  const values = [
    ['待覆核', pending.length, '份文件'],
    ['正式紀錄', state.records.length, '筆評估'],
    ['受試者', state.subjects.length, '個匿名編號'],
    ['研究變數', state.variables.length, `Schema v${state.project.schema_version}`]
  ];
  return header('研究概覽', '', `${button('上傳進度筆記','go-intake','primary')}${button('匯入舊資料','go-import')}`)
  + `<div class="stats">${values.map(([label, value, foot], i) => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value ${i === 0 && value ? 'stat-accent' : ''}">${value}</div><div class="stat-foot">${foot}</div></div>`).join('')}</div>`
  + `${section('待覆核文件', pending.length ? `<button class="link-button" data-nav="review">查看全部 ${pending.length} 份 →</button>` : '')}<div class="panel">${pending.length ? pending.slice(0,5).map(noteRow).join('') : `<div class="empty"><strong>目前沒有待覆核文件</strong><button class="button small" data-nav="intake">上傳進度筆記</button></div>`}</div>`
  + `${section('近期評估紀錄', `<button class="link-button" data-nav="dataset">查看資料集 →</button>`)}<div class="panel table-wrap">${records.length ? `<table class="data-table"><thead><tr><th>受試者</th><th>評估日期</th>${state.variables.slice(0,3).map(v => `<th title="${esc(v.label)}">${esc(v.label)}</th>`).join('')}<th>來源</th></tr></thead><tbody>${records.map(r => `<tr><td class="strong mono">${esc(r.subject_code)}</td><td>${fmtDate(r.assessment_date)}</td>${state.variables.slice(0,3).map(v => `<td>${valueDisplay(v,r.values[v.key])}</td>`).join('')}<td>${r.import_id ? '舊資料' : r.note_id ? '筆記覆核' : '示例資料'}</td></tr>`).join('')}</tbody></table>` : `<div class="empty"><strong>尚未有評估紀錄</strong><button class="button small" data-nav="import">匯入舊資料</button></div>`}</div>`;
}
function noteRow(n) {
  return `<div class="note-row"><div class="note-file">${noteIcon(n.file_name)}<div><div class="note-title">${esc(n.file_name)}</div><div class="note-meta">${esc(n.subject_code)} · ${fmtDate(n.assessment_date)} · ${fmtTime(n.created_at)}</div></div></div><div class="note-actions">${status(n)}${n.draft_status === 'pending' ? button('覆核 →','open-draft','small',`data-id="${n.draft_id}"`) : ''}</div></div>`;
}
function intake() {
  return header('文件處理', '上傳進度筆記並建立待覆核草稿', button('新增受試者','new-subject'))
  + (state.variables.length ? '' : '<div class="setup-notice">此研究尚未設定萃取欄位。<button class="link-button" data-nav="variables">設定研究變數 →</button></div>')
  + `<div class="intake-grid"><div><div class="panel"><div class="panel-head"><strong>上傳進度筆記</strong><span class="muted" style="font-size:11px">TXT / PDF / PNG / JPG</span></div><div class="panel-body"><form id="upload-form" class="form-stack"><label class="upload-zone" id="upload-zone"><span class="upload-glyph">⇧</span><strong>選擇或拖放進度筆記</strong><span>單檔上限 12 MB</span><input type="file" id="note-file" accept=".txt,.pdf,.png,.jpg,.jpeg" /></label><div id="file-display">${selectedFile ? `<div class="selected-file">${noteIcon(selectedFile.name)} ${esc(selectedFile.name)}</div>` : ''}</div><div class="grid-2"><div class="field"><label for="subject-id">受試者編號</label><select class="select" id="subject-id" required><option value="">選擇受試者</option>${state.subjects.map(s => `<option value="${s.id}">${esc(s.code)}</option>`).join('')}</select></div><div class="field"><label for="assessment-date">評估日期</label><input class="input" id="assessment-date" type="date" value="${today}" required /></div></div><div class="inline-actions" style="justify-content:flex-end"><button class="button primary" type="submit">建立萃取草稿 →</button></div></form></div></div></div><div><div class="panel"><div class="panel-head"><strong>處理紀錄</strong><small class="muted">${state.notes.length} 份文件</small></div>${state.notes.length ? state.notes.slice(0,6).map(noteRow).join('') : empty('尚未上傳文件')}</div></div></div>`;
}
function review() {
  const queue = activeNotes();
  const draft = selectedDraft && queue.some(n => n.draft_id === selectedDraft.id) ? selectedDraft : null;
  return header('覆核隊列', `${queue.length} 份文件等待核對`, queue.length ? `<span class="status pending">${queue.length} 待覆核</span>` : '')
  + `<div class="review-layout"><div class="queue"><div class="queue-head">待覆核文件</div>${queue.length ? queue.map(n => `<button class="queue-item ${draft?.id === n.draft_id ? 'active' : ''}" data-action="open-draft" data-id="${n.draft_id}"><strong>${esc(n.subject_code)}</strong><small>${esc(n.file_name)}</small><small>${fmtDate(n.assessment_date)}</small></button>`).join('') : empty('沒有待覆核文件', '', '✓')}</div>
  ${draft ? `<div class="review-work"><div class="document-pane"><div class="pane-head"><strong>遮蔽後筆記</strong><small>${esc(draft.file_name)}</small></div><div class="document-content">${esc(draft.redacted_text)}</div></div><div class="review-pane"><div class="pane-head"><strong>核對萃取欄位</strong><small>${esc(draft.subject_code)} · ${fmtDate(draft.assessment_date)}</small></div><p class="review-instruction">核對筆記原文及數值；空白欄位請選擇缺值原因。</p><div class="review-fields">${draft.variables.map(v => `<div class="review-field"><div class="review-field-top"><label for="review-${v.key}">${esc(v.label)} ${v.required ? '<span class="required-mark">*</span>' : ''}</label><span class="confidence ${draft.confidence[v.key] < .6 ? 'low' : ''}">${draft.confidence[v.key] ? '找到原文' : '未找到'}</span></div>${v.type === 'CATEGORY' ? `<select class="select review-input" id="review-${v.key}" data-key="${esc(v.key)}"><option value="">未記錄</option>${v.codes.map(c => `<option value="${c.code}" ${String(draft.candidate[v.key]) === String(c.code) ? 'selected' : ''}>${c.code} = ${esc(c.label)}</option>`).join('')}</select>` : `<input class="input review-input" id="review-${v.key}" data-key="${esc(v.key)}" type="${['INTEGER','DECIMAL'].includes(v.type) ? 'number' : v.type === 'DATE' ? 'date' : 'text'}" ${v.type === 'DECIMAL' ? 'step="any"' : ''} value="${esc(draft.candidate[v.key] ?? '')}" placeholder="未記錄" />`}<div class="evidence">${draft.evidence[v.key] ? `原文依據：${esc(draft.evidence[v.key].quote)}` : '原文未找到此欄位'}</div><label class="sr-only" for="missing-${esc(v.key)}">${esc(v.label)}缺值原因</label><select id="missing-${esc(v.key)}" class="select missing-reason" data-key="${esc(v.key)}" ${draft.candidate[v.key] !== null && draft.candidate[v.key] !== undefined ? 'disabled' : ''} style="margin-top:7px"><option value="NOT_RECORDED" ${draft.missingReasons[v.key] !== 'NOT_ASSESSABLE' ? 'selected' : ''}>未記錄 (-99)</option><option value="NOT_ASSESSABLE" ${draft.missingReasons[v.key] === 'NOT_ASSESSABLE' ? 'selected' : ''}>無法評估 (-98)</option></select></div>`).join('')}</div><div class="review-footer">${button('儲存修正','save-draft')}${button('核准並寫入資料集','approve-draft','primary')}</div></div></div>` : `<div class="panel">${queue.length ? empty('選擇文件開始覆核') : `<div class="empty"><strong>目前沒有待覆核文件</strong><button class="button small" data-nav="intake">上傳進度筆記</button></div>`}</div>`}</div>`;
}
function dataset() {
  return header('研究資料集', `${state.records.length} 筆已核准評估紀錄`, `${button('<span class="symbol">⇩</span> 匯出資料','go-export','primary')}`)
  + `<div class="toolbar"><div class="toolbar-left"><div class="search"><span class="search-icon">⌕</span><input id="record-search" class="input" aria-label="搜尋受試者編號" placeholder="搜尋受試者編號" value="${esc(search)}" /></div><select id="record-source" class="select filter" aria-label="篩選紀錄來源"><option value="all" ${recordSource === 'all' ? 'selected' : ''}>所有來源</option><option value="note" ${recordSource === 'note' ? 'selected' : ''}>筆記覆核</option><option value="import" ${recordSource === 'import' ? 'selected' : ''}>舊資料</option></select></div><div class="toolbar-right"><span id="record-count" class="muted" style="font-size:11px"></span></div></div><div class="panel table-wrap">${state.records.length ? `<table class="data-table" id="records-table"><thead><tr><th>受試者</th><th>評估日期</th>${state.variables.map(v => `<th title="${esc(v.label)}">${esc(v.label)}</th>`).join('')}<th>來源</th></tr></thead><tbody>${state.records.map(r => `<tr data-search="${esc(r.subject_code.toLowerCase())}" data-source="${r.import_id ? 'import' : 'note'}"><td class="strong mono">${esc(r.subject_code)}</td><td>${fmtDate(r.assessment_date)}</td>${state.variables.map(v => `<td>${valueDisplay(v, r.values[v.key])}</td>`).join('')}<td><span class="status ${r.import_id ? 'imported' : ''}">${r.import_id ? '舊資料' : r.note_id ? '筆記覆核' : '示例資料'}</span></td></tr>`).join('')}</tbody></table><div id="record-no-results" class="empty" hidden><strong>找不到符合條件的紀錄</strong><button class="button small" data-action="clear-record-filters">清除篩選</button></div>` : `<div class="empty"><strong>尚未有正式紀錄</strong><button class="button small" data-nav="import">匯入舊資料</button></div>`}</div>`;
}
function variables() {
  return header('變數設定', `定義研究欄位、量表範圍與數值代碼 · Schema v${state.project.schema_version}`, button('<span class="symbol">＋</span> 新增變數','new-variable','primary'))
  + `<div class="panel table-wrap">${state.variables.length ? `<table class="data-table"><thead><tr><th>變數名稱</th><th>顯示標籤</th><th>型別</th><th>範圍 / 單位</th><th>代碼對照</th><th>必填</th><th>操作</th></tr></thead><tbody>${state.variables.map(v => `<tr><td class="mono strong">${esc(v.key)}</td><td>${esc(v.label)}</td><td><span class="variable-type">${esc(v.type)}</span></td><td>${v.min_value !== null || v.max_value !== null ? `${v.min_value ?? '—'} – ${v.max_value ?? '—'}` : '—'} ${esc(v.unit)}</td><td class="code-list">${v.codes.length ? v.codes.map(c => `${c.code}=${esc(c.label)}`).join(' · ') : '—'}</td><td>${v.required ? '<span class="required-mark">●</span>' : '<span class="muted">—</span>'}</td><td><div class="inline-actions">${button('編輯','edit-variable','small',`data-id="${esc(v.id)}"`)}<button class="button small danger" data-action="delete-variable" data-id="${esc(v.id)}">刪除</button></div></td></tr>`).join('')}</tbody></table>` : `<div class="empty"><strong>尚未設定研究變數</strong><button class="button small" data-action="new-variable">新增變數</button></div>`}</div>`;
}
function importView() {
  return header('舊資料匯入', '對照 Excel / CSV 欄位並檢查資料後匯入', '')
  + step(1, '選擇來源檔案', '支援 Excel 或 CSV，最多 10,000 行')
  + `<div class="intake-grid"><div><div class="panel"><div class="panel-head"><strong>來源檔案</strong><span class="muted" style="font-size:11px">CSV / XLSX</span></div><div class="panel-body"><label class="upload-zone" id="import-zone"><span class="upload-glyph">↳</span><strong>選擇舊 Excel 或 CSV</strong><span>最多 10,000 行</span><input id="import-file" type="file" accept=".csv,.xlsx" /></label>${importData ? `<div class="selected-file">${esc(importData.filename)} · ${importData.rows.length} 行 · ${importData.headers.length} 欄</div>` : ''}</div></div>
  ${importData ? `${step(2, '對照欄位', '先確認受試者編號和評估日期，再對照已有變數')}<div class="panel"><div class="panel-body"><div class="mapping-grid">${[['subject_id','受試者編號'],['assessment_date','評估日期'],...state.variables.map(v => [v.key,v.label])].map(([key,label]) => `<div class="mapping-row"><label for="import-map-${esc(key)}">${esc(label)}</label><select id="import-map-${esc(key)}" class="select mapping-select" data-key="${esc(key)}"><option value="">不匯入</option>${importData.headers.map(h => `<option value="${esc(h)}" ${suggestColumn(key,h) ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></div>`).join('')}</div><div class="field-hint" style="margin-top:10px">受試者編號及評估日期必須對應；其餘欄位可在下方建立為新變數。</div></div></div>${step(3, '建立新變數', '只勾選這次需要新增的欄位，並確認型別')}<div class="panel"><div class="panel-body"><div class="field-hint" style="margin-bottom:9px">檢查系統推測的型別。文字類別會先存為文字，數值代碼可稍後在變數設定中建立。</div>${importData.headers.map((h,index) => `<div class="auto-variable-row" data-index="${index}" data-column="${esc(h)}"><label><input type="checkbox" class="auto-variable-check" ${defaultNewColumn(h) ? 'checked' : ''} /> ${esc(h)}</label><input class="input auto-variable-key" value="${esc(suggestKey(h))}" aria-label="變數名稱" /><select class="select auto-variable-type" aria-label="變數型別">${['INTEGER','DECIMAL','TEXT','DATE'].map(type => `<option value="${type}" ${inferType(h) === type ? 'selected' : ''}>${type}</option>`).join('')}</select></div>`).join('')}<div class="inline-actions" style="justify-content:flex-end;margin-top:18px">${button('檢查並匯入 '+importData.rows.length+' 行','commit-import','primary')}</div></div></div>${step(4, '資料預覽', '顯示檔案首 5 行，匯入前請核對內容')}<div class="panel table-wrap"><table class="data-table"><thead><tr>${importData.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${importData.rows.slice(0,5).map(r => `<tr>${importData.headers.map(h => `<td>${esc(r[h])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}</div><div><div class="panel"><div class="panel-head"><strong>匯入歷史</strong></div>${state.imports.length ? state.imports.map(batch => `<div class="note-row"><div><div class="note-title">${esc(batch.source_name)}</div><div class="note-meta">${fmtTime(batch.created_at)} · ${batch.row_count} 行</div></div><span class="status">已匯入</span></div>`).join('') : empty('尚未有匯入批次')}</div></div></div>`;
}
function suggestKey(header) {
  const ascii = header.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(ascii) ? ascii.slice(0,64) : 'variable_' + (importData.headers.indexOf(header) + 1);
}
function inferType(header) {
  const values = importData.rows.map(row => String(row[header] ?? '').trim()).filter(Boolean).slice(0,100);
  if (!values.length) return 'TEXT';
  if (values.every(v => /^-?\d+$/.test(v))) return 'INTEGER';
  if (values.every(v => /^-?\d+(?:\.\d+)?$/.test(v))) return 'DECIMAL';
  if (values.every(v => /^\d{4}-\d{2}-\d{2}$/.test(v))) return 'DATE';
  return 'TEXT';
}
function defaultNewColumn(header) {
  if (suggestColumn('subject_id', header) || suggestColumn('assessment_date', header)) return false;
  return !state.variables.some(v => suggestColumn(v.key, header));
}
function suggestColumn(key, header) {
  const clean = s => s.toLowerCase().replace(/[\s_-]/g,'');
  const aliases = { subject_id:['subjectid','subjectcode','patientid','受試者編號'], assessment_date:['assessmentdate','date','評估日期'] };
  return clean(key) === clean(header) || (aliases[key] || []).includes(clean(header));
}
function exportView() {
  return header('匯出中心', '下載研究資料，或更新指定 Excel 檔案', '')
  + `<div class="local-workbook-status"><div><strong>${linkedWorkbookName ? `目前連結：${esc(linkedWorkbookName)}` : '尚未連結指定 Excel'}</strong><span>${linkedWorkbookName ? '核准或匯入資料後會自動下載更新版。' : '核准或匯入資料後會自動下載新 Excel。'}</span></div><div class="inline-actions"><button class="button small" data-action="backup-workspace">備份本機資料</button><label class="button small restore-label">還原備份<input id="restore-workspace" type="file" accept=".json" /></label></div></div>`
  + `<div class="export-layout"><div><div class="panel"><div class="panel-head"><strong>下載檔案</strong><span class="muted" style="font-size:11px">${state.records.length} 筆正式紀錄</span></div><div class="panel-body">${[
    ['xlsx','Excel 工作簿','資料表與 Codebook 工作表','X',''],
    ['csv','CSV 資料表','UTF-8 編碼，含數值代碼','≡','orange']
  ].map(([format,title,sub,glyph,color]) => `<div class="export-option"><div class="export-icon ${color}">${glyph}</div><div class="export-desc"><strong>${title}</strong><span>${sub}</span></div><button class="button small" data-action="download-export" data-format="${format}">下載 ⇩</button></div>`).join('')}</div></div>
  ${section('更新現有 Excel')}<div class="panel"><div class="panel-body"><div class="form-stack"><p class="workflow-note">選擇現有工作簿，對照欄位後下載更新版。</p><div class="field"><label for="export-template">選擇現有 .xlsx 檔案</label><input id="export-template" class="input" type="file" accept=".xlsx" /></div>${exportTemplate ? `<div><div class="selected-file">${esc(exportTemplate.file.name)} · ${exportTemplate.rows.length} 行</div><div class="mapping-grid">${[['subject_id','受試者編號'],['assessment_date','評估日期'],...state.variables.map(v => [v.key,v.label])].map(([key,label]) => `<div class="mapping-row"><label for="export-map-${esc(key)}">${esc(label)}</label><select id="export-map-${esc(key)}" class="select export-mapping" data-key="${esc(key)}"><option value="">不更新</option>${exportTemplate.headers.map(h => `<option value="${esc(h)}" ${suggestColumn(key,h) ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></div>`).join('')}</div><div class="inline-actions" style="justify-content:flex-end;margin-top:18px">${button('產生更新版 Excel','merge-export','primary')}</div></div>` : ''}</div></div></div></div><div><div class="panel"><div class="panel-head"><strong>匯出摘要</strong></div><div class="panel-body"><div class="codebook-mini"><span>專案</span><b>${esc(state.project.name)}</b></div><div class="codebook-mini"><span>紀錄數</span><b>${state.records.length}</b></div><div class="codebook-mini"><span>研究變數</span><b>${state.variables.length}</b></div><div class="codebook-mini"><span>Schema 版本</span><b>v${state.project.schema_version}</b></div><div class="codebook-mini"><span>數值缺值代碼</span><b>-99 / -98</b></div></div></div></div></div>`;
}
function renderModal() {
  let title = '', content = '', submit = '';
  const editingVariable = editingVariableId ? state.variables.find(v => v.id === editingVariableId) : null;
  if (modal === 'project') { title = '建立研究專案'; submit = '建立專案'; content = `<div class="field"><label>專案名稱</label><input class="input" name="name" required maxlength="100" placeholder="例如：上肢復康成效研究" autofocus /></div><div class="field"><label>簡介</label><textarea class="textarea" name="description" placeholder="研究範圍或目標"></textarea></div>`; }
  if (modal === 'subject') { title = '新增受試者'; submit = '新增編號'; content = `<div class="field"><label>匿名受試者編號</label><input class="input" name="code" required pattern="[A-Za-z0-9_-]{2,40}" placeholder="例如：OT-005" autofocus /><span class="field-hint">不輸入姓名、電話或病歷號碼。</span></div>`; }
  if (modal === 'variable') { title = '新增研究變數'; submit = '新增變數'; content = `<div class="grid-2"><div class="field"><label>變數名稱</label><input class="input" name="key" required pattern="[A-Za-z][A-Za-z0-9_]{0,63}" placeholder="例如：moca_total" /></div><div class="field"><label>顯示標籤</label><input class="input" name="label" required placeholder="例如：MoCA 總分" /></div></div><div class="grid-2"><div class="field"><label>資料型別</label><select class="select" name="type" id="variable-type"><option value="INTEGER">整數</option><option value="DECIMAL">小數</option><option value="CATEGORY">類別代碼</option><option value="TEXT">文字</option><option value="DATE">日期</option></select></div><div class="field"><label>單位</label><input class="input" name="unit" placeholder="例如：分" /></div></div><div class="grid-2"><div class="field"><label>最小值</label><input class="input" type="number" step="any" name="min" placeholder="選填" /></div><div class="field"><label>最大值</label><input class="input" type="number" step="any" name="max" placeholder="選填" /></div></div><div class="field" id="codes-field" style="display:none"><label>數值代碼</label><textarea class="textarea" name="codes" placeholder="1 | Independent | 獨立\n2 | Assist | 需協助"></textarea><span class="field-hint">每行：數值 | 標籤 | 別名（可選）</span></div><label style="display:flex;gap:8px;align-items:center;font-size:12px"><input type="checkbox" name="required" /> 必填欄位</label>`; }
  if (modal === 'edit-variable' && editingVariable) { const v = editingVariable; title = `編輯 ${v.key}`; submit = '儲存變數'; content = `<div class="field"><label>顯示標籤</label><input class="input" name="label" required maxlength="200" value="${esc(v.label)}" /></div><div class="grid-2"><div class="field"><label>型別</label><select class="select" name="type" id="variable-type">${['INTEGER','DECIMAL','CATEGORY','TEXT','DATE'].map(type => `<option value="${type}" ${v.type === type ? 'selected' : ''}>${type}</option>`).join('')}</select></div><div class="field"><label>單位</label><input class="input" name="unit" maxlength="60" value="${esc(v.unit)}" /></div></div><div class="grid-2"><div class="field"><label>最小值</label><input class="input" type="number" step="any" name="min" value="${esc(v.min_value ?? '')}" placeholder="選填" /></div><div class="field"><label>最大值</label><input class="input" type="number" step="any" name="max" value="${esc(v.max_value ?? '')}" placeholder="選填" /></div></div><div class="field" id="codes-field" style="${v.type === 'CATEGORY' ? '' : 'display:none'}"><label>代碼對照</label><textarea class="textarea" name="codes" placeholder="1 | Independent | 獨立\n2 | Assist | 需協助">${esc(v.codes.map(c => [c.code,c.label,...(c.aliases || [])].join(' | ')).join('\n'))}</textarea><span class="field-hint">每行：數值 | 標籤 | 別名（可選）。已有代碼的數值不可任意更換。</span></div><div class="field-hint">變數名稱 ${esc(v.key)} 保持不變；修改後 schema 版本會增加。</div>`; }
  if (modal === 'switch') { title = '研究專案'; content = `<div style="display:grid;gap:8px">${state.projects.map(p => `<button class="workspace-pill" style="background:#f7faf7;color:#284734;border-color:#dce9df" data-action="select-project" data-id="${p.id}"><span class="workspace-avatar">${esc(p.name.slice(0,1))}</span><span class="workspace-label"><b>${esc(p.name)}</b><small style="color:#849a88">Schema v${p.schema_version}</small></span>${p.id === id() ? '✓' : '→'}</button>`).join('')}</div>`; }
  return `<div class="modal-backdrop" id="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="${title}"><div class="modal-head"><h2>${title}</h2><button class="close" data-action="close-modal" aria-label="關閉">×</button></div><form id="modal-form"><div class="modal-body">${content}</div><div class="modal-footer">${modal === 'switch' ? button('建立新專案','new-project','primary') : `<button type="button" class="button" data-action="close-modal">取消</button><button type="submit" class="button primary">${submit}</button>`}</div></form></div></div>`;
}
function render() {
  if (!state) { root.innerHTML = `<div style="padding:40px">${translate('載入中…')}</div>`; return; }
  const content = ({ overview, intake, review, dataset, variables, import: importView, export: exportView })[view]();
  renderShell(content);
  if (view === 'dataset') filterRecords();
}
function switchLanguage(nextLanguage) {
  const selector = '.content input, .content select, .content textarea, .modal input, .modal select, .modal textarea';
  const fields = [...document.querySelectorAll(selector)].map(field => ({ value: field.value, checked: field.checked, disabled: field.disabled, type: field.type }));
  setLanguage(nextLanguage);
  render();
  document.querySelectorAll(selector).forEach((field, index) => {
    const previous = fields[index];
    if (!previous || previous.type === 'file' || field.type !== previous.type) return;
    if (field.type === 'checkbox' || field.type === 'radio') field.checked = previous.checked;
    else field.value = previous.value;
    if (field.classList.contains('missing-reason')) field.disabled = previous.disabled;
  });
  if (view === 'dataset') filterRecords();
  document.querySelector('.toast')?.remove();
}
function filterRecords() {
  const query = (document.querySelector('#record-search')?.value || '').trim().toLowerCase();
  const source = document.querySelector('#record-source')?.value || 'all';
  let visible = 0;
  document.querySelectorAll('#records-table tbody tr').forEach(row => {
    row.hidden = !(row.dataset.search.includes(query) && (source === 'all' || row.dataset.source === source));
    if (!row.hidden) visible++;
  });
  const noResults = document.querySelector('#record-no-results');
  if (noResults) noResults.hidden = visible !== 0;
  const count = document.querySelector('#record-count');
  if (count) count.textContent = translate(`${visible} / ${state.records.length} 筆紀錄`);
}
function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('無法讀取檔案'));
    reader.readAsDataURL(file);
  });
}
async function openDraft(draftId) {
  selectedDraft = await request(`/api/drafts/${draftId}`);
  view = 'review'; render();
}
function reviewValues() {
  const candidate = {};
  document.querySelectorAll('.review-input').forEach(input => { candidate[input.dataset.key] = input.value === '' ? null : input.value; });
  return candidate;
}
function reviewMissingReasons(candidate) {
  const reasons = {};
  document.querySelectorAll('.missing-reason').forEach(select => {
    if (candidate[select.dataset.key] === null) reasons[select.dataset.key] = select.value;
  });
  return reasons;
}
async function saveDraft() {
  const candidate = reviewValues();
  await patch(`/api/drafts/${selectedDraft.id}`, { candidate, missingReasons: reviewMissingReasons(candidate) });
  selectedDraft = await request(`/api/drafts/${selectedDraft.id}`);
  notice('草稿修正已儲存'); render();
}
function bind() {
  document.querySelector('#language-select')?.addEventListener('change', event => switchLanguage(event.target.value));
  document.querySelector('#restore-workspace')?.addEventListener('change', event => { act(async () => {
    const file = event.target.files?.[0]; if (!file) return;
    if (!window.confirm(translate('還原備份會取代這個瀏覽器目前的所有研究資料。確定繼續？'))) return;
    await importWorkspace(await file.text());
    localStorage.removeItem('ot-project-id'); exportTemplate = null; selectedDraft = null; view = 'overview';
    await refresh(); notice('本機資料已還原');
  }); });
  document.querySelector('#note-file')?.addEventListener('change', event => { selectedFile = event.target.files?.[0] || null; document.querySelector('#file-display').innerHTML = selectedFile ? `<div class="selected-file">${noteIcon(selectedFile.name)} ${esc(selectedFile.name)}</div>` : ''; });
  document.querySelector('#upload-zone')?.addEventListener('dragover', event => { event.preventDefault(); event.currentTarget.classList.add('drag'); });
  document.querySelector('#upload-zone')?.addEventListener('dragleave', event => event.currentTarget.classList.remove('drag'));
  document.querySelector('#upload-zone')?.addEventListener('drop', event => { event.preventDefault(); event.currentTarget.classList.remove('drag'); selectedFile = event.dataTransfer.files?.[0] || null; document.querySelector('#file-display').innerHTML = selectedFile ? `<div class="selected-file">${noteIcon(selectedFile.name)} ${esc(selectedFile.name)}</div>` : ''; });
  document.querySelector('#upload-form')?.addEventListener('submit', event => { event.preventDefault(); act(async () => {
    if (!selectedFile) throw new Error('請先選擇文件');
    if (selectedFile.size > 12 * 1024 * 1024) throw new Error('檔案不可超過 12 MB');
    const button = event.target.querySelector('button[type="submit"]'); button.disabled = true; button.textContent = translate('正在處理文件…');
    try {
      const result = await post(`/api/projects/${id()}/notes`, { filename: selectedFile.name, mimeType: selectedFile.type, contentBase64: await readBase64(selectedFile), subjectId: document.querySelector('#subject-id').value, assessmentDate: document.querySelector('#assessment-date').value });
      selectedFile = null; await refresh(); await openDraft(result.draftId); notice('草稿已建立，請核對萃取數值');
    } finally { button.disabled = false; button.textContent = translate('建立萃取草稿 →'); }
  }); });
  document.querySelector('#record-search')?.addEventListener('input', event => { search = event.target.value; filterRecords(); });
  document.querySelector('#record-source')?.addEventListener('change', event => { recordSource = event.target.value; filterRecords(); });
  if (preferredSubjectId && document.querySelector('#subject-id option[value="' + preferredSubjectId + '"]')) {
    document.querySelector('#subject-id').value = preferredSubjectId;
    preferredSubjectId = null;
  }
  document.querySelector('#import-file')?.addEventListener('change', event => { act(async () => {
    const file = event.target.files?.[0]; if (!file) return;
    const parsed = await post(`/api/projects/${id()}/imports/preview`, { filename: file.name, contentBase64: await readBase64(file) });
    importData = { ...parsed, filename: file.name }; render(); notice('檔案已讀取，請檢查欄位映射');
  }); });
  document.querySelector('#export-template')?.addEventListener('change', event => { act(async () => {
    const file = event.target.files?.[0]; if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 12 * 1024 * 1024) throw new Error('請選擇不超過 12 MB 的 .xlsx 檔案');
    const contentBase64 = await readBase64(file);
    const parsed = await post(`/api/projects/${id()}/imports/preview`, { filename: file.name, contentBase64 });
    exportTemplate = { ...parsed, file, contentBase64 }; render(); notice('已讀取目標 Excel，請檢查欄位對應');
  }); });
  document.querySelector('#import-zone')?.addEventListener('dragover', event => event.preventDefault());
  document.querySelector('#import-zone')?.addEventListener('drop', event => { event.preventDefault(); act(async () => {
    const file = event.dataTransfer.files?.[0]; if (!file) return;
    const parsed = await post(`/api/projects/${id()}/imports/preview`, { filename: file.name, contentBase64: await readBase64(file) });
    importData = { ...parsed, filename: file.name }; render(); notice('檔案已讀取，請檢查欄位映射');
  }); });
  document.querySelector('#variable-type')?.addEventListener('change', event => { document.querySelector('#codes-field').style.display = event.target.value === 'CATEGORY' ? 'flex' : 'none'; });
  document.querySelectorAll('.review-input').forEach(input => input.addEventListener('input', () => {
    const reason = document.querySelector(`.missing-reason[data-key="${input.dataset.key}"]`);
    if (reason) reason.disabled = input.value !== '';
  }));
  document.querySelector('#modal-form')?.addEventListener('submit', event => { event.preventDefault(); act(async () => {
    const form = new FormData(event.target);
    if (modal === 'project') { const result = await post('/api/projects', { name: form.get('name'), description: form.get('description') }); modal = null; view = 'overview'; importData = null; selectedDraft = null; await refresh(result.id); notice('研究專案已建立'); }
    if (modal === 'subject') { const result = await post(`/api/projects/${id()}/subjects`, { code: form.get('code') }); preferredSubjectId = result.id; modal = null; await refresh(); notice('受試者編號已新增'); }
    if (modal === 'variable') {
      const codes = String(form.get('codes') || '').split(/\r?\n/).filter(Boolean).map(line => { const [code,label,...aliases] = line.split('|').map(x => x.trim()); return { code: Number(code), label, aliases: aliases.filter(Boolean) }; });
      await post(`/api/projects/${id()}/variables`, { key: form.get('key'), label: form.get('label'), type: form.get('type'), unit: form.get('unit'), min: form.get('min'), max: form.get('max'), required: form.has('required'), codes });
      modal = null; await refresh(); notice('研究變數已新增');
    }
    if (modal === 'edit-variable' && editingVariableId) {
      const codes = String(form.get('codes') || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => { const [code,label,...aliases] = line.split('|').map(x => x.trim()); return { code: Number(code), label, aliases: aliases.filter(Boolean) }; });
      await patch(`/api/projects/${id()}/variables/${editingVariableId}`, { label: form.get('label'), type: form.get('type'), unit: form.get('unit'), min: form.get('min'), max: form.get('max'), codes });
      editingVariableId = null; modal = null; await refresh(); notice('變數設定已更新');
    }
  }); });
}
document.addEventListener('click', event => {
  const navButton = event.target.closest('[data-nav]');
  if (navButton) { act(() => navigate(navButton.dataset.nav)); return; }
  const action = event.target.closest('[data-action]');
  if (!action) {
    if (event.target.id === 'modal-backdrop') { modal = null; render(); }
    return;
  }
  const name = action.dataset.action;
  if (name === 'go-intake') act(() => navigate('intake'));
  if (name === 'go-import') act(() => navigate('import'));
  if (name === 'go-export') act(() => navigate('export'));
  if (name === 'clear-record-filters') { search = ''; recordSource = 'all'; render(); }
  if (name === 'new-project') { modal = 'project'; render(); }
  if (name === 'new-subject') { modal = 'subject'; render(); }
  if (name === 'new-variable') { modal = 'variable'; render(); }
  if (name === 'edit-variable') { editingVariableId = action.dataset.id; modal = 'edit-variable'; render(); }
  if (name === 'delete-variable') act(async () => {
    const variable = state.variables.find(v => v.id === action.dataset.id);
    if (!variable || !window.confirm(translate(`刪除「${variable.label}」？此欄位將不再出現在資料集和匯出，已核准的原值會保留。`))) return;
    await request(`/api/projects/${id()}/variables/${variable.id}`, { method: 'DELETE' });
    exportTemplate = null;
    await refresh(); notice('變數已刪除');
  });
  if (name === 'switch-project') { modal = 'switch'; render(); }
  if (name === 'close-modal') { modal = null; render(); }
  if (name === 'select-project') { modal = null; selectedDraft = null; importData = null; exportTemplate = null; search = ''; recordSource = 'all'; view = 'overview'; act(() => refresh(action.dataset.id)); }
  if (name === 'open-draft') act(() => openDraft(action.dataset.id));
  if (name === 'save-draft') act(saveDraft);
  if (name === 'approve-draft') act(async () => { const candidate = reviewValues(); await patch(`/api/drafts/${selectedDraft.id}`, { candidate, missingReasons: reviewMissingReasons(candidate) }); await post(`/api/drafts/${selectedDraft.id}/approve`, {}); selectedDraft = null; await refresh(); await exportAfterApproval(); if (activeNotes().length) await navigate('review'); notice('已核准，更新版 Excel 已下載'); });
  if (name === 'commit-import') act(async () => {
    const mapping = Object.fromEntries([...document.querySelectorAll('.mapping-select')].map(select => [select.dataset.key, select.value]));
    const newVariables = [...document.querySelectorAll('.auto-variable-row')].filter(row => row.querySelector('.auto-variable-check').checked).map(row => ({ column: row.dataset.column, label: row.dataset.column, key: row.querySelector('.auto-variable-key').value, type: row.querySelector('.auto-variable-type').value }));
    const result = await post(`/api/projects/${id()}/imports/commit`, { filename: importData.filename, rows: importData.rows, mapping, newVariables });
    importData = null; await refresh(); await exportAfterApproval(); notice(`已建立 ${result.variablesCreated} 個變數，匯入 ${result.rowCount} 筆紀錄；Excel 已下載`);
  });
  if (name === 'download-export') act(() => downloadProject(action.dataset.format));
  if (name === 'backup-workspace') act(async () => {
    download(new Blob([await exportWorkspace()], { type: 'application/json' }), 'ot_research_backup.json');
    notice('本機研究備份已下載');
  });
  if (name === 'merge-export') act(async () => {
    const mapping = Object.fromEntries([...document.querySelectorAll('.export-mapping')].map(select => [select.dataset.key, select.value]));
    const template = { filename: exportTemplate.file.name, contentBase64: exportTemplate.contentBase64, mapping };
    const blob = await downloadUpdatedWorkbook(template);
    await saveWorkbook(id(), { ...template, contentBase64: await toBase64(new File([blob], template.filename)) });
    linkedWorkbookName = template.filename; render();
    notice('已連結此工作簿並下載更新版 Excel；之後核准會自動更新');
  });
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && modal) { modal = null; render(); } });
act(() => refresh(localStorage.getItem('ot-project-id') || undefined));
