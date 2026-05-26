import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeRunId } from "../../artifact/runId.js";
import { wpAuditSecurityHandler } from "./wp_audit_security.js";
import {
  AuditManyInputSchema,
  AuditManyOutputSchema,
  type AuditManyInput,
  type AuditManyOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpAuditManyToolDef = {
  name: "rolepod_wp_audit_many",
  description:
    "Run rolepod_wp_audit_security across multiple targets in parallel + consolidate findings (agency-tier killer). Writes per-target report + a consolidated index to ./.rolepod-wplab/artifacts/<run_id>/.",
  inputSchema: AuditManyInputSchema,
};

export async function wpAuditManyHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<AuditManyOutput> {
  const input: AuditManyInput = AuditManyInputSchema.parse(raw);
  const runId = makeRunId();
  const reports: AuditManyOutput["reports"] = [];

  await Promise.all(
    input.target_ids.map(async (tid) => {
      try {
        const target = registry.get(tid);
        const r = await wpAuditSecurityHandler(registry, {
          target_id: tid,
          report_format: input.report_format,
        });
        reports.push({
          target_id: tid,
          siteurl: target.siteurl,
          ok: true,
          report_path: r.report_path,
          summary: {
            wp_core_outdated: r.wp_core_outdated,
            outdated_plugin_count: r.outdated_plugins.length,
            outdated_theme_count: r.outdated_themes.length,
            weak_admin_count: r.weak_admin_users.length,
            wp_debug_on: r.wp_debug_on,
          },
        });
      } catch (err) {
        reports.push({
          target_id: tid,
          siteurl: "unknown",
          ok: false,
          error: (err as Error).message,
        });
      }
    }),
  );

  // Consolidated index
  const artifactDir = join(process.cwd(), ".rolepod-wplab", "artifacts", runId);
  await mkdir(artifactDir, { recursive: true });
  const consolidatedPath = join(artifactDir, "audit-many.json");
  await writeFile(
    consolidatedPath,
    JSON.stringify({ run_id: runId, reports }, null, 2),
    "utf8",
  );

  return AuditManyOutputSchema.parse({
    run_id: runId,
    reports,
    consolidated_path: consolidatedPath,
  });
}
