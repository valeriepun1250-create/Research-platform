"""Small XLSX reader/writer using the Python standard library."""
import datetime
import base64
import io
import json
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "p": "http://schemas.openxmlformats.org/package/2006/relationships"}
M = "{" + NS["m"] + "}"


def excel_date(value, date1904=False):
    origin = datetime.datetime(1904, 1, 1) if date1904 else datetime.datetime(1899, 12, 30)
    return (origin + datetime.timedelta(days=float(value))).date().isoformat()


def read_xlsx(blob):
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        date1904 = workbook.find("m:workbookPr", NS)
        date1904 = date1904 is not None and date1904.get("date1904") == "1"
        sheet = workbook.find("m:sheets/m:sheet", NS)
        if sheet is None:
            raise ValueError("Workbook has no sheets")
        rel_id = sheet.get("{" + NS["r"] + "}id")
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        target = next(r.get("Target") for r in rels if r.get("Id") == rel_id)
        path = target.lstrip("/") if target.startswith("/") else "xl/" + target
        path = path.replace("xl/xl/", "xl/")
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = ["".join(t.text or "" for t in si.findall(".//m:t", NS)) for si in strings]
        date_styles = set()
        if "xl/styles.xml" in archive.namelist():
            styles = ET.fromstring(archive.read("xl/styles.xml"))
            custom = {int(x.get("numFmtId")): x.get("formatCode", "") for x in styles.findall("m:numFmts/m:numFmt", NS)}
            for index, xf in enumerate(styles.findall("m:cellXfs/m:xf", NS)):
                fmt = int(xf.get("numFmtId", "0"))
                if fmt in range(14, 23) or re.search(r"(?<!\\)[ymd]", custom.get(fmt, "").lower()):
                    date_styles.add(index)
        root = ET.fromstring(archive.read(path))
        matrix = []
        for row in root.findall("m:sheetData/m:row", NS):
            values = {}
            for cell in row.findall("m:c", NS):
                reference = cell.get("r", "A1")
                letters = re.match(r"[A-Z]+", reference).group()
                column = 0
                for letter in letters:
                    column = column * 26 + ord(letter) - 64
                kind = cell.get("t")
                raw = cell.findtext("m:v", default="", namespaces=NS)
                if kind == "s" and raw:
                    value = shared[int(raw)]
                elif kind == "inlineStr":
                    value = "".join(t.text or "" for t in cell.findall(".//m:t", NS))
                elif raw and int(cell.get("s", "0")) in date_styles:
                    value = excel_date(raw, date1904)
                else:
                    value = raw
                values[column - 1] = value
            matrix.append([values.get(i, "") for i in range(max(values, default=-1) + 1)])
        if not matrix:
            return {"headers": [], "rows": []}
        headers = [str(x).strip() for x in matrix[0]]
        return {"headers": headers, "rows": [dict(zip(headers, row + [""] * (len(headers) - len(row)))) for row in matrix[1:] if any(str(x).strip() for x in row)]}


def column_number(reference):
    number = 0
    for letter in re.match(r"[A-Z]+", reference).group():
        number = number * 26 + ord(letter) - 64
    return number


def column_letters(number):
    letters = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def template_sheet(archive):
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    sheet = workbook.find("m:sheets/m:sheet", NS)
    if sheet is None:
        raise ValueError("Workbook has no sheets")
    rel_id = sheet.get("{" + NS["r"] + "}id")
    rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    target = next(r.get("Target") for r in rels if r.get("Id") == rel_id)
    path = target.lstrip("/") if target.startswith("/") else "xl/" + target
    return path.replace("xl/xl/", "xl/"), workbook


