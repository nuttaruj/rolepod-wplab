# Contributing to rolepod-wplab

Thanks for your interest. This project is solo-maintained until v1.0; PRs are welcome but please open an issue first for anything beyond a small fix or doc tweak.

## License hygiene (non-negotiable)

By contributing you confirm the code is your own work or contributed under MIT. Do NOT paste code from any GPL/AGPL WordPress AI plugin or similar copyleft-licensed project. Per-file headers must NOT reference third-party source. Tool names must use the `rolepod_wp_*` namespace.

This keeps the codebase MIT-clean and free of copyleft contamination risk.

## Setup

```bash
git clone https://github.com/nuttaruj/rolepod-wplab.git
cd rolepod-wplab
npm install
npm run build
npm test
```

## Code quality gates

Every PR must pass:

- `npm run typecheck` — TypeScript strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`.
- `npm run build` — tsup ESM build clean.
- `npm test` — all unit + smoke tests green.
- `npm run drift` — the skills and README cite no tool or parameter that does
  not exist, and no new tool ships undocumented. A new tool must either be
  documented in a skill or added to `tests/unit/undocumented-tools.allowlist.ts`,
  which is shrink-only: once a tool is documented, its entry must come out.
- `npx oxlint src tests/unit tests/smoke` — 0 warnings.
- `npx prettier --check "src/**/*.ts" "tests/unit/**/*.ts" "tests/smoke/**/*.ts"` — formatted.
- `claude plugin validate ./ --strict` — plugin manifest valid.

CI runs all of the above on Node 20+22 × ubuntu+macos.

## Adding a new MCP tool

1. Schema in `src/schema/tools.ts` (zod input + output).
2. Handler in `src/tools/atomic/` or `src/tools/composite/` or `src/tools/adapter/` or `src/tools/companion/` (pick by category).
3. Register in `src/tools/registerTools.ts`.
4. Update assert list in `tests/smoke/mcp-handshake.test.ts`.
5. Add at least one unit test covering happy path + 1 error path.
6. Update CHANGELOG `## [Unreleased]` section.

## Adding a new adapter (W-023)

1. New dir `src/adapters/<slug>/` with `read.ts` (mandatory) + optional `write.ts`.
2. Implements `Adapter<TRead, TWrite?>` from `src/adapters/_contract.ts`.
3. Detection must work on RestTarget (REST routes probe) AND shell-capable targets (wp-cli `plugin is-active`).
4. supportedRange field locks tested plugin version window.
5. Expose via a tool in `src/tools/adapter/wp_<slug>_read.ts` (+ write tool if applicable).

## Adding a companion endpoint (rolepod-wplab-companion repo)

Goes in the sibling repo. Each endpoint must:
- Check `Config::endpointsEnabled()` first.
- Verify `current_user_can('manage_options')`.
- Require session token (verify via `SessionToken::verify`).
- AST-screen any executable payload (`AstScreen::screen`).
- Enforce `ProductionGuard::matchedPattern()` for destructive ops.
- Write `Log::append` for every call (success + rejection).

## Releasing — version-pair convention across two repos

rolepod-wplab ships as **two coordinated repos**:

| Repo | Role | Ships as |
|---|---|---|
| `rolepod-wplab` (this repo) | Node MCP server + skills | npm: `@rolepod/wplab` + Claude Code marketplace |
| `rolepod-wp` (sibling) | WordPress arm of the Rolepod ecosystem (PHP plugin) | `releases/latest/download/rolepod-wp.zip` |

The cross-component contract is locked in `src/companion/constants.ts`:

- **`COMPANION_PLUGIN_SLUG`** = `rolepod-wp` — WP plugin slug + release-asset filename root.
- **`COMPANION_REPO_URL`** = `https://github.com/nuttaruj/rolepod-wp`.
- **`COMPANION_INSTALL_URL`** — stable release-asset URL (no version suffix). The sibling repo's `scripts/build-zip.sh` and `.github/workflows/release.yml` are responsible for keeping that asset present on every tagged release.
- **`MIN_COMPANION_VERSION`** — the floor plugin version this MCP build is known to work with. Bump it the moment MCP starts depending on a new endpoint, capability flag, or response field.

### Release rules

1. **Coupled features (new endpoint, new capability, new response field) → tag both repos together.** Same semver level (`wplab v1.x.0` ⇄ `companion v1.x.0`). Bump `MIN_COMPANION_VERSION` in the MCP and release MCP **after** the companion tag is live, so the stable install URL already serves the new zip when MCP guidance points to it.
2. **Independent patches (bug fix or doc change confined to one side) → tag only that side.** No need to bump the other repo; `MIN_COMPANION_VERSION` stays put. The version-compat check in `wp_pair` is forward-compatible: a newer companion is always accepted.
3. **Never** ship MCP that depends on a not-yet-released companion. Verify the new zip is reachable at the stable URL before publishing the npm release.
4. **CHANGELOG entries on both sides must cross-reference the matched version** in coupled releases (e.g., wplab `## v1.3.0 — companion ≥ 1.3.0`).

### Memory note

Two-repo split is deliberate (parallel dev tracks, independent CI cadence). Do **not** propose monorepo restructure without an explicit maintainer ask — it has been considered and rejected.

## Single-backend rule

Shipped skills under `skills/` call ONLY `rolepod_wp_*` tools — never raw wp-cli shell, third-party MCP servers, or any other backend. If a skill cannot accomplish its task with wplab tools, return a structured failure and let the caller decide; do not silently degrade.

## DCO sign-off

Sign commits with `git commit -s`. By signing, you certify per [Developer Certificate of Origin 1.1](https://developercertificate.org/) that you have the right to submit the code.

## Issues

Use the issue tracker for bugs and feature requests. Security issues go via `SECURITY.md`, NOT in public issues.
