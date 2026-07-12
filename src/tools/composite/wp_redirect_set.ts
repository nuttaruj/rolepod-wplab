import { ProdGuard } from "../../safety/ProdGuard.js";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import { phpJsonArg } from "../../lib/phpEmbed.js";
import {
  RedirectSetInputSchema,
  RedirectSetOutputSchema,
  type RedirectSetInput,
  type RedirectSetOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpRedirectSetToolDef = {
  name: "rolepod_wp_redirect_set",
  description:
    "Create a redirect through the site's OWN redirect plugin via its documented API — NOT a raw redirection-table insert. Detects the backend: Rank Math (uses \\RankMath\\Redirections\\DB::add) writes the redirect; if only the Redirection plugin is active it returns REDIRECT_BACKEND_MANUAL (add it in Tools → Redirection — this tool does not guess that plugin's schema); no backend → REDIRECT_BACKEND_MISSING. Companion + execute-php only, so it is production-blocked (confirm=true still required if the prod guard is armed). Multisite → MULTISITE_UNSUPPORTED. Ledger category=redirect.",
  inputSchema: RedirectSetInputSchema,
};

export async function wpRedirectSetHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<RedirectSetOutput> {
  const input: RedirectSetInput = RedirectSetInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  if (!target.companion?.enabled) {
    throw new WplabError(
      "COMPANION_REQUIRED",
      "wp_redirect_set requires the rolepod-wp companion (redirect writes go through execute-php).",
      { targetId: input.target_id },
    );
  }
  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "redirect_set blocked on production-matched target — pass confirm=true",
      { siteurl: target.siteurl, matchedPattern: matched.pattern },
    );
  }
  const bridge = await bridgeFor(target);

  const args = { source: input.source, target: input.target, code: input.code };
  const payload = `if (is_multisite()) return ['error' => 'MULTISITE_UNSUPPORTED', 'detail' => 'Redirects are not managed here on multisite — use the plugin UI per site.'];
$active = (array) get_option('active_plugins', []);
$rank = in_array('seo-by-rank-math/rank-math.php', $active, true);
$redir = in_array('redirection/redirection.php', $active, true);
$a = ${phpJsonArg(args)};
if ($rank && class_exists('\\\\RankMath\\\\Redirections\\\\DB')) {
  $id = \\RankMath\\Redirections\\DB::add([
    'sources' => [['pattern' => (string) $a['source'], 'comparison' => 'exact']],
    'url_to' => (string) $a['target'],
    'header_code' => (int) $a['code'],
    'status' => 'active',
  ]);
  if (!$id) return ['error' => 'REDIRECT_CREATE_FAILED', 'detail' => 'Rank Math DB::add returned no id.'];
  return ['backend' => 'rankmath', 'created' => true, 'id' => (int) $id, 'source' => (string) $a['source'], 'target' => (string) $a['target'], 'code' => (int) $a['code']];
}
if ($redir) {
  return ['error' => 'REDIRECT_BACKEND_MANUAL', 'detail' => 'The Redirection plugin is active but this tool writes only Rank Math redirects — add this one in Tools > Redirection.'];
}
return ['error' => 'REDIRECT_BACKEND_MISSING', 'detail' => 'No supported redirect backend. Activate Rank Math (with Redirections enabled), or add the redirect in your redirect plugin.'];`;

  const result = await bridge.executePhp(payload);
  if (!result.ok) {
    throw new WplabError(
      result.error_code ?? "REDIRECT_SET_FAILED",
      result.error_message ?? "wp_redirect_set execute-php failed",
      { result },
    );
  }
  const rv = (result.return_value ?? {}) as {
    backend?: string;
    created?: boolean;
    id?: number;
    source?: string;
    target?: string;
    code?: number;
    error?: string;
    detail?: string;
  };
  if (rv.error) {
    throw new WplabError(rv.error, rv.detail ?? rv.error, {});
  }

  await recordChange(target, {
    category: "redirect",
    subcategory: rv.backend ?? "unknown",
    targetDescriptor: `${rv.code ?? input.code} redirect ${input.source} → ${input.target}`,
    beforeState: { existed: false },
    afterState: {
      id: rv.id,
      source: input.source,
      target: input.target,
      code: input.code,
    },
    reversible: true,
    sourceTool: "wp_redirect_set",
  });

  return RedirectSetOutputSchema.parse({
    backend: rv.backend ?? "rankmath",
    source: input.source,
    target: input.target,
    code: rv.code ?? input.code,
    created: rv.created === true,
    ...(rv.id !== undefined ? { id: rv.id } : {}),
  });
}
