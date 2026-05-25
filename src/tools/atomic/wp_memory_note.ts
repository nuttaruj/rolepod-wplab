import { MemoryStore } from '../../memory/MemoryStore.js'
import { canonicalizeSite } from '../../credentials/types.js'
import {
  MemoryNoteInputSchema,
  MemoryNoteOutputSchema,
  type MemoryNoteInput,
  type MemoryNoteOutput,
} from '../../schema/tools.js'
import { WplabError } from '../../util/errors.js'
import type { TargetRegistry } from '../../target/TargetRegistry.js'

export const wpMemoryNoteToolDef = {
  name: 'rolepod_wp_memory_note',
  description:
    'Save a per-site note / convention / runbook (W-028). Notes are append-only; conventions accumulate with version markers; runbooks replace-on-write and need runbook_name. Site derived from target.siteurl. Local-only.',
  inputSchema: MemoryNoteInputSchema,
}

export async function wpMemoryNoteHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<MemoryNoteOutput> {
  const input: MemoryNoteInput = MemoryNoteInputSchema.parse(raw)
  if (input.kind === 'runbook' && (input.runbook_name === undefined || input.runbook_name.trim() === '')) {
    throw new WplabError(
      'MEMORY_NOTE_MISSING_RUNBOOK_NAME',
      'kind=runbook requires runbook_name',
      {},
    )
  }
  const target = registry.get(input.target_id)
  const slug = canonicalizeSite(target.siteurl)
  await MemoryStore.ensureSite(slug, target.siteurl)
  const written = await MemoryStore.appendNote(slug, input.content, input.kind, input.runbook_name)
  return MemoryNoteOutputSchema.parse({
    saved_at: new Date().toISOString(),
    file_path: written.filePath,
    site_slug: slug,
  })
}