def merge_xlsx(payload):
    source = base64.b64decode(payload["contentBase64"], validate=True)
    data = payload["data"]
    mapping = payload["mapping"]
    preview = read_xlsx(source)
    headers = preview["headers"]
    if not headers or len(headers) != len(set(headers)):
        raise ValueError("Target sheet needs a unique header row")
    if mapping.get("subject_id") not in headers or mapping.get("assessment_date") not in headers:
        raise ValueError("Subject and date columns must be mapped")
    mapped = {key: headers.index(header) + 1 for key, header in mapping.items() if header in headers}
    if len(mapped) != len(set(mapped.values())):
        raise ValueError("Each target column may only be mapped once")
    with zipfile.ZipFile(io.BytesIO(source)) as original:
        path, workbook = template_sheet(original)
        date1904_node = workbook.find("m:workbookPr", NS)
        date1904 = date1904_node is not None and date1904_node.get("date1904") == "1"
        root = ET.fromstring(original.read(path))
        if root.find("m:tableParts", NS) is not None:
            raise ValueError("Excel Tables are not supported in this version; convert the target table to a normal range first")
        rows_node = root.find("m:sheetData", NS)
        if rows_node is None:
            raise ValueError("Target sheet has no rows")
        existing = {}
        original_rows = rows_node.findall("m:row", NS)
        if any(int(row.get("r", "0")) != index + 1 for index, row in enumerate(original_rows)):
            raise ValueError("Target sheet must have a contiguous header and data rows")
        if len(preview["rows"]) != max(0, len(original_rows) - 1):
            raise ValueError("Target sheet has blank data rows; remove them before export")
        for row in original_rows[1:]:
            number = int(row.get("r", "0"))
            index = number - 2
            if index < 0 or index >= len(preview["rows"]):
                continue
            values = preview["rows"][index]
            subject = str(values.get(mapping["subject_id"], "")).strip()
            date = str(values.get(mapping["assessment_date"], "")).strip()
            if not subject or not date:
                continue
            key = (subject, date)
            if key in existing:
                raise ValueError(f"Target sheet has duplicate subject/date rows: {subject} {date}")
            existing[key] = row
        seen = set()
        next_row = max((int(row.get("r", "0")) for row in original_rows), default=1) + 1
        for values in data["rows"]:
            key = (str(values[0]), str(values[1]))
            if key in seen:
                raise ValueError(f"Project has duplicate subject/date records: {key[0]} {key[1]}")
            seen.add(key)
            row = existing.get(key)
            if row is None:
                row = ET.SubElement(rows_node, M + "row", {"r": str(next_row)})
                next_row += 1
            row_number = int(row.get("r"))
            for index, field in enumerate(data["headers"]):
                if field not in mapped:
                    continue
                column = mapped[field]
                reference = f"{column_letters(column)}{row_number}"
                old = next((cell for cell in row.findall("m:c", NS) if cell.get("r") == reference), None)
                if old is not None:
                    row.remove(old)
                value = values[index]
                date_cell = field == "assessment_date" and old is not None and old.get("s") is not None
                if date_cell and date1904:
                    value = (datetime.date.fromisoformat(value) - datetime.date(1904, 1, 1)).days
                cell = xcell(row_number, column, value, date=date_cell and not date1904)
                if old is not None and old.get("s") is not None:
                    cell.set("s", old.get("s"))
                position = next((i for i, item in enumerate(row) if item.tag == M + "c" and column_number(item.get("r")) > column), len(row))
                row.insert(position, cell)
        last_row = max((int(row.get("r", "0")) for row in rows_node.findall("m:row", NS)), default=1)
        dimension = root.find("m:dimension", NS)
        if dimension is not None:
            dimension.set("ref", f"A1:{column_letters(len(headers))}{last_row}")
        auto_filter = root.find("m:autoFilter", NS)
        if auto_filter is not None:
            auto_filter.set("ref", f"A1:{column_letters(len(headers))}{last_row}")
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as updated:
            for info in original.infolist():
                updated.writestr(info, ET.tostring(root, encoding="utf-8", xml_declaration=True) if info.filename == path else original.read(info.filename))
        return output.getvalue()


def xcell(row, col, value, date=False, header=False):
    ref = ""
    while col:
        col, rem = divmod(col - 1, 26)
        ref = chr(65 + rem) + ref
    ref += str(row)
    cell = ET.Element(M + "c", {"r": ref})
    if header:
        cell.set("s", "1")
    if date and value:
        cell.set("s", "2")
        ET.SubElement(cell, M + "v").text = str((datetime.date.fromisoformat(value) - datetime.date(1899, 12, 30)).days)
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        ET.SubElement(cell, M + "v").text = str(value)
    else:
        cell.set("t", "inlineStr")
        inline = ET.SubElement(cell, M + "is")
        ET.SubElement(inline, M + "t").text = str(value or "")
    return cell


def sheet_xml(rows, date_column=False):
    root = ET.Element(M + "worksheet")
    views = ET.SubElement(root, M + "sheetViews")
    view = ET.SubElement(views, M + "sheetView", {"workbookViewId": "0"})
    ET.SubElement(view, M + "pane", {"ySplit": "1", "topLeftCell": "A2", "state": "frozen"})
    data = ET.SubElement(root, M + "sheetData")
    for number, values in enumerate(rows, 1):
        row = ET.SubElement(data, M + "row", {"r": str(number)})
        for index, value in enumerate(values, 1):
            row.append(xcell(number, index, value, date=date_column and index == 2 and number > 1, header=number == 1))
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def write_xlsx(payload):
    data = payload["data"]
    project = payload["project"]
    codebook = [["Variable", "Label", "Type", "Unit", "Missing", "Value labels", "Schema version"]]
    for var in data["vars"]:
        codes = "; ".join(f"{code['code']}={code['label']}" for code in var["codes"])
        codebook.append([var["key"], var["label"], var["type"], var["unit"], "-99=Not recorded; -98=Not assessable" if var["type"] in ("INTEGER", "DECIMAL", "CATEGORY") else "", codes, project["schema_version"]])
    sheets = [sheet_xml([data["headers"], *data["rows"]], True), sheet_xml(codebook)]
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '''<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>''')
        archive.writestr("_rels/.rels", '''<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>''')
        archive.writestr("xl/workbook.xml", '''<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Codebook" sheetId="2" r:id="rId2"/></sheets></workbook>''')
        archive.writestr("xl/_rels/workbook.xml.rels", '''<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>''')
        archive.writestr("xl/styles.xml", '''<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9F1EC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>''')
        archive.writestr("xl/worksheets/sheet1.xml", sheets[0])
        archive.writestr("xl/worksheets/sheet2.xml", sheets[1])
    return output.getvalue()


if __name__ == "__main__":
    try:
        if sys.argv[1] == "read":
            sys.stdout.write(json.dumps(read_xlsx(sys.stdin.buffer.read()), ensure_ascii=False))
        elif sys.argv[1] == "merge":
            sys.stdout.buffer.write(merge_xlsx(json.load(sys.stdin)))
        else:
            sys.stdout.buffer.write(write_xlsx(json.load(sys.stdin)))
    except Exception as error:
        sys.stderr.write(str(error))
        sys.exit(1)
