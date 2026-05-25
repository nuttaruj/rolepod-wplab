import { rankmathAdapter } from '../../adapters/rankmath/read.js'
import {
  RankMathReadInputSchema,
  RankMathReadOutputSchema,
  type RankMathReadInput,
  type RankMathReadOutput,
} from '../../schema/tools.js'
import { WplabError } from '../../util/errors.js'
import type { TargetRegistry } from '../../target/TargetRegistry.js'

export const wpRankMathReadToolDef = {
  name: 'rolepod_wp_rankmath_read',
  description:
    'Read Rank Math SEO metadata. Scopes: post_meta (requires post_id; returns focus keyword + description + title + canonical), settings (general option block).',
  inputSchema: RankMathReadInputSchema,
}

export async function wpRankMathReadHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<RankMathReadOutput> {
  const input: RankMathReadInput = RankMathReadInputSchema.parse(raw)
  const target = registry.get(input.target_id)
  const detected = await rankmathAdapter.detect(target)
  if (!detected) {
    return RankMathReadOutputSchema.parse({ scope: input.scope, detected: false, data: null })
  }
  if (input.scope === 'post_meta') {
    if (input.post_id === undefined) {
      throw new WplabError('RANKMATH_READ_MISSING_POST_ID', 'scope=post_meta requires post_id', {})
    }
    return RankMathReadOutputSchema.parse({
      scope: input.scope,
      detected: true,
      data: await rankmathAdapter.read.postMeta(target, input.post_id),
    })
  }
  return RankMathReadOutputSchema.parse({
    scope: input.scope,
    detected: true,
    data: await rankmathAdapter.read.settings(target),
  })
}
