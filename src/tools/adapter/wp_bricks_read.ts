import { bricksAdapter } from '../../adapters/bricks/read.js'
import {
  BricksReadInputSchema,
  BricksReadOutputSchema,
  type BricksReadInput,
  type BricksReadOutput,
} from '../../schema/tools.js'
import type { TargetRegistry } from '../../target/TargetRegistry.js'

export const wpBricksReadToolDef = {
  name: 'rolepod_wp_bricks_read',
  description:
    'Read Bricks Builder data. Without page_id: lists Bricks-rendered pages of the given type. With page_id: dumps the element tree from `_bricks_page_content_2` meta. Shell targets work directly; RestTarget without companion is limited to list.',
  inputSchema: BricksReadInputSchema,
}

export async function wpBricksReadHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<BricksReadOutput> {
  const input: BricksReadInput = BricksReadInputSchema.parse(raw)
  const target = registry.get(input.target_id)
  const detected = await bricksAdapter.detect(target)
  if (!detected) {
    return BricksReadOutputSchema.parse({
      mode: input.page_id !== undefined ? 'page' : 'list',
      detected: false,
    })
  }
  if (input.page_id !== undefined) {
    const page = await bricksAdapter.read.getPage(target, input.page_id)
    return BricksReadOutputSchema.parse({ mode: 'page', detected: true, page })
  }
  const pages = await bricksAdapter.read.listPages(target, {
    type: input.type,
    per_page: input.per_page,
  })
  return BricksReadOutputSchema.parse({ mode: 'list', detected: true, pages })
}
