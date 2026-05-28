# Spec: Cover block bindings — internal-only support for `id` and `url`

## Overview

The `core/cover` block does not support Block Bindings. Two prior draft PRs stalled over architectural objections (event-handler-driven `useEffect` proliferation), an HTML-rewrite blocker (CSS values inside `style` attributes cannot be edited by the WP HTML API), and scope creep around external URLs. This feature lands narrowly-scoped Block Bindings support for the `id` and `url` attributes of `core/cover`, restricted to internal media library items, with Pattern Overrides as the headline use case. When a binding is active, Cover-specific controls that would conflict with bindings (parallax, repeat, media-replace under non-editable sources, use-featured-image) are hidden, and dependent values (overlay color, effective dim ratio) are derived from the bound URL at render time without ever mutating stored attributes. The server render produces correct `<img>` markup with parallax effectively off.

## Glossary

- **Bound `url` / `id`**: a Cover attribute whose `metadata.bindings.<attr>` is set to a binding source (e.g. `core/pattern-overrides`, `core/post-meta`).
- **Internal media**: an attachment that exists in the site's media library; identified by a numeric attachment `id` from which the `url` can be derived.
- **Effective value**: a value computed at render time from the resolved bound values, used for display only; never written back to the stored attribute.
- **Pattern Overrides**: the `core/pattern-overrides` binding source — pattern authors mark attributes overridable; pattern instances may override per-instance and reset to default.
- **Reactive observer**: a single `useEffect` (using `useEffectEvent` for stable access to latest values) that derives all dependent state from the effective `url` regardless of how the URL arrived (manual, featured image, binding).

## Requirements

### A. Metadata and registration

1. `core/cover`'s `id` attribute MUST declare `"role": "content"` (matching `core/image`). No other attribute schema changes.
2. A new file `lib/compat/wordpress-7.1/block-bindings.php` MUST be created and required from `lib/load.php`. It MUST register a filter that adds `id` and `url` to `gutenberg_get_block_bindings_supported_attributes('core/cover')`. The filter MUST follow the established `! function_exists` / version-guard pattern.
3. No other `block.json` shape changes for `core/cover`. No new attributes.

### B. Editor — UI gating when a binding is present

4. The parallax toggle (`hasParallax`) MUST be hidden whenever a binding is present on `url` or `id`.
5. The repeated-background toggle (`isRepeated`) MUST be hidden whenever a binding is present on `url` or `id`.
6. The "Use featured image" toggle MUST be hidden whenever a binding is present on `url` or `id`, in every surface where it appears (block toolbar, inspector).
7. The media-replace control MUST be hidden when a binding is present AND the bound source's `canUserEditValue` returns false. (Pattern Overrides allows edits — see OQ-1.)
8. The Block Bindings UI (legacy Attributes panel and Block Fields UI from sibling pipeline 75022) MUST surface bindable rows for `id` and `url` on `core/cover` automatically, with no Cover-specific UI code beyond requirement 2.
9. Pattern Overrides controls (`Enable overrides` button, `ResetOverridesControl`) MUST work for `core/cover` automatically, with no Cover-specific UI code.

### C. Editor — reactive derivation (single-observer architecture)

10. The Edit component MUST derive all dependent state (overlay color, effective dim ratio, effective URL, lock flags) from a single reactive observer keyed on the effective `url`. The observer MUST be source-agnostic: identical behavior whether the URL arrived manually, via `useFeaturedImage`, or via a binding source.
11. The observer MUST NOT mutate any block attribute as a side effect of a binding becoming active or inactive. Specifically: `dimRatio`, `useFeaturedImage`, `backgroundType`, `id`, `url`, `hasParallax`, `isRepeated`, `overlayColor`, `customOverlayColor` MUST NOT be written from inside the observer.
12. The observer MUST update overlay color from the resolved image's average color when `isUserOverlayColor` is false, regardless of URL source.
13. The observer MUST be resilient against concurrent async `getMediaColor` resolutions: a stale color MUST NOT overwrite a newer one.

