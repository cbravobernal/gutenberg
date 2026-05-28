# Design Doc Review

## Verdict: rejected

## Summary

Iter-2 resolves every one of the eleven iter-1 findings explicitly: the non-existent Tag-Processor byte-offset accessors are replaced by `preg_match` + `substr` splice (iter-1 Issue 1); the empty-cover branch is gated in `index.js` so `cover-placeholder.js` no longer needs editing, and the line-750 `<CoverPlaceholder>` is correctly carried by `disableMediaButtons` (iter-1 Issues 2 + 4); the first-pass `useFeaturedImage` injection is intercepted via a `render_block_data` filter that mutates `$parsed_block['attrs']['useFeaturedImage']` BEFORE `WP_Block::__construct`, and the propagation has been verified against `wp-includes/class-wp-block.php:127-236, 520-596` and `wp-includes/blocks.php:2398-2436` (iter-1 Issue 3); the i18n string is named the primary test-observable contract with `data-testid` as a secondary stability hook (iter-1 Issue 5); `<MediaReplaceFlow>` is kept in the DOM with embed-video access preserved (iter-1 Issue 6); the race-token ref is now declared explicitly at component top with rationale (iter-1 Issue 7); the `useSelect` is now a single-closure read of source + attachment record (iter-1 Issue 8); AC-26/27/28 are explicitly traced in §12 (iter-1 Issue 9); the renamed `gutenberg_cover_bindings_is_active` is defined alongside its expansion logic (iter-1 Issue 10); the backport-changelog timing is settled (iter-1 Issue 11).

However, iter-2 introduces a **blocker defect** in the gating mechanism for `<MediaReplaceFlow>`. The design's central claim — that setting `onSelect=undefined` removes the upload / "Open Media Library" menu items — does not match the actual `<MediaReplaceFlow>` source. Those menu items render unconditionally; only the `onSelect` callback path is undefined, which would crash at runtime if a user clicks them. This breaks AC-14 (the e2e test as designed will fail because the menu items remain in the DOM) and turns the design's centerpiece UI-gating mechanism into a runtime crash hazard. Three smaller defects compound this. Detailed below.

## Issues

### Issue 1 (blocker): `<MediaReplaceFlow>` `onSelect=undefined` does NOT remove "Open Media Library" / "Upload" menu items

**What's wrong:** §5.5 asserts that setting `onSelect={ bindingActive ? undefined : onSelectMedia }` removes the media-replace menu items from the dropdown:

> "`MediaReplaceFlow` (verified at `packages/block-editor/src/components/media-replace-flow/`) renders the 'Use featured image' toggle ONLY when `onToggleFeaturedImage` is a function; setting it to `undefined` removes that menu item from the dropdown. **Same for `onSelect` (the upload + media-library buttons short-circuit when `onSelect` is falsy)**."

Verified against `packages/block-editor/src/components/media-replace-flow/index.js`:

- Line 233 — "Use featured image" `<MenuItem>` IS gated on `onToggleFeaturedImage &&`. ✓ Design correct here.
- Line 245 — "Reset" `<MenuItem>` IS gated on `mediaURL && onReset &&`. ✓ Design correct here.
- Lines 193–212 — `<MediaUploadCheck>` wraps `<MediaUpload>` (rendering the "Open Media Library" `<MenuItem>`) and `<FormFileUpload>` (rendering the "Upload" `<MenuItem>`). **Neither is gated on `onSelect`.** They render unconditionally. ✗ Design wrong here.

The runtime consequence: setting `onSelect={ undefined }` does not remove the "Open Media Library" / "Upload" menu items. Worse, the internal `selectMedia` helper (line 109–118) is called from `<MediaUpload onSelect>` (line 200) and from `uploadFiles` (line 131); `selectMedia` calls `onSelect( media )` at line 115. With `onSelect=undefined`, clicking "Open Media Library" or "Upload" throws `TypeError: onSelect is not a function`.

**Where in design doc:** §5.5 (the block-controls.js gating sketch and the verification claim under it), §11.3 (the e2e test outline asserts "<MediaReplaceFlow> upload/replace MenuItems are not visible"), §13 ("AC-14 mitigation" trade-off).

