import { requiredUuid, z } from "@/lib/validation/form";

/** One (role, person) cell of the eligibility matrix. */
export const toggleRoleMemberSchema = z.object({
  roleId: requiredUuid("role id"),
  personId: requiredUuid("person id"),
  eligible: z.boolean(),
});
export type ToggleRoleMemberInput = z.infer<typeof toggleRoleMemberSchema>;

/** Replace the full member list of a role. */
export const setRoleMembersSchema = z.object({
  roleId: requiredUuid("role id"),
  personIds: z.array(requiredUuid("person id")),
});
export type SetRoleMembersInput = z.infer<typeof setRoleMembersSchema>;

/** Replace the full set of roles one person is eligible for (HR profile). */
export const setPersonRolesSchema = z.object({
  personId: requiredUuid("person id"),
  roleIds: z.array(requiredUuid("role id")),
});
export type SetPersonRolesInput = z.infer<typeof setPersonRolesSchema>;
