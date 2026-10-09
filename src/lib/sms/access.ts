import { canEditModule, canViewSensitiveHr, isCandidateStatus, type AppUser } from "../auth/permissions";
import { isTextableStatus } from "./rules";

/**
 * Who may read and send texts for a person. Candidates follow Recruiting edit
 * rights; employees/contractors are HR (edit rights plus a full-HR-file role,
 * so Schedule/Marketing Admins and Staff can't text staff from Ops).
 */
export function canTextPerson(user: AppUser, personStatus: string | null | undefined): boolean {
  if (!isTextableStatus(personStatus)) return false;
  if (isCandidateStatus(personStatus)) return canEditModule(user, "ats");
  return canEditModule(user, "hr") && canViewSensitiveHr(user.role);
}
