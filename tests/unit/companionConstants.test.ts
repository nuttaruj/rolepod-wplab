import { describe, it, expect } from "vitest";
import {
  COMPANION_INSTALL_URL,
  COMPANION_PLUGIN_SLUG,
  COMPANION_REPO_URL,
  MIN_COMPANION_VERSION,
  compareVersions,
  isCompanionTooOld,
  setupWizardUrlFor,
} from "../../src/companion/constants.js";

describe("companion/constants", () => {
  it("plugin slug + repo URL reflect the rolepod-wp rename", () => {
    expect(COMPANION_PLUGIN_SLUG).toBe("rolepod-wp");
    expect(COMPANION_REPO_URL).toBe("https://github.com/nuttaruj/rolepod-wp");
  });

  it("install URL points at the latest-download alias", () => {
    expect(COMPANION_INSTALL_URL).toBe(
      `${COMPANION_REPO_URL}/releases/latest/download/rolepod-wp.zip`,
    );
  });

  it("compareVersions handles equal, less, greater, and length mismatch", () => {
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.0", "1.2.1")).toBe(-1);
    expect(compareVersions("1.3.0", "1.2.9")).toBe(1);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("2.0", "1.9.99")).toBe(1);
  });

  it("isCompanionTooOld is false on unknown / empty (avoid false positives)", () => {
    expect(isCompanionTooOld(undefined)).toBe(false);
    expect(isCompanionTooOld("")).toBe(false);
    expect(isCompanionTooOld("unknown")).toBe(false);
  });

  it("isCompanionTooOld returns true only below MIN_COMPANION_VERSION", () => {
    expect(MIN_COMPANION_VERSION).toBe("2.0.0");
    expect(isCompanionTooOld(MIN_COMPANION_VERSION)).toBe(false);
    expect(isCompanionTooOld("1.2.0")).toBe(true);
    expect(isCompanionTooOld("99.0.0")).toBe(false);
  });

  it("setupWizardUrlFor strips trailing slash and appends new admin path", () => {
    expect(setupWizardUrlFor("https://example.com/")).toBe(
      "https://example.com/wp-admin/tools.php?page=rolepod-wp-setup",
    );
    expect(setupWizardUrlFor("https://example.com")).toBe(
      "https://example.com/wp-admin/tools.php?page=rolepod-wp-setup",
    );
  });
});