### D. Editor — render-time effective values

14. When a binding is active on `url`/`id` AND the stored `dimRatio` equals the default value (100) AND the bound URL resolves to a non-empty value, the rendered overlay MUST use a non-opaque effective dim ratio (target: 50). The stored `dimRatio` attribute MUST NOT change.
15. The effective `url` used by the editor preview MUST prefer the bound `url` over `useFeaturedImage`'s `mediaUrl` when both are present. The bound value wins.
16. When `url` is bound but the binding-resolved `id` is missing or does not resolve to an attachment in the media library (the "external URL" case), the editor MUST surface a visible "internal media required" affordance (placeholder copy, notice, or equivalent) instead of rendering the cover with a broken image. The exact surface is a design choice; visibility is the requirement.

### E. Server — render correctness

17. When bindings have resolved `url`/`id` for a Cover, the server-rendered markup MUST contain an `<img>` element for the resolved image (NOT a `<div style="background-image: url(...)">`), even if the saved markup was the parallax/repeat form. Parallax styling MUST be effectively off in the rendered output when bindings are active.
18. The server-rendered overlay span class MUST reflect the effective dim ratio from requirement 14: when the stored `dimRatio` is the default 100 AND a binding resolves a URL, the overlay span class MUST be rewritten from `has-background-dim-100` to `has-background-dim-50` (or equivalent non-opaque value).
19. The server render MUST short-circuit the existing `useFeaturedImage` image-injection path in `render_block_core_cover` when bindings have resolved a value for `url` and/or `id`. Double image insertion MUST NOT occur.
20. If the binding cannot resolve `id` to a media-library attachment (or `url` cannot be derived from the resolved `id`), the server MUST render the cover WITHOUT an image element. No broken `<img src>` / `<img src="">` may be emitted.
21. The server-side mechanism (whether a Cover-scoped `render_block` filter or reuse of a generic `block_bindings_attribute_replaced_in_markup` filter — see OQ-3) MUST be additive: it MUST NOT change behavior for any other block.

### F. Cross-cutting invariants

22. Unbound Cover behavior MUST be unchanged: no regression on parallax, repeat, focal point, featured image, embed-video, dim ratio, overlay color, alt text, image-size selection, deprecation chain.
23. Pattern Overrides MUST round-trip cleanly through editor save/load and server render for four enumerated states:
   - (a) **default, no override**: bound value equals the block's own attribute; instance renders the pattern default.
   - (b) **overridden**: instance value differs from pattern default; renders the override.
   - (c) **reset-to-default with binding active**: user clicks Reset; instance returns to pattern default.
   - (d) **reset-affordance suppressed when instance value already matches default**: Reset is disabled (existing `ResetOverridesControl` semantics) or hidden — design phase resolves; OQ-2.
24. External URL binding MUST NOT be silently honored. A binding source returning a `url` without a resolvable internal `id` MUST be treated as unresolvable per requirement 16 (editor) and requirement 20 (server).
25. `backgroundType: "embed-video"` MUST continue to render correctly and MUST NOT regress. The bindings panel MAY expose `url` even for embed-video covers (no Cover-specific suppression required), but the binding-aware derivations (effective dim ratio, overlay color) SHOULD short-circuit when `backgroundType === "embed-video"`.
26. The PR MUST NOT introduce new global Block Bindings APIs. If a reused filter (e.g. `block_bindings_attribute_replaced_in_markup`) is needed, it MUST be weighed against a Cover-scoped render path during design.

### G. Tests

