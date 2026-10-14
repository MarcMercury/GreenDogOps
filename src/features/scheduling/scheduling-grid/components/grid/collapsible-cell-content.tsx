import styles from "@/features/scheduling/scheduling-grid/components/grid/grid.module.css";

/**
 * Wraps a cell's content so the row can animate open and closed: a one-row
 * CSS grid whose track the row's `data-collapse` state drives from 1fr to 0fr
 * (see `grid.module.css`). Every cell of a collapsible row uses it.
 */
export function CollapsibleCellContent({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.collapsible}>
      <div className={styles.collapsibleInner}>{children}</div>
    </div>
  );
}
