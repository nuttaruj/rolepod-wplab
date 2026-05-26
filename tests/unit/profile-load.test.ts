import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProfile } from "../../src/profile/load.js";

const SAVED_ENV = { ...process.env };

function clearEnv(): void {
  delete process.env["ROLEPOD_WPLAB_PROFILE"];
  delete process.env["ROLEPOD_WPLAB_PROD_HOSTS"];
  delete process.env["ROLEPOD_WPLAB_CONFIG"];
}

describe("profile/load", () => {
  let tmp: string;

  beforeEach(() => {
    clearEnv();
    tmp = mkdtempSync(join(tmpdir(), "wplab-prof-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    process.env = { ...SAVED_ENV };
  });

  it("defaults to strict profile + empty prod hosts when no env / file", () => {
    process.env["ROLEPOD_WPLAB_CONFIG"] = join(tmp, "missing.json");
    const cfg = loadProfile();
    expect(cfg.profile).toBe("strict");
    expect(cfg.production_hosts).toEqual([]);
    expect(cfg.companion.session_ttl_seconds).toBe(1800);
  });

  it("reads profile + production_hosts + default_target_path from JSON file", () => {
    const path = join(tmp, "profile.json");
    writeFileSync(
      path,
      JSON.stringify({
        profile: "personal",
        production_hosts: ["mysite.com", "*.client.com"],
        default_target_path: "/Users/me/Sites/wp",
      }),
    );
    process.env["ROLEPOD_WPLAB_CONFIG"] = path;
    const cfg = loadProfile();
    expect(cfg.profile).toBe("personal");
    expect(cfg.production_hosts).toEqual(["mysite.com", "*.client.com"]);
    expect(cfg.default_target_path).toBe("/Users/me/Sites/wp");
  });

  it("env ROLEPOD_WPLAB_PROFILE overrides the file value", () => {
    const path = join(tmp, "profile.json");
    writeFileSync(path, JSON.stringify({ profile: "personal" }));
    process.env["ROLEPOD_WPLAB_CONFIG"] = path;
    process.env["ROLEPOD_WPLAB_PROFILE"] = "power";
    const cfg = loadProfile();
    expect(cfg.profile).toBe("power");
  });

  it("env ROLEPOD_WPLAB_PROD_HOSTS overrides the file list", () => {
    const path = join(tmp, "profile.json");
    writeFileSync(
      path,
      JSON.stringify({ production_hosts: ["from-file.com"] }),
    );
    process.env["ROLEPOD_WPLAB_CONFIG"] = path;
    process.env["ROLEPOD_WPLAB_PROD_HOSTS"] = "env-a.com, env-b.com ,";
    const cfg = loadProfile();
    expect(cfg.production_hosts).toEqual(["env-a.com", "env-b.com"]);
  });

  it("falls back to defaults when JSON is malformed", () => {
    const path = join(tmp, "profile.json");
    writeFileSync(path, "{ this-is: NOT json }");
    process.env["ROLEPOD_WPLAB_CONFIG"] = path;
    const cfg = loadProfile();
    expect(cfg.profile).toBe("strict");
  });

  it("accepts power profile with companion config", () => {
    const path = join(tmp, "profile.json");
    writeFileSync(
      path,
      JSON.stringify({
        profile: "power",
        companion: { require_installed: true, session_ttl_seconds: 600 },
      }),
    );
    process.env["ROLEPOD_WPLAB_CONFIG"] = path;
    const cfg = loadProfile();
    expect(cfg.profile).toBe("power");
    expect(cfg.companion.require_installed).toBe(true);
    expect(cfg.companion.session_ttl_seconds).toBe(600);
  });
});
