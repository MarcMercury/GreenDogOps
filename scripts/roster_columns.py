import json, openpyxl

path = "public/Untitled spreadsheet.xlsx"
wb = openpyxl.load_workbook(path, read_only=True, data_only=True)

def dump(sheet, header_row_idx):
    ws = wb[sheet]
    rows = list(ws.iter_rows(values_only=True))
    header = rows[header_row_idx]
    print(f"\n=== {sheet}: {len(rows)} rows ===")
    cols = []
    for i, h in enumerate(header):
        if h not in (None, ""):
            cols.append((i, str(h).strip().replace("\n", " ")))
    for i, name in cols:
        print(f"  col{i}: {name}")
    # show one full data row mapped
    for r in rows[header_row_idx + 1:]:
        if any(c not in (None, "") for c in r):
            print("  --- sample ---")
            for i, name in cols:
                v = r[i] if i < len(r) else None
                if v not in (None, ""):
                    print(f"    {name} = {str(v)[:60]}")
            break

dump("roster", 1)
dump("former employees", 0)
wb.close()
