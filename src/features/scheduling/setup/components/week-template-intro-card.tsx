"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** What the Week Template tab shows before any template exists (or is open). */
export function WeekTemplateIntroCard({
  canEdit,
  onCreate,
}: {
  canEdit: boolean;
  onCreate: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Week Templates</CardTitle>
        <CardDescription className="max-w-2xl">
          Build reusable copies of a full weekly schedule — shift lines with
          employees assigned to each shift — and keep as many as you need, for
          example a standard week, a short-staffed week, and a summer
          rotation. From the Grid tab you can apply any of them to any week.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" disabled={!canEdit} onClick={onCreate}>
          Create your first template
        </Button>
      </CardContent>
    </Card>
  );
}
