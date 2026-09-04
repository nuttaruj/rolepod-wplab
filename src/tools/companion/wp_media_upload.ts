import { bridgeFor } from "../../companion/Bridge.js";
import { WplabError } from "../../util/errors.js";
import {
  WpMediaUploadInputSchema,
  WpMediaUploadOutputSchema,
  type WpMediaUploadInput,
  type WpMediaUploadOutput,
} from "../../schema/tools.js";
import type { Target } from "../../runtime/Target.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpMediaUploadToolDef = {
  name: "rolepod_wp_media_upload",
  description:
    "Import a file into the WordPress media library and get its attachment id + URL — the prerequisite for featured images and inserting media. Source is base64 (inline bytes), an https url, or a server-local path under wp-content. With the rolepod-wp companion v2.23+ (media_import capability) the upload is bounded server-side (size cap, https-only + SSRF guard on url, wp-content scoping on path, allowed-mime enforced) and recorded as a REVERSIBLE change-ledger row (disable it to delete the attachment). Without the companion it falls through to a bare REST upload — base64 ONLY, NOT ledgered (manual cleanup: DELETE /wp/v2/media/<id>?force=true). Always pass `alt` for accessibility/SEO. set_featured=true also sets the post's featured image (requires attach_to_post). Needs a rest target.",
  inputSchema: WpMediaUploadInputSchema,
};

function requireRest(t: Target): void {
  if (t.kind !== "rest") {
    throw new WplabError(
      "MEDIA_UPLOAD_REQUIRES_REST",
      `media upload needs a rest target (a live WordPress over REST) — got ${t.kind}`,
      { target_kind: t.kind },
    );
  }
}

/** Decode base64 (tolerating a data: URI prefix) to raw bytes. */
function decodeBase64(data: string): Uint8Array {
  const marker = data.indexOf("base64,");
  const b64 = marker >= 0 ? data.slice(marker + 7) : data;
  return new Uint8Array(Buffer.from(b64.trim(), "base64"));
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

function guessMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Bare-REST fallback for companions without the media_import capability.
 * base64 only — url/local_path need the companion to fetch/read server-side.
 * The upload is NOT ledgered; the returned note says how to remove it.
 */
async function bareRestUpload(
  target: Target,
  input: WpMediaUploadInput,
): Promise<Record<string, unknown>> {
  if (input.source !== "base64" || !input.data) {
    throw new WplabError(
      "MEDIA_UPLOAD_SOURCE_REQUIRES_COMPANION",
      `source='${input.source}' needs the rolepod-wp companion v2.23+ (media_import capability). Over bare REST only source='base64' works — update the companion or send base64.`,
    );
  }
  const bytes = decodeBase64(input.data);
  const filename = input.filename ?? "rolepod-upload.png";

  const res = await target.rest({
    method: "POST",
    path: "/wp/v2/media",
    body: bytes,
    headers: {
      "Content-Type": guessMime(filename),
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
  if (res.status < 200 || res.status >= 300) {
    const b = (res.body ?? {}) as Record<string, unknown>;
    throw new WplabError(
      typeof b["code"] === "string"
        ? (b["code"] as string)
        : `MEDIA_UPLOAD_REST_HTTP_${res.status}`,
      typeof b["message"] === "string"
        ? (b["message"] as string)
        : `POST /wp/v2/media returned HTTP ${res.status}`,
      { status: res.status },
    );
  }

  const media = (res.body ?? {}) as Record<string, unknown>;
  const id = Number(media["id"] ?? 0);

  // alt/title/caption are a second call — the binary POST body carried the file.
  const patch: Record<string, unknown> = {};
  if (input.alt) patch["alt_text"] = input.alt;
  if (input.title) patch["title"] = input.title;
  if (input.caption) patch["caption"] = input.caption;
  if (Object.keys(patch).length > 0 && id > 0) {
    await target.rest({
      method: "POST",
      path: `/wp/v2/media/${id}`,
      body: patch,
    });
  }

  return {
    ok: true,
    attachment_id: id,
    url: media["source_url"] ?? "",
    alt: input.alt ?? "",
    source: "base64",
    source_transport: "rest",
    ledgered: false,
    note: `Uploaded via bare REST (no companion) — NOT recorded in the change ledger. To remove: DELETE /wp/v2/media/${id}?force=true. Install/update the rolepod-wp companion (v2.23+) for reversible, guarded uploads.`,
  };
}

export async function wpMediaUploadHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpMediaUploadOutput> {
  const input: WpMediaUploadInput = WpMediaUploadInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  requireRest(target);
  const bridge = await bridgeFor(target);

  let result: Record<string, unknown>;
  if (bridge.hasCapability("media_import")) {
    // Companion path — bounded server-side + reversible media/import ledger row.
    const payload: Record<string, unknown> = { source: input.source };
    if (input.data !== undefined) payload["data"] = input.data;
    if (input.url !== undefined) payload["url"] = input.url;
    if (input.path !== undefined) payload["path"] = input.path;
    if (input.filename !== undefined) payload["filename"] = input.filename;
    if (input.alt !== undefined) payload["alt"] = input.alt;
    if (input.title !== undefined) payload["title"] = input.title;
    if (input.caption !== undefined) payload["caption"] = input.caption;
    if (input.attach_to_post !== undefined)
      payload["attach_to_post"] = input.attach_to_post;
    const body = await bridge.mediaImport(payload);
    result = { ...body, source_transport: "companion", ledgered: true };
  } else {
    result = await bareRestUpload(target, input);
  }

  // Featured image = the POST's featured_media, set separately from the upload.
  if (input.set_featured && input.attach_to_post !== undefined) {
    const attachId = Number(result["attachment_id"] ?? result["id"] ?? 0);
    if (attachId > 0) {
      const res = await target.rest({
        method: "POST",
        path: `/wp/v2/${input.attach_to_post_type}/${input.attach_to_post}`,
        body: { featured_media: attachId },
      });
      result["featured_set"] =
        res.status >= 200 && res.status < 300 ? input.attach_to_post : false;
      if (res.status < 200 || res.status >= 300) {
        result["featured_error"] =
          `setting featured_media returned HTTP ${res.status}`;
      }
    }
  }

  return WpMediaUploadOutputSchema.parse(result);
}
