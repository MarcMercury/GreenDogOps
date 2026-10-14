/** The heading the grid shows on Set Up ▸ Week Template instead of a week's dates. */
export function TemplateHeading() {
  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight text-slate-900">Week Template</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Populate this reusable template with shifts and staffing, then apply it to any week from the Grid tab.
      </p>
    </div>
  );
}
