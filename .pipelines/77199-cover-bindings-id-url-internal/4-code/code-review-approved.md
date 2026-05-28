# Code Review

## Verdict: approved

## Batch scope

Tasks reviewed: Tasks 1–13 from `3-plan/code-plan.md`.

- Task 1: Add `role: "content"` to `core/cover`'s `id` attribute.
- Task 2: Create `lib/compat/wordpress-7.1/block-bindings.php` with allow-list filter, wire it into `lib/load.php`.
- Task 3: Add `gutenberg_cover_bindings_is_active` helper.
- Task 4: `render_block_data` filter to neutralise `useFeaturedImage` on bound covers.
- Task 5: Cover-scoped `render_block` filter with image-rewrite / dim-class-relax / strip-image helpers.
- Task 6: New hook — `useCoverBindingState`.
- Task 7: Single observer + derived values in `CoverEdit`.
- Task 8: Bound-cover empty-cover placeholder branch and `<img>`-forced non-empty render branch in `CoverEdit`.
- Task 9: Gate parallax/repeat in `inspector-controls.js`; gate `<MediaReplaceFlow>` in `block-controls.js`; gate line-750 `<CoverPlaceholder>`.
- Task 10: PHPUnit coverage in `phpunit/blocks/render-block-cover-test.php`.
- Task 11: Jest unit tests for `useCoverBindingState` and the single observer.
- Task 12: E2E — Pattern Overrides round-trip and unresolvable-binding affordance.
- Task 13: Backport-changelog stub and PR description draft.

## Summary

The batch lands internal-only Block Bindings support for `core/cover`'s `id` and `url`, headlined by Pattern Overrides, in 8 feature commits on the worktree branch (plus 4 test/docs commits). The server-side path is a single Cover-scoped file (`lib/compat/wordpress-7.1/block-bindings.php`) wired into `lib/load.php` with three filters: allow-list (`block_bindings_supported_attributes`), pre-render neutralisation of `useFeaturedImage` (`render_block_data` @ priority 10), and post-render markup rewrite (`render_block` @ priority 9). The client-side path introduces a single-`useSelect` hook (`useCoverBindingState`) and replaces the existing `[mediaUrl]` `useEffect` with a single source-agnostic observer keyed on `effectiveUrl`, using `useEffectEvent` for latest-value reads and a race-token ref for stale-resolution protection. UI gating in `inspector-controls.js`, `block-controls.js`, and the line-750 `<CoverPlaceholder>` call site is conditional-render-based per AC-14's literal-DOM-absence requirement. Tests are comprehensive: 9 new PHPUnit cases, 19 new Jest cases (43 total in `edit.js`, all green), and one e2e describe with five `test.step` phases covering the full Pattern Overrides round-trip plus an embed-video AC-21 control case and an unresolvable-binding affordance check. Lint passes cleanly on the touched files, PHP code style produces only the documented intentional `==` warning, and the byte-identical AC-20 PHPUnit case explicitly removes and re-adds both filters to lock the no-regression contract. DC-1 (single observer), DC-2 (no binding-state-triggered attribute mutation outside the documented DC-3 source-agnostic `setOverlayColor` carve-out + permitted `isDark` write), and DC-3 (source-agnostic derivation) all hold.

## Checks

| Check | Command | Result |
| ----- | ------- | ------ |
| JSON schema validity | `node -e "JSON.parse(require('fs').readFileSync('packages/block-library/src/cover/block.json','utf8'))"` | Pass — `block.json valid` |
| JS lint | `npm run lint:js packages/block-library/src/cover/` | Pass — 0 errors; 10 warnings pre-existing in `*.native.js` files outside this batch |
| Jest unit suite | `npm run test:unit -- packages/block-library/src/cover/test/edit.js` | Pass — 43/43 tests green (24 pre-existing + 19 new) |
| PHP lint/code style | `vendor/bin/phpcs lib/compat/wordpress-7.1/block-bindings.php phpunit/blocks/render-block-cover-test.php` | Pass — 0 errors; 3 warnings (1 intentional `==` per Design §6.1, 2 unused-param warnings for required filter signatures) |
| PHPUnit | `npx wp-env --config .wp-env.test.json run cli --env-cwd=wp-content/plugins/gutenberg -- composer run test -- --filter Tests_Blocks_Render_Cover` | Pass — 11/11 tests, 32 assertions (2 pre-existing + 9 new) |
| E2E syntactic validity | `node --check test/e2e/specs/editor/blocks/cover.spec.js` | Pass |
| `lib/load.php` wiring | `grep -n "wordpress-7.1" lib/load.php` | Pass — `require __DIR__ . '/compat/wordpress-7.1/block-bindings.php';` is present at line 83 |
| Diff against trunk | `git diff trunk...HEAD --stat -- '*.js' '*.php' '*.json'` | 8 production files; 2,581 insertions / 95 deletions |

