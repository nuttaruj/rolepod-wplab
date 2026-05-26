import type { Target } from "../../runtime/Target.js";
import type { Adapter } from "../_contract.ts";

export type FormsEngine = "gravity" | "cf7" | "wpforms" | "none";

export interface FormSummary {
  engine: FormsEngine;
  id: number | string;
  title: string;
  entry_count?: number;
  date_created?: string;
}

export interface FormDetail {
  engine: FormsEngine;
  id: number | string;
  title: string;
  fields: unknown[];
  notifications?: unknown[];
  confirmations?: unknown[];
}

export interface FormEntry {
  engine: FormsEngine;
  id: number | string;
  form_id: number | string;
  date_created: string;
  is_spam?: boolean;
  fields: Record<string, unknown>;
}

export interface FormsReadAPI {
  detectEngine(target: Target): Promise<FormsEngine>;
  listForms(
    target: Target,
    engine: FormsEngine,
    perPage: number,
  ): Promise<FormSummary[]>;
  getForm(
    target: Target,
    engine: FormsEngine,
    formId: number | string,
  ): Promise<FormDetail>;
  listEntries(
    target: Target,
    engine: FormsEngine,
    formId: number | string | undefined,
    perPage: number,
  ): Promise<FormEntry[]>;
}

const SLUG = "forms";

