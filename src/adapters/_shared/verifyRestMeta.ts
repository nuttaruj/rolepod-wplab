import type { Target } from "../../runtime/Target.js";

export interface RestMetaVerification {
  verified: boolean;
  mismatched: string[];
  note?: string;
}

/**
 * Read the post's meta back after a `/wp/v2/posts/{id}` meta write and confirm
 * each written key actually landed. This catches the silent wrong-data case the
 * audit targets: a field-framework field (Pods stored in a custom table, a Meta
 * Box group/clone, a JetEngine field with non-standard storage) accepts the
 * core REST meta write with HTTP 200 but does NOT change — because the plugin
 * reads that field from elsewhere. A read-back mismatch means the write was a
 * no-op for that key.
 *
 * This is verification, NOT a guess about the plugin's storage — it only
 * compares what we wrote against what the same REST endpoint now returns.
 */
export async function verifyRestMeta(
  target: Target,
  postId: number,
  meta: Record<string, unknown>,
): Promise<RestMetaVerification> {
  const keys = Object.keys(meta);
  try {
    const res = await target.rest({
      method: "GET",
      path: `/wp/v2/posts/${postId}?context=edit`,
    });
    if (res.status < 200 || res.status >= 300) {
      return {
        verified: false,
        mismatched: keys,
        note: `could not read the post back (HTTP ${res.status}) to verify the write — the values may not have landed`,
      };
    }
    const after =
      (((res.body ?? {}) as Record<string, unknown>)["meta"] as
        | Record<string, unknown>
        | undefined) ?? {};
    const mismatched = keys.filter(
      (k) => JSON.stringify(after[k]) !== JSON.stringify(meta[k]),
    );
    if (mismatched.length === 0) return { verified: true, mismatched: [] };
    return {
      verified: false,
      mismatched,
      note: `WARNING: ${mismatched.length} field(s) did not change on read-back (${mismatched.join(", ")}). The REST returned 200 but the value did not persist — these fields likely use non-standard storage (a custom table / group / clone) that the core post-meta REST path does not reach. Set them in the plugin's own UI, or expose the correct meta key with show_in_rest.`,
    };
  } catch (err) {
    return {
      verified: false,
      mismatched: keys,
      note: `read-back verification failed (${(err as Error).message}) — the write may not have taken effect`,
    };
  }
}
