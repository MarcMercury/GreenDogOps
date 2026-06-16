import sys, openpyxl

def summarize(path):
    print("\n" + "=" * 80)
    print("FILE:", path)
    print("=" * 80)
    try:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception as e:
        print("  ERROR opening:", e)
        return
    for ws in wb.worksheets:
        print(f"\n  SHEET: '{ws.title}'  max_row={ws.max_row} max_col={ws.max_column}")
        rows = []
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            rows.append(row)
            if i >= 8:
                break
        # find header = first row with the most non-empty cells among first few
        for ridx, row in enumerate(rows[:5]):
            nonempty = [str(c) for c in row if c not in (None, "")]
            print(f"    row{ridx}: ", " | ".join(nonempty[:25]))
    wb.close()

for p in sys.argv[1:]:
    summarize(p)
