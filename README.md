# OT Research Platform

Browser-only occupational therapy research workspace. The production build is a static website: no API server or hosted database is required.

## Run and deploy

```sh
npm install
npm run dev
npm test
npm run build
```

Open the URL printed by Vite. Deploy `dist/` as a static site. `netlify.toml` configures Netlify automatically; for GitHub Pages, build with `npm run build` and publish the contents of `dist/`. The site uses relative asset URLs, so it also works under a repository subpath.

## Data flow

- Project definitions, variables, subjects, review drafts, records, and the currently linked Excel workbook are stored in this browser's IndexedDB for this site origin.
- The interface defaults to English. Use the language selector in the top bar to switch to Traditional Chinese; the preference is retained in this browser.
- TXT files are read in the browser. PDF text is read with PDF.js; scanned PDF pages and PNG/JPG images use local Tesseract OCR with bundled English and Traditional Chinese data. The note content is not uploaded to a server. The original file is not retained in IndexedDB; the redacted text and draft are retained for review.
- Extraction uses local rules and requires human review. No cloud AI service is called. Detection and redaction are limited heuristics, so review the displayed note for identifiers before sharing any backup.
- Approving a draft or importing legacy data immediately downloads an Excel workbook. If a workbook is linked in Export Center, matching rows are updated by subject code and assessment date and a new `_updated.xlsx` copy is downloaded. The latest generated workbook is also kept in IndexedDB for the next update. The original file on disk is never overwritten automatically.
- Export Center can download CSV or a fresh XLSX with a Codebook worksheet. Numeric missing values are `-99` (not recorded) and `-98` (not assessable); a real score of `0` remains `0`.
- Use **備份本機資料** to download a JSON backup and **還原備份** to restore it on another browser/device. The JSON backup may contain clinical text and must be handled accordingly.

## Moving existing SQLite data

The old Node/SQLite files remain in the repository for one-time migration only. They are not used by the static build. With Node.js 24, run:

```sh
node scripts/migrate-sqlite.mjs
```

This writes `.data/browser-migration.json` locally. In the new website, open Export Center and choose **還原備份** to import that file. The export omits original uploaded files and file paths. Keep `.data/` and the migration JSON outside the deployed `dist/` folder.

## Browser storage limits

Restarting a device normally retains IndexedDB, but clearing site data, private browsing, storage pressure, or changing the website origin can remove access. Keep downloaded Excel files and periodic JSON backups outside the browser. Safari on iPad may evict site storage under storage pressure. A linked workbook and all local records belong only to the current browser/profile. PDF or image OCR can be slow on an iPad, especially for multi-page scanned PDFs.

The old `server.js` and `test/platform.test.js` are legacy migration references. The current application entry point is `public/index.html`; `npm test` runs browser tests against the static frontend.
