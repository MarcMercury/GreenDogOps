import { badgeVariants } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * One approver queue: a titled card with a count pill and a lookback hint.
 * A server component, so the pill is the badge's class string on a plain span
 * (`<Badge>` itself renders through Base UI hooks and needs a client tree).
 */
export function QueueSection({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count: number;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {title}
          <span className={badgeVariants({ variant: count > 0 ? "default" : "secondary" })}>{count}</span>
        </CardTitle>
        <CardAction className="text-xs text-muted-foreground">{hint}</CardAction>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
