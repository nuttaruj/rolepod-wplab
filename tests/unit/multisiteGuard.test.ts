import { describe, expect, it, vi } from "vitest";
import { assertSingleSite } from "../../src/safety/multisiteGuard.js";
import type { Target } from "../../src/runtime/Target.js";

function fakeTarget(wpCli: Target["wpCli"]): Target {
  return {
    id: "tgt_multisite",
    kind: "local",
    siteurl: "https://network.test",
    wpVersion: "6.5",
    companion: null,
    wpCli,
    rootPath: () => "/srv/wp",
    close: vi.fn(),
  } as unknown as Target;
}

const result = (exitCode: number) => ({
  exitCode,
  stdout: "",
  stderr: "",
  durationMs: 1,
});

describe("assertSingleSite", () => {
  it("probes with `core is-installed --network`", async () => {
    const wpCli = vi.fn(async () => result(1));
    await assertSingleSite(fakeTarget(wpCli));
    expect(wpCli).toHaveBeenCalledWith(
      ["core", "is-installed", "--network"],
      expect.anything(),
    );
  });

  it("resolves on a single site (non-zero exit)", async () => {
    await expect(
      assertSingleSite(fakeTarget(vi.fn(async () => result(1)))),
    ).resolves.toBeUndefined();
  });

  it("throws MULTISITE_UNSUPPORTED on a network (exit 0)", async () => {
    await expect(
      assertSingleSite(fakeTarget(vi.fn(async () => result(0)))),
    ).rejects.toMatchObject({ code: "MULTISITE_UNSUPPORTED" });
  });

  it("fails closed when the probe cannot run", async () => {
    await expect(
      assertSingleSite(
        fakeTarget(
          vi.fn(async () => {
            throw new Error("COMPANION_REQUIRED_V0_2");
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: "MULTISITE_PROBE_FAILED" });
  });
});
