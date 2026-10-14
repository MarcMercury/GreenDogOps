/**
 * One option in the "Replace which punch?" dropdown of a "wrong time"
 * correction. `value` is `"punch:<id>"` or `"adjustment:<id>"`, which the
 * action splits back into the RPC's two replace parameters.
 */
export interface CorrectionTarget {
  value: string;
  label: string;
}
