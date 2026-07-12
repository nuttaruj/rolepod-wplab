import { beforeEach, describe, expect, it, vi } from "vitest";
import { wpMigrateDataHandler } from "../../src/tools/composite/wp_migrate_data.js";
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

type Cli = ReturnType<typeof vi.fn>;

function makeTarget(id: string, siteurl: string, wpCli: Cli) {
  return { id, kind: "rest", siteurl, companion: { enabled: true }, wpCli };
}

function harness() {
  const srcCli = vi.fn(async (args: readonly string[]) => {
    // `option get <name> --format=json` → JSON-encoded value.
    if (args[0] === "option" && args[1] === "get") {
      return { exitCode: 0, stdout: '"the-value"', stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  });
  const dstCli = vi.fn(async () => ({
    exitCode: 0,
    stdout: "Success",
    stderr: "",
  }));
  const source = makeTarget("tgt_src00001", "https://source.test", srcCli);
  const dest = makeTarget("tgt_dst00001", "https://dest.test", dstCli);
  const registry = {
    get: (id: string) => (id === source.id ? source : dest),
  } as unknown as TargetRegistry;
  return { registry, srcCli, dstCli };
}

beforeEach(() => vi.clearAllMocks());

describe("wp_migrate_data — options scope (WS13-T8)", () => {
  it("copies named options source → dest, serialized-safe via JSON", async () => {
    const { registry, srcCli, dstCli } = harness();
    const out = await wpMigrateDataHandler(registry, new ProdGuard([]), {
      source_target_id: "tgt_src00001",
      dest_target_id: "tgt_dst00001",
      scope: "options",
      options: ["blogdescription", "timezone_string"],
      allow_destructive: true,
    });

    // Read with --format=json (serialized-safe round trip).
    expect(srcCli).toHaveBeenCalledWith([
      "option",
      "get",
      "blogdescription",
      "--format=json",
    ]);
    // Write the JSON value straight through, allowDestructive.
    expect(dstCli).toHaveBeenCalledWith(
      ["option", "update", "blogdescription", '"the-value"', "--format=json"],
      { allowDestructive: true },
    );
    expect(out.applied).toEqual([
      { action: "option_set", option: "blogdescription", ok: true },
      { action: "option_set", option: "timezone_string", ok: true },
    ]);
  });

  it("refuses URL/identity options and writes nothing", async () => {
    const { registry, dstCli } = harness();
    await expect(
      wpMigrateDataHandler(registry, new ProdGuard([]), {
        source_target_id: "tgt_src00001",
        dest_target_id: "tgt_dst00001",
        scope: "options",
        options: ["blogdescription", "siteurl"],
        allow_destructive: true,
      }),
    ).rejects.toMatchObject({ code: "OPTION_MIGRATE_URL_REFUSED" });
    expect(dstCli).not.toHaveBeenCalled();
  });

  it("requires a non-empty options list", async () => {
    const { registry } = harness();
    await expect(
      wpMigrateDataHandler(registry, new ProdGuard([]), {
        source_target_id: "tgt_src00001",
        dest_target_id: "tgt_dst00001",
        scope: "options",
        allow_destructive: true,
      }),
    ).rejects.toMatchObject({ code: "OPTIONS_LIST_REQUIRED" });
  });

  it("reports ok:false for an option the source lacks", async () => {
    const { registry, srcCli } = harness();
    srcCli.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "could not get option",
    });
    const out = await wpMigrateDataHandler(registry, new ProdGuard([]), {
      source_target_id: "tgt_src00001",
      dest_target_id: "tgt_dst00001",
      scope: "options",
      options: ["nope"],
      allow_destructive: true,
    });
    expect(out.applied[0]).toMatchObject({
      action: "option_set",
      option: "nope",
      ok: false,
    });
  });

  it.each(["users", "posts"] as const)(
    "rejects scope=%s as MIGRATE_SCOPE_UNSUPPORTED",
    async (scope) => {
      const { registry, dstCli } = harness();
      await expect(
        wpMigrateDataHandler(registry, new ProdGuard([]), {
          source_target_id: "tgt_src00001",
          dest_target_id: "tgt_dst00001",
          scope,
          allow_destructive: true,
        }),
      ).rejects.toMatchObject({ code: "MIGRATE_SCOPE_UNSUPPORTED" });
      expect(dstCli).not.toHaveBeenCalled();
    },
  );
});
