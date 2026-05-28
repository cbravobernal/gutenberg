# Spec Review

## Verdict: rejected

## Summary

The iter-2 revision is a substantial improvement: all eight iter-1 findings are addressed cleanly. Issue 1 (AC-14 / Req 7 media-replace contradiction) is resolved by committing to the strict reading. Issue 2 (embed-video × AC-19) is resolved by adding the `backgroundType !== "embed-video"` precondition and Req 22. Issue 3 (dim-ratio class hedging) is resolved via option (b) — non-opacity is the contract. Issue 4 (untestable affordance) is improved by mandating a stable test-observable signal. Issue 5 (mismatched-source binding) is resolved by Req 26 / AC-6. Issues 6–8 are also addressed cleanly.

However, the revision introduces ONE blocking new defect by trying to be precise about what "active binding" means. The Glossary defines "active binding" as **both** `metadata.bindings.id` and `metadata.bindings.url` being set to the same source instance. In the actual codebase, the standard Pattern Overrides flow — the headline use case for this PR — does **not** write per-attribute binding entries; it writes only `metadata.bindings.__default = { source: 'core/pattern-overrides' }`. This means every requirement and AC that gates on "active binding" would silently FAIL for the Pattern Overrides case as defined.

This is a real implementability defect: under the spec's own Glossary, requirement 4 (parallax toggle hidden) would not fire for a Pattern-Overrides Cover, and AC-7 (the headline acceptance criterion) would contradict AC-11/12/13/14. Two minor issues (one HTML API claim in OQ-3, one ambiguity in AC-21) are noted as non-blocking.

## Issues

### Issue 1: Glossary "active binding" definition is incompatible with the actual Pattern Overrides client-side data model [blocker]

**What's wrong:** Glossary says:

> **Active binding (on a Cover instance)**: both `metadata.bindings.id` and `metadata.bindings.url` are set AND point to the same source instance (same `source` string AND, where applicable, same `args`).

This entire spec then gates Reqs 4–9, 11, 14, 18, AC-3, AC-4, AC-6, AC-11–15, AC-18, AC-19, AC-21 on this definition.

But the actual Pattern Overrides client-side flow writes **only** `metadata.bindings.__default = { source: 'core/pattern-overrides' }`, NOT per-attribute entries. Verified in `packages/patterns/src/components/pattern-overrides-controls.js:51-55`:

```js
updateBlockBindings( {
    __default: isChecked
        ? { source: PATTERN_OVERRIDES_BINDING_SOURCE }
        : undefined,
} );
```

Server-side, `__default` is then expanded into per-attribute bindings inside `gutenberg_process_block_bindings` (verified in `lib/compat/wordpress-6.9/block-bindings.php:257-281`). Client-side, the expansion happens only in selected places via `replacePatternOverridesDefaultBinding` from `packages/block-editor/src/utils/block-bindings.js`. The Image block's `lockUrlControls` (`packages/block-library/src/image/image.js:758,771-777`) reads `metadata?.bindings?.url` directly — for a Pattern-Overrides image, `urlBinding` is undefined and `lockUrlControls` is false (which is correct for image, since Pattern Overrides allows editing — but the lock signal is not the same as the "binding is active" signal Cover needs).

Concrete consequence under this spec: a Cover block in a synced pattern with Pattern Overrides enabled has `metadata.bindings = { __default: { source: 'core/pattern-overrides' } }`. Per Glossary, this is NOT an "active binding" (`bindings.id` and `bindings.url` are both `undefined`). Therefore:
- Req 4 (hide parallax) does not fire — AC-11 fails.
- Req 5 (hide repeat) does not fire — AC-12 fails.
- Req 6 (hide use-featured-image) does not fire — AC-13 fails.
- Req 7 (hide media-replace) does not fire — AC-14 fails.
- Req 14 (effective dimRatio) does not fire — AC-15, AC-16 fail.
- AC-7 (pattern instance shows pattern default) passes server-side via `__default` expansion BUT contradicts AC-11..14 because the editor-side controls are not hidden.

**Where in spec:** Glossary; cascading through all of §§B, C, D and Acceptance Criteria.

**Suggestion:** Either of:
- **(a) Broaden the "active binding" definition to recognise `__default: core/pattern-overrides`** as equivalent to "both `id` and `url` bound to `core/pattern-overrides`". Concretely: "Active binding (on a Cover instance): either (i) both `metadata.bindings.id` and `metadata.bindings.url` are set and point to the same source instance, OR (ii) `metadata.bindings.__default.source` is set (`__default` semantically expands to per-attribute bindings for every supported attribute)." This is the codebase reality, and it matches how the Image block's `lockUrlControls` and the editor's existing helpers reason about pattern-override-bound blocks.
- **(b) Define "active binding" using the existing expansion helper** `replacePatternOverridesDefaultBinding(metadata.bindings, supportedAttributes)`: a Cover has an active binding iff, after expansion, the resulting object contains both `id` and `url` keys pointing to the same source. This is testable and aligns with the server-side semantics.

In either case, also update AC-6 (mismatched source) to clarify that `__default` resolves to "same source" for all expanded attributes and therefore CANNOT mismatch by construction; only explicit per-attribute bindings can mismatch.

