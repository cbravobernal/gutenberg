# Spec: Cover block bindings — internal-only support for `id` and `url`

## Overview

The `core/cover` block does not support Block Bindings. Two prior draft PRs stalled over architectural objections (event-handler-driven `useEffect` proliferation), an HTML-rewrite blocker (CSS values inside `style` attributes cannot be edited by the WP HTML API), and scope creep around external URLs. This feature lands narrowly-scoped Block Bindings support for the `id` and `url` attributes of `core/cover`, restricted to internal media library items, with Pattern Overrides as the headline use case. When a binding is active, Cover-specific controls that would conflict with bindings (parallax, repeat, media-replace, use-featured-image) are hidden, and dependent values (overlay color, effective dim ratio) are derived from the bound URL at render time without ever mutating stored attributes. The server render produces correct `<img>` markup with parallax effectively off.

## Glossary

- **Bound `url` / `id`**: a Cover attribute whose `metadata.bindings.<attr>` is set to a binding source (e.g. `core/pattern-overrides`, `core/post-meta`), OR whose binding is implied by a `__default` wildcard binding (see "Expanded bindings" below).
- **Internal media**: an attachment that exists in the site's media library; identified by a numeric attachment `id` from which the `url` can be derived.
- **Expanded bindings (on a Cover instance)**: the `metadata.bindings` object after the `__default` wildcard is resolved into per-attribute entries. Concretely: if `metadata.bindings.__default.source` is set (today only `core/pattern-overrides` writes this shape), then **every** supported attribute that does not already have an explicit per-attribute binding entry is treated as bound to that same `__default` source. If `__default` is absent, the expanded bindings equal the literal `metadata.bindings`. This matches the existing client-side helper `replacePatternOverridesDefaultBinding( bindings, supportedAttributes )` (in `packages/block-editor/src/utils/block-bindings.js`) and the server-side expansion in `gutenberg_process_block_bindings`.
- **Active binding (on a Cover instance)**: after expansion (see "Expanded bindings"), `metadata.bindings.id` and `metadata.bindings.url` are both present AND point to the same source instance (same `source` string AND, where applicable, same `args`). The `__default: { source: 'core/pattern-overrides' }` shape therefore qualifies as an active binding by construction, because expansion populates `id` and `url` from the same `__default` source. Any other configuration — only one of `id`/`url` is bound (after expansion) or both bound but to different sources — is **not** an active binding; the cover falls back to direct-edit behaviour, except where requirement 16 / AC-4 / AC-6 applies.
- **Effective value**: a value computed at render time from the resolved bound values, used for display only; never written back to the stored attribute.
- **Pattern Overrides**: the `core/pattern-overrides` binding source — pattern authors mark attributes overridable (the editor writes only `metadata.bindings.__default = { source: 'core/pattern-overrides' }`, no per-attribute entries); pattern instances may override per-instance and reset to default.

## Requirements

### A. Metadata and registration

1. `core/cover`'s `id` attribute MUST declare `"role": "content"` (matching `core/image`). No other attribute schema changes.
2. A new file `lib/compat/wordpress-7.1/block-bindings.php` MUST be created and required from `lib/load.php`. It MUST register a filter that adds `id` and `url` to `gutenberg_get_block_bindings_supported_attributes('core/cover')`. The filter MUST follow the established `! function_exists` / version-guard pattern.
3. No other `block.json` shape changes for `core/cover`. No new attributes.

### B. Editor — UI gating when a binding is active

A binding is **active** per the Glossary definition (after `__default` expansion, both `id` and `url` are bound to the same source instance). The headline Pattern Overrides shape — `metadata.bindings.__default = { source: 'core/pattern-overrides' }` with no per-attribute entries — IS an active binding under this definition.

4. The parallax toggle (`hasParallax`) MUST be hidden whenever a binding is active on the Cover.
5. The repeated-background toggle (`isRepeated`) MUST be hidden whenever a binding is active on the Cover.
6. The "Use featured image" toggle MUST be hidden whenever a binding is active on the Cover, in every surface where it appears (block toolbar, inspector).
7. The media-replace control MUST be hidden whenever a binding is active on the Cover, regardless of the bound source's `canUserEditValue`. (Pattern Overrides routes overrides through a separate flow; direct media replacement from inside the Cover is not offered when bound.)
8. The Block Bindings UI (legacy Attributes panel and Block Fields UI from sibling pipeline 75022) MUST surface bindable rows for `id` and `url` on `core/cover` automatically, with no Cover-specific UI code beyond requirement 2.
9. Pattern Overrides controls (`Enable overrides` button, `ResetOverridesControl`) MUST work for `core/cover` automatically, with no Cover-specific UI code.

