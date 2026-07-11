import { recordChange } from "../../companion/ledger.js";
import type { Target } from "../../runtime/Target.js";

export interface WriteScalarMetaResult {
  updated: boolean;
  reversible: boolean;
  auditId: string | null;
}

/**
 * Write one scalar post_meta value with `wp post meta update`, capturing the
 * prior value first so the change lands in the ledger.
 *
 * For plugin meta (Yoast, Rank Math) whose values are single strings — not the
 * serialized trees that go through replacePostMeta. Records a `post` row per
 * key, which is why the SEO adapters loop over fields and call this once each,
 * rather than recording a single combined row.
 *
 * `reversible` is honest about what the companion can restore:
 *   - the key had a prior value  → true  (restore that value)
 *   - the key was absent          → false (an undo would have to DELETE it,
 *     which the `post` dispatcher does not do; a note says so)
 */
export async function writeScalarMeta(
  target: Target,
  postId: number,
  metaKey: string,
  value: string,
  sourceTool: string,
): Promise<WriteScalarMetaResult> {
  const read = await target.wpCli([
    "post",
    "meta",
    "get",
    String(postId),
    metaKey,
  ]);
  const hadPrior = read.exitCode === 0 && read.stdout.trim().length > 0;
  const beforeValue = hadPrior ? read.stdout.replace(/\n$/, "") : null;

  const write = await target.wpCli(
    ["post", "meta", "update", String(postId), metaKey, value],
    { allowDestructive: true },
  );
  if (write.exitCode !== 0) {
    throw new Error(
      `post meta update ${metaKey} failed: ${write.stderr.slice(0, 200)}`,
    );
  }

  const reversible = hadPrior;
  const audit = await recordChange(target, {
    category: "post",
    subcategory: metaKey,
    targetDescriptor: `post:${postId}:${metaKey}`,
    beforeState: { value: beforeValue },
    afterState: { value },
    reversible,
    sourceTool,
    ...(reversible
      ? {}
      : {
          notes: `${metaKey} did not exist before this write; an undo would need to delete it (wp post meta delete ${postId} ${metaKey}).`,
        }),
  });

  return { updated: true, reversible, auditId: audit?.auditId ?? null };
}
