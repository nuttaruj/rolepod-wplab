import { describe, expect, it } from "vitest";
import {
  CompanionRequiredError,
  ProductionBlockedError,
  TargetNotFoundError,
  WpCliBlockedError,
  WplabError,
} from "../../src/util/errors.js";
import { COMPANION_INSTALL_URL } from "../../src/companion/constants.js";
import { RestClient } from "../../src/runtime/restClient.js";

/**
 * A refusal that is really a redirect must name the way forward — the flag,
 * the tool, or the person who can lift it. A model that reads a bare "blocked"
 * gives up; one that reads "pass allow_destructive=true" retries correctly.
 * These pin the wording so a rewrite cannot quietly drop the path.
 */

describe("refusals name the way forward", () => {
  it("WPCLI_BLOCKED not_in_allowlist → allow_destructive=true", () => {
    const e = new WpCliBlockedError(
      ["plugin", "install", "x"],
      "not_in_allowlist",
    );
    expect(e.code).toBe("WPCLI_BLOCKED");
    expect(e.message).toMatch(/allow_destructive=true/);
    expect(e.message).toMatch(/plugin install x/);
    expect(e.meta).toMatchObject({ reason: "not_in_allowlist" });
  });

  it("WPCLI_BLOCKED never_allowed → execute_php for eval, a person for the rest", () => {
    const e = new WpCliBlockedError(["eval", "echo 1;"], "never_allowed");
    expect(e.message).toMatch(/rolepod_wp_execute_php/);
    expect(e.message).toMatch(/on any target/);
  });

  it("WPCLI_BLOCKED does not echo a huge payload back", () => {
    const e = new WpCliBlockedError(
      ["eval", "x".repeat(10_000), "a", "b", "c"],
      "never_allowed",
    );
    expect(e.message.length).toBeLessThan(11_000);
    expect(e.message).not.toMatch(/ a b c\./);
  });

  it("PRODUCTION_BLOCKED → who lifts it and how", () => {
    const e = new ProductionBlockedError(
      "https://shop.test",
      "shop.test (guarded mode)",
    );
    expect(e.code).toBe("PRODUCTION_BLOCKED");
    expect(e.message).toMatch(/shop\.test \(guarded mode\)/);
    expect(e.message).toMatch(/AI Full Control/);
    expect(e.message).toMatch(/ROLEPOD_WPLAB_PROD_HOSTS/);
  });

  it("TARGET_NOT_FOUND → reconnect", () => {
    const e = new TargetNotFoundError("tgt_dead0001");
    expect(e.message).toMatch(/rolepod_wp_connect_/);
    expect(e.message).toMatch(/tgt_dead0001/);
  });

  it("COMPANION_REQUIRED → install URL, pair, reconnect", () => {
    const e = new CompanionRequiredError("wp_seo_set", "tgt_abc00001");
    expect(e.code).toBe("COMPANION_REQUIRED");
    expect(e.message).toContain(COMPANION_INSTALL_URL);
    expect(e.message).toMatch(/rolepod_wp_pair/);
    expect(e.message).toMatch(/rolepod_wp_connect_rest/);
    expect(e.meta).toMatchObject({
      targetId: "tgt_abc00001",
      tool: "wp_seo_set",
      companion_install_url: COMPANION_INSTALL_URL,
    });
  });

  it("COMPANION_REQUIRED carries the tool's own reason when given", () => {
    const e = new CompanionRequiredError(
      "wp_menu_create",
      "tgt_abc00001",
      "uses execute-php for nav menu APIs",
    );
    expect(e.message).toMatch(/\(uses execute-php for nav menu APIs\)/);
  });

  it("REST_REQUIRES_HTTPS → https form or connect_local", () => {
    let caught: unknown;
    try {
      new RestClient({
        baseUrl: "http://example.com",
        credential: { username: "u", appPassword: "p" },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WplabError);
    expect((caught as WplabError).code).toBe("REST_REQUIRES_HTTPS");
    expect((caught as WplabError).message).toMatch(/https:\/\//);
    expect((caught as WplabError).message).toMatch(/rolepod_wp_connect_local/);
  });
});
