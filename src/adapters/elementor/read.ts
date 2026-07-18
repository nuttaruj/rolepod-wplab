import type { Target } from "../../runtime/Target.js";
import type { Adapter } from "../_contract.ts";

export interface ElementorPageSummary {
  id: number;
  title: string;
  status: string;
  link?: string;
}

export interface ElementorWidget {
  id: string;
  elType: string;
  widgetType?: string;
  settings?: Record<string, unknown>;
  elements?: ElementorWidget[];
}

export interface ElementorPageDetail {
  id: number;
  title: string;
  widget_tree: ElementorWidget[];
  meta_size_bytes: number;
}

export interface ElementorReadAPI {
  /** List Elementor-rendered pages (any post type with non-empty `_elementor_data`). */
  listPages(
    target: Target,
    opts?: { type?: string; per_page?: number },
  ): Promise<ElementorPageSummary[]>;

  /** Dump the widget tree of a single page from `_elementor_data` meta. */
  getPage(target: Target, postId: number): Promise<ElementorPageDetail>;

  /**
   * Read the active kit's global design tokens (colors + typography) via
   * Elementor's OWN REST API (`/elementor/v1/globals`) — read-only. Verified
   * live: this endpoint returns the resolved globals; there is no safe REST
   * WRITE path (POST is a silent no-op without an editor nonce).
   */
  getKit(target: Target): Promise<{ colors?: unknown; typography?: unknown }>;
}

const SLUG = "elementor";

export const elementorAdapter: Adapter<ElementorReadAPI> = {
  slug: SLUG,
  name: "Elementor",
  supportedRange: { min: "3.18", testedUpTo: "3.22" },

  async detect(target: Target): Promise<boolean> {
    // Cheapest probe — REST routes index. WP exposes /wp-json/ root with `routes`.
    try {
      const res = await target.rest({ method: "GET", path: "/" });
      const body = res.body as { routes?: Record<string, unknown> } | undefined;
      if (body?.routes && typeof body.routes === "object") {
        for (const route of Object.keys(body.routes)) {
          if (route.startsWith("/elementor/")) return true;
        }
      }
    } catch {
      // ignore — fall through
    }

    // Fallback: probe wp_options for active_plugins via wp-cli (shell-capable only)
    if (
      target.kind === "local" ||
      target.kind === "ssh" ||
      target.kind === "docker"
    ) {
      try {
        const result = await target.wpCli(["plugin", "is-active", "elementor"]);
        return result.exitCode === 0;
      } catch {
        return false;
      }
    }
    return false;
  },

  read: {
    async listPages(target, opts = {}) {
      const type = opts.type ?? "page";
      const per_page = opts.per_page ?? 50;
      // Use REST `/wp/v2/<type>` with _fields to keep payload small.
      const res = await target.rest({
        method: "GET",
        path: `/wp/v2/${type}`,
        query: { per_page, _fields: "id,title,status,link,meta" },
      });
      const items = Array.isArray(res.body) ? res.body : [];
      const out: ElementorPageSummary[] = [];
      for (const raw of items) {
        const p = raw as {
          id: number;
          title: { rendered: string };
          status: string;
          link?: string;
          meta?: Record<string, unknown>;
        };
        // We don't have direct access to _elementor_data via REST — that meta
        // key isn't exposed publicly. v0.1 returns all pages; v0.2 will use
        // companion introspection to filter to actual Elementor pages.
        const summary: ElementorPageSummary = {
          id: p.id,
          title: p.title.rendered,
          status: p.status,
        };
        if (p.link !== undefined) summary.link = p.link;
        out.push(summary);
      }
      return out;
    },

    async getPage(target, postId) {
      // Pull post meta via wp-cli. Shell targets spawn `wp` directly; a
      // RestTarget routes wp-cli through the companion endpoint, so it works
      // too whenever the companion is enabled.
      if (
        target.kind === "local" ||
        target.kind === "ssh" ||
        target.kind === "docker" ||
        (target.kind === "rest" && target.companion?.enabled)
      ) {
        const meta = await target.wpCli([
          "post",
          "meta",
          "get",
          String(postId),
          "_elementor_data",
          "--format=json",
        ]);
        if (meta.exitCode !== 0) {
          return {
            id: postId,
            title: "",
            widget_tree: [],
            meta_size_bytes: 0,
          };
        }
        // `--format=json` on a scalar JSON-string meta double-encodes it: the
        // value comes back as a JSON string of a JSON string. Decode once more
        // when the first parse yields a string rather than the section array.
        let parsed: unknown = JSON.parse(meta.stdout);
        if (typeof parsed === "string") {
          parsed = JSON.parse(parsed);
        }
        const widgetTree = parsed as ElementorWidget[];
        const title = await target.wpCli([
          "post",
          "get",
          String(postId),
          "--field=post_title",
        ]);
        return {
          id: postId,
          title: title.exitCode === 0 ? title.stdout.trim() : "",
          widget_tree: widgetTree,
          meta_size_bytes: meta.stdout.length,
        };
      }

      // RestTarget without a companion can't reach post meta (REST doesn't
      // expose _elementor_data). Install/enable the rolepod-wp companion.
      throw new Error(
        `elementor.getPage on a RestTarget requires the rolepod-wp companion (post meta access). Enable it on the target.`,
      );
    },

    async getKit(target) {
      const res = await target.rest({
        method: "GET",
        path: "/elementor/v1/globals",
      });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(
          `elementor globals returned HTTP ${res.status} — is Elementor active and the auth allowed to read it?`,
        );
      }
      const body = (res.body ?? {}) as {
        colors?: unknown;
        typography?: unknown;
      };
      return { colors: body.colors, typography: body.typography };
    },
  },
};
