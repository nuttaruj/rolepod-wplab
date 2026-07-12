# Known limitations — third-party plugin write surfaces

The remediation audit hardened every tool that touches WordPress core or a
plugin whose storage this project can verify. A small set of **write** surfaces
remain deliberately un-built because building them correctly requires a live
install of the specific plugin to verify its storage model / API first. Guessing
that storage is exactly the wrong-data bug class the audit exists to remove —
so these fail LOUDLY and honestly today rather than shipping guessed writes.

## Current honest behavior (already shipped)

| Surface                                             | Behavior today                                                                                                                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oxygen `ct_builder_json` (Oxygen 4.0+)              | `oxygen_write` writes `ct_builder_shortcodes`, **detects** a `ct_builder_json` tree, and returns `ct_builder_json_present` + a loud `note` to re-save in the Oxygen editor. Writing the JSON tree directly is unsupported.          |
| Forms (CF7 / WPForms / Fluent / Ninja / Formidable) | `forms_write` throws `FORMS_ENGINE_UNSUPPORTED_WRITE` for any non-Gravity engine — it does not guess their entry storage.                                                                                                           |
| Pods / Meta Box / JetEngine fields                  | Writes go through the core `/wp/v2/posts` meta endpoint and are **read-back verified**: a field on custom-table / group / non-standard storage returns `verified:false` + `unverified_fields` + a note instead of a silent success. |
| Multisite (everywhere applicable)                   | Loud `MULTISITE_UNSUPPORTED` rather than a half-working path.                                                                                                                                                                       |

## Requires a live install to complete safely

Each item below needs a staging WordPress with the named plugin so the exact
storage / API can be verified BEFORE an adapter is written. The verification
step is listed so the work is executable the moment an environment is available.

- **Elementor global "kit" (WS12-T4/T5).** Verify: `get_option('elementor_active_kit')` → the kit post id; confirm the settings live in that post's `_elementor_page_settings` meta and capture the exact key names for global colors / fonts / typography before any write. A wrong key corrupts site-wide global styles.
- **Oxygen `ct_builder_json` write (WS12-T3 write half).** Verify: the JSON tree schema Oxygen 4.0+ persists in `ct_builder_json` and how it is kept in sync with `ct_builder_shortcodes`, so a write updates both consistently.
- **Pods custom-table fields.** Verify: for a given Pod, whether "Store data" is meta-based or table-based, and (if table-based) the generated table + column names from the Pod's config — so a write targets the right store instead of writing an ignored postmeta row.
- **Polylang (WS14).** Verify: the `pll_language` taxonomy assignment + the translation-group relationship storage, so linking translations doesn't orphan or mis-group posts.
- **WPML translation rewrite (WS14, breaking).** Verify: the `icl_translations` table shape + WPML's element-type keys, so a rewrite doesn't corrupt translation state. Needs an active WPML licence to test.
- **Meta Box groups / clones + JetEngine non-standard fields.** Verify: the actual meta key layout a group/clone/relational field uses, so the write reaches the value the plugin reads.

## Principle

> Do not guess a third-party plugin's storage or API. A write that lands on the
> wrong key returns HTTP 200 and looks successful while changing nothing (or
> corrupting adjacent data) — the precise failure this audit was commissioned to
> eliminate. Until the storage is verified against a live install, the honest
> behavior is a loud, typed refusal or a read-back-verified result, never a
> guessed write.