## Behavior verification

The verification convention for this repo is JS unit + PHPUnit + E2E plus lint/code-style gates. All four ran:

- **PHPUnit** — `Tests_Blocks_Render_Cover` ran inside `wp-env-test` via the standard `composer run test --filter`. All 11 tests pass, including:
  - `test_bound_url_substitutes_in_plain_img_form` (AC-3) — bound URL appears in `src`, pre-existing saved URL removed, `wp-image-{id}` replaced.
  - `test_default_dim_ratio_class_is_relaxed` (AC-16, AC-25) — `has-background-dim-100` removed, `has-background-dim` preserved.
  - `test_non_default_dim_ratio_is_preserved` (AC-17) — `has-background-dim-70` survives untouched.
  - `test_parallax_saved_markup_is_rebuilt_as_img` (AC-19) — `<div>` form rebuilt as `<img>`, no `has-parallax`/`is-repeated` on the image, no `background-image:url()` CSS in the rebuilt element.
  - `test_mismatched_source_strips_image` (AC-6) — image element stripped on mismatched-source bindings.
  - `test_external_url_strips_image` (AC-5) — non-attachment id strips the image.
  - `test_use_featured_image_with_active_binding_emits_exactly_one_img_with_bound_url` (AC-18) — bound URL appears exactly once, featured-image URL absent, exactly one `wp-block-cover__image-background` survives.
  - `test_embed_video_short_circuits` (AC-21) — bound URL absent, `has-background-dim-100` survives.
  - `test_unbound_cover_is_byte_identical_to_trunk` (AC-20) — byte-identical output with and without both new filters.

- **Jest** — `packages/block-library/src/cover/test/edit.js` covers `useCoverBindingState` predicates (no-bindings shape, mismatched source, differing args, embed-video override, mismatched-source unresolvable, pending vs not-found vs wrong-type attachment), bound-cover render (unresolvable placeholder, force-`<img>` despite `hasParallax`/`isRepeated`, `effectiveUrl` reach when stored `url` is empty, dim-100 relaxation, embed-video inertness), control gating (parallax/repeat absence, MediaReplaceFlow absence), and the single-observer invariants (no DC-2 mutation, source-agnostic `getMediaColor` invocation for manual vs bound URL, single observer fire on mount). All 43 tests green.

## Issues

None.

## Notes

A few minor observations that did not rise to rejection but warrant a glance from future maintainers:

1. **Backport-changelog stub (Task 13)** is NOT present on the worktree branch HEAD. Trunk has commit `077b1f7a042` (`docs(backport): add cover bindings backport-changelog stub for 7.1`) creating `backport-changelog/7.1/TODO-cover-bindings.md`, but that commit is on `trunk` rather than the feature branch, so `git diff trunk...HEAD` does not include it. Per Design §2.2 (and Code Plan Task 13 phrasing), this file is a SHOULD that "Not a blocker for the Gutenberg PR landing" — Req 36 conditionally requires the entry "when the corresponding Core PR exists". AC-26 covers only the new compat file's location, which is satisfied. The PR-description text required by AC-27 is itself a PR-creation step rather than a code change.

2. **Embed-video edge case (`bindingUnresolvable` on bindings-configured embed-video covers).** `useCoverBindingState` returns `bindingActive=false` for embed-video covers (correct per AC-21), but `bindingUnresolvable` evaluates to `true` whenever the cover carries any cover-relevant binding configuration AND is not active — which includes the embed-video case. In practice this is moot because (a) the non-empty image branch is gated by `isImageBackground=false` for embed-video, (b) the empty-cover branch only fires when there is no `hasBackground` (and a normal embed-video cover has a `url` so `hasBackground=true`). Confirmed by the `leaves the embed-video render path engaged on a cover with bindings (binding is inert)` Jest test. The pathological "empty embed-video cover with bindings" state is not reachable through normal authoring flows. Worth a defensive gate (`backgroundType !== 'embed-video'` inside the `bindingUnresolvable` computation) if a regression ever surfaces here, but no fix needed for landing.

3. **PHPCS intentional warnings.** Two unused-param warnings on `gutenberg_cover_bindings_prepare_block( $parsed_block, $source_block, $parent_block )` and one loose-equality warning on the `args` comparison are expected: the filter signature is fixed by WP core's `render_block_data` callback contract, and the loose equality is documented in Design §6.1 / Code Plan Task 3 as the deliberate order-insensitive associative-array comparison that mirrors the JS-side `JSON.stringify` parity check.
