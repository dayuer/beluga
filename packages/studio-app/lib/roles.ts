/** The AI's display names. P1 has no settings screen: this is the one default (P3 adds a picker). */
export type RoleNames = Readonly<Record<string, string>>;

export const defaultRoleNames: RoleNames = { default: 'AI' };

/** `role` wins when the studio named it; an app mapping may rename it; then the default word. */
export function aiName(role: string | undefined, names: RoleNames = defaultRoleNames): string {
  if (role && names[role]) return names[role];
  return role ?? names.default ?? 'AI';
}