### C. Editor — reactive derivation (single-observer architecture)

10. The Edit component MUST derive all dependent state (overlay color, effective dim ratio, effective URL, lock flags) reactively from the effective `url` in a source-agnostic way: identical behavior whether the URL arrived manually, via `useFeaturedImage`, or via a binding source. (The single-observer / no-per-event-`useEffect` constraint that operationalises this is a Design Constraint — see §"Design Constraints".)
11. Derivation MUST NOT mutate any block attribute as a side effect of a binding becoming active or inactive. Specifically: `dimRatio`, `useFeaturedImage`, `backgroundType`, `id`, `url`, `hasParallax`, `isRepeated`, `overlayColor`, `customOverlayColor` MUST NOT be written from the derivation path triggered by binding state changes.
12. Overlay color MUST update from the resolved image's average color when `isUserOverlayColor` is false, regardless of URL source.
13. The derivation MUST be resilient against concurrent async `getMediaColor` resolutions: a stale color MUST NOT overwrite a newer one.

### D. Editor — render-time effective values

14. When a binding is active on a Cover AND the stored `dimRatio` equals the default value (100) AND the bound URL resolves to a non-empty value, the rendered overlay MUST NOT be fully opaque. The stored `dimRatio` attribute MUST NOT change. (The exact non-opaque value used is a design decision; the constraint is non-opacity.)
15. The effective `url` used by the editor preview MUST prefer the bound `url` over `useFeaturedImage`'s `mediaUrl` when both are present. The bound value wins.
16. When `url` is bound but the binding-resolved `id` is missing or does not resolve to an attachment in the media library (the "external URL" case), the editor MUST surface a clear "internal media required" affordance AND MUST NOT render an `<img>` element for the unresolved binding. The affordance MUST be discoverable by a stable, test-observable signal — a known i18n message string (or equivalent stable identifier) accessible to the e2e test. The exact surface (placeholder copy, notice, inspector message) is a design choice; visibility AND test-observability are the constraints.

### E. Server — render correctness

