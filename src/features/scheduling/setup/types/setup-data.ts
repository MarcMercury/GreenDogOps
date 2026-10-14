import type {
  ScheduleLocation,
  SchedDepartment,
  SchedEmployeeSetting,
  SchedPerson,
  SchedRole,
  SchedRoleMember,
  SchedShiftTemplate,
} from "@/lib/schedule/types";

/** Everything the Setup screens (and the grid's pickers) need in one shot. */
export interface SetupData {
  departments: SchedDepartment[];
  roles: SchedRole[];
  templates: SchedShiftTemplate[];
  members: SchedRoleMember[];
  settings: SchedEmployeeSetting[];
  people: SchedPerson[];
  locations: ScheduleLocation[];
}