**Why it matters:** Pattern Overrides is the spec's headline use case (explicit in the Overview paragraph and the prompt). The Glossary as written silently breaks the headline use case for control hiding and render-time effective values. Two implementers reading the spec would build different things: one might literally implement `bindings.id && bindings.url` and ship a regression on Pattern Overrides; another might guess that `__default` should "count" and ship something that works but doesn't match the spec. The e2e test (AC-22, AC-23) would not pass against the literal Glossary reading. This is the single most consequential bug in the spec because it conflates the server-side data model (post-expansion) with the client-side data model (pre-expansion).

### Issue 2: OQ-3's claim that "the HTML Tag Processor can perform element replacement" is materially inaccurate [minor]

**What's wrong:** OQ-3 says:

> The HTML Tag Processor can perform element replacement when the element is uniquely identifiable by class (`wp-block-cover__image-background`).

In the WordPress HTML API (`WP_HTML_Tag_Processor`), there is no `set_tag()` or "swap element type" operation. You can mutate attributes, classes, and inner HTML (via `WP_HTML_Processor` and bookmarks), but you cannot change a `<div>` into an `<img>` — that requires string-level substitution outside the Tag Processor's mutation API. Verified by grep: no `set_tag` / `change_tag` references exist in the codebase.

OQ-3 is the open question that nominally lets the design phase pick its mechanism, so this is not literally a runtime contradiction. But it baits the design phase into picking an approach that doesn't work. The actual feasible mechanisms are:
- Process the saved markup with a regex / string replace (fragile),
- Use the higher-level `WP_HTML_Processor` with bookmarks + inner-HTML replacement (still requires re-emitting the tag),
- Move the entire `<img>` injection logic into the cover's PHP `render_callback` (skipping the saved markup entirely when bindings are active — this is the Approach A in OQ-1).

**Where in spec:** Open Questions → OQ-3.

**Suggestion:** Rephrase OQ-3 to acknowledge the API constraint:

> OQ-3. Saved-markup parallax/repeat replacement mechanism. When a Cover saved with `hasParallax: true` and/or `isRepeated: true` gains a binding, the server-render must emit `<img>` instead of `<div style="background-image: ...">`. The WP HTML Tag Processor cannot rewrite a `<div>` into an `<img>` directly. Two feasible approaches: (i) detect the parallax case in `render_block_core_cover`, replace `$content` wholesale (or its image fragment) with a rebuilt `<img>` HTML string, or (ii) make `render_block_core_cover` ignore the saved image markup entirely when bindings are active and synthesise the full `<img>` from resolved `url`/`id`. Design picks one; both honour AC-19.

This is a minor wording fix; it doesn't change the AC contract.

**Why it matters:** Design phase will likely correct this within minutes of starting work, but flagging it now saves a wasted exploration cycle. Also tightens the link between the spec's HTML-API-limits Risk #5 (which is correct) and OQ-3's mechanism claim (which contradicts Risk #5 by implication).

### Issue 3: AC-21 leaves embed-video URL substitution behaviour ambiguous [minor]

**What's wrong:** AC-21 says:

> Given an existing Cover with `backgroundType: "embed-video"`, when the editor opens the bindings UI, then the panel still lists `url`/`id` as bindable; but neither the binding-aware editor derivations nor the binding-aware server-render path engage — the existing embed render flow runs unchanged regardless of binding presence.

"The existing embed render flow runs unchanged regardless of binding presence" — does this mean the bound `url` is substituted into the embed iframe URL (so the iframe shows the bound embed URL), or does the embed render path use the saved `url` only? The Out-of-Scope bullet on embed-video says "No `<img>` substitution, no class rewrite, no parallax strip is performed on embed-video covers under this PR" — but it does not state whether basic URL substitution into the embed iframe happens.

Two implementers could read AC-21 + Out-of-Scope as:
- (a) The bound `url` is substituted; only the binding-aware derivations (dim ratio, overlay colour) and the `<img>` rewrite are short-circuited. The embed iframe's `src` attribute does get the bound URL. This requires `gutenberg_replace_html` or equivalent to run on the embed iframe.
- (b) The whole binding processing path is bypassed for embed-video; the embed iframe shows the saved URL only.

The phrase "binding-resolution server path MUST NOT engage for embed-video covers" in Req 22 leans toward (b) — but (a) would be more consistent with "the user is allowed to bind the URL and the panel shows the bindable rows".

**Where in spec:** Acceptance Criteria → AC-21; Cross-cutting invariants → Req 22; Out of Scope → Embed-video bullet.

**Suggestion:** Pick one interpretation. The cheap and conservative choice is (b): the entire bindings server path bypasses for `backgroundType === "embed-video"`. Add to AC-21:

> When `backgroundType === "embed-video"`, the rendered embed iframe URL is the saved attribute URL, NOT the bound URL. Binding the URL of an embed-video Cover has no observable runtime effect under this PR (out-of-scope per Out-of-Scope).

This makes the contract testable and unambiguous.

**Why it matters:** Minor — embed-video × bindings is OOS so this only affects whether a user who tries the combination gets a coherent result or a surprising one. But the e2e test (AC-21 derivative) cannot be written until the interpretation is locked.

## Recap

Reject reason: Issue 1 is a real spec-level defect that silently breaks the headline use case. Until "active binding" recognises the standard `__default` shape, the spec is not implementable for Pattern Overrides without an implementer making their own interpretation. Issues 2 and 3 are minor and could ship for design-phase resolution if Issue 1 is fixed, but they are cheap to address in the same rewrite pass.
