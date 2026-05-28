import { describe, it, expect } from "vitest";
import {
  checkRequireChain,
  isBootstrapPath,
  resolveRequirePath,
} from "../../src/lib/requireChain.js";

describe("isBootstrapPath", () => {
  it("matches theme functions.php / header.php / footer.php", () => {
    expect(isBootstrapPath("wp-content/themes/x/functions.php")).toBe(true);
    expect(isBootstrapPath("wp-content/themes/x-child/header.php")).toBe(true);
    expect(isBootstrapPath("wp-content/themes/x/footer.php")).toBe(true);
  });

  it("matches mu-plugins/*.php", () => {
    expect(isBootstrapPath("wp-content/mu-plugins/guardian.php")).toBe(true);
    expect(isBootstrapPath("wp-content/mu-plugins/a/b.php")).toBe(false); // not depth-1
  });

  it("matches wp-config.php", () => {
    expect(isBootstrapPath("wp-config.php")).toBe(true);
  });

  it("does not match arbitrary inc / assets / templates", () => {
    expect(isBootstrapPath("wp-content/themes/x/inc/setup.php")).toBe(false);
    expect(isBootstrapPath("wp-content/themes/x/assets/walnut.css")).toBe(false);
    expect(isBootstrapPath("wp-content/themes/x/template-parts/header/site-header.php")).toBe(false);
  });
});

describe("resolveRequirePath", () => {
  it("resolves quoted-only relative require", () => {
    expect(
      resolveRequirePath("wp-content/themes/x", "inc/setup.php"),
    ).toBe("wp-content/themes/x/inc/setup.php");
  });

  it("resolves __DIR__ . '/inc/setup.php' style (leading slash literal)", () => {
    expect(
      resolveRequirePath("wp-content/themes/x", "/inc/setup.php"),
    ).toBe("wp-content/themes/x/inc/setup.php");
  });

  it("collapses ../ segments", () => {
    expect(
      resolveRequirePath("wp-content/themes/x/_build", "../inc/setup.php"),
    ).toBe("wp-content/themes/x/inc/setup.php");
  });

  it("returns null for http(s) urls", () => {
    expect(
      resolveRequirePath("wp-content/themes/x", "https://example.com/a.php"),
    ).toBeNull();
  });

  it("returns null for absolute system paths under /home /var", () => {
    expect(
      resolveRequirePath("wp-content/themes/x", "/home/user/whatever.php"),
    ).toBeNull();
  });
});

describe("checkRequireChain", () => {
  function fakeTarget(existing: Set<string>) {
    return {
      fileExists(path: string): Promise<boolean> {
        return Promise.resolve(existing.has(path));
      },
    };
  }

  it("flags missing require_once that fatal'd walnutztudio", async () => {
    const content = `<?php
if ( ! defined( 'ABSPATH' ) ) exit;
define( 'WALNUTZTUDIO_DIR', get_stylesheet_directory() );
require_once WALNUTZTUDIO_DIR . '/inc/setup.php';
require_once WALNUTZTUDIO_DIR . '/inc/enqueue.php';
`;
    const result = await checkRequireChain(
      fakeTarget(new Set()),
      "wp-content/themes/x/functions.php",
      content,
    );
    expect(result.scanned).toBe(2);
    expect(result.missing).toHaveLength(2);
    expect(result.missing.map((m) => m.required_path)).toEqual([
      "/inc/setup.php",
      "/inc/enqueue.php",
    ]);
  });

  it("does not flag when all requires resolve", async () => {
    const existing = new Set([
      "wp-content/themes/x/inc/setup.php",
      "wp-content/themes/x/inc/enqueue.php",
    ]);
    const content = `<?php
require_once __DIR__ . '/inc/setup.php';
require_once __DIR__ . '/inc/enqueue.php';
`;
    const result = await checkRequireChain(
      fakeTarget(existing),
      "wp-content/themes/x/functions.php",
      content,
    );
    expect(result.scanned).toBe(2);
    expect(result.missing).toHaveLength(0);
  });

  it("skips dynamic requires it cannot statically resolve", async () => {
    const content = `<?php
$path = 'inc/' . $name . '.php';
require_once $path;
require_once get_template_directory() . $foo;
`;
    const result = await checkRequireChain(
      fakeTarget(new Set()),
      "wp-content/themes/x/functions.php",
      content,
    );
    // None of these has a literal *.php string suitable for static check.
    expect(result.scanned).toBe(0);
    expect(result.missing).toHaveLength(0);
  });

  it("handles include / include_once forms", async () => {
    const content = `<?php
include 'parts/header.php';
include_once 'parts/footer.php';
`;
    const result = await checkRequireChain(
      fakeTarget(new Set()),
      "wp-content/themes/x/functions.php",
      content,
    );
    expect(result.scanned).toBe(2);
    expect(result.missing).toHaveLength(2);
  });
});