**Suggestion:** Pick one:
- (a) Replace the `<MediaReplaceFlow>` with a different toolbar control on bound covers: a thin `<ToolbarGroup>` that surfaces only the "Embed video from URL" `<MenuItem>` (since AC-21 requires that affordance be preserved). When `bindingActive`, render the alternate control; when `! bindingActive`, render the existing `<MediaReplaceFlow>`. This is straightforward — extract the embed `<MenuItem>` into its own toolbar surface for the bound case.
- (b) Modify `<MediaReplaceFlow>` itself to gate `<MediaUploadCheck>`'s subtree on `onSelect && ...`. This is an upstream change to a shared component; requires owner sign-off; risks affecting other consumers.
- (c) Accept the runtime hazard, suppress the menu items via CSS, and document the limitation. This is worse than (a) and (b); not recommended.

Recommendation: (a). The design already acknowledges in Risk #5 of §15 that AC-14 is a "literal-DOM-absence vs functional-absence" stretch — but the chosen mechanism does not even achieve functional absence for the media-library/upload paths, only for the "Use featured image" and "Reset" affordances.

**Why it matters:** AC-14 is one of the spec's control-hiding contracts and is explicitly tested by AC-23. The design's mechanism for it is incorrect; the e2e test as outlined will fail (`await expect( mediaLibraryMenuItem ).not.toBeVisible()` will time out because the menu item is still in the DOM). This is exactly the kind of defect PR review will catch, and the design phase is where it should be resolved.

---

### Issue 2 (major): `getBlockBindingsSource` is on the `@wordpress/blocks` store, not `blockEditorStore`

**What's wrong:** §5.1 step 3 sketches the `useSelect`:

```js
const source = unlock( select( blockEditorStore ) ).getBlockBindingsSource( expanded.url.source );
```

`getBlockBindingsSource` is NOT a selector on `blockEditorStore`. Verified at `packages/blocks/src/store/private-selectors.ts:252-257` — it is a private selector on the `@wordpress/blocks` store. It is also a direct module export at `packages/blocks/src/api/registration.ts:903`. The block-editor store does not expose `getBlockBindingsSource`.

Concrete evidence of intended usage in trunk: `packages/block-editor/src/components/block-bindings/source-fields-list.js:9` imports `getBlockBindingsSource` directly from `@wordpress/blocks` (not via `select`). `packages/block-editor/src/components/block-edit/edit.js:120-155` reads a `registeredSources` map gathered earlier from the same `@wordpress/blocks` module, not through `select`.

An implementer who copies §5.1 step 3 verbatim will get `undefined` back from the selector call and the hook will silently treat every binding as unresolvable.

**Where in design doc:** §5.1 step 3, the `useSelect` body.

