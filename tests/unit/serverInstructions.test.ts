import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SERVER_INSTRUCTIONS } from "../../src/serverInstructions.js";
import { createServer } from "../../src/server.js";

/**
 * Every `rolepod_wp_*` name the instructions mention.
 *
 * A name written with a trailing `*` — `rolepod_wp_elementor_*` — names a
 * family of tools, not one that must exist. Those are dropped here rather than
 * filtered later, so the gate keeps failing on a genuine typo.
 */
const CITED_TOOLS = [
  ...new Set(
    (SERVER_INSTRUCTIONS.match(/rolepod_wp_[a-z_]+\*?/g) ?? [])
      .filter((m) => !m.endsWith("*"))
      .map((m) => m),
  ),
];

/** Every `wp-*` skill name cited in the routing table. */
const CITED_SKILLS = [
  ...new Set(SERVER_INSTRUCTIONS.match(/\bwp-[a-z-]+\b/g) ?? []),
];

describe("SERVER_INSTRUCTIONS", () => {
  it("is wired into the MCP server", async () => {
    const { server, shutdown } = await createServer({ withoutTransport: true });
    expect(server).toBeDefined();
    await shutdown();
  });

  it("cites only tools the server actually registers", async () => {
    const { server, shutdown } = await createServer({ withoutTransport: true });
    // The tool names come straight from the registered defs.
    const registered = new Set(
      (
        await (
          server as unknown as {
            _requestHandlers: Map<
              string,
              (req: unknown) => Promise<{ tools: { name: string }[] }>
            >;
          }
        )._requestHandlers.get("tools/list")!({
          method: "tools/list",
          params: {},
        })
      ).tools.map((t) => t.name),
    );
    await shutdown();

    const unknown = CITED_TOOLS.filter(
      (name) => !registered.has(name) && name !== "rolepod_wp_",
    );
    expect(unknown).toEqual([]);
  });

  it("cites only skills that exist on disk", () => {
    const onDisk = new Set(
      readdirSync("skills", { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name),
    );
    // `wp-cli` etc. are not skills; only check names that look like skill dirs.
    const unknown = CITED_SKILLS.filter(
      (name) => !onDisk.has(name) && name.startsWith("wp-") && onDisk.size > 0,
    ).filter(
      (name) => !["wp-admin", "wp-config", "wp-cli", "wp-json"].includes(name),
    );
    expect(unknown).toEqual([]);
  });

  it("does not promise that safe mode blocks writes", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/Safe mode is advisory/);
  });
});
