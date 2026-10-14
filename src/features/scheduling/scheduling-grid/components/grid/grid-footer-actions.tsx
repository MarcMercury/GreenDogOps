"use client";

import { PlusIcon, ZapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** The controls under the grid: load the Dept/Shift Template, add a department, add a shift line. */
export function GridFooterActions({
  showDefaultTemplate,
  onLoadDefaultTemplate,
  onAddDepartment,
  onAddLine,
}: {
  showDefaultTemplate: boolean;
  onLoadDefaultTemplate: () => void;
  onAddDepartment: () => void;
  onAddLine: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {showDefaultTemplate && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                onClick={onLoadDefaultTemplate}
              />
            }
          >
            <ZapIcon /> Dept/Shift Template
          </TooltipTrigger>
          <TooltipContent>Load the Dept/Shift Template shift lines into this week</TooltipContent>
        </Tooltip>
      )}
      <Button variant="outline" size="sm" className="border-dashed" onClick={onAddDepartment}>
        <PlusIcon /> Add department
      </Button>
      <Button variant="outline" size="sm" className="border-dashed" onClick={onAddLine}>
        <PlusIcon /> Add shift line
      </Button>
    </div>
  );
}
