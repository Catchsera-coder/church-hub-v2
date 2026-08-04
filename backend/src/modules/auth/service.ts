import { eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { rolePermissions, roles, userRoles, permissions } from '../../db/schema.js';

/** Load a user's role names and permission names for the access-token claims. */
export async function loadRolesAndPerms(userId: number): Promise<{ roles: string[]; perms: string[] }> {
  const roleRows = await db
    .select({ id: roles.id, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));

  const roleIds = roleRows.map((r) => r.id);
  const roleNames = roleRows.map((r) => r.name);
  if (roleIds.length === 0) return { roles: [], perms: [] };

  const permRows = await db
    .select({ name: permissions.name })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(inArray(rolePermissions.roleId, roleIds));

  return { roles: roleNames, perms: [...new Set(permRows.map((p) => p.name))] };
}