**Suggestion:** Either:
- (a) Import `getBlockBindingsSource` from `@wordpress/blocks` and call it directly inside the `useSelect` body. It does not need a `select` parameter because it is a registry lookup, not state-dependent.
- (b) Read it via `select( blocksStore )` — but then the design must name `blocksStore` explicitly (`@wordpress/blocks`'s store reference) instead of `blockEditorStore`.

Either is fine. Option (a) is what the existing trunk callers do.

**Why it matters:** §5.1 is the canonical code shape implementers will copy. A wrong store reference produces a silently-broken hook (no error, just `bindingActive=false` everywhere) — exactly the kind of regression the design phase exists to prevent.

---

### Issue 3 (minor): `gutenberg_cover_bindings_is_active` PHP helper description omits the `args` equality check

**What's wrong:** Spec Glossary "Active binding" requires `id` and `url` bindings "point to the same source instance (same `source` string AND, where applicable, same `args`)". §5.1 step 2's JS `bindingActive` correctly includes `JSON.stringify(expanded.id.args ?? null) === JSON.stringify(expanded.url.args ?? null)`.

§6.1's description of the PHP companion `gutenberg_cover_bindings_is_active( $attrs )` says only: "applies `__default` expansion (via inline logic copied from `lib/compat/wordpress-6.9/block-bindings.php:257-281`, scoped to `[ 'id', 'url' ]`), checks both bindings exist and resolve to the same source instance, and returns a bool".

The phrase "same source instance" is ambiguous — does it include `args` equality? §6.1 should mirror §5.1 step 2 explicitly: same `source` string AND same `args`. Otherwise client and server can disagree about `bindingActive` semantics for an explicit per-attribute bindings shape with matching sources but different `args`.

**Where in design doc:** §6.1 (definition of `gutenberg_cover_bindings_is_active`), §9 step 2 (claims "Client and server agree on expansion by construction").

**Suggestion:** Add one sentence to §6.1 immediately after the `gutenberg_cover_bindings_is_active` paragraph: "Source-instance equality is checked as `$expanded['id']['source'] === $expanded['url']['source'] && ( $expanded['id']['args'] ?? null ) == ( $expanded['url']['args'] ?? null )`, mirroring §5.1 step 2's client-side check."

**Why it matters:** Spec Req 26 says mismatched-source bindings (including different `args` against the same source) MUST be treated as unresolvable. If the PHP helper checks only `source` string equality, an explicit `{ id: { source: X, args: A }, url: { source: X, args: B } }` shape would pass server-side but fail client-side, producing inconsistent render output.

---

### Issue 4 (minor): `gutenberg_cover_bindings_strip_image` — form-1 (plain `<img>`) pattern not given

**What's wrong:** §6.4 describes the stripper as "use the same `preg_match` + `substr`-splice approach (form-2 pattern, plus a form-1 pattern for plain `<img>`) to **remove** any element with class `wp-block-cover__image-background` from `$content`". §6.2 gives the form-2 (`<div>...</div>`) pattern explicitly: `/<div\s+[^>]*\bwp-block-cover__image-background\b[^>]*><\/div>/U`. The form-1 (self-closing or void `<img>`) pattern is not given.

An `<img>` saved-form is `<img class="wp-block-cover__image-background ..." ... />` (single self-closing tag, no closing `</img>`). The form-2 regex won't match it. The design should either:
- give the form-1 pattern explicitly (something like `/<img\s+[^>]*\bwp-block-cover__image-background\b[^>]*\/?>/`); OR
- delegate to `WP_HTML_Tag_Processor` for the plain-`<img>` form (which can locate the tag via `next_tag( ['tag_name'=>'IMG', 'class_name'=>'wp-block-cover__image-background'] )`, but Tag Processor cannot DELETE a tag — only mutate attributes/classes — so this requires additional thought).

**Where in design doc:** §6.4.

**Suggestion:** Spell out the form-1 pattern explicitly OR pick a different mechanism for the plain-`<img>` strip. Option: for the plain-`<img>` case, use `WP_HTML_Tag_Processor` to find the tag's byte position via a different probe (e.g., write a sentinel class via `add_class`, regex-locate the sentinel, splice). Or accept the regex approach for both forms and give both patterns explicitly.

**Why it matters:** AC-5 / AC-6 / Req 20 require the server to emit no `<img>` for unresolvable cases. If the form-1 stripper is missing, an unresolvable binding on a plain-`<img>` saved Cover will leave the broken-src `<img>` in the output.

---

### Issue 5 (minor): `<CoverPlaceholder disableMediaButtons>` at line 750 keeps a drop-zone affordance that may conflict with AC-14 intent

**What's wrong:** §5.5 says "the line-750 site is reached on bound covers but uses `disableMediaButtons`, which removes both the upload and the featured-image affordance from `<MediaPlaceholder>`". Verified at `packages/block-editor/src/components/media-placeholder/index.js:551-552`: `if ( disableMediaButtons ) { return <MediaUploadCheck>{ renderDropZone() }</MediaUploadCheck>; }`. The drop zone IS still rendered — it just doesn't render the buttons.

If a user drags an image file onto a bound Cover that has an existing background (`hasBackground === true`, so the line-750 placeholder is reached), the drop-zone callback (which is wired to `onFilesPreUpload` in `cover-placeholder.js:22-26` calling `onSelectMedia({ url: ... })`) would still attempt to replace the media. This is a *user-initiated* mutation (the user dropped a file) so DC-2 is technically satisfied, but the spec's intent (Req 7, AC-14) is "media-replace control NOT in the DOM" / "direct media replacement from inside the Cover is not offered when bound".

A drop zone IS an alternative form of "media-replace control" even if it has no visible button. The design should either:
- explicitly acknowledge that drop-zone replacement is preserved on bound covers as an out-of-AC-14 user-initiated path; OR
- gate the line-750 `<CoverPlaceholder>` with `bindingActive ? null : ...` (a one-line addition) so no `<MediaPlaceholder>` is rendered at all on bound covers.

**Where in design doc:** §5.5 ("`disableMediaButtons` ... removes both the upload and the featured-image affordance ... Therefore no additional gating is required at that site.")

**Suggestion:** Add to §5.5: either (a) gate the line-750 `<CoverPlaceholder>` on `! bindingActive`, returning `null` (or omitting the element) for bound covers; or (b) explicitly document the drop-zone-as-user-initiated-mutation carve-out and trace it to Req 7's "control" wording vs spec intent.

**Why it matters:** AC-14 / Req 7 are the spec's media-replace-suppression contracts. A drop-zone alternative path that still mutates the cover's `url`/`id` on bound covers is at minimum a documentation gap; at most a real AC-14 violation depending on how reviewers read "control".

---

## Coverage summary

| AC                 | Traced in design                                                | Adequately addressed                                            |
| ------------------ | --------------------------------------------------------------- | --------------------------------------------------------------- |
| AC-1               | §8                                                              | Yes                                                             |
| AC-2               | §5.6, §9                                                        | Yes                                                             |
| AC-3               | §5.4, §6.5(1)                                                   | Yes                                                             |
| AC-4               | §5.4, §10, OQ-6                                                 | Yes                                                             |
| AC-5               | §6.4                                                            | Partial — Issue 4 (form-1 strip pattern missing)                |
| AC-6               | §6.4, §10                                                       | Partial — Issue 4 (form-1 strip pattern missing)                |
| AC-7..AC-10        | §5.6, §9, OQ-2                                                  | Yes                                                             |
| AC-11..AC-12       | §5.5                                                            | Yes                                                             |
| AC-13              | §5.5                                                            | Yes (uses `onToggleFeaturedImage=undefined`, verified)          |
| AC-14              | §5.5, §11.3                                                     | **No — Issue 1 (onSelect=undefined doesn't remove menu items)** + Issue 5 (drop zone still present) |
| AC-15..AC-17       | §5.2, §5.4, §6.3, OQ-4                                          | Yes                                                             |
| AC-18              | §6.1 Part 2, §12                                                | Yes (verified: `render_block_data` mutation propagates via `$parsed_block['attrs']` lazy init in WP_Block::__get) |
| AC-19              | §6.2, OQ-3                                                      | Yes                                                             |
| AC-20              | §12                                                             | Yes                                                             |
| AC-21              | §6.1, Risk 4                                                    | Yes                                                             |
| AC-22..AC-24       | §11.3                                                           | Partial — depends on Issue 1                                    |
| AC-25              | §6.5                                                            | Yes                                                             |
| AC-26              | §2.2, §6.1                                                      | Yes                                                             |
| AC-27              | §12                                                             | Yes                                                             |
| AC-28              | §12                                                             | Yes                                                             |

## Iter-1 finding resolution check

| Iter-1 Issue | Status | Notes |
| ---- | ---- | ---- |
| 1 — non-existent Tag-Processor methods | Resolved | Replaced with `preg_match` + `substr` splice (§3 OQ-3); explicit acknowledgement of the iter-1 finding. |
| 2 — `cover-placeholder.js` second toggle site | Resolved | Empty-cover branch gated in `index.js` (§5.4 (1)); line-750 `<CoverPlaceholder>` uses `disableMediaButtons` (§5.5). See Issue 5 for a residual drop-zone nuance. |
| 3 — AC-18 first-pass injection | Resolved | `render_block_data` filter mutates `$parsed_block['attrs']['useFeaturedImage']` BEFORE `WP_Block::__construct` (§6.1 Part 2). Verified against `wp-includes/blocks.php:2398-2436` and `wp-includes/class-wp-block.php:127-236, 520-596`. |
| 4 — §2.2 / §5.5 contradiction | Resolved | §2.2 explicitly says "`cover-placeholder.js` is NOT touched"; §5.4 and §5.5 agree. |
| 5 — test signal primary/secondary | Resolved | §3 OQ-6 names i18n string primary, `data-testid` secondary; §11.3 e2e uses `getByText`. |
| 6 — embed-video MenuItem hidden | Resolved | `<MediaReplaceFlow>` remains rendered; embed `<MenuItem>` preserved (§5.5). |
| 7 — race-token guard placement | Resolved | `raceTokenRef` declared explicitly at component top with rationale (§5.2, §13). |
| 8 — useSelect re-renders | Resolved | Single-closure `useSelect` reads source + attachment record together (§5.1 step 3). See Issue 2 for the wrong-store nuance. |
| 9 — AC-26/27/28 traces missing | Resolved | §12 has explicit bullets for each. |
| 10 — `gutenberg_cover_bindings_expand` undefined | Resolved | Renamed `gutenberg_cover_bindings_is_active`; definition described in §6.1. See Issue 3 for residual ambiguity. |
| 11 — backport-changelog wording | Resolved | §2.2 last row explicit. |

## Open Questions resolution check

| OQ    | Choice                          | Rationale + rejected alternatives traced | Verdict                                  |
| ----- | ------------------------------- | ----------------------------------------- | ---------------------------------------- |
| OQ-1  | Approach A                      | Yes, with trade-off table in §13          | OK                                       |
| OQ-2  | Disable                         | Yes                                       | OK                                       |
| OQ-3  | `preg_match` + `substr` splice  | Yes; rejected alternatives spelled out    | OK                                       |
| OQ-4  | 50                              | Yes                                       | OK                                       |
| OQ-5  | Render-time force-off           | Yes                                       | OK                                       |
| OQ-6  | i18n string primary             | Yes; `data-testid` secondary              | OK                                       |

## Risks mitigation check

| Risk                                          | Mitigation                                                           | Adequate                                  |
| --------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------- |
| 1. Ockham single-observer                     | §5.2 single useEffect on `effectiveUrl`, useEffectEvent              | Yes                                       |
| 2. Pattern Overrides reset                    | §5.6 reuse withPatternOverrideControls + ResetOverridesControl       | Yes                                       |
| 3. dimRatio: 100 default                      | §5.2/§5.4 effectiveDimRatio + §6.3 server class strip                | Yes                                       |
| 4. Embed-video collision                      | §6.1 short-circuit at both ends                                      | Yes                                       |
| 5. HTML API can't edit CSS-in-`style`         | §6.2 element-replace via `preg_match` + `substr`                     | Yes                                       |

## Verification notes (for the orchestrator)

For transparency, the following load-bearing claims in iter-2 were verified against actual source code in this review pass:

- **`render_block_data` signature and timing** — `wp-includes/blocks.php:2398` fires `apply_filters( 'render_block_data', $parsed_block, $source_block, $parent_block )`; `new WP_Block( $parsed_block, ... )` at line 2436 reads from the mutated `$parsed_block`. Inner-block path at `wp-includes/class-wp-block.php:561` reassigns `$inner_block->parsed_block`. Lazy `$this->attributes` init at `class-wp-block.php:223-236` reads from `$this->parsed_block['attrs']` — confirms the mutation propagates. ✓
- **`WP_HTML_Tag_Processor` public methods** — `next_tag` (line 887), `class_list` (1181), `has_class` (1240), `get_attribute` (2772), `set_attribute` (4310), `add_class` (4539), `remove_class` (4581), `get_updated_html` (4637) all confirmed public in `wp-includes/html-api/class-wp-html-tag-processor.php`. ✓
- **`useEffectEvent` export** — Exported from `packages/element/src/react.ts:218` and re-exported via `packages/element/src/index.ts:2`. ✓
- **`<MediaReplaceFlow>` gating** — `packages/block-editor/src/components/media-replace-flow/index.js`: `onToggleFeaturedImage` gates "Use featured image" `<MenuItem>` (line 233); `mediaURL && onReset` gates "Reset" `<MenuItem>` (line 245); `<MediaUpload>` + `<FormFileUpload>` for "Open Media Library" + "Upload" are NOT gated on `onSelect` (lines 193–232). ✗ Design's claim is wrong — see Issue 1.
- **`<MediaPlaceholder disableMediaButtons>` behaviour** — `packages/block-editor/src/components/media-placeholder/index.js:551-552` confirms `disableMediaButtons` returns the drop-zone-only renderPath. The drop zone IS still rendered. See Issue 5.
- **`getBlockBindingsSource` location** — Direct export at `packages/blocks/src/api/registration.ts:903`; private selector on the `@wordpress/blocks` store at `packages/blocks/src/store/private-selectors.ts:252-257`. NOT on the block-editor store. ✗ Design's `select( blockEditorStore ).getBlockBindingsSource(...)` is incorrect — see Issue 2.
- **`replacePatternOverridesDefaultBinding` signature** — `packages/block-editor/src/utils/block-bindings.js:27-46`. ✓ Matches design's usage.
- **`gutenberg_block_bindings_render_block` priority 10** — `lib/compat/wordpress-6.9/block-bindings.php:108`. ✓ Design's priority-9 placement is consistent.
- **6.9 compat `__default` expansion** — `lib/compat/wordpress-6.9/block-bindings.php:257-281`. ✓ Matches the reference cited in design §6.1 and §9.
- **`render_block_core_cover` early-return on `useFeaturedImage=false`** — `packages/block-library/src/cover/index.php:133` confirms `if ( 'image' !== $attributes['backgroundType'] || false === $attributes['useFeaturedImage'] ) { return $content; }`. ✓ AC-18 mechanism is sound.
