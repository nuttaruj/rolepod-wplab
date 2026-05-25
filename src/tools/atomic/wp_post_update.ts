import { ProdGuard } from '../../safety/ProdGuard.js'
import {
  PostUpdateInputSchema,
  PostUpdateOutputSchema,
  type PostUpdateInput,
  type PostUpdateOutput,
} from '../../schema/tools.js'
import { WplabError } from '../../util/errors.js'
import type { TargetRegistry } from '../../target/TargetRegistry.js'

export const wpPostUpdateToolDef = {
  name: 'rolepod_wp_post_update',
  description:
    'Update an existing post (or any registered REST collection entry) by ID via the WP REST API. Only specified fields are sent.',
  inputSchema: PostUpdateInputSchema,
}

export async function wpPostUpdateHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<PostUpdateOutput> {
  const input: PostUpdateInput = PostUpdateInputSchema.parse(raw)
  const target = registry.get(input.target_id)
  prodGuard.enforce(target.siteurl)

  const body: Record<string, unknown> = {}
  if (input.title !== undefined) body['title'] = input.title
  if (input.content !== undefined) body['content'] = input.content
  if (input.status !== undefined) body['status'] = input.status
  if (input.meta !== undefined) body['meta'] = input.meta

  if (Object.keys(body).length === 0) {
    throw new WplabError(
      'POST_UPDATE_NO_FIELDS',
      'post_update requires at least one of: title, content, status, meta',
      { id: input.id },
    )
  }

  const res = await target.rest({
    method: 'POST', // WP REST treats POST to existing /posts/{id} as update
    path: `/wp/v2/${input.type}/${input.id}`,
    body,
  })

  if (res.status < 200 || res.status >= 300) {
    throw new WplabError('POST_UPDATE_FAILED', `REST returned HTTP ${res.status}`, {
      status: res.status,
      body: res.body,
    })
  }

  const b = (res.body ?? {}) as { id?: number; modified?: string }
  return PostUpdateOutputSchema.parse({
    status: res.status,
    id: b.id ?? input.id,
    ...(b.modified !== undefined ? { modified: b.modified } : {}),
  })
}
