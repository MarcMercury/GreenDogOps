import sys, openpyxl

path = sys.argv[1]
wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
print("SHEETS:", wb.sheetnames)
target = sys.argv[2] if len(sys.argv) > 2 else None
maxr = int(sys.argv[3]) if len(sys.argv) > 3 else 15
for ws in wb.worksheets:
    if target and ws.title != target:
        continue
    print("\n" + "=" * 70)
    print("SHEET:", ws.title)
    print("=" * 70)
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        cells = [("" if c is None else str(c)).replace("\n", " ")[:30] for c in row]
        # trim trailing empties
        while cells and cells[-1] == "":
            cells.pop()
        print(f"r{i}:", " | ".join(cells[:30]))
        if i >= maxr:
            break
wb.close()