27. A new e2e test MUST create a Cover, bind its `url`+`id` to a Pattern Overrides source, and assert the editor preview AND the rendered front-end show the pattern default.
28. The same e2e test MUST override the value on a pattern instance and assert the rendered output reflects the override (different `<img src>`, correct dim ratio class).
29. The same e2e test MUST reset the override and assert the rendered output returns to the pattern default.
30. The e2e test MUST assert that the parallax toggle, repeat toggle, media-replace control (where the source disallows editing), and featured-image toggle are NOT present (or NOT enabled) when a binding is active.
31. A PHPUnit test SHOULD assert that `render_block_core_cover` substitutes the bound `url` into the rendered `<img src>` AND rewrites the dim ratio class when the saved value is the default 100.
32. Existing Cover unit tests (`packages/block-library/src/cover/test/edit.js`) MUST continue to pass; existing Cover e2e tests MUST continue to pass.

### H. PR shape and project metadata

33. The new compat file MUST live at `lib/compat/wordpress-7.1/block-bindings.php` (NOT 7.0). A `backport-changelog/7.1/<core-pr-number>.md` entry MUST be added when the corresponding Core PR exists.
34. The PR description MUST link issue #77199 and explicitly state whether it subsumes prior PRs #74109 and #74610.
35. The net diff (including tests) SHOULD target under ~500 lines.
36. The implementation MUST gracefully degrade on a WP install lacking the bindings infrastructure changes (use the existing `! function_exists` / version-guard pattern).

## Out of Scope

The following are explicitly excluded from this work. They are not deferred-but-acknowledged inside this PR; they are non-goals:

- **External / non-media-library URL binding.** Binding `url` to an arbitrary URL with no resolvable internal `id` is not supported. The cover surfaces an "internal media required" UX instead.
- **Parallax × bindings interaction beyond "force off".** No CSS-in-style HTML rewriting. When bindings are active, parallax styling is suppressed (server emits `<img>`, no `<div style="background-image: ...">`); the UI hides the parallax toggle.
- **Embed-video × bindings interaction.** `backgroundType: "embed-video"` is not specifically supported with bindings beyond non-regression. No Cover-specific suppression of the bindings panel is added.
- **Featured-image binding for Cover.** Binding `url`/`id` to express "use the post featured image" is a separate follow-up PR. This PR merely hides the `useFeaturedImage` toggle when a binding is active and ensures the server render does not double-insert images.
- **New global Block Bindings APIs.** No new globally-registered Block Bindings APIs are introduced. At most one already-proposed filter (`block_bindings_attribute_replaced_in_markup`) may be reused; introducing it is weighed against a Cover-scoped server-render path during design.
- **Post-data source `featured_media.url` / `featured_media.id` field.** Out of scope.

## Acceptance Criteria

Given-When-Then form. Each criterion is independently testable.

### Bindings discovery

- **AC-1.** Given a `core/cover` block selected in the editor on a site running this build, when the user opens the Block Bindings UI (legacy Attributes panel or Block Fields UI), then the panel lists `url` and `id` as bindable attributes.
- **AC-2.** Given a `core/cover` block in a synced pattern, when the pattern author opens the Pattern Overrides controls, then the "Enable overrides" affordance is available for the Cover block.

### Internal-media-only invariant

- **AC-3.** Given a binding source resolves `url` to an attachment URL AND `id` to the corresponding media-library attachment id, when the editor renders the Cover, then the editor preview shows the resolved image.
- **AC-4.** Given a binding source resolves `url` to a string but `id` is missing or resolves to a non-attachment, when the editor renders the Cover, then the cover displays a visible "internal media required" affordance and does NOT render a broken `<img>`.
- **AC-5.** Given the same unresolvable binding state, when the server renders the Cover, then the rendered HTML contains no `<img>` element for the bound URL.

### Pattern Overrides round-trip

- **AC-6.** Given a synced pattern with a Cover whose `url`+`id` are bound to `core/pattern-overrides`, when an instance is inserted with no override applied, then both the editor preview and the front-end render show the pattern default image.
- **AC-7.** Given an inserted pattern instance with the Cover image overridden via the editor, when the post is saved and rendered on the front end, then the rendered `<img src>` is the override URL.
- **AC-8.** Given an overridden Cover instance, when the user clicks "Reset" on the toolbar `ResetOverridesControl`, then the override is cleared and both editor preview and front-end render return to the pattern default.
- **AC-9.** Given a Cover instance with no override applied (value matches pattern default), when the user looks at the toolbar, then the `ResetOverridesControl` is disabled (or hidden per OQ-2 resolution).

