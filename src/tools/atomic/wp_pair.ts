import { randomBytes } from "node:crypto";
import { RestTarget } from "../../runtime/RestTarget.js";
import { makeVault } from "../../credentials/factory.js";
import { canonicalizeSite } from "../../credentials/types.js";
import {
  PairInputSchema,
  PairOutputSchema,
  type PairInput,
  type PairOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import { log } from "../../util/log.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpPairToolDef = {
  name: "rolepod_wp_pair",
  description:
    'One-click pair using a companion-issued pair_token. Exchanges the token for a WP Application Password minted by the companion under the issuing admin user (named "wplab-pair-<timestamp>"). Stores the credential in the local vault and opens a Target. Tokens are single-use, 60-min TTL, https-only.',
  inputSchema: PairInputSchema,
};

interface RedeemResponseBody {
  username?: string;
  app_password?: string;
  app_password_name?: string;
  capabilities?: string[];
  companion_version?: string;
  siteurl?: string;
  is_production?: boolean;
  error_code?: string;
  error_message?: string;
}

export async function wpPairHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<PairOutput> {
  const input: PairInput = PairInputSchema.parse(raw);
  const url = new URL(input.siteurl);
  const redeemUrl = `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}/wp-json/wplab/v1/pair/redeem`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000).unref();
  let body: RedeemResponseBody;
  let status: number;
  try {
    const res = await fetch(redeemUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "rolepod-wplab/1.2 (+pair)",
      },
      body: JSON.stringify({ pair_token: input.pair_token }),
      signal: controller.signal,
    });
    status = res.status;
    const text = await res.text();
    try {
      body = JSON.parse(text) as RedeemResponseBody;
    } catch {
      body = { error_message: text.slice(0, 200) };
    }
  } catch (err) {
    const e = err as Error & { name?: string };
    throw new WplabError(
      e.name === "AbortError" ? "PAIR_REDEEM_TIMEOUT" : "PAIR_REDEEM_NETWORK",
      `pair redeem failed: ${e.message ?? "unknown"}`,
      {
        redeemUrl: `${url.protocol}//${url.host}/wp-json/wplab/v1/pair/redeem`,
      },
    );
  } finally {
    clearTimeout(timer);
  }

  if (status === 429) {
    throw new WplabError(
      body.error_code ?? "PAIR_REDEEM_THROTTLED",
      body.error_message ?? "pair redeem throttled by companion",
      { status },
    );
  }
  if (status < 200 || status >= 300) {
    throw new WplabError(
      body.error_code ?? `PAIR_REDEEM_HTTP_${status}`,
      body.error_message ?? `pair redeem returned HTTP ${status}`,
      { status },
    );
  }
  if (!body.username || !body.app_password) {
    throw new WplabError(
      "PAIR_REDEEM_BAD_RESPONSE",
      "companion did not return username + app_password",
      { status },
    );
  }

  const canonical = canonicalizeSite(url.host);
  const credential = {
    site: canonical,
    username: body.username,
    appPassword: body.app_password,
    addedAt: new Date().toISOString(),
  };

  let credentialStored = false;
  try {
    const vault = await makeVault();
    await vault.add(credential);
    credentialStored = true;
  } catch (err) {
    log.warn("pair: failed to persist credential — Target will still open", {
      err: (err as Error).message,
    });
  }

  const target = await RestTarget.open({
    url: `${url.protocol}//${url.host}`,
    credential,
  });
  registry.register(target);

  return PairOutputSchema.parse({
    target_id: target.id,
    siteurl: body.siteurl ?? `${url.protocol}//${url.host}`,
    username: body.username,
    capabilities: body.capabilities ?? [],
    companion_version: body.companion_version ?? "unknown",
    is_production: body.is_production ?? false,
    app_password_name: body.app_password_name ?? "wplab-pair-unknown",
    credential_stored: credentialStored,
  });
}

// Defensive: re-export a tiny helper that mints a fresh target_id-shaped string
// if RestTarget.open ever changes its id format. Kept private here so the
// schema check (regex /^tgt_/) catches mismatches at boundary instead of inside
// downstream tools.
export function _fakeTargetIdForTests(): string {
  return `tgt_${randomBytes(6).toString("hex")}`;
}
