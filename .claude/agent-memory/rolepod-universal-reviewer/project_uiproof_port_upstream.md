---
name: uiproof-port-upstream
description: Shared tooling (e.g. scripts/install-opencode.sh + its test) is authored in the sibling repo rolepod-uiproof first, then ported to rolepod-wplab — review ports as renames against the original.
metadata:
  type: project
---

Cross-repo tooling in this ecosystem lands in `rolepod-uiproof` first and is
ported here afterwards. Checkout lives outside this repo at
`/Users/nuttaruj/Project/rolepod-uiproof` (sibling of
`/Users/nuttaruj/Project/rolepod-wplab`). First observed port: commit 846a8ef
(2026-09-22) — `scripts/install-opencode.sh` + its unit test from uiproof 0.22.0.

**Why:** uiproof ships and verifies the script there, so the wplab copy is a
rename-only port, not new logic. Known intended deltas for this pair: server
`rolepod-wplab`, package `@rolepod/wplab`, spec `@latest` (this repo pins
nothing — no version-lockstep test, unlike uiproof), a trailing `serve` argument
on both the npx and local-build commands, `ROLEPOD_WPLAB_*` env vars, backup
suffix `.rolepod-wplab-bak`, and prettier-wrapped test files (uiproof's are not).

**How to apply:** review such a port by diffing against the uiproof original and
hunting rename slips (leftover "uiproof", wrong env var, missing `serve`, wrong
catalog regex / backup suffix) rather than re-reviewing the logic. The reverse
direction may also happen — check both checkouts before calling something novel.
