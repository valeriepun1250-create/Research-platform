const translations = {
  '主要導覽': 'Main navigation', '工作台': 'Workspace', '研究管理': 'Study management',
  '介面語言': 'Interface language',
  '概覽': 'Overview', '文件處理': 'Documents', '覆核隊列': 'Review queue', '資料集': 'Dataset',
  '變數設定': 'Variables', '舊資料匯入': 'Legacy import', '匯出中心': 'Export center',
  '研究概覽': 'Study overview', '研究資料集': 'Study dataset', '研究專案': 'Studies',
  '我的研究': 'My study', '切換研究專案': 'Switch study',
  '待覆核': 'Pending review', '正式紀錄': 'Approved records', '受試者': 'Subjects', '研究變數': 'Study variables',
  '份文件': 'documents', '筆評估': 'assessments', '個匿名編號': 'anonymous IDs',
  '上傳進度筆記': 'Upload progress note', '匯入舊資料': 'Import legacy data',
  '待覆核文件': 'Documents to review', '近期評估紀錄': 'Recent assessments',
  '目前沒有待覆核文件': 'No documents awaiting review', '尚未有評估紀錄': 'No assessment records yet',
  '尚未有正式紀錄': 'No approved records yet', '查看資料集 →': 'View dataset →',
  '受試者編號': 'Subject ID', '評估日期': 'Assessment date', '來源': 'Source',
  '筆記覆核': 'Reviewed note', '舊資料': 'Legacy data', '示例資料': 'Sample data',
  '已核准': 'Approved', '待覆核': 'Pending review', '覆核 →': 'Review →',
  '上傳進度筆記並建立待覆核草稿': 'Upload a progress note to create a review draft',
  '新增受試者': 'Add subject', '此研究尚未設定萃取欄位。': 'This study has no extraction variables yet.',
  '設定研究變數 →': 'Set up variables →', '選擇或拖放進度筆記': 'Choose or drop a progress note',
  '單檔上限 12 MB': 'Maximum file size: 12 MB', '選擇受試者': 'Select a subject',
  '建立萃取草稿 →': 'Create extraction draft →', '處理紀錄': 'Processed documents',
  '尚未上傳文件': 'No documents uploaded yet', '沒有待覆核文件': 'No documents to review',
  '遮蔽後筆記': 'Redacted note', '核對萃取欄位': 'Review extracted fields',
  '核對筆記原文及數值；空白欄位請選擇缺值原因。': 'Check each value against the note. Select a reason for blank fields.',
  '找到原文': 'Evidence found', '未找到': 'Not found', '未記錄': 'Not recorded',
  '原文依據：': 'Evidence: ', '原文未找到此欄位': 'No matching evidence in the note',
  '缺值原因': ' missing reason', '未記錄 (-99)': 'Not recorded (-99)',
  '無法評估 (-98)': 'Not assessable (-98)', '儲存修正': 'Save changes',
  '核准並寫入資料集': 'Approve and add to dataset', '選擇文件開始覆核': 'Select a document to review',
  '匯出資料': 'Export data', '搜尋受試者編號': 'Search subject ID',
  '篩選紀錄來源': 'Filter record source', '所有來源': 'All sources',
  '找不到符合條件的紀錄': 'No matching records', '清除篩選': 'Clear filters',
  '定義研究欄位、量表範圍與數值代碼': 'Define fields, score ranges, and numeric codes',
  '新增變數': 'Add variable', '變數名稱': 'Variable name', '顯示標籤': 'Display label',
  '型別': 'Type', '範圍 / 單位': 'Range / unit', '代碼對照': 'Value codes',
  '必填': 'Required', '操作': 'Actions', '編輯': 'Edit', '刪除': 'Delete',
  '尚未設定研究變數': 'No study variables yet',
  '對照 Excel / CSV 欄位並檢查資料後匯入': 'Map Excel / CSV columns and review the data before import',
  '選擇來源檔案': 'Choose source file', '支援 Excel 或 CSV，最多 10,000 行': 'Excel or CSV, up to 10,000 rows',
  '來源檔案': 'Source file', '選擇舊 Excel 或 CSV': 'Choose a legacy Excel or CSV file',
  '最多 10,000 行': 'Up to 10,000 rows', '對照欄位': 'Map columns',
  '先確認受試者編號和評估日期，再對照已有變數': 'Map subject ID and assessment date first, then existing variables',
  '不匯入': 'Do not import',
  '受試者編號及評估日期必須對應；其餘欄位可在下方建立為新變數。': 'Subject ID and assessment date are required. Other columns can be created as new variables below.',
  '建立新變數': 'Create new variables',
  '只勾選這次需要新增的欄位，並確認型別': 'Select only the columns to add and confirm their types',
  '檢查系統推測的型別。文字類別會先存為文字，數值代碼可稍後在變數設定中建立。': 'Check the suggested types. Text categories are stored as text; add numeric codes later in Variables.',
  '變數型別': 'Variable type', '檢查並匯入': 'Review and import',
  '資料預覽': 'Data preview', '顯示檔案首 5 行，匯入前請核對內容': 'Check the first five rows before importing',
  '匯入歷史': 'Import history', '尚未有匯入批次': 'No imports yet', '已匯入': 'Imported',
  '下載研究資料，或更新指定 Excel 檔案': 'Download study data or update a selected Excel workbook',
  '尚未連結指定 Excel': 'No workbook linked', '目前連結：': 'Linked workbook: ',
  '核准或匯入資料後會自動下載更新版。': 'Approvals and imports download an updated copy automatically.',
  '核准或匯入資料後會自動下載新 Excel。': 'Approvals and imports download a new workbook automatically.',
  '備份本機資料': 'Back up local data', '還原備份': 'Restore backup',
  '下載檔案': 'Download files', 'Excel 工作簿': 'Excel workbook',
  '資料表與 Codebook 工作表': 'Data and Codebook worksheets',
  'CSV 資料表': 'CSV dataset', 'UTF-8 編碼，含數值代碼': 'UTF-8 with numeric codes',
  '下載 ⇩': 'Download ⇩', '更新現有 Excel': 'Update existing Excel',
  '選擇現有工作簿，對照欄位後下載更新版。': 'Choose a workbook, map its columns, then download an updated copy.',
  '選擇現有 .xlsx 檔案': 'Choose an existing .xlsx file', '不更新': 'Do not update',
  '產生更新版 Excel': 'Download updated Excel', '匯出摘要': 'Export summary',
  '專案': 'Study', '紀錄數': 'Records', 'Schema 版本': 'Schema version',
  '數值缺值代碼': 'Numeric missing codes',
  '建立研究專案': 'Create study', '建立專案': 'Create study',
  '專案名稱': 'Study name', '簡介': 'Description', '研究範圍或目標': 'Study scope or goal',
  '例如：上肢復康成效研究': 'e.g. Upper limb rehabilitation outcomes',
  '匿名受試者編號': 'Anonymous subject ID', '新增編號': 'Add ID',
  '例如：OT-005': 'e.g. OT-005', '不輸入姓名、電話或病歷號碼。': 'Do not enter names, phone numbers, or medical record numbers.',
  '新增研究變數': 'Add study variable', '資料型別': 'Data type',
  '例如：moca_total': 'e.g. moca_total', '例如：MoCA 總分': 'e.g. MoCA total',
  '整數': 'Integer', '小數': 'Decimal', '類別代碼': 'Category code',
  '文字': 'Text', '日期': 'Date', '單位': 'Unit', '例如：分': 'e.g. points',
  '最小值': 'Minimum', '最大值': 'Maximum', '選填': 'Optional',
  '數值代碼': 'Numeric codes', '每行：數值 | 標籤 | 別名（可選）': 'One per line: number | label | alias (optional)',
  '每行：數值 | 標籤 | 別名（可選）。已有代碼的數值不可任意更換。': 'One per line: number | label | alias (optional). Existing code numbers cannot be changed freely.',
  '必填欄位': 'Required field', '儲存變數': 'Save variable',
  '取消': 'Cancel', '關閉': 'Close', '建立新專案': 'Create new study',
  '載入中…': 'Loading…', '正在處理文件…': 'Processing document…',
  '草稿修正已儲存': 'Draft changes saved', '本機資料已還原': 'Local data restored',
  '草稿已建立，請核對萃取數值': 'Draft created. Check the extracted values.',
  '檔案已讀取，請檢查欄位映射': 'File read. Check the column mappings.',
  '已讀取目標 Excel，請檢查欄位對應': 'Workbook read. Check the column mappings.',
  '研究專案已建立': 'Study created', '受試者編號已新增': 'Subject ID added',
  '研究變數已新增': 'Study variable added', '變數設定已更新': 'Variable updated',
  '變數已刪除': 'Variable deleted', '已核准，更新版 Excel 已下載': 'Approved. Updated Excel downloaded.',
  '本機研究備份已下載': 'Local study backup downloaded',
  '已連結此工作簿並下載更新版 Excel；之後核准會自動更新': 'Workbook linked and updated copy downloaded. Future approvals will update it.',
  '請先選擇文件': 'Choose a document first', '檔案不可超過 12 MB': 'File must be 12 MB or smaller',
  '請選擇不超過 12 MB 的 .xlsx 檔案': 'Choose an .xlsx file no larger than 12 MB',
  '找不到專案': 'Study not found', '無法讀取檔案': 'Could not read file',
  'CSV 引號沒有正確關閉': 'CSV quotes are not closed correctly', 'Excel 沒有工作表': 'Excel workbook has no worksheets',
  '只支援 CSV 或 XLSX': 'Only CSV and XLSX are supported',
  '無法讀取此 Excel 檔案。請確認是有效的 .xlsx，或另存為 CSV 後匯入。': 'Could not read this Excel file. Check that it is a valid .xlsx, or save it as CSV and import again.',
  'Excel 首行需要不重複的欄位名稱': 'The first Excel row must have unique, nonblank column names',
  '請對應受試者編號和評估日期': 'Map subject ID and assessment date',
  '只支援 TXT、PDF、PNG 和 JPG': 'Only TXT, PDF, PNG, and JPG are supported',
  'PDF 最多支援 30 頁': 'PDFs can have at most 30 pages',
  '無法開啟本機暫存，請檢查瀏覽器設定': 'Could not open local storage. Check browser settings.',
  '無法讀取本機資料': 'Could not read local data',
  '無法儲存本機資料；請檢查可用儲存空間': 'Could not save local data. Check available storage.',
  '變數名稱必須符合 SPSS 命名規則': 'Variable name must follow SPSS naming rules',
  '請輸入變數標籤及型別': 'Enter a variable label and type',
  '-99 和 -98 保留作缺值代碼': '-99 and -98 are reserved missing-value codes',
  '類別代碼無效或重複': 'Category codes are invalid or duplicated',
  '數值範圍無效': 'Invalid numeric range', '請輸入專案名稱': 'Enter a study name',
  '變數名稱已存在': 'Variable name already exists', '找不到變數': 'Variable not found',
  '已有數值的變數需先遷移資料才能改型別': 'Migrate existing values before changing this variable type',
  '受試者編號無效或已存在': 'Subject ID is invalid or already exists',
  '請先選擇受試者': 'Select a subject first',
  '請先設定研究變數或匯入舊資料': 'Set up study variables or import legacy data first',
  '請選擇有效評估日期': 'Choose a valid assessment date',
  '文件沒有可讀取的文字': 'No readable text was found in the document',
  '找不到草稿': 'Draft not found', '草稿不可修改': 'This draft cannot be edited',
  '找不到待覆核草稿': 'Pending draft not found',
  '檔案沒有欄位或超過 10,000 行': 'File has no columns or more than 10,000 rows',
  '新變數名稱重複': 'New variable names are duplicated',
  '找不到本機操作': 'Local operation not found',
  '不是有效的研究備份': 'Not a valid study backup',
  '還原備份會取代這個瀏覽器目前的所有研究資料。確定繼續？': 'Restoring this backup will replace all study data in this browser. Continue?',
  '1 | Independent | 獨立\n2 | Assist | 需協助': '1 | Independent | independent\n2 | Assist | needs assistance'
};

