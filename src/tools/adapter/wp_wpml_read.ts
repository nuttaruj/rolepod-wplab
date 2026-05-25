import { wpmlAdapter } from '../../adapters/wpml/read.js'
import {
  WpmlReadInputSchema,
  WpmlReadOutputSchema,
  type WpmlReadInput,
  type WpmlReadOutput,
} from '../../schema/tools.js'
import { WplabError } from '../../util/errors.js'
import type { TargetRegistry } from '../../target/TargetRegistry.js'

export const wpWpmlReadToolDef = {
  name: 'rolepod_wp_wpml_read',
  description:
    'Read WPML multilingual data. Scopes: languages, string_translations (optional domain filter), post_translations (requires post_id).',
  inputSchema: WpmlReadInputSchema,
}

export async function wpWpmlReadHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpmlReadOutput> {
  const input: WpmlReadInput = WpmlReadInputSchema.parse(raw)
  const target = registry.get(input.target_id)
  const detected = await wpmlAdapter.detect(target)
  if (!detected) {
    return WpmlReadOutputSchema.parse({ scope: input.scope, detected: false, data: null })
  }

  switch (input.scope) {
    case 'languages':
      return WpmlReadOutputSchema.parse({
        scope: input.scope,
        detected: true,
        data: await wpmlAdapter.read.languages(target),
      })
    case 'string_translations':
      return WpmlReadOutputSchema.parse({
        scope: input.scope,
        detected: true,
        data: await wpmlAdapter.read.stringTranslations(
          target,
          input.domain !== undefined ? { domain: input.domain } : {},
        ),
      })
    case 'post_translations':
      if (input.post_id === undefined) {
        throw new WplabError('WPML_READ_MISSING_POST_ID', 'scope=post_translations requires post_id', {})
      }
      return WpmlReadOutputSchema.parse({
        scope: input.scope,
        detected: true,
        data: await wpmlAdapter.read.postTranslations(target, input.post_id),
      })
  }
}
