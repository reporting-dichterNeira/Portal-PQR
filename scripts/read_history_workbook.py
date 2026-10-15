"""Read-only extraction. Never saves or modifies the source workbook."""
import hashlib
import json
import sys
from datetime import date, datetime, time
from pathlib import Path
import openpyxl

source, destination = map(Path, sys.argv[1:3])
if not destination.resolve().is_relative_to((Path.cwd() / "tmp").resolve()):
    raise ValueError("Output must be in a private ignored tmp directory")
with source.open("rb") as stream:
    digest = hashlib.file_digest(stream, "sha256").hexdigest()
book = openpyxl.load_workbook(source, read_only=True, data_only=True, keep_links=False)
sheet = book["BASE REQUERIDA PQR KO"]
rows = sheet.iter_rows(values_only=True)
headers = [str(v or "").strip() for v in next(rows)]
records = []
for number, row in enumerate(rows, 2):
    if not any(v is not None and str(v).strip() for v in row):
        continue
    values = {k: v.isoformat() if isinstance(v, (date, datetime, time)) else v for k, v in zip(headers, row) if k}
    records.append({"row": number, "values": values})
book.close()
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps({"file": source.name, "sha256": digest, "sheets": [{"sheet": sheet.title, "headers": headers, "records": records}]}, ensure_ascii=False), encoding="utf-8")
print(json.dumps({"sourceHash": digest, "records": len(records)}))
