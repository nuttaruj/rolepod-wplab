/**
 * Sent to the MCP client once, at initialize. This is the only place the
 * server can teach a model how to use ~130 tools before it starts guessing.
 *
 * Every claim here must be true of the current code. A rule that overstates a
 * protection is worse than no rule, because it licenses the model to skip a
 * check it thinks the server already made.
 */
export const SERVER_INSTRUCTIONS = `rolepod-wplab drives real WordPress installs. Changes land on a live site.

## Start here

1. Connect first — every other tool needs a \`target_id\`.
   Local install → \`rolepod_wp_connect_local\`. Live site already paired →
   \`rolepod_wp_connect_rest\`. SSH and Docker have their own connect tools.

   **Live site, first time → lead with the plugin, not credentials.** Walk the
   user through it and give them the pieces directly:
   1. Install the Rolepod for WordPress plugin (stable URL, always latest):
      https://github.com/nuttaruj/rolepod-wp/releases/latest/download/rolepod-wp.zip
      (WP admin → Plugins → Add New → Upload Plugin → Activate)
   2. Open WP admin → Tools → Rolepod WP Setup → Quick start → Generate pair
      token, and paste the prompt block back into this chat.
   3. You then call \`rolepod_wp_pair\` with the token — it mints and stores the
      Application Password automatically. No manual credential steps.
   A manually created Application Password (profile.php) is the LAST resort —
   offer it only when the plugin cannot be installed (no plugin-install rights,
   host blocks uploads) or the user explicitly declines the plugin.
2. Then \`rolepod_wp_health_check\`. Read its \`prod_guard\` field before writing.
3. \`rolepod_wp_memory_recall\` + \`rolepod_wp_conventions_get\` carry context from
   earlier sessions on this site. \`rolepod_wp_skill_catalog\` lists the workflow
   guides below.

## Which skill covers what

| Task | Skill |
|---|---|
| First connect, credentials, aliases | wp-connect, wp-pair-setup |
| Posts, pages, media, taxonomies, ACF/Woo/forms | wp-content |
| Page builders (Elementor, Bricks, Divi, Oxygen), global styles | wp-edit-design |
| Themes, child themes, safe theme switches | wp-edit-theme |
| Plugins, mu-plugins, wp-config | wp-edit-plugin |
| Arbitrary PHP through the companion | wp-execute-php |
| Site is broken, WSOD, fatal | wp-recovery first, then wp-health-check, wp-changes |
| One surface 500s while the rest of the site is 200 — REST only, admin-ajax only, one admin screen | wp-recovery. A partial fatal is still a fatal, and the guardian recorded it |
| Slow, buggy, or suspicious site | wp-diagnose |
| Reading the live object graph (hooks, post types, options) | wp-introspect |
| Moving a site or its data | wp-migrate |
| New plugin, theme, block, pattern, CPT | wp-scaffold |
| Undoing what the AI just did | wp-changes |

Read the skill before a multi-step change. \`rolepod_wp_skill_get\` returns it.

## Rules that hold everywhere

**Read what already recorded the failure before you change anything.** Climb
this ladder and stop at the first rung that answers the question. Each rung
costs more and risks more than the one above it.

1. **Evidence that already exists** — free, read-only, no side effects.
   \`rolepod_wp_recovery_status\` is the one people forget: the guardian
   mu-plugin records every fatal with its class, file and line, and keeps
   answering while the main plugin is dead. Then \`rolepod_wp_health_check\`,
   \`rolepod_wp_changes_query\`, \`rolepod_wp_memory_recall\`. A fataling site has
   usually already written down exactly what broke.
2. **Observation** — read-only probes that narrow the blast radius. Which
   surfaces fail and which do not (front end, wp-admin, admin-ajax, REST, and a
   REST namespace that does not exist) localises a fault far faster than
   reasoning about which component "should" own it.
3. **Read the configuration** — \`rolepod_wp_option_get\`,
   \`rolepod_wp_introspect\`, \`rolepod_wp_file_read\`. Still no writes.
4. **Isolation scoped to you** — a troubleshooting mode that disables plugins
   for your session only. Visitors see nothing change.
5. **Reversible site-wide change** — deactivating a plugin, flipping an option.
   Say what you are about to do and why, and undo it the moment the test
   answers. Expect side effects you did not plan: deactivating a security
   plugin can invalidate your own admin session and leave you unable to put it
   back.
6. **Anything harder to undo** — confirm with the user first.

Never open at rung 5. Deactivating a live plugin to test a hypothesis, before
reading the fatal the site already recorded, is how an afternoon gets spent
proving the wrong thing.

**Never ask a human to log in for you — walk down this ladder.** When a task
needs a wp-admin screen (auditing the admin UI, reading a settings page,
reproducing an admin-only bug), call \`rolepod_wp_admin_one_time_link\` and open
the URL it returns:

1. **rolepod-uiproof**, if the user has it — \`browser_open\` with the URL. This
   is the intended pair and needs nothing else.
2. **Any other browser automation on this machine** — a Chrome-extension MCP, a
   Playwright or Puppeteer MCP, anything at all that can open a URL. Nothing
   about the link is uiproof-specific; it is a plain URL, so a missing uiproof
   blocks nothing. Look at the tools you actually have before giving up.
3. **A human, last.** Only when this machine has no browser automation at all.

**Say which rung you are on.** On 1 or 2, tell the user you are handling the
admin step yourself and they do not need to log in — otherwise they sit waiting
for a prompt that is never coming, which is exactly the failure this rule
exists to stop. On 3, say plainly that no browser automation is available here,
so this one step needs them, and hand over the link with what it opens.

WordPress sets the auth cookie on whichever browser context opened the URL, so
every later navigation in that same session stays signed in as the admin. The
token is single-use and expires in 5 minutes — re-mint if the context is
recreated (a close, a crash, a new run); that is not a failure to report.

Two things to say out loud whenever you use it. Whoever opens the URL holds a
full admin session. And anything recorded during that session is at least an
internal artifact: recent uiproof scrubs cookies from HARs and traces on a
best-effort basis, but nothing scrubs page bodies, DOM snapshots or
screenshots, and a saved storage-state file IS the session. Check an artifact
before sharing it; never attach one to a public issue or PR on the assumption
it was scrubbed.

**A guarded site is the owner's choice — asking for Full Access is a protocol,
not a sentence.** When a task hits \`FULL_ACCESS_REQUIRED\` (or needs
\`execute_php\` and the companion does not advertise it), do not just say
"enable the toggle". Tell the user what needs it and why, warn them in plain
words that ON means the AI gets full control of a live site (PHP execution,
file writes, destructive wp-cli), and offer \`rolepod_wp_backup_create\` FIRST —
it works in guarded mode, so the backup exists before the power surface opens.
Remind them they can turn it back OFF when the task is done.

**The production guard is only as good as its signal.** \`prod_guard.armed=false\`
does not mean the target is safe to write — it means nobody told the server
otherwise. \`health_check\` says why. An unset \`WP_ENVIRONMENT_TYPE\` leaves the
guard disarmed on purpose, because WordPress reports "production" for every
unconfigured install.

**Elementor data is a JSON string inside a meta value, and it is escaped twice.**
Never touch \`_elementor_data\` through \`rolepod_wp_execute_php\` or a raw meta
write. Use \`rolepod_wp_elementor_read\` / \`_write\` / \`_section\`, which handle the
encoding. The same applies to Bricks (\`_bricks_page_content_2\`), Divi, and
Oxygen — each has its own read/write pair.

**\`rolepod_wp_db_query\` runs a single read statement by default.** Stacked
statements are refused. Set \`allow_write=true\` deliberately, never to "see if it
works".

**\`db reset\`, \`db drop\`, \`db clean\` and \`core multisite-convert\` are refused for
every caller, on every target kind.** There is no flag that unlocks them. Do not
route around this with \`rolepod_wp_execute_php\`.

**Writes made through the companion are reversible; writes made any other way are
not.** \`rolepod_wp_changes_query\` lists what was recorded, \`_toggle\` undoes one
change, \`_panic\` undoes the session. A change with \`reversible: 0\` cannot be
undone by this server — say so before making it.

**Safe mode is advisory on the released companion.** \`rolepod_wp_recovery_safe_mode\`
sets a flag that only media optimization currently honours. It does not stop
execute-php, file writes, or wp-cli. Stopping is your job.

## When something breaks

\`rolepod_wp_recovery_status\` first — the guardian mu-plugin survives a fatal that
takes the main plugin down. \`rolepod_wp_recovery_disable_plugin\`,
\`_disable_file\`, and \`_restore_file\` work without WordPress loading. Do not
attempt a fix through the REST API on a site that is throwing a fatal; it is not
listening.

## Reporting

Report what happened, including what failed. A tool that returned
\`probe_failed\`, \`manual_required\`, or an empty result did not do the thing. Say
that, rather than describing the intended effect.
`;
