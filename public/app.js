const root = document.querySelector('#app');
const nav = [
  { group: '工作台', items: [['overview', '概覽', '▦'], ['intake', '文件處理', '⇧'], ['review', '覆核隊列', '☷'], ['dataset', '資料集', '▤']] },
  { group: '研究管理', items: [['variables', '變數設定', '⚙'], ['import', '舊資料匯入', '↳'], ['export', '匯出中心', '⇩']] }
];
const today = new Date().toLocaleDateString('sv-SE');
const screenTitles = { overview: '研究概覽', intake: '文件處理', review: '覆核隊列', dataset: '研究資料集', variables: '變數設定', import: '舊資料匯入', export: '匯出中心' };
let state = null, view = 'overview', modal = null, editingVariableId = null, selectedFile = null, importData = null, exportTemplate = null, selectedDraft = null, search = '';
let toastTimer;

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const fmtDate = value => value ? new Date(value.includes('T') ? value : value + 'T00:00:00').toLocaleDateString('zh-HK', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—';
const fmtTime = value => value ? new Date(value).toLocaleString('zh-HK', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const id = () => state?.project?.id;
const activeNotes = () => state?.notes.filter(n => n.draft_status === 'pending') || [];

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作失敗');
  return data;
}
const post = (url, data) => request(url, { method: 'POST', body: JSON.stringify(data) });
const patch = (url, data) => request(url, { method: 'PATCH', body: JSON.stringify(data) });
async function refresh(projectId = id()) {
  state = await request(`/api/state${projectId ? '?projectId=' + encodeURIComponent(projectId) : ''}`);
  render();
}
function notice(message, error = false) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); document.body.append(el); }
  el.className = `toast${error ? ' error' : ''}`;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 4000);
}
async function act(fn) { try { await fn(); } catch (error) { notice(error.message, true); } }
function header(title, subtitle = '', actions = '') {
  return `<div class="page-head"><div><div class="eyebrow">${esc(state.project.name)} / ${esc(screenTitles[view])}</div><h1>${esc(title)}</h1>${subtitle ? `<p class="page-sub">${esc(subtitle)}</p>` : ''}</div><div class="head-actions">${actions}</div></div>`;
}
function button(label, action, type = '', extra = '') { return `<button class="button ${type}" data-action="${action}" ${extra}>${label}</button>`; }
function section(title, right = '') { return `<div class="section-heading"><h2>${title}</h2>${right}</div>`; }
function empty(title, caption = '', symbol = '◫') { return `<div class="empty"><div class="empty-symbol">${symbol}</div><strong>${title}</strong>${caption ? `<p>${caption}</p>` : ''}</div>`; }
function status(note) { return note.draft_status === 'approved' ? '<span class="status">已核准</span>' : '<span class="status pending">待覆核</span>'; }
function noteIcon(filename) { const ext = filename.split('.').pop().toLowerCase(); return `<span class="file-icon ${ext === 'pdf' ? 'pdf' : ['png','jpg','jpeg'].includes(ext) ? 'img' : ''}">${esc(ext.toUpperCase())}</span>`; }
function valueDisplay(variable, value) {
  if (value === null || value === undefined || value === '') return '<span class="muted">—</span>';
  if (variable.type === 'CATEGORY') return `<span class="score">${esc(value)}</span> <span class="muted">${esc(variable.codes.find(c => c.code === value)?.label || '')}</span>`;
  return `<span class="score">${esc(value)}</span>`;
}
function renderShell(content) {
  const pending = activeNotes().length;
  root.innerHTML = `<div class="shell">
    <aside class="sidebar"><div class="brand"><div class="brand-mark">OT</div><div class="brand-name">OT Research<span class="brand-sub">CLINICAL DATA PLATFORM</span></div></div>
    ${nav.map(group => `<div class="side-section"><div class="side-caption">${group.group}</div>${group.items.map(([key, label, glyph]) => `<button class="nav-item ${view === key ? 'active' : ''}" data-nav="${key}"><span class="nav-icon">${glyph}</span><span>${label}</span>${key === 'review' && pending ? `<span class="nav-count">${pending}</span>` : ''}</button>`).join('')}</div>`).join('')}
    <div class="side-bottom"><button class="workspace-pill" data-action="switch-project"><span class="workspace-avatar">${esc(state.project.name.slice(0,1))}</span><span class="workspace-label"><b>${esc(state.project.name)}</b><small>${state.projects.length} 個研究專案</small></span><span class="workspace-switch">⌄</span></button><div class="local-tag"><span class="local-dot"></span>本機工作區</div></div></aside>
    <div class="main"><header class="topbar"><div class="breadcrumb"><span>研究專案</span><span>›</span><b>${esc(state.project.name)}</b><span>›</span><span>${esc(screenTitles[view])}</span></div><div class="top-actions"><button class="mobile-project-switch" data-action="switch-project" aria-label="切換研究專案">⌄</button><span class="top-date">${new Date().toLocaleDateString('zh-HK', { year:'numeric', month:'long', day:'numeric' })}</span><span class="avatar">OT</span></div></header><main class="content"><div class="prototype-banner">本機原型 · 只使用測試或已去識別化資料。尚未配置機構登入、加密儲存及正式個資治理。</div>${content}</main></div></div>${modal ? renderModal() : ''}`;
  bind();
}
function overview() {
  const pending = activeNotes();
  const records = state.records.slice(0, 5);
  const values = [
    ['受試者', state.subjects.length, '專案中的匿名編號'],
    ['正式紀錄', state.records.length, '已核准評估'],
    ['待覆核', pending.length, '需要 OT 確認'],
    ['研究變數', state.variables.length, `Schema v${state.project.schema_version}`]
  ];
  return header('研究概覽', '臨床數據與文件處理狀態', `${button('<span class="symbol">⇧</span> 上傳進度筆記','go-intake','primary')}`)
  + `<div class="stats">${values.map(([label, value, foot], i) => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value ${i === 2 ? 'stat-accent' : ''}">${value}</div><div class="stat-foot">${foot}</div></div>`).join('')}</div>`
  + `<div class="two-column"><div>${section('近期評估紀錄', `<button class="link-button" data-nav="dataset">查看所有紀錄 →</button>`)}<div class="panel table-wrap">${records.length ? `<table class="data-table"><thead><tr><th>受試者</th><th>評估日期</th>${state.variables.slice(0,2).map(v => `<th>${esc(v.key)}</th>`).join('')}<th>來源</th></tr></thead><tbody>${records.map(r => `<tr><td class="strong mono">${esc(r.subject_code)}</td><td>${fmtDate(r.assessment_date)}</td>${state.variables.slice(0,2).map(v => `<td>${valueDisplay(v,r.values[v.key])}</td>`).join('')}<td><span class="status ${r.import_id ? 'imported' : ''}">${r.import_id ? '舊資料' : r.note_id ? '筆記覆核' : '示例資料'}</span></td></tr>`).join('')}</tbody></table>` : empty('尚未有評估紀錄')}</div>
  ${section('待處理文件', `<button class="link-button" data-nav="review">前往覆核 →</button>`)}<div class="panel">${pending.length ? pending.slice(0,4).map(n => noteRow(n)).join('') : empty('所有文件已處理', '新上傳的筆記會顯示在這裡', '✓')}</div></div>
  <div>${section('最近活動')}<div class="panel"><div class="panel-body">${state.activity.length ? state.activity.map(a => `<div class="activity-item"><span class="activity-icon">${a.action.includes('export') ? '⇩' : a.action.includes('import') ? '↳' : a.action.includes('approved') ? '✓' : '·'}</span><div><div class="activity-main">${activityLabel(a.action)}</div><div class="activity-time">${fmtTime(a.created_at)}</div></div></div>`).join('') : empty('尚無活動')}</div></div>${section('資料品質')}<div class="panel"><div class="panel-body"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:9px"><b>覆核完成率</b><span>${state.notes.length ? Math.round((state.notes.length-pending.length)/state.notes.length*100) : 0}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${state.notes.length ? Math.round((state.notes.length-pending.length)/state.notes.length*100) : 0}%"></div></div><div class="mini-rule"></div><div class="codebook-mini"><span>已匯入批次</span><b>${state.imports.length}</b></div><div class="codebook-mini"><span>已處理文件</span><b>${state.notes.length}</b></div></div></div></div></div>`;
}
function activityLabel(action) { return ({ 'project.created':'建立研究專案', 'variable.created':'新增研究變數', 'variable.updated':'修改研究變數', 'variable.retired':'刪除研究變數', 'subject.created':'新增受試者', 'note.uploaded':'上傳進度筆記', 'draft.edited':'修正萃取草稿', 'record.approved':'核准評估紀錄', 'import.committed':'匯入舊資料', 'export.created':'產生資料匯出' })[action] || action; }
function noteRow(n) {
  return `<div class="note-row"><div class="note-file">${noteIcon(n.file_name)}<div><div class="note-title">${esc(n.file_name)}</div><div class="note-meta">${esc(n.subject_code)} · ${fmtDate(n.assessment_date)} · ${fmtTime(n.created_at)}</div></div></div><div class="note-actions">${status(n)}${n.draft_status === 'pending' ? button('覆核 →','open-draft','small',`data-id="${n.draft_id}"`) : ''}</div></div>`;
}
function intake() {
  return header('文件處理', '上傳進度筆記並建立待覆核草稿', button('新增受試者','new-subject'))
  + `<div class="intake-grid"><div><div class="panel"><div class="panel-head"><strong>上傳進度筆記</strong><span class="muted" style="font-size:11px">TXT / PDF / PNG / JPG</span></div><div class="panel-body"><form id="upload-form" class="form-stack"><label class="upload-zone" id="upload-zone"><span class="upload-glyph">⇧</span><strong>選擇或拖放進度筆記</strong><span>單檔上限 12 MB</span><input type="file" id="note-file" accept=".txt,.pdf,.png,.jpg,.jpeg" /></label><div id="file-display">${selectedFile ? `<div class="selected-file">${noteIcon(selectedFile.name)} ${esc(selectedFile.name)}</div>` : ''}</div><div class="grid-2"><div class="field"><label for="subject-id">受試者編號</label><select class="select" id="subject-id" required><option value="">選擇受試者</option>${state.subjects.map(s => `<option value="${s.id}">${esc(s.code)}</option>`).join('')}</select></div><div class="field"><label for="assessment-date">評估日期</label><input class="input" id="assessment-date" type="date" value="${today}" required /></div></div><div class="privacy-line"><span>✦</span><span><b>本地處理：</b>文字先去識別化，再產生萃取草稿；所有欄位須經人工覆核。</span></div><div class="inline-actions" style="justify-content:flex-end"><button class="button primary" type="submit">建立萃取草稿 →</button></div></form></div></div></div><div><div class="panel"><div class="panel-head"><strong>處理紀錄</strong><small class="muted">${state.notes.length} 份文件</small></div>${state.notes.length ? state.notes.slice(0,6).map(noteRow).join('') : empty('尚未上傳文件')}</div></div></div>`;
}
function review() {
  const queue = activeNotes();
  const draft = selectedDraft && queue.some(n => n.draft_id === selectedDraft.id) ? selectedDraft : null;
  return header('覆核隊列', `${queue.length} 份文件等待核對`, queue.length ? `<span class="status pending">${queue.length} 待覆核</span>` : '')
  + `<div class="review-layout"><div class="queue"><div class="queue-head">待覆核文件</div>${queue.length ? queue.map(n => `<button class="queue-item ${draft?.id === n.draft_id ? 'active' : ''}" data-action="open-draft" data-id="${n.draft_id}"><strong>${esc(n.subject_code)}</strong><small>${esc(n.file_name)}</small><small>${fmtDate(n.assessment_date)}</small></button>`).join('') : empty('沒有待覆核文件', '', '✓')}</div>
  ${draft ? `<div class="review-work"><div class="document-pane"><div class="pane-head"><strong>去識別化筆記</strong><small>${esc(draft.file_name)}</small></div><div class="document-content">${esc(draft.redacted_text)}</div></div><div class="review-pane"><div class="pane-head"><strong>萃取欄位</strong><small>${esc(draft.subject_code)} · ${fmtDate(draft.assessment_date)}</small></div><div class="review-fields">${draft.variables.map(v => `<div class="review-field"><div class="review-field-top"><label for="review-${v.key}">${esc(v.label)} ${v.required ? '<span class="required-mark">*</span>' : ''}</label><span class="confidence ${draft.confidence[v.key] < .6 ? 'low' : ''}">${draft.confidence[v.key] ? Math.round(draft.confidence[v.key]*100)+'% 信心度' : '未找到'}</span></div>${v.type === 'CATEGORY' ? `<select class="select review-input" id="review-${v.key}" data-key="${esc(v.key)}"><option value="">未記錄</option>${v.codes.map(c => `<option value="${c.code}" ${String(draft.candidate[v.key]) === String(c.code) ? 'selected' : ''}>${c.code} = ${esc(c.label)}</option>`).join('')}</select>` : `<input class="input review-input" id="review-${v.key}" data-key="${esc(v.key)}" type="${['INTEGER','DECIMAL'].includes(v.type) ? 'number' : v.type === 'DATE' ? 'date' : 'text'}" ${v.type === 'DECIMAL' ? 'step="any"' : ''} value="${esc(draft.candidate[v.key] ?? '')}" placeholder="未記錄" />`}<div class="evidence">${draft.evidence[v.key] ? `原文：${esc(draft.evidence[v.key].quote)}` : '沒有找到相應原文'}</div><select class="select missing-reason" data-key="${esc(v.key)}" ${draft.candidate[v.key] !== null && draft.candidate[v.key] !== undefined ? 'disabled' : ''} style="margin-top:7px"><option value="NOT_RECORDED" ${draft.missingReasons[v.key] !== 'NOT_ASSESSABLE' ? 'selected' : ''}>未記錄 (-99)</option><option value="NOT_ASSESSABLE" ${draft.missingReasons[v.key] === 'NOT_ASSESSABLE' ? 'selected' : ''}>無法評估 (-98)</option></select></div>`).join('')}</div><div class="review-footer">${button('儲存修正','save-draft')}${button('核准並寫入資料集','approve-draft','primary')}</div></div></div>` : `<div class="panel">${empty(queue.length ? '選擇左側文件開始覆核' : '目前沒有待覆核文件', queue.length ? '核對原文與擷取數值後再核准' : '新文件的草稿會在這裡出現')}</div>`}</div>`;
}
function dataset() {
  return header('研究資料集', `${state.records.length} 筆已核准評估紀錄`, `${button('<span class="symbol">⇩</span> 匯出資料','go-export','primary')}`)
  + `<div class="toolbar"><div class="toolbar-left"><div class="search"><span class="search-icon">⌕</span><input id="record-search" class="input" placeholder="搜尋受試者編號" value="${esc(search)}" /></div><select id="record-source" class="select filter"><option value="all">所有來源</option><option value="note">筆記覆核</option><option value="import">舊資料</option></select></div><div class="toolbar-right"><span class="muted" style="font-size:11px">資料版本 v${state.project.schema_version}</span></div></div><div class="panel table-wrap">${state.records.length ? `<table class="data-table" id="records-table"><thead><tr><th>受試者</th><th>評估日期</th>${state.variables.map(v => `<th title="${esc(v.label)}">${esc(v.key)}</th>`).join('')}<th>來源</th></tr></thead><tbody>${state.records.map(r => `<tr data-search="${esc(r.subject_code.toLowerCase())}" data-source="${r.import_id ? 'import' : 'note'}"><td class="strong mono">${esc(r.subject_code)}</td><td>${fmtDate(r.assessment_date)}</td>${state.variables.map(v => `<td>${valueDisplay(v, r.values[v.key])}</td>`).join('')}<td><span class="status ${r.import_id ? 'imported' : ''}">${r.import_id ? '舊資料' : r.note_id ? '筆記覆核' : '示例資料'}</span></td></tr>`).join('')}</tbody></table>` : empty('尚未有正式紀錄', '先匯入舊資料或核准進度筆記')}</div><div class="field-hint" style="margin-top:10px">未記錄匯出為 -99、無法評估為 -98；0 分保留為有效數值。</div>`;
}
function variables() {
  return header('變數設定', `定義研究欄位、量表範圍與數值代碼 · Schema v${state.project.schema_version}`, button('<span class="symbol">＋</span> 新增變數','new-variable','primary'))
  + `<div class="panel table-wrap"><table class="data-table"><thead><tr><th>變數名稱</th><th>顯示標籤</th><th>型別</th><th>範圍 / 單位</th><th>代碼對照</th><th>必填</th><th>操作</th></tr></thead><tbody>${state.variables.map(v => `<tr><td class="mono strong">${esc(v.key)}</td><td>${esc(v.label)}</td><td><span class="variable-type">${esc(v.type)}</span></td><td>${v.min_value !== null || v.max_value !== null ? `${v.min_value ?? '—'} – ${v.max_value ?? '—'}` : '—'} ${esc(v.unit)}</td><td class="code-list">${v.codes.length ? v.codes.map(c => `${c.code}=${esc(c.label)}`).join(' · ') : '—'}</td><td>${v.required ? '<span class="required-mark">●</span>' : '<span class="muted">—</span>'}</td><td><div class="inline-actions">${button('編輯','edit-variable','small',`data-id="${esc(v.id)}"`)}<button class="button small danger" data-action="delete-variable" data-id="${esc(v.id)}">刪除</button></div></td></tr>`).join('')}</tbody></table></div><div class="privacy-line" style="max-width:760px"><span>ⓘ</span><span>已使用的欄位可修改標籤、單位及相容的範圍或代碼；更改型別須先遷移現有資料。刪除後原值仍保留供稽核。</span></div>`;
}
function importView() {
  return header('舊資料匯入', '對照 Excel / CSV 欄位並檢查資料後匯入', '')
  + `<div class="intake-grid"><div><div class="panel"><div class="panel-head"><strong>來源檔案</strong><span class="muted" style="font-size:11px">CSV / XLSX</span></div><div class="panel-body"><label class="upload-zone" id="import-zone"><span class="upload-glyph">↳</span><strong>選擇舊 Excel 或 CSV</strong><span>最多 10,000 行</span><input id="import-file" type="file" accept=".csv,.xlsx" /></label>${importData ? `<div class="selected-file">${esc(importData.filename)} · ${importData.rows.length} 行 · ${importData.headers.length} 欄</div>` : ''}</div></div>
  ${importData ? `${section('欄位映射')}<div class="panel"><div class="panel-body"><div class="mapping-grid">${[['subject_id','受試者編號'],['assessment_date','評估日期'],...state.variables.map(v => [v.key,v.label])].map(([key,label]) => `<div class="mapping-row"><label>${esc(label)}</label><select class="select mapping-select" data-key="${esc(key)}"><option value="">不匯入</option>${importData.headers.map(h => `<option value="${esc(h)}" ${suggestColumn(key,h) ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></div>`).join('')}</div><div class="field-hint" style="margin-top:10px">受試者編號及評估日期必須對應；其餘欄位可在下方建立為新變數。</div></div></div>${section('從檔案建立新變數')}<div class="panel"><div class="panel-body"><div class="field-hint" style="margin-bottom:9px">檢查系統推測的型別。文字類別會先存為文字，數值代碼可稍後在變數設定中建立。</div>${importData.headers.map((h,index) => `<div class="auto-variable-row" data-index="${index}" data-column="${esc(h)}"><label><input type="checkbox" class="auto-variable-check" ${defaultNewColumn(h) ? 'checked' : ''} /> ${esc(h)}</label><input class="input auto-variable-key" value="${esc(suggestKey(h))}" aria-label="變數名稱" /><select class="select auto-variable-type" aria-label="變數型別">${['INTEGER','DECIMAL','TEXT','DATE'].map(type => `<option value="${type}" ${inferType(h) === type ? 'selected' : ''}>${type}</option>`).join('')}</select></div>`).join('')}<div class="inline-actions" style="justify-content:flex-end;margin-top:18px">${button('檢查並匯入 '+importData.rows.length+' 行','commit-import','primary')}</div></div></div>${section('資料預覽')}<div class="panel table-wrap"><table class="data-table"><thead><tr>${importData.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${importData.rows.slice(0,5).map(r => `<tr>${importData.headers.map(h => `<td>${esc(r[h])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}</div><div><div class="panel"><div class="panel-head"><strong>匯入歷史</strong></div>${state.imports.length ? state.imports.map(batch => `<div class="note-row"><div><div class="note-title">${esc(batch.source_name)}</div><div class="note-meta">${fmtTime(batch.created_at)} · ${batch.row_count} 行</div></div><span class="status">已匯入</span></div>`).join('') : empty('尚未有匯入批次')}</div></div></div>`;
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
  + `<div class="export-layout"><div><div class="panel"><div class="panel-head"><strong>下載檔案</strong><span class="muted" style="font-size:11px">${state.records.length} 筆正式紀錄</span></div><div class="panel-body">${[
    ['xlsx','Excel 工作簿','資料表與 Codebook 工作表','X',''],
    ['csv','CSV 資料表','UTF-8 編碼，含數值代碼','≡','orange']
  ].map(([format,title,sub,glyph,color]) => `<div class="export-option"><div class="export-icon ${color}">${glyph}</div><div class="export-desc"><strong>${title}</strong><span>${sub}</span></div><a class="button small" href="/api/projects/${id()}/export?format=${format}" download>下載 ⇩</a></div>`).join('')}</div></div>
  ${section('匯出至指定 Excel')}<div class="panel"><div class="panel-body"><div class="form-stack"><div class="field"><label for="export-template">選擇現有 .xlsx 檔案</label><input id="export-template" class="input" type="file" accept=".xlsx" /></div>${exportTemplate ? `<div><div class="selected-file">${esc(exportTemplate.file.name)} · ${exportTemplate.rows.length} 行</div><div class="mapping-grid">${[['subject_id','受試者編號'],['assessment_date','評估日期'],...state.variables.map(v => [v.key,v.label])].map(([key,label]) => `<div class="mapping-row"><label>${esc(label)}</label><select class="select export-mapping" data-key="${esc(key)}"><option value="">不更新</option>${exportTemplate.headers.map(h => `<option value="${esc(h)}" ${suggestColumn(key,h) ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></div>`).join('')}</div><div class="inline-actions" style="justify-content:flex-end;margin-top:18px">${button('產生更新版 Excel','merge-export','primary')}</div></div>` : ''}</div></div></div></div><div><div class="panel"><div class="panel-head"><strong>匯出摘要</strong></div><div class="panel-body"><div class="codebook-mini"><span>專案</span><b>${esc(state.project.name)}</b></div><div class="codebook-mini"><span>紀錄數</span><b>${state.records.length}</b></div><div class="codebook-mini"><span>研究變數</span><b>${state.variables.length}</b></div><div class="codebook-mini"><span>Schema 版本</span><b>v${state.project.schema_version}</b></div><div class="codebook-mini"><span>數值缺值代碼</span><b>-99 / -98</b></div></div></div><div class="privacy-line"><span>ⓘ</span><span>指定 Excel 以受試者編號及評估日期比對；同一筆紀錄會更新已對應欄位，新紀錄會加入首個工作表。原檔不會被修改，其他工作表會保留。</span></div></div></div>`;
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
  if (!state) { root.innerHTML = '<div style="padding:40px">載入中…</div>'; return; }
  const content = ({ overview, intake, review, dataset, variables, import: importView, export: exportView })[view]();
  renderShell(content);
  if (view === 'dataset') filterRecords();
}
function filterRecords() {
  const query = (document.querySelector('#record-search')?.value || '').trim().toLowerCase();
  const source = document.querySelector('#record-source')?.value || 'all';
  document.querySelectorAll('#records-table tbody tr').forEach(row => { row.hidden = !(row.dataset.search.includes(query) && (source === 'all' || row.dataset.source === source)); });
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
  document.querySelector('#note-file')?.addEventListener('change', event => { selectedFile = event.target.files?.[0] || null; document.querySelector('#file-display').innerHTML = selectedFile ? `<div class="selected-file">${noteIcon(selectedFile.name)} ${esc(selectedFile.name)}</div>` : ''; });
  document.querySelector('#upload-zone')?.addEventListener('dragover', event => { event.preventDefault(); event.currentTarget.classList.add('drag'); });
  document.querySelector('#upload-zone')?.addEventListener('dragleave', event => event.currentTarget.classList.remove('drag'));
  document.querySelector('#upload-zone')?.addEventListener('drop', event => { event.preventDefault(); event.currentTarget.classList.remove('drag'); selectedFile = event.dataTransfer.files?.[0] || null; document.querySelector('#file-display').innerHTML = selectedFile ? `<div class="selected-file">${noteIcon(selectedFile.name)} ${esc(selectedFile.name)}</div>` : ''; });
  document.querySelector('#upload-form')?.addEventListener('submit', event => { event.preventDefault(); act(async () => {
    if (!selectedFile) throw new Error('請先選擇文件');
    if (selectedFile.size > 12 * 1024 * 1024) throw new Error('檔案不可超過 12 MB');
    const button = event.target.querySelector('button[type="submit"]'); button.disabled = true; button.textContent = '正在處理文件…';
    try {
      const result = await post(`/api/projects/${id()}/notes`, { filename: selectedFile.name, mimeType: selectedFile.type, contentBase64: await readBase64(selectedFile), subjectId: document.querySelector('#subject-id').value, assessmentDate: document.querySelector('#assessment-date').value });
      selectedFile = null; await refresh(); await openDraft(result.draftId); notice('草稿已建立，請核對萃取數值');
    } finally { button.disabled = false; }
  }); });
  document.querySelector('#record-search')?.addEventListener('input', event => { search = event.target.value; filterRecords(); });
  document.querySelector('#record-source')?.addEventListener('change', filterRecords);
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
    if (modal === 'subject') { await post(`/api/projects/${id()}/subjects`, { code: form.get('code') }); modal = null; await refresh(); notice('受試者編號已新增'); }
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
  if (navButton) { view = navButton.dataset.nav; modal = null; render(); return; }
  const action = event.target.closest('[data-action]');
  if (!action) {
    if (event.target.id === 'modal-backdrop') { modal = null; render(); }
    return;
  }
  const name = action.dataset.action;
  if (name === 'go-intake') { view = 'intake'; render(); }
  if (name === 'go-export') { view = 'export'; render(); }
  if (name === 'new-project') { modal = 'project'; render(); }
  if (name === 'new-subject') { modal = 'subject'; render(); }
  if (name === 'new-variable') { modal = 'variable'; render(); }
  if (name === 'edit-variable') { editingVariableId = action.dataset.id; modal = 'edit-variable'; render(); }
  if (name === 'delete-variable') act(async () => {
    const variable = state.variables.find(v => v.id === action.dataset.id);
    if (!variable || !window.confirm(`刪除「${variable.label}」？此欄位將不再出現在資料集和匯出，已核准的原值會保留。`)) return;
    await request(`/api/projects/${id()}/variables/${variable.id}`, { method: 'DELETE' });
    exportTemplate = null;
    await refresh(); notice('變數已刪除');
  });
  if (name === 'switch-project') { modal = 'switch'; render(); }
  if (name === 'close-modal') { modal = null; render(); }
  if (name === 'select-project') { modal = null; selectedDraft = null; importData = null; view = 'overview'; act(() => refresh(action.dataset.id)); }
  if (name === 'open-draft') act(() => openDraft(action.dataset.id));
  if (name === 'save-draft') act(saveDraft);
  if (name === 'approve-draft') act(async () => { const candidate = reviewValues(); await patch(`/api/drafts/${selectedDraft.id}`, { candidate, missingReasons: reviewMissingReasons(candidate) }); await post(`/api/drafts/${selectedDraft.id}/approve`, {}); selectedDraft = null; await refresh(); notice('評估紀錄已核准並寫入資料集'); });
  if (name === 'commit-import') act(async () => {
    const mapping = Object.fromEntries([...document.querySelectorAll('.mapping-select')].map(select => [select.dataset.key, select.value]));
    const newVariables = [...document.querySelectorAll('.auto-variable-row')].filter(row => row.querySelector('.auto-variable-check').checked).map(row => ({ column: row.dataset.column, label: row.dataset.column, key: row.querySelector('.auto-variable-key').value, type: row.querySelector('.auto-variable-type').value }));
    const result = await post(`/api/projects/${id()}/imports/commit`, { filename: importData.filename, rows: importData.rows, mapping, newVariables });
    importData = null; await refresh(); notice(`已建立 ${result.variablesCreated} 個變數，匯入 ${result.rowCount} 筆紀錄`);
  });
  if (name === 'merge-export') act(async () => {
    const mapping = Object.fromEntries([...document.querySelectorAll('.export-mapping')].map(select => [select.dataset.key, select.value]));
    const response = await fetch(`/api/projects/${id()}/export/template`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: exportTemplate.file.name, contentBase64: exportTemplate.contentBase64, mapping }) });
    if (!response.ok) { const error = await response.json(); throw new Error(error.error || '匯出失敗'); }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = exportTemplate.file.name.replace(/\.xlsx$/i, '') + '_updated.xlsx'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    notice('已下載更新版 Excel；原檔沒有改動');
  });
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && modal) { modal = null; render(); } });
act(() => refresh());
