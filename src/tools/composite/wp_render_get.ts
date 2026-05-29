import { WplabError } from "../../util/errors.js";
import { sliceContent, type SliceOpts } from "../../lib/contentSlice.js";
import {
  WpRenderGetInputSchema,
  WpRenderGetOutputSchema,
  type WpRenderGetInput,
  type WpRenderGetOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpRenderGetToolDef = {
  name: "rolepod_wp_render_get",
  description:
    "Fetch the RENDERED front-end HTML of a post/page (its permalink) — what the browser actually receives, so you can confirm a class/attribute/markup actually emitted (e.g. whether a section `_css_classes` survived to the DOM). Pass `grep` (regex) and/or `max_bytes` to extract just what you need; HTML is large, so the result is capped by default. Fetches over plain HTTP without auth — public (published) pages only.",
  inputSchema: WpRenderGetInputSchema,
};

export async function wpRenderGetHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpRenderGetOutput> {
  const input: WpRenderGetInput = WpRenderGetInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  let url = input.url;
  if (url === undefined) {
    if (input.post_id === undefined) {
      throw new WplabError(
        "RENDER_GET_NO_TARGET",
        "provide post_id or url",
        {},
      );
    }
    const r = await target.wpCli([
      "post",
      "get",
      String(input.post_id),
      "--field=url",
    ]);
    if (r.exitCode !== 0 || r.stdout.trim() === "") {
      throw new WplabError(
        "RENDER_GET_NO_PERMALINK",
        `could not resolve permalink for post ${input.post_id}`,
        { stderr: r.stderr.slice(0, 200) },
      );
    }
    url = r.stdout.trim();
  }

  // Same-host guard: only fetch URLs on the connected target's host (no SSRF
  // to arbitrary hosts via this tool).
  try {
    const u = new URL(url);
    const site = new URL(target.siteurl);
    if (u.host !== site.host) {
      throw new WplabError(
        "RENDER_GET_HOST_MISMATCH",
        `url host ${u.host} does not match target host ${site.host}`,
        { url, target: target.siteurl },
      );
    }
  } catch (err) {
    if (err instanceof WplabError) throw err;
    throw new WplabError("RENDER_GET_BAD_URL", `invalid url: ${url}`, {});
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": "rolepod-wplab/render-get" },
      redirect: "follow",
    });
  } catch (err) {
    throw new WplabError(
      "RENDER_GET_FETCH_FAILED",
      `fetch failed: ${(err as Error).message}`,
      { url },
    );
  }
  const html = await res.text();

  const sliceOpts: SliceOpts = {
    ignoreCase: input.ignore_case,
    maxBytes: input.max_bytes,
    context: input.context,
  };
  if (input.grep !== undefined) sliceOpts.grep = input.grep;
  const sliced = sliceContent(html, sliceOpts);

  return WpRenderGetOutputSchema.parse({
    url,
    status: res.status,
    total_bytes: sliced.totalBytes,
    returned_bytes: sliced.returnedBytes,
    truncated: sliced.truncated,
    ...(sliced.matchedLines !== undefined
      ? { matched_lines: sliced.matchedLines }
      : {}),
    content: sliced.content,
  });
}