### Control hiding

- **AC-10.** Given a Cover block with any binding present on `url` or `id`, when the user inspects the inspector controls, then the parallax toggle is NOT in the DOM.
- **AC-11.** Given a Cover block with any binding present on `url` or `id`, when the user inspects the inspector controls, then the repeat toggle is NOT in the DOM.
- **AC-12.** Given a Cover block with any binding present on `url` or `id`, when the user inspects the block toolbar and inspector controls, then the "Use featured image" toggle is NOT in the DOM.
- **AC-13.** Given a Cover block bound to a source whose `canUserEditValue` returns false (e.g. `core/post-meta`), when the user inspects the block toolbar, then the media-replace control is NOT in the DOM.
- **AC-14.** Given a Cover block bound to `core/pattern-overrides`, when the user inspects the block toolbar, then the media-replace control is present (Pattern Overrides allows edits) — pending OQ-1 resolution.

### Render-time effective values

- **AC-15.** Given a newly inserted Cover with default `dimRatio: 100` and a binding resolving a non-empty `url`, when the editor renders the cover, then the displayed overlay is NOT fully opaque (effective dim ratio 50 applied).
- **AC-16.** Given the same Cover, when the server renders the cover, then the overlay span class is `has-background-dim-50` (or equivalent non-opaque), NOT `has-background-dim-100`.
- **AC-17.** Given a Cover with `dimRatio` explicitly set to a non-default value (e.g. 70) and a binding resolving a URL, when either editor or server renders, then the displayed overlay uses the stored value (70). The stored attribute is unchanged.
- **AC-18.** Given a Cover with `useFeaturedImage: true` and a binding present on `url`, when either editor or server renders, then the bound `url` is shown, NOT the featured image URL. Server render does NOT inject a second `<img>` for the featured image.
- **AC-19.** Given a Cover with `hasParallax: true` and `isRepeated: true` saved in markup, and a binding subsequently activated on `url`, when the server renders the cover, then the output contains an `<img>` (not a `<div style="background-image">`), the `has-parallax` and `is-repeated` classes are not applied to that element, and no `style="background-image: ..."` substitution is attempted.

### Architecture (verifiable from code review, not at runtime)

- **AC-20.** The Edit component contains a single observer for URL-derived state. There is NOT a separate `useEffect` per event handler (no observer keyed on "media-replaced", another on "blur", another on "binding-detected").
- **AC-21.** The observer never calls `setAttributes` for `dimRatio`, `useFeaturedImage`, `backgroundType`, `id`, `url`, `hasParallax`, `isRepeated`, `overlayColor`, or `customOverlayColor` as a result of a binding becoming active or inactive.

### Non-regression

- **AC-22.** Given an existing unbound Cover block (with or without `hasParallax`, `isRepeated`, `useFeaturedImage`, `backgroundType: "embed-video"`, custom overlay color, custom dim ratio, custom focal point), when the editor and server render the block, then the output is identical to the current trunk behavior. No deprecation chain breakage.
- **AC-23.** Given an existing Cover with `backgroundType: "embed-video"`, when the editor opens the bindings UI, then the panel still lists `url`/`id` as bindable; but the binding-aware effective-dim-ratio / overlay-color derivations short-circuit (no auto-color from embed URL). The embed render path is unchanged.

### Tests present

- **AC-24.** The repository contains an e2e test that exercises Pattern Overrides on Cover end-to-end (create pattern with bound Cover, insert, override instance, reset) and asserts both editor preview and rendered front-end output.
- **AC-25.** The e2e test asserts the hidden-controls invariants (AC-10..AC-13) on a bound Cover.
- **AC-26.** A PHPUnit test asserts server-side URL substitution and dim ratio class rewriting for a bound Cover.

