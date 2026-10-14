/** Postgres reports both the name index and the title check as 23505/23514. */
export function isDuplicate(message: string): boolean {
  return /duplicate key|already exists|sched_week_template_title_idx/i.test(message);
}
