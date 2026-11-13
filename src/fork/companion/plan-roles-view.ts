/**
 * Fork (1.60, BLG-199): who did each part of a plan's milestone, on the phone's plan page (read
 * only). The schema lives in protocol.ts (it stays zod only and self-contained: the phone loads it
 * under Bare); this name is what the fork's own files import.
 */
export { MilestoneRolesView, RoleSeenView } from '../../companion/protocol.js';
