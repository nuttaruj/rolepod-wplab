import type { Target } from "../../runtime/Target.js";
import type { Adapter } from "../_contract.ts";

export interface AcfFieldGroup {
  id: number;
  title: string;
  key: string;
  active: boolean;
  location?: unknown;
}

export interface AcfField {
  id: number;
  group_id: number;
  key: string;
  name: string;
  label: string;
  type: string;
  required: boolean;
}

export interface AcfReadAPI {
  /** List ACF field groups (any active or inactive). */
  fieldGroups(target: Target): Promise<AcfFieldGroup[]>;

  /** Fields belonging to one group. */
  fieldsInGroup(target: Target, groupKey: string): Promise<AcfField[]>;

  /** ACF-shaped post meta for a given post — Lead can use this to compare
   * with raw `wp post meta list` output. */
  postMeta(target: Target, postId: number): Promise<Record<string, unknown>>;
}

const SLUG = "acf";

export const acfAdapter: Adapter<AcfReadAPI> = {
  slug: SLUG,
  name: "Advanced Custom Fields",
  supportedRange: { min: "6.0", testedUpTo: "6.3" },

  async detect(target: Target): Promise<boolean> {
    // ACF Pro registers `/acf/v3/` REST routes by default; free ACF does not.
    // Cheapest probe still works for ACF Pro.
    try {
      const res = await target.rest({ method: "GET", path: "/" });
      const body = res.body as { routes?: Record<string, unknown> } | undefined;
      if (body?.routes && typeof body.routes === "object") {
        if (Object.keys(body.routes).some((r) => r.startsWith("/acf/")))
          return true;
      }
    } catch {
      // fall through
    }
    // Shell fallback covers both free + Pro
    if (
      target.kind === "local" ||
      target.kind === "ssh" ||
      target.kind === "docker"
    ) {
      try {
        const r = await target.wpCli([
          "plugin",
          "is-active",
          "advanced-custom-fields",
        ]);
        if (r.exitCode === 0) return true;
        const rPro = await target.wpCli([
          "plugin",
          "is-active",
          "advanced-custom-fields-pro",
        ]);
        return rPro.exitCode === 0;
      } catch {
        return false;
      }
    }
    return false;
  },

  read: {
    async fieldGroups(target) {
      // ACF stores field groups as posts of type `acf-field-group`.
      // wp-cli works directly; REST needs ACF Pro routes.
      if (
        target.kind === "local" ||
        target.kind === "ssh" ||
        target.kind === "docker"
      ) {
        const r = await target.wpCli([
          "post",
          "list",
          "--post_type=acf-field-group",
          "--post_status=any",
          "--format=json",
          "--fields=ID,post_title,post_name,post_status",
        ]);
        if (r.exitCode !== 0) return [];
        const raw = JSON.parse(r.stdout || "[]") as Array<{
          ID: number;
          post_title: string;
          post_name: string;
          post_status: string;
        }>;
        return raw.map((g) => ({
          id: g.ID,
          title: g.post_title,
          key: g.post_name,
          active: g.post_status === "publish",
        }));
      }
      // RestTarget — try ACF Pro REST endpoint.
      const res = await target.rest({
        method: "GET",
        path: "/acf/v3/field-groups",
      });
      if (res.status >= 200 && res.status < 300 && Array.isArray(res.body)) {
        return (
          res.body as Array<{
            id: number;
            title: string;
            key: string;
            active?: boolean;
          }>
        ).map((g) => ({
          id: g.id,
          title: g.title,
          key: g.key,
          active: g.active ?? true,
        }));
      }
      return [];
    },

    async fieldsInGroup(target, groupKey) {
      if (
        target.kind === "local" ||
        target.kind === "ssh" ||
        target.kind === "docker"
      ) {
        const r = await target.wpCli([
          "post",
          "list",
          "--post_type=acf-field",
          "--post_status=any",
          "--meta_key=parent",
          `--meta_value=${groupKey}`,
          "--format=json",
          "--fields=ID,post_title,post_name,post_excerpt",
        ]);
        if (r.exitCode !== 0) return [];
        const raw = JSON.parse(r.stdout || "[]") as Array<{
          ID: number;
          post_title: string;
          post_name: string;
          post_excerpt: string;
        }>;
        return raw.map((f) => ({
          id: f.ID,
          group_id: 0,
          key: f.post_name,
          name: f.post_excerpt,
          label: f.post_title,
          type: "unknown", // would require fetching post_content meta — v0.2 via companion
          required: false,
        }));
      }
      const res = await target.rest({
        method: "GET",
        path: `/acf/v3/field-groups/${encodeURIComponent(groupKey)}/fields`,
      });
      return res.status >= 200 && res.status < 300 && Array.isArray(res.body)
        ? (res.body as AcfField[])
        : [];
    },

    async postMeta(target, postId) {
      // ACF Pro exposes typed meta at /acf/v3/<post_type>/{id}; free ACF doesn't.
      // Try Pro REST first.
      const res = await target.rest({
        method: "GET",
        path: `/wp/v2/posts/${postId}`,
        query: { _fields: "acf" },
      });
      if (
        res.status >= 200 &&
        res.status < 300 &&
        res.body &&
        typeof res.body === "object" &&
        "acf" in res.body
      ) {
        return (res.body as { acf: Record<string, unknown> }).acf;
      }

      // Shell fallback — list all meta + filter on `field_` ones (ACF prefix).
      if (
        target.kind === "local" ||
        target.kind === "ssh" ||
        target.kind === "docker"
      ) {
        const r = await target.wpCli([
          "post",
          "meta",
          "list",
          String(postId),
          "--format=json",
        ]);
        if (r.exitCode !== 0) return {};
        const all = JSON.parse(r.stdout || "[]") as Array<{
          meta_key: string;
          meta_value: string;
        }>;
        const acfOnly: Record<string, unknown> = {};
        for (const row of all) {
          if (row.meta_key.startsWith("_") || row.meta_key.startsWith("field_"))
            continue;
          acfOnly[row.meta_key] = row.meta_value;
        }
        return acfOnly;
      }
      return {};
    },
  },
};
