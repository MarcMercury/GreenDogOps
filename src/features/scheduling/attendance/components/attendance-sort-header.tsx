"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableHead } from "@/components/ui/table";
import type { SortDir } from "@/features/scheduling/attendance/types/attendance-sort";

/** A clickable column heading showing which way the table is sorted. */
export function AttendanceSortHeader({
  label,
  align = "left",
  active,
  dir,
  onClick,
}: {
  label: string;
  align?: "left" | "center";
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={`h-9 px-1.5 ${align === "center" ? "text-center" : "text-left"}`}
    >
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={onClick}
        className={`uppercase ${active ? "text-foreground" : "text-muted-foreground"}`}
      >
        {label}
        <Icon aria-hidden className={active ? "" : "opacity-60"} />
      </Button>
    </TableHead>
  );
}