async function pluginActive(target: Target, slug: string): Promise<boolean> {
  if (
    target.kind !== "local" &&
    target.kind !== "ssh" &&
    target.kind !== "docker"
  )
    return false;
  try {
    const r = await target.wpCli(["plugin", "is-active", slug]);
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

export const formsAdapter: Adapter<FormsReadAPI> = {
  slug: SLUG,
  name: "Forms (Gravity / CF7 / WPForms)",

  async detect(target: Target): Promise<boolean> {
    const eng = await formsAdapter.read.detectEngine(target);
    return eng !== "none";
  },

  read: {
    async detectEngine(target) {
      if (await pluginActive(target, "gravityforms")) return "gravity";
      if (await pluginActive(target, "contact-form-7")) return "cf7";
      if (await pluginActive(target, "wpforms-lite")) return "wpforms";
      if (await pluginActive(target, "wpforms")) return "wpforms";
      // REST fallback: probe known namespaces
      try {
        const res = await target.rest({ method: "GET", path: "/" });
        const body = res.body as
          | { routes?: Record<string, unknown> }
          | undefined;
        const routes = body?.routes ? Object.keys(body.routes) : [];
        if (routes.some((r) => r.startsWith("/gf/v2"))) return "gravity";
        if (routes.some((r) => r.startsWith("/contact-form-7/v1")))
          return "cf7";
        if (routes.some((r) => r.startsWith("/wpforms/v1"))) return "wpforms";
      } catch {
        // ignore
      }
      return "none";
    },

    async listForms(target, engine, perPage) {
      if (engine === "cf7") {
        const res = await target.rest({
          method: "GET",
          path: "/wp/v2/wpcf7_contact_form",
          query: { per_page: perPage, _fields: "id,title,date" },
        });
        const items = Array.isArray(res.body) ? res.body : [];
        return items.map((raw) => {
          const f = raw as {
            id: number;
            title: { rendered: string };
            date: string;
          };
          return {
            engine: "cf7" as const,
            id: f.id,
            title: f.title.rendered,
            date_created: f.date,
          };
        });
      }
      if (engine === "wpforms") {
        const res = await target.rest({
          method: "GET",
          path: "/wp/v2/wpforms",
          query: { per_page: perPage, _fields: "id,title,date" },
        });
        const items = Array.isArray(res.body) ? res.body : [];
        return items.map((raw) => {
          const f = raw as {
            id: number;
            title: { rendered: string };
            date: string;
          };
          return {
            engine: "wpforms" as const,
            id: f.id,
            title: f.title.rendered,
            date_created: f.date,
          };
        });
      }
      if (engine === "gravity") {
        if (
          target.kind !== "local" &&
          target.kind !== "ssh" &&
          target.kind !== "docker"
        ) {
          // Gravity Forms REST v2 requires consumer key/secret — fall back to wp-cli only.
          throw new Error(
            "gravity forms list requires shell target or REST consumer key (not yet wired)",
          );
        }
        const r = await target.wpCli(["gf", "form", "list", "--format=json"]);
        if (r.exitCode !== 0) return [];
        try {
          const rows = JSON.parse(r.stdout || "[]") as Array<{
            id: number;
            title: string;
            entries?: number;
            date_created?: string;
          }>;
          return rows.map((f) => {
            const out: FormSummary = {
              engine: "gravity" as const,
              id: f.id,
              title: f.title,
            };
            if (f.entries !== undefined) out.entry_count = f.entries;
            if (f.date_created !== undefined) out.date_created = f.date_created;
            return out;
          });
        } catch {
          return [];
        }
      }
      return [];
    },

    async getForm(target, engine, formId) {
      if (engine === "cf7" || engine === "wpforms") {
        const postType = engine === "cf7" ? "wpcf7_contact_form" : "wpforms";
        const res = await target.rest({
          method: "GET",
          path: `/wp/v2/${postType}/${formId}`,
          query: { _fields: "id,title,content,meta" },
        });
        const f = (res.body ?? {}) as {
          id: number;
          title: { rendered: string };
          content?: { rendered: string };
          meta?: Record<string, unknown>;
        };
        return {
          engine,
          id: f.id ?? formId,
          title: f.title?.rendered ?? "",
          fields: f.meta ? [f.meta] : [],
        };
      }
      if (engine === "gravity") {
        if (
          target.kind !== "local" &&
          target.kind !== "ssh" &&
          target.kind !== "docker"
        ) {
          throw new Error("gravity getForm requires shell target");
        }
        const r = await target.wpCli([
          "gf",
          "form",
          "get",
          String(formId),
          "--format=json",
        ]);
        if (r.exitCode !== 0)
          throw new Error(`gf form get failed: ${r.stderr.slice(0, 200)}`);
        const data = JSON.parse(r.stdout || "{}") as {
          id?: number;
          title?: string;
          fields?: unknown[];
          notifications?: unknown[];
          confirmations?: unknown[];
        };
        const out: FormDetail = {
          engine: "gravity",
          id: data.id ?? formId,
          title: data.title ?? "",
          fields: data.fields ?? [],
        };
        if (data.notifications !== undefined)
          out.notifications = data.notifications;
        if (data.confirmations !== undefined)
          out.confirmations = data.confirmations;
        return out;
      }
      return { engine: "none", id: formId, title: "", fields: [] };
    },

    async listEntries(target, engine, formId, perPage) {
      if (engine === "gravity") {
        if (
          target.kind !== "local" &&
          target.kind !== "ssh" &&
          target.kind !== "docker"
        ) {
          throw new Error("gravity listEntries requires shell target");
        }
        const args = ["gf", "entry", "list"];
        if (formId !== undefined) args.push(`--form=${formId}`);
        args.push(`--per-page=${perPage}`, "--format=json");
        const r = await target.wpCli(args);
        if (r.exitCode !== 0) return [];
        try {
          const rows = JSON.parse(r.stdout || "[]") as Array<{
            id: number;
            form_id: number;
            date_created: string;
            status?: string;
            [k: string]: unknown;
          }>;
          return rows.map((e) => {
            const { id, form_id, date_created, status, ...rest } = e;
            return {
              engine: "gravity" as const,
              id,
              form_id,
              date_created,
              is_spam: status === "spam",
              fields: rest,
            };
          });
        } catch {
          return [];
        }
      }
      // CF7 + WPForms entries land in custom tables; v1.1 returns empty for those.
      return [];
    },
  },
};
