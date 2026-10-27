# OT Research Platform

Local prototype for occupational therapy research data collection. Run with Node.js 24 or newer:

```sh
npm start
```

Open `http://127.0.0.1:3000`. Data is stored in `.data/platform.sqlite`, and original uploads are stored in `.data/notes`. Set `PORT` and `DATA_DIR` to change those defaults.

The prototype includes project and variable setup, subject codes, CSV/XLSX import with column mapping, TXT/PDF/image note intake, local redaction and extraction, manual review, and CSV/XLSX/codebook/SPSS syntax export. Local extraction uses deterministic rules by default. To use a local Ollama model, set `OLLAMA_URL=http://127.0.0.1:11434` and `OLLAMA_MODEL` to an installed model name. Model output must pass validation and still requires human approval.

When importing a CSV/XLSX into a new research project, the importer proposes variables from file columns. Confirm the subject ID and assessment date mappings, then review each proposed key and data type before committing. New variables and imported records are saved together; a validation error saves neither. Categorical text is initially stored as TEXT, so review numeric coding separately before statistical analysis.

Variable Settings supports editing display labels, types, numeric ranges, units, and category code labels. Updates are versioned and audited. Existing stored values must remain valid under the new range or code list; changing the type of a populated variable requires creating a replacement variable and migrating its data separately.

In **Export Center**, choose an existing `.xlsx` file under **Export to a specified Excel file** and map its subject, assessment date, and study variable columns. The platform matches existing rows by subject code and date, updates mapped columns, appends new records to the first worksheet, and downloads a new `_updated.xlsx` copy. The selected original file is not overwritten. Other worksheets and unmapped cells are preserved. The target sheet must have a unique header row and contiguous data rows; Excel Tables are not yet supported.

**Use test or already de-identified data only.** This prototype does not provide authentication, role based access, encrypted file storage, validated PHI scrubbing, backup/retention policy, or a formal PDPO deployment review. The local SQLite database and macOS Vision OCR are development choices, not the intended production infrastructure. Before clinical deployment, migrate to managed PostgreSQL/Prisma and private encrypted object storage, add institutional SSO/MFA, enforce project roles, validate a PHI detection workflow, and complete the institution's privacy and security assessment.

Run `npm test` for the API workflow test. The OCR helper compiles on first PDF/image upload and requires macOS Command Line Tools.
