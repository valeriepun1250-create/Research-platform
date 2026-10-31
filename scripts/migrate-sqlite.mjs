import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const database = resolve(process.argv[2] || '.data/platform.sqlite');
const output = resolve(process.argv[3] || '.data/browser-migration.json');
const db = new DatabaseSync(database, { readOnly: true });
const rows = table => db.prepare(`SELECT * FROM ${table}`).all();
const parse = value => { try { return JSON.parse(value); } catch { return {}; } };

const workspace = {
  projects: rows('projects'),
  variables: rows('variables').map(v => ({ ...v, required: !!v.required, codes: parse(v.codes) })),
  subjects: rows('subjects'),
  notes: rows('notes').map(({ file_path, sha256, ...note }) => note),
  drafts: rows('drafts').map(d => ({ ...d, candidate: parse(d.candidate), confidence: parse(d.confidence), evidence: parse(d.evidence), missingReasons: parse(d.missing_reasons) })),
  records: rows('records').map(r => ({ ...r, values: parse(r.values_json), missingReasons: parse(r.missing_reasons) })),
  imports: rows('imports'),
  workbooks: {}
};

writeFileSync(output, JSON.stringify(workspace), { mode: 0o600 });
db.close();
console.log(`本機遷移檔已建立：${output}`);
