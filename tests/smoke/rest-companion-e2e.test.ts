/**
 * Opt-in E2E smoke test for the RestTarget + companion path.
 *
 * Why this exists: Round 6 produced 7 production bugs (R6-1 → R6-7) because
 * the RestTarget + companion code path was never executed against a real
 * WordPress install before shipping. Unit tests covered schema validation
 * + local target only. Each adapter write helper had a shell-only gate that
 * silently rejected `target.kind === "rest"` until the customer hit it.
 *
 * This test simulates that path against a real site so the next R6-style
 * bug is caught in CI / pre-commit, not on a customer site.
 *
 * **Skipped by default.** Set these env vars to opt in:
 *   - WPLAB_TEST_URL           https URL of a throwaway WP install
 *   - WPLAB_TEST_USERNAME      WP user login (not email)
 *   - WPLAB_TEST_APP_PASSWORD  WP Application Password
 *
 * The test installs + uninstalls Elementor, creates + deletes a draft page,
 * and writes + verifies `_elementor_data`. The site must be a demo /
 * throwaway, not a production install.
 */

import { describe, it, expect } from "vitest";
import { RestTarget } from "../../src/runtime/RestTarget.js";
import { elementorWrite } from "../../src/adapters/elementor/write.js";
import type { Credential } from "../../src/credentials/types.js";

const URL_ENV = process.env.WPLAB_TEST_URL;
const USER_ENV = process.env.WPLAB_TEST_USERNAME;
const PASS_ENV = process.env.WPLAB_TEST_APP_PASSWORD;

const enabled = Boolean(URL_ENV && USER_ENV && PASS_ENV);

describe.skipIf(!enabled)("RestTarget + companion E2E", () => {
  it(
    "elementor_write round-trip on a real RestTarget+companion",
    { timeout: 60_000 },
    async () => {
      const url = URL_ENV!;
      const host = new URL(url).hostname;
      const credential: Credential = {
        site: host,
        username: USER_ENV!,
        appPassword: PASS_ENV!,
        addedAt: new Date().toISOString(),
      };
      const target = await RestTarget.open({ url, credential });
      expect(target.kind).toBe("rest");
      expect(target.companion?.enabled).toBe(true);

      // Install Elementor (idempotent — wp-cli no-ops if already active).
      const install = await target.wpCli(
        ["plugin", "install", "elementor", "--activate"],
        { allowDestructive: true, timeoutMs: 60_000 },
      );
      expect(install.exitCode).toBe(0);

      // Create draft page.
      const createRes = await target.rest({
        method: "POST",
        path: "/wp/v2/pages",
        body: {
          title: "wplab-smoke-elementor",
          status: "draft",
          content: "<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->",
        },
      });
      expect(createRes.status).toBeGreaterThanOrEqual(200);
      expect(createRes.status).toBeLessThan(300);
      const postId = (createRes.body as { id: number }).id;
      expect(typeof postId).toBe("number");

      try {
        const tree = [
          {
            id: "s1",
            elType: "section",
            settings: {
              background_background: "classic",
              background_color: "#0f3460",
            },
            elements: [
              {
                id: "c1",
                elType: "column",
                settings: { _column_size: 100 },
                elements: [
                  {
                    id: "h1",
                    elType: "widget",
                    widgetType: "heading",
                    settings: {
                      title: "smoke-elementor",
                      align: "center",
                    },
                  },
                ],
              },
            ],
          },
        ];

        const result = await elementorWrite.updatePageData(target, postId, tree);
        expect(result.bytesWritten).toBeGreaterThan(0);

        // Verify meta persisted — read via wp-cli (PHP-serialized).
        const verify = await target.wpCli([
          "post",
          "meta",
          "get",
          String(postId),
          "_elementor_data",
        ]);
        expect(verify.exitCode).toBe(0);
        expect(verify.stdout).toContain("#0f3460");
        expect(verify.stdout).toContain("smoke-elementor");
      } finally {
        // Cleanup — best-effort.
        await target
          .wpCli(["post", "delete", String(postId), "--force"], {
            allowDestructive: true,
          })
          .catch(() => undefined);
      }
    },
  );
});
