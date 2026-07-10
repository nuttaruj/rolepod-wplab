import { assertReadOnlyOrAllowed } from "../../safety/DbGuard.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import {
  DbQueryInputSchema,
  DbQueryOutputSchema,
  type DbQueryInput,
  type DbQueryOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpDbQueryToolDef = {
  name: "rolepod_wp_db_query",
  description:
    "Run a SQL query via wp-cli `db query`, on every target kind. Default: a single SELECT/SHOW/DESCRIBE/EXPLAIN statement — stacked statements (`SELECT 1; DELETE …`) are rejected, since wp-cli runs every one of them. Set allow_write=true (+ confirm=true when the production guard is armed) to unlock INSERT/UPDATE/DELETE. RestTarget without companion v0.2 throws (no remote wp-cli access).",
  inputSchema: DbQueryInputSchema,
};

export async function wpDbQueryHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<DbQueryOutput> {
  const input: DbQueryInput = DbQueryInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  // 1. SELECT-only guard (W-007)
  assertReadOnlyOrAllowed(input.sql, input.allow_write);

  // 2. Production guard — only when actually writing
  if (input.allow_write) {
    const matched = prodGuard.matches(target.siteurl);
    if (matched.matched && !input.confirm) {
      throw new WplabError(
        "PRODUCTION_BLOCKED",
        `db_query (write) blocked on production-matched target — pass confirm=true to proceed`,
        { siteurl: target.siteurl, matchedPattern: matched.pattern },
      );
    }
  }

  // 3. RestTarget without companion-bundled wp-cli (v0.2) cannot reach DB.
  //    Target.wpCli throws COMPANION_REQUIRED_V0_2 — let it bubble.
  const result = await target.wpCli(
    ["db", "query", input.sql, "--skip-themes", "--skip-plugins"],
    { allowDestructive: input.allow_write },
  );

  return DbQueryOutputSchema.parse({
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exitCode,
  });
}
