import { MemoryStore } from '../../memory/MemoryStore.js'
import { canonicalizeSite } from '../../credentials/types.js'
import {
  MemoryListInputSchema,
  MemoryListOutputSchema,
  type MemoryListInput,
  type MemoryListOutput,
} from '../../schema/tools.js'
import type { TargetRegistry } from '../../target/TargetRegistry.js'

export const wpMemoryListToolDef = {
  name: 'rolepod_wp_memory_list',
  description:
    'List per-site memory files + sizes + mtimes (W-028). Does NOT return contents — use rolepod_wp_memory_recall for content. Site derived from target.siteurl.',
  inputSchema: MemoryListInputSchema,
}

export async function wpMemoryListHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<MemoryListOutput> {
  const input: MemoryListInput = MemoryListInputSchema.parse(raw)
  const target = registry.get(input.target_id)
  const slug = canonicalizeSite(target.siteurl)
  const files = await MemoryStore.list(slug)
  const totalBytes = files.reduce((sum, f) => sum + f.size_bytes, 0)
  return MemoryListOutputSchema.parse({ site_slug: slug, files, total_bytes: totalBytes })
}
