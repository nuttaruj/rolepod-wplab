import {
  UserListInputSchema,
  UserListOutputSchema,
  type UserListInput,
  type UserListOutput,
} from '../../schema/tools.js'
import type { TargetRegistry } from '../../target/TargetRegistry.js'

export const wpUserListToolDef = {
  name: 'rolepod_wp_user_list',
  description:
    'List WordPress users via the WP REST API. Caller must have read_users capability (Application Password user typically does).',
  inputSchema: UserListInputSchema,
}

export async function wpUserListHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<UserListOutput> {
  const input: UserListInput = UserListInputSchema.parse(raw)
  const target = registry.get(input.target_id)

  const query: Record<string, string | number | boolean> = {
    per_page: input.per_page,
    page: input.page,
    context: 'edit', // need 'edit' for email/role visibility
  }
  if (input.search !== undefined) query['search'] = input.search
  if (input.role !== undefined) query['roles'] = input.role

  const res = await target.rest({ method: 'GET', path: '/wp/v2/users', query })
  const users = Array.isArray(res.body) ? res.body : []
  return UserListOutputSchema.parse({ status: res.status, users })
}
