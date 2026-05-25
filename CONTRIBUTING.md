# Contributing to rolepod-wplab

Thanks for your interest. This project is solo-maintained until v1.0; PRs are welcome but please open an issue first for anything beyond a small fix or doc tweak.

## Clean-room from a third-party plugin (W-002 — non-negotiable)

By contributing you confirm you have **NOT read the a third-party plugin PHP source**. We rely on public docs + the published feature list only. Per-file headers must NOT reference a third-party plugin code. Tool names must NOT match a third-party plugin's (`execute-php` etc. — we use `rolepod_wp_execute_php`).

This rule keeps the codebase MIT-clean and avoids AGPL contamination risk.

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

## Single-backend rule (W-011)

Shipped skills under `skills/` call ONLY `rolepod_wp_*` tools — never a third-party plugin, raw wp-cli shell, or any other backend. If a skill cannot accomplish its task with wplab tools, return a structured failure and let the caller decide; do not silently degrade.

## DCO sign-off

Sign commits with `git commit -s`. By signing, you certify per [Developer Certificate of Origin 1.1](https://developercertificate.org/) that you have the right to submit the code.

## Issues

Use the issue tracker for bugs and feature requests. Security issues go via `SECURITY.md`, NOT in public issues.