const patterns = [
  [/^(.*) \/ (研究概覽|文件處理|覆核隊列|研究資料集|變數設定|舊資料匯入|匯出中心)$/, (_, study, screen) => `${translate(study)} / ${translate(screen)}`],
  [/^(\d+) 個研究專案$/, (_, count) => `${count} studies`],
  [/^查看全部 (\d+) 份 →$/, (_, count) => `View all ${count} →`],
  [/^(\d+) 份文件等待核對$/, (_, count) => `${count} documents awaiting review`],
  [/^(\d+) 待覆核$/, (_, count) => `${count} pending`],
  [/^(\d+) 筆已核准評估紀錄$/, (_, count) => `${count} approved assessments`],
  [/^(\d+) 筆正式紀錄$/, (_, count) => `${count} approved records`],
  [/^(\d+) \/ (\d+) 筆紀錄$/, (_, shown, all) => `${shown} / ${all} records`],
  [/^(\d+) 份文件$/, (_, count) => `${count} documents`],
  [/^(\d+) 行$/, (_, count) => `${count} rows`],
  [/^檢查並匯入 (\d+) 行$/, (_, count) => `Review and import ${count} rows`],
  [/^(.+) · (\d+) 行 · (\d+) 欄$/, (_, file, rows, columns) => `${file} · ${rows} rows · ${columns} columns`],
  [/^(.+) · (\d+) 行$/, (_, file, rows) => `${file} · ${rows} rows`],
  [/^(.+) · (\d+) 行$/, (_, file, rows) => `${file} · ${rows} rows`],
  [/^目前連結：(.+)$/, (_, file) => `Linked workbook: ${file}`],
  [/^原文依據：(.+)$/, (_, quote) => `Evidence: ${quote}`],
  [/^(.+)缺值原因$/, (_, label) => `${label} missing reason`],
  [/^定義研究欄位、量表範圍與數值代碼 · (.+)$/, (_, schema) => `Define fields, score ranges, and numeric codes · ${schema}`],
  [/^編輯 (.+)$/, (_, key) => `Edit ${key}`],
  [/^變數名稱 (.+) 保持不變；修改後 schema 版本會增加。$/, (_, key) => `Variable name ${key} stays the same; saving increases the schema version.`],
  [/^已建立 (\d+) 個變數，匯入 (\d+) 筆紀錄；Excel 已下載$/, (_, variables, records) => `Created ${variables} variables and imported ${records} records. Excel downloaded.`],
  [/^(.+) 為必填欄位$/, (_, label) => `${label} is required`],
  [/^(.+) 沒有對應代碼$/, (_, label) => `${label} has no matching code`],
  [/^(.+) 必須是數字$/, (_, label) => `${label} must be a number`],
  [/^(.+) 超出允許範圍$/, (_, label) => `${label} is outside the allowed range`],
  [/^(.+) 日期格式不正確$/, (_, label) => `${label} has an invalid date`],
  [/^新變數 (.+) 的來源欄位重複$/, (_, label) => `Source column for ${label} is duplicated`],
  [/^第 (\d+) 行受試者編號或評估日期無效$/, (_, row) => `Row ${row} has an invalid subject ID or assessment date`],
  [/^刪除「(.+)」？此欄位將不再出現在資料集和匯出，已核准的原值會保留。$/, (_, label) => `Delete “${label}”? This field will disappear from the dataset and exports. Approved values will be retained.`]
];

