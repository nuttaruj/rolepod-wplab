import { yoastAdapter } from '../../adapters/yoast/read.js'
import {
  YoastReadInputSchema,
  YoastReadOutputSchema,
  type YoastReadInput,
  type YoastReadOutput,
} from '../../schema/tools.js'
import { WplabError } from '../../util/errors.js'
import type { TargetRegistry } from '../../target/TargetRegistry.js'

export const wpYoastReadToolDef = {
  name: 'rolepod_wp_yoast_read',
  description:
    'Read Yoast SEO metadata. Scopes: post_meta (requires post_id; returns focus keyword + meta description + title + canonical + noindex), settings (titles + schema config).',
  inputSchema: YoastReadInputSchema,
}

export async function wpYoastReadHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<YoastReadOutput> {
  const input: YoastReadInput = YoastReadInputSchema.parse(raw)
  const target = registry.get(input.target_id)
  const detected = await yoastAdapter.detect(target)
  if (!detected) {
    return YoastReadOutputSchema.parse({ scope: input.scope, detected: false, data: null })
  }
  if (input.scope === 'post_meta') {
    if (input.post_id === undefined) {
      throw new WplabError('YOAST_READ_MISSING_POST_ID', 'scope=post_meta requires post_id', {})
    }
    return YoastReadOutputSchema.parse({
      scope: input.scope,
      detected: true,
      data: await yoastAdapter.read.postMeta(target, input.post_id),
    })
  }
  return YoastReadOutputSchema.parse({
    scope: input.scope,
    detected: true,
    data: await yoastAdapter.read.settings(target),
  })
}
