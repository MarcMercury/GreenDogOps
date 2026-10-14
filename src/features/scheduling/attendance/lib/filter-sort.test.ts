import { describe, expect, it } from "vitest";
import type { AttendanceTableView } from "@/features/scheduling/attendance/types/attendance-sort";
import type { EmployeeAttendance } from "@/features/scheduling/attendance/types/employee-attendance";
import { filterAndSortEmployees } from "./filter-sort";
import { emptyTally } from "./tally";

const employee = (
  name: string,
  score: number | null,
  tally: Partial<EmployeeAttendance["tally"]> = {},
): EmployeeAttendance => ({
  personId: name.toLowerCase(),
  name,
  tally: { ...emptyTally(), ...tally },
  score,
});

const bea = employee("Bea", 60, { total: 2, late: 2 });
const amy = employee("amy", 100, { total: 1, present: 1 });
const zed = employee("Zed", null);

const view = (over: Partial<AttendanceTableView> = {}): AttendanceTableView => ({
  query: "",
  onlyResolved: false,
  sortKey: "name",
  sortDir: "asc",
  ...over,
});

const names = (rows: EmployeeAttendance[]) => rows.map((e) => e.name);

describe("filterAndSortEmployees", () => {
  it("matches the search term case-insensitively against the name", () => {
    expect(names(filterAndSortEmployees([bea, amy, zed], view({ query: "  AM " })))).toEqual(["amy"]);
  });

  it("drops employees with nothing resolved when 'only resolved' is on", () => {
    expect(names(filterAndSortEmployees([bea, amy, zed], view({ onlyResolved: true })))).toEqual([
      "amy",
      "Bea",
    ]);
  });

  it("sorts by name ignoring case, in either direction", () => {
    expect(names(filterAndSortEmployees([zed, bea, amy], view()))).toEqual(["amy", "Bea", "Zed"]);
    expect(names(filterAndSortEmployees([zed, bea, amy], view({ sortDir: "desc" })))).toEqual([
      "Zed",
      "Bea",
      "amy",
    ]);
  });

  it("treats a missing score as -1 so it lands last on a descending Reliability sort", () => {
    expect(
      names(filterAndSortEmployees([zed, bea, amy], view({ sortKey: "score", sortDir: "desc" }))),
    ).toEqual(["amy", "Bea", "Zed"]);
    expect(
      names(filterAndSortEmployees([zed, bea, amy], view({ sortKey: "score", sortDir: "asc" }))),
    ).toEqual(["Zed", "Bea", "amy"]);
  });

  it("sorts on a status column and on the resolved total", () => {
    expect(names(filterAndSortEmployees([amy, zed, bea], view({ sortKey: "late", sortDir: "desc" })))).toEqual([
      "Bea",
      "amy",
      "Zed",
    ]);
    expect(names(filterAndSortEmployees([amy, zed, bea], view({ sortKey: "total", sortDir: "asc" })))).toEqual([
      "Zed",
      "amy",
      "Bea",
    ]);
  });

  it("does not reorder the input array", () => {
    const input = [zed, bea, amy];
    filterAndSortEmployees(input, view());
    expect(names(input)).toEqual(["Zed", "Bea", "amy"]);
  });
});