17. When bindings have resolved `url`/`id` for a Cover with `backgroundType !== "embed-video"`, the server-rendered markup MUST contain an `<img>` element for the resolved image (NOT a `<div style="background-image: url(...)">`), even if the saved markup was the parallax/repeat form. Parallax styling MUST be effectively off in the rendered output when bindings are active.
18. When a binding is active AND the stored `dimRatio` is the default 100 AND the binding resolves a URL, the server-rendered overlay span class MUST NOT be `has-background-dim-100`. (It MUST be a non-opaque variant whose specific value is the design phase's choice; see Risks.)
19. The server render MUST short-circuit the existing `useFeaturedImage` image-injection path in `render_block_core_cover` when bindings have resolved a value for `url`/`id`. Double image insertion MUST NOT occur.
20. If the binding cannot resolve `id` to a media-library attachment (or `url` cannot be derived from the resolved `id`), the server MUST render the cover WITHOUT an image element. No broken `<img src>` / `<img src="">` may be emitted.
21. The server-side mechanism (whether a Cover-scoped `render_block` filter or reuse of a generic `block_bindings_attribute_replaced_in_markup` filter — see OQ-1) MUST be additive: it MUST NOT change behavior for any other block.
22. When `backgroundType === "embed-video"`, the existing oEmbed render path in `render_block_core_cover` MUST run unchanged regardless of binding presence; the binding-resolution server path MUST NOT engage for embed-video covers.

### F. Cross-cutting invariants

23. Unbound Cover behavior MUST be unchanged: no regression on parallax, repeat, focal point, featured image, embed-video, dim ratio, overlay color, alt text, image-size selection, deprecation chain.
24. Pattern Overrides MUST round-trip cleanly through editor save/load and server render for four enumerated states:
   - (a) **default, no override**: bound value equals the block's own attribute; instance renders the pattern default.
   - (b) **overridden**: instance value differs from pattern default; renders the override.
   - (c) **reset-to-default with binding active**: user clicks Reset; instance returns to pattern default.
   - (d) **reset-affordance suppressed when instance value already matches default**: Reset is disabled (existing `ResetOverridesControl` semantics) or hidden — design phase resolves; OQ-2.
25. External URL binding MUST NOT be silently honored. A binding source returning a `url` without a resolvable internal `id` MUST be treated as unresolvable per requirement 16 (editor) and requirement 20 (server).
26. Mismatched-source binding MUST be treated as unresolvable. If — after `__default` expansion (see Glossary) — a Cover has `metadata.bindings.id` and `metadata.bindings.url` set to **different** source instances (different `source` strings, or different `args` against the same source), the editor MUST surface the "internal media required" affordance (per requirement 16) and the server MUST render the cover without an image element (per requirement 20). Mismatch can only arise from **explicit per-attribute** binding entries; the `__default` wildcard shape cannot mismatch by construction (expansion writes the same source into every supported attribute that lacks an explicit entry).
27. `backgroundType: "embed-video"` MUST continue to render correctly and MUST NOT regress. The bindings panel MAY expose `url`/`id` rows even for embed-video covers (no Cover-specific suppression required), but the binding-aware derivations (effective dim ratio, overlay color) AND the binding-aware server render MUST short-circuit when `backgroundType === "embed-video"` (per requirement 22).
28. The PR MUST NOT introduce new global Block Bindings APIs. If a reused filter (e.g. `block_bindings_attribute_replaced_in_markup`) is needed, it MUST be weighed against a Cover-scoped render path during design.

### G. Tests

29. A new e2e test MUST create a Cover, bind its `url`+`id` to a Pattern Overrides source, and assert the editor preview AND the rendered front-end show the pattern default.
30. The same e2e test MUST override the value on a pattern instance and assert the rendered output reflects the override (different `<img src>`, non-opaque dim ratio class).
31. The same e2e test MUST reset the override and assert the rendered output returns to the pattern default.
32. The e2e test MUST assert that the parallax toggle, repeat toggle, media-replace control, and featured-image toggle are NOT present in the DOM when a binding is active.
33. The e2e test MUST cover the unresolvable-binding case (e.g. mismatched sources, or a source resolving `url` without a media-library `id`) and assert the "internal media required" affordance is visible via its stable test-observable signal.
34. A PHPUnit test SHOULD assert that `render_block_core_cover` substitutes the bound `url` into the rendered `<img src>` AND rewrites the dim ratio class to a non-opaque variant when the saved value is the default 100.
35. Existing Cover unit tests (`packages/block-library/src/cover/test/edit.js`) MUST continue to pass; existing Cover e2e tests MUST continue to pass.

### H. PR shape and project metadata

36. The new compat file MUST live at `lib/compat/wordpress-7.1/block-bindings.php` (NOT 7.0). A `backport-changelog/7.1/<core-pr-number>.md` entry MUST be added when the corresponding Core PR exists.
37. The PR description MUST link issue #77199 and explicitly state whether it subsumes prior PRs #74109 and #74610.
38. The net diff (including tests) SHOULD target under ~500 lines.
39. The implementation MUST gracefully degrade on a WP install lacking the bindings infrastructure changes (use the existing `! function_exists` / version-guard pattern).

## Out of Scope

The following are explicitly excluded from this work. They are not deferred-but-acknowledged inside this PR; they are non-goals:

- **External / non-media-library URL binding.** Binding `url` to an arbitrary URL with no resolvable internal `id` is not supported. The cover surfaces an "internal media required" UX instead.
- **Mismatched-source binding (`id` and `url` bound to different sources).** Not supported. Treated as an unresolvable binding per requirement 26.
- **Parallax × bindings interaction beyond "force off".** No CSS-in-style HTML rewriting. When bindings are active and `backgroundType !== "embed-video"`, parallax styling is suppressed in the server render (emit `<img>`, no `<div style="background-image: ...">`); the UI hides the parallax toggle.
- **Embed-video × bindings interaction.** `backgroundType: "embed-video"` is not specifically supported with bindings beyond non-regression. The bindings panel MAY surface bindable rows, but the binding-aware editor derivations AND the binding-aware server-render path BOTH short-circuit — embed-video covers continue to render via the existing oEmbed flow regardless of binding presence. No `<img>` substitution, no class rewrite, no parallax strip, AND no embed-iframe `src` substitution from the bound `url` is performed on embed-video covers under this PR (the rendered iframe `src` is the saved `url` attribute). This carve-out applies even if a Cover's saved markup contains stale `hasParallax: true` alongside `backgroundType: "embed-video"`: the embed path wins.
- **Featured-image binding for Cover (i.e. expressing `useFeaturedImage` behaviour AS a binding).** Defining a binding source that returns the post's featured-image URL/id (so that `useFeaturedImage` becomes redundant with bindings) is a separate follow-up PR. This PR's in-scope contract concerning featured image is the *precedence rule* (AC-18): when both `useFeaturedImage: true` and an active binding co-exist on the same Cover, the binding wins and the server does not double-render.
- **New global Block Bindings APIs.** No new globally-registered Block Bindings APIs are introduced. At most one already-proposed filter (`block_bindings_attribute_replaced_in_markup`) may be reused; introducing it is weighed against a Cover-scoped server-render path during design.
- **Post-data source `featured_media.url` / `featured_media.id` field.** Out of scope.

## Acceptance Criteria

Given-When-Then form. Each runtime AC is independently testable from outside the implementation (e2e, PHPUnit, or DOM inspection). Code-review-only assertions live in §"Design Constraints".

### Bindings discovery

- **AC-1.** Given a `core/cover` block selected in the editor on a site running this build, when the user opens the Block Bindings UI (legacy Attributes panel or Block Fields UI), then the panel lists `url` and `id` as bindable attributes.
- **AC-2.** Given a `core/cover` block in a synced pattern, when the pattern author opens the Pattern Overrides controls, then the "Enable overrides" affordance is available for the Cover block.

### Internal-media-only invariant

- **AC-3.** Given a binding source resolves `url` to an attachment URL AND `id` to the corresponding media-library attachment id AND both bindings reference the same source instance, when the editor renders the Cover, then the editor preview shows the resolved image.
- **AC-4.** Given a binding configuration that does NOT meet the active-binding definition (only one attribute bound; both bound but to different sources; or `id` missing / resolving to a non-attachment), when the editor renders the Cover, then (a) no `<img>` element is emitted for the bound URL AND (b) the editor surfaces the "internal media required" affordance via its stable test-observable signal (a known i18n message string or equivalent stable identifier resolved during design).
- **AC-5.** Given the same unresolvable binding state, when the server renders the Cover, then the rendered HTML contains no `<img>` element for the bound URL.
- **AC-6.** Given a Cover with **explicit per-attribute** bindings such that `metadata.bindings.id.source !== metadata.bindings.url.source` (or differing `args`), when either the editor or the server renders the cover, then the cover renders the "internal media required" state per AC-4 / AC-5 (mismatched sources are treated as unresolvable). The `__default: { source: 'core/pattern-overrides' }` shape cannot trigger this AC because expansion writes the same source into both `id` and `url` (see Glossary "Expanded bindings"); mismatch is only reachable via explicit per-attribute bindings.

### Pattern Overrides round-trip

- **AC-7.** Given a synced pattern with a Cover whose `url`+`id` are bound to `core/pattern-overrides`, when an instance is inserted with no override applied, then both the editor preview and the front-end render show the pattern default image.
- **AC-8.** Given an inserted pattern instance with the Cover image overridden via the editor, when the post is saved and rendered on the front end, then the rendered `<img src>` is the override URL.
- **AC-9.** Given an overridden Cover instance, when the user clicks "Reset" on the toolbar `ResetOverridesControl`, then the override is cleared and both editor preview and front-end render return to the pattern default.
- **AC-10.** Given a Cover instance with no override applied (value matches pattern default), when the user looks at the toolbar, then the `ResetOverridesControl` is disabled (or hidden per OQ-2 resolution).

### Control hiding

- **AC-11.** Given a Cover block with an active binding (per Glossary), when the user inspects the inspector controls, then the parallax toggle is NOT in the DOM.
- **AC-12.** Given a Cover block with an active binding, when the user inspects the inspector controls, then the repeat toggle is NOT in the DOM.
- **AC-13.** Given a Cover block with an active binding, when the user inspects the block toolbar and inspector controls, then the "Use featured image" toggle is NOT in the DOM.
- **AC-14.** Given a Cover block with an active binding to **any** source (including `core/pattern-overrides` and `core/post-meta`), when the user inspects the block toolbar, then the media-replace control is NOT in the DOM. Replacement under Pattern Overrides flows through the override authoring surface, not the Cover's own media-replace control.

### Render-time effective values

- **AC-15.** Given a newly inserted Cover with default `dimRatio: 100` and an active binding resolving a non-empty `url`, when the editor renders the cover, then the displayed overlay's computed opacity is strictly less than 1.0 (the bound image is visible through the overlay).
- **AC-16.** Given the same Cover, when the server renders the cover, then the overlay span class is NOT `has-background-dim-100`.
- **AC-17.** Given a Cover with `dimRatio` explicitly set to a non-default value (e.g. 70) and an active binding resolving a URL, when either editor or server renders, then the displayed overlay uses the stored value (70). The stored attribute is unchanged.
- **AC-18.** Given a Cover with `useFeaturedImage: true` and an active binding on `url`+`id`, when either editor or server renders, then the bound `url` is shown, NOT the featured image URL. Server render does NOT inject a second `<img>` for the featured image. (This is the *precedence* rule; expressing featured-image AS a binding source is out of scope — see Out of Scope.)
- **AC-19.** Given `backgroundType !== "embed-video"` AND a Cover with `hasParallax: true` and `isRepeated: true` saved in markup, and a binding subsequently activated on `url`+`id`, when the server renders the cover, then the output contains an `<img>` (not a `<div style="background-image">`), the `has-parallax` and `is-repeated` classes are not applied to that element, and no `style="background-image: ..."` substitution is attempted.

### Non-regression

- **AC-20.** Given an existing unbound Cover block (with or without `hasParallax`, `isRepeated`, `useFeaturedImage`, `backgroundType: "embed-video"`, custom overlay color, custom dim ratio, custom focal point), when the editor and server render the block, then the output is identical to the current trunk behavior. No deprecation chain breakage.
- **AC-21.** Given an existing Cover with `backgroundType: "embed-video"`, when the editor opens the bindings UI, then the panel still lists `url`/`id` as bindable; but neither the binding-aware editor derivations nor the binding-aware server-render path engage — the existing embed render flow runs unchanged regardless of binding presence. Specifically: the rendered embed iframe `src` is the **saved** `url` attribute, NOT the bound `url`. No URL substitution is attempted for embed-video covers; no `<img>` is synthesised; no overlay-class or parallax-class rewrite is performed. Binding the `url`/`id` of an embed-video Cover has no observable runtime effect under this PR (consistent with the Out-of-Scope "Embed-video × bindings interaction" bullet).

### Tests present

- **AC-22.** The repository contains an e2e test that exercises Pattern Overrides on Cover end-to-end (create pattern with bound Cover, insert, override instance, reset) and asserts both editor preview and rendered front-end output.
- **AC-23.** The e2e test asserts the hidden-controls invariants (AC-11..AC-14) on a Cover with an active binding.
- **AC-24.** The e2e test asserts the unresolvable-binding affordance (AC-4) via its stable test-observable signal.
- **AC-25.** A PHPUnit test asserts server-side URL substitution AND a non-`has-background-dim-100` dim-ratio class for a bound Cover with default stored `dimRatio: 100`.

### PR shape

- **AC-26.** The new server-side filter file lives at `lib/compat/wordpress-7.1/block-bindings.php` and is loaded via `lib/load.php`. No file is created under `lib/compat/wordpress-7.0/`.
- **AC-27.** The PR description links #77199 and explicitly states the relationship to #74109 and #74610.
- **AC-28.** The net diff (additions − deletions) is under ~500 lines including tests.

## Design Constraints

These are architectural invariants required by reviewer @ockham (see Risks #4) and the prompt's architectural section. They are verifiable by code review on the PR, not by runtime tests. The design doc and PR review checklist MUST enforce them:

- **DC-1. Single observer for URL-derived state.** The Edit component MUST NOT contain multiple `useEffect`s each keyed on a different event source (e.g. one for "media replaced", one for "blur", one for "binding detected"). All URL-derived state (overlay color, effective dim ratio, lock flags) MUST flow from a single reactive derivation path keyed on the effective `url`. Use of `useEffectEvent` (already exported from `@wordpress/element`) is the recommended primitive for reading latest non-tracked values without stale-closure pitfalls.
- **DC-2. No attribute mutation from binding-state changes.** The derivation path triggered by a binding becoming active/inactive MUST NOT call `setAttributes` for `dimRatio`, `useFeaturedImage`, `backgroundType`, `id`, `url`, `hasParallax`, `isRepeated`, `overlayColor`, or `customOverlayColor`. (Requirement 11 states the contract; DC-2 is its code-review enforcement.)
- **DC-3. Source-agnostic derivation.** The code path that derives dependent state from `url` MUST NOT branch on whether the URL came from a binding, `useFeaturedImage`, or manual selection. Identical behavior across all three sources.

The PR review checklist MUST tick DC-1, DC-2, DC-3 explicitly before merge.

## Risks

1. **Pattern Overrides reset semantics** historically broke. The four enumerated states (AC-7..AC-10) must all round-trip; existing `ResetOverridesControl` behavior must be respected or extended.
2. **`dimRatio: 100` default with a binding** is the specific opaque-overlay regression that stalled prior PRs. Solution lives in render-time effective value, NOT attribute mutation. The exact effective value (e.g. 50, matching the existing `onSelectMedia` downshift) is a design-phase decision; the AC contract is non-opacity.
3. **`backgroundType: "embed-video"`** was added after prior bindings PRs; must not regress. Requirements 22 and 27 carve embed-video out of the binding-aware render path entirely.
4. **Reviewer @ockham gates this area.** Prior objections (event-keyed `useEffect` proliferation, scattered derivation logic, internal-only scope) MUST be preempted in the design doc and enforced via the §"Design Constraints" checklist, not surfaced during PR review.
5. **HTML rewriting blocker**: the WordPress HTML API cannot edit CSS values inside `style` attributes. The implementation MUST avoid that path — i.e. the server cannot rewrite `<div style="background-image: url(...)">`; it must emit `<img>` instead when bindings are active.

## Open Questions (carried to design phase)

These are the genuinely architectural HOW choices left for phase 2. All user-observable WHAT decisions have been resolved in the spec above.

- **OQ-1. Server-side approach: Approach A vs Approach B.**
  - **A.** Add a Cover-scoped `render_block` filter (in `lib/compat/wordpress-7.1/block-bindings.php` or `packages/block-library/src/cover/index.php`) that handles binding resolution, URL substitution, dim-ratio class rewrite, parallax class strip, and `useFeaturedImage` short-circuit in one place.
  - **B.** Reuse the generic `block_bindings_attribute_replaced_in_markup` filter (from PR #74610) to synthesize `source: attribute, selector: img, attribute: src` for Cover's `url`, plus a smaller Cover-specific path for dim-ratio / parallax handling.
  - Trade-off: A is entirely block-scoped (less cross-block risk); B has reuse value for future blocks with non-source-declared bindable attributes.
- **OQ-2. Reset affordance: disabled or hidden when value matches default?** Existing `ResetOverridesControl` disables the button rather than hiding it. Pick disable (existing, consistent across all bindable blocks) or hide (matches prompt phrasing). Recommendation: disable. Design phase formally decides.
- **OQ-3. Saved-markup parallax/repeat replacement mechanism.** When a Cover saved with `hasParallax: true` and/or `isRepeated: true` gains a binding, the server-render must emit an `<img>` instead of `<div style="background-image: url(...)">` (per AC-19) and ensure `has-parallax`/`is-repeated` classes do not apply to the image element. The WordPress HTML API's `WP_HTML_Tag_Processor` cannot rewrite a `<div>` into an `<img>` — there is no `set_tag()` / element-type-swap operation; only attribute, class, and (via `WP_HTML_Processor` bookmarks) inner-HTML mutations are available. Feasible mechanisms therefore include: (i) detect the parallax/repeat case in `render_block_core_cover` and replace the entire image fragment in `$content` with a rebuilt `<img>` HTML string (string-level or `WP_HTML_Processor`-bookmark substitution), or (ii) bypass the saved image markup entirely when bindings are active and synthesise the full `<img>` server-side from the resolved `url`/`id`. Design phase picks one; both must honour AC-19 and must avoid CSS-in-`style` mutation (Risk #5).
- **OQ-4. Specific non-opaque effective dim-ratio value.** The contract (Req 14, AC-15, AC-16) is non-opacity. The existing `onSelectMedia` downshift uses 50; the design phase picks the specific value (likely 50 for symmetry, but the spec does not lock it).