### PR shape

- **AC-27.** The new server-side filter file lives at `lib/compat/wordpress-7.1/block-bindings.php` and is loaded via `lib/load.php`. No file is created under `lib/compat/wordpress-7.0/`.
- **AC-28.** The PR description links #77199 and explicitly states the relationship to #74109 and #74610.
- **AC-29.** The net diff (additions − deletions) is under ~500 lines including tests.

## Risks

1. **Pattern Overrides reset semantics** historically broke. The four enumerated states (AC-6..AC-9) must all round-trip; existing `ResetOverridesControl` behavior must be respected or extended.
2. **`dimRatio: 100` default with a binding** is the specific opaque-overlay regression that stalled prior PRs. Solution lives in render-time effective value, NOT attribute mutation.
3. **`backgroundType: "embed-video"`** was added after prior bindings PRs; must not regress and must short-circuit the binding-aware derivations cleanly.
4. **Reviewer @ockham gates this area.** Prior objections (event-keyed `useEffect` proliferation, scattered derivation logic, internal-only scope) must be preempted in the design doc, not surfaced during PR review.
5. **HTML rewriting blocker**: the WordPress HTML API cannot edit CSS values inside `style` attributes. The implementation MUST avoid that path — i.e. the server cannot rewrite `<div style="background-image: url(...)">`; it must emit `<img>` instead when bindings are active.

## Open Questions (carried to design phase)

These are questions for phase 2 (design doc). The design phase MUST resolve all five before implementation.

- **OQ-1. Media-replace visibility under Pattern Overrides.** The prompt says "Hide the media-replace control (replacement happens via the binding source, not direct edit)." But Pattern Overrides typically uses the existing media-replace flow to author the override (via `setValues`). Should the media-replace control stay visible for Pattern Overrides (and write through to the binding) and hide only for sources where `canUserEditValue` returns false? Or hide it universally and route the override through a different surface?
- **OQ-2. Reset affordance: disabled or hidden when value matches default?** The prompt says "Reset must hide cleanly when the instance value already matches the default override state." Existing `ResetOverridesControl` disables the button rather than hiding it. Pick disable (existing, consistent across all bindable blocks) or hide (matches prompt phrasing). Recommendation in requirements is "disable", but the design phase formally decides.
- **OQ-3. Server-side approach: Approach A vs Approach B.**
  - **A.** Add a Cover-scoped `render_block` filter (in `lib/compat/wordpress-7.1/block-bindings.php` or `packages/block-library/src/cover/index.php`) that handles binding resolution, URL substitution, dim ratio class rewrite, parallax class strip, and `useFeaturedImage` short-circuit in one place.
  - **B.** Reuse the generic `block_bindings_attribute_replaced_in_markup` filter (from PR #74610) to synthesize `source: attribute, selector: img, attribute: src` for Cover's `url`, plus a smaller Cover-specific path for dim ratio / parallax handling.
  - Trade-off: A is entirely block-scoped (less cross-block risk); B has reuse value for future blocks with non-source-declared bindable attributes.
- **OQ-4. Saved-markup parallax/repeat replacement on server.** When a Cover saved with `hasParallax: true` and/or `isRepeated: true` gains a binding via "Enable overrides", the server-render must replace the `<div style="background-image: url(...)">` element with an `<img>` and strip `has-parallax`/`is-repeated` classes. The HTML Tag Processor can perform element replacement when the element is uniquely identifiable by class (`wp-block-cover__image-background`). Confirm in design that this is the chosen mechanism and that it is safe across all known cover markup variations.
- **OQ-5. Binding source validation: must `id` and `url` bind to the same source?** The internal-only invariant implies the same source provides both. Should the editor validate that `metadata.bindings.id.source === metadata.bindings.url.source`? Should it block save if they differ? Or treat any mismatch as an unresolvable binding per AC-4?