export const getLanguage = () => localStorage.getItem('ot-language') === 'zh-Hant' ? 'zh-Hant' : 'en';
export const setLanguage = value => localStorage.setItem('ot-language', value === 'zh-Hant' ? 'zh-Hant' : 'en');
export function translate(source) {
  if (getLanguage() === 'zh-Hant' || source == null) return String(source ?? '');
  const value = String(source);
  if (Object.hasOwn(translations, value)) return translations[value];
  for (const [pattern, replacement] of patterns) {
    if (pattern.test(value)) return value.replace(pattern, replacement);
  }
  return value;
}
export function localize(root) {
  const language = getLanguage();
  document.documentElement.lang = language;
  document.title = language === 'en' ? 'OT Research | Clinical study data' : 'OT Research | 臨床研究資料';
  if (language === 'zh-Hant') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement?.closest('.document-content, .note-title')) continue;
    const value = node.nodeValue;
    const leading = value.match(/^\s*/)[0], trailing = value.match(/\s*$/)[0];
    const core = value.slice(leading.length, value.length - trailing.length);
    if (core) node.nodeValue = leading + translate(core) + trailing;
  }
  root.querySelectorAll('[placeholder], [aria-label], [title]').forEach(element => {
    for (const attribute of ['placeholder', 'aria-label', 'title']) {
      if (element.hasAttribute(attribute)) element.setAttribute(attribute, translate(element.getAttribute(attribute)));
    }
  });
}
