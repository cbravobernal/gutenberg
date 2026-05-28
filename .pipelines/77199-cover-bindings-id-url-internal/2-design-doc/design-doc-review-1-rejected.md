# Design Doc Review

## Verdict: rejected

## Summary

The design doc has a solid skeleton: OQ-1/2/3/4 are chosen explicitly with rejected-alternative trade-offs; the single-observer architecture under `useEffectEvent` directly addresses Risk 1 / DC-1; the file table is concrete; Pattern Overrides routing is correctly delegated to `withPatternOverrideControls` + `replacePatternOverridesDefaultBinding`; and the spec's `__default` expansion finding (iter-2) is correctly threaded through both client and server. However, four substantive issues prevent approval:

1. The chosen WP_HTML_Tag_Processor byte-offset helpers cited as "public" do not exist on `WP_HTML_Tag_Processor` — OQ-3's chosen mechanism rests on a fictional API surface.
2. AC-13 / Req 6 (hide "Use featured image" toggle in EVERY surface) is incompletely satisfied — `cover-placeholder.js` exposes a second toggle site that the gating plan does not actually gate.
3. AC-18 (no double `<img>` for featured image when binding is active) has a real architectural hole on Core 6.9+ where `render_callback` runs BEFORE the priority-9 filter with the bound url already merged into `$instance->attributes`, meaning the featured-image element is already injected into `$content` before our filter sees it — and the design's "`$instance->attributes['useFeaturedImage'] = false`" mutation only suppresses the priority-10 re-render leg, not the already-injected first-pass markup.
4. Internal contradictions between §2.2 (files touched: `cover-placeholder.js` change) and §5.5 ("no second-site gating is needed") leave the design ambiguous about where the placeholder copy lives and where gating happens.

Several smaller traceability / clarity issues compound these. Detailed below.

## Issues

### Issue 1 (blocker): OQ-3's chosen mechanism relies on non-existent `WP_HTML_Tag_Processor` methods

**What's wrong:** The design (§3 OQ-3 and §6.2) cites the public methods `WP_HTML_Tag_Processor::get_token_byte_offset_in_source_text()` and `get_full_token_length()` as the mechanism for computing splice byte ranges. These methods **do not exist** on `WP_HTML_Tag_Processor` in the WordPress version range targeted (verified against `wp-includes/html-api/class-wp-html-tag-processor.php` — the class exposes `$token_starts_at` and `$token_length` only as **private** properties; the public method list in the file has no `get_token_byte_offset_in_source_text` / `get_full_token_length` / `get_token_length_in_source_text`). The design also conflates `WP_HTML_Tag_Processor` and `WP_HTML_Processor::create_fragment` ("…using `WP_HTML_Tag_Processor` to locate the element and Tag-Processor bookmarks (via the source-text byte positions exposed through `get_token_byte_offset_in_source_text`/`get_token_length_in_source_text` on `WP_HTML_Processor::create_fragment`)…"), which is internally inconsistent — first naming `WP_HTML_Tag_Processor`, then attributing the helper methods to `WP_HTML_Processor`. Neither class exposes those methods publicly in WP trunk today.

**Where in design doc:** §3 OQ-3 (the "Concrete shape (pseudo-PHP, mechanism (i))" block) and §6.2.

**Suggestion:** Pick one of:
- (a) Commit to the `preg_match` fallback path the design already names as a Plan B (matching the regex pattern used by `render_block_core_cover` at `packages/block-library/src/cover/index.php:117-125`). Mark this as the primary mechanism for OQ-3 mechanism (i). Drop the byte-offset helper claim entirely or move it to "future micro-optimisation if Core gains public byte-offset accessors."
- (b) Use `WP_HTML_Processor::create_fragment` with bookmark-bounded `seek` and explicit `get_updated_html()` substring extraction — but this needs a concrete code shape verified against trunk APIs, not just an asserted method name.

**Why it matters:** OQ-3 is the load-bearing decision for AC-19. A mechanism that doesn't exist isn't a mechanism. Implementation phase will hit this immediately and have to redesign on the fly; the design phase is exactly where this should be settled. The spec called this a "genuinely architectural HOW choice" — the resolution has to be implementable.

---

### Issue 2 (blocker): AC-13 / Req 6 coverage gap — second "Use featured image" toggle site in `cover-placeholder.js`

**What's wrong:** AC-13 / Req 6 require the "Use featured image" toggle to be hidden in **every surface where it appears** when a binding is active. The design (§5.5) explicitly enumerates only `block-controls.js` as the toggle's render site: "The `<MediaReplaceFlow>` (`onToggleFeaturedImage` + `useFeaturedImage` props at `block-controls.js:117-118`); hiding `<MediaReplaceFlow>` hides the toggle automatically (AC-13). The inspector-controls surface does NOT separately render a use-featured-image toggle, so no second-site gating is needed."

This misses `packages/block-library/src/cover/edit/cover-placeholder.js`, which renders a `<MediaPlaceholder ... onToggleFeaturedImage={ toggleUseFeaturedImage }>` (lines 20, 37). This placeholder is invoked from the empty-cover branch in `index.js:599-635` (the `! useFeaturedImage && ! hasInnerBlocks && ! hasBackground` branch). A Cover that has bindings but a not-yet-resolved URL (e.g. the network is slow, or the user just inserted a synced-pattern instance with the binding active) can land in that empty branch and expose the "Use featured image" affordance — which AC-13 forbids. The same flow also exposes a media-upload affordance via `<MediaPlaceholder onSelect={ onSelectMedia }>`, conflicting with AC-14 (media-replace hidden under active binding).

The §2.2 files-touched table DOES list `cover-placeholder.js` as a touched file ("New 'internal media required' Placeholder copy gated by `bindingUnresolvable`"), but the §5.5 text contradicts this by claiming no second-site gating is needed. The two halves of the doc disagree.

**Where in design doc:** §2.2 (files touched table, last line for `cover-placeholder.js`) versus §5.4 (the Placeholder rendered inside `index.js`'s render tree) versus §5.5 ("no second-site gating is needed").

**Suggestion:**
- Decide explicitly: does `bindingUnresolvable` route through `cover-placeholder.js` (modifying it to render a different message + suppress the upload/featured-image affordances when bound) OR through a sibling Placeholder in `index.js` (in which case `cover-placeholder.js` does not need touching but the empty-cover branch must early-return on `bindingActive || bindingUnresolvable`).
- Add the explicit gating for the empty-cover branch (`index.js:599`): "When `bindingActive || bindingUnresolvable`, the empty-cover branch MUST NOT render the standard `<CoverPlaceholder>` exposing the featured-image / media-upload affordances; it MUST render the 'internal media required' Placeholder instead OR (when `bindingActive` resolves later) defer until `effectiveUrl` arrives." Either path is fine — the design has to pick one and document it.

**Why it matters:** AC-13 explicitly says "every surface where it appears". Without addressing `cover-placeholder.js`, the e2e test (AC-23) on a freshly-inserted bound Cover that has not yet resolved its URL will fail. DC-2 is also at indirect risk: the `cover-placeholder.js` upload path calls `onSelectMedia` which mutates `url`/`id`/`useFeaturedImage` on the cover — a user-initiated mutation, so DC-2 is technically satisfied, but the spec's intent (Req 7, AC-14) is to *prevent the affordance entirely* under active binding.

---

### Issue 3 (blocker): AC-18 — "$instance->attributes['useFeaturedImage'] = false" does not undo `render_callback`'s first-pass featured-image injection on Core 6.9+

**What's wrong:** The design (§6.1, comment block "(C) Suppress the useFeaturedImage injection…") asserts that mutating `$instance->attributes['useFeaturedImage'] = false` at priority 9 prevents double image insertion. The accompanying comment is careful: "Setting useFeaturedImage=false here applies only to the gutenberg_block_bindings_render_block re-render at priority 10".

On **Core 6.9+**, this leaves the AC-18 contract unmet for the first render pass:

1. `WP_Block::render()` (verified at `wp-includes/class-wp-block.php:531-535`) calls `$this->process_block_bindings()` and merges resolved bindings into `$this->attributes` BEFORE invoking the `render_callback` (line 596).
2. Core 6.9+ exposes `core/cover` as a binding-supported block once our `block_bindings_supported_attributes` filter adds `id`/`url`. So Core's own `process_block_bindings` resolves the bound url/id and merges them into `$instance->attributes` — including any post-resolution `useFeaturedImage` (which is unchanged from saved).
3. `render_block_core_cover` runs with `useFeaturedImage: true` (the saved value) AND the bound url already substituted. If `backgroundType === 'image'` and `useFeaturedImage === true`, it injects a featured-image `<img>` (lines 137–197 of `packages/block-library/src/cover/index.php`) AFTER the existing `wp-block-cover__inner-container`. `$content` now has TWO `wp-block-cover__image-background` elements: the saved cover image AND the injected featured image.
4. Priority-9 filter runs on this `$content`. `gutenberg_cover_bindings_rewrite_image` rewrites the FIRST matching element — but which one is "first" depends on saved-markup ordering vs. injection position, and even if rewritten, the SECOND injected element remains. Double-image violation per AC-18.

The design's mitigation (mutate `$instance->attributes['useFeaturedImage'] = false`) takes effect only for the **second** render pass (the priority-10 generic filter that calls `$instance->render()` again), not the first one — and the first pass is the one that produced the `$content` we're filtering.

**Where in design doc:** §6.1 Part 2, comment block "(C) Suppress the useFeaturedImage injection in render_block_core_cover". Also §12 ("`useFeaturedImage` precedence rule" bullet) repeats the same claim.

**Suggestion:** Choose explicitly between:
- (a) **Pre-resolve and strip approach** — In the priority-9 filter, after detecting `bindingActive` and resolving the bound url, additionally search `$content` for ALL elements matching `class_name => 'wp-block-cover__image-background'`. If more than one is found, remove all but the first AND set the survivor's src to the bound url. Document this as the AC-18 path.
- (b) **Intercept earlier** — Hook `render_block_data` (which runs before `render_callback`) to mutate the parsed-block's attributes (`useFeaturedImage = false` and seed the bound url into `attrs['url']`) so `render_callback` skips the featured-image injection entirely. This requires careful interaction with Core's `process_block_bindings`.
- (c) **Acknowledge the gap** — Document explicitly that on Core 6.9+ the design relies on `render_callback`'s early-return path being hit when `useFeaturedImage` is false (the typical case), and that the rare `useFeaturedImage: true + bindingActive` case is handled by a content-level strip of the duplicate `wp-block-cover__image-background` after `render_callback`. Tie this back to the §6.5 PHPUnit case #7.

**Why it matters:** AC-18 is one of the spec's enumerated server-side correctness contracts. The current design says it's handled but the mechanism doesn't actually handle the first-pass injection. This is the kind of detail PR review will catch immediately.

---

### Issue 4 (major): Internal inconsistency between §5.4 (Placeholder rendered in `index.js`) and §2.2 / §5.5 (placeholder copy in `cover-placeholder.js`)

**What's wrong:** §2.2 files-touched table says `cover-placeholder.js` is touched to add "New 'internal media required' Placeholder copy gated by `bindingUnresolvable`". §5.4 render-tree changes show the `<Placeholder data-testid="cover-binding-unresolvable">` rendered inline in `CoverEdit`'s render tree, alongside the existing image-rendering branch — not inside `<CoverPlaceholder>`. §5.5 then asserts no second-site gating is needed (which would be inconsistent with editing `cover-placeholder.js`). Two implementers reading this design will disagree on whether the new Placeholder lives in `index.js` or `cover-placeholder.js`, and whether `cover-placeholder.js` gets gated on `bindingActive`.

**Where in design doc:** §2.2 (`cover-placeholder.js` row), §5.4 (Placeholder inline in `index.js`), §5.5 (no second-site gating).

**Suggestion:** Pick one location for the unresolvable-affordance Placeholder. Recommended: render the new Placeholder inline in `index.js` (matching §5.4), AND additionally gate `cover-placeholder.js`'s `<MediaPlaceholder>` so that when `bindingActive` or `bindingUnresolvable` is true the empty-cover branch (`index.js:599`) either renders the unresolvable Placeholder or suppresses the upload/featured-image affordances. Update §2.2 to reflect whatever is decided. Remove the §5.5 "no second-site gating is needed" claim if cover-placeholder.js is gated.

**Why it matters:** Ambiguity between two physical render sites is the canonical "two implementers, two different results" failure that the design phase exists to prevent.

---

### Issue 5 (major): Test-observable signal for AC-24 is not yet a stable contract

**What's wrong:** OQ-6 introduces `data-testid="cover-binding-unresolvable"` and the i18n string `__( 'Internal media required for this binding.' )` as the test-observable signal. The design says "adding it to the requirements vocabulary" — but neither the spec nor the design enforce that this `data-testid` is preserved across implementations / translations / future refactors. A reviewer who removes the `data-testid` because "test-only props in production DOM smell bad" can silently break the e2e test (AC-24).

Additionally, the spec's Req 16 wording is "a stable, test-observable signal — a known i18n message string (or equivalent stable identifier) accessible to the e2e test." The design picks BOTH `data-testid` AND the i18n string. The e2e test should pick one as primary; the spec preference is the i18n string. Using `data-testid` as the primary contract for the e2e test introduces a non-i18n coupling that may not survive Core upstreaming.

**Where in design doc:** §3 OQ-6, §5.4 sketch, §11.3 e2e test outline.

**Suggestion:**
- Name the i18n message string as the **primary** test-observable contract (per spec Req 16: "a known i18n message string"). Use `getByText( __( '…' ) )` or equivalent locator in the e2e test.
- Keep `data-testid` as a **secondary** stability hook with a comment explaining that it exists specifically to survive translation regressions during e2e. Document this in the design as "primary: i18n string match; fallback: `data-testid`".
- Or commit to `data-testid` only and document why the spec's i18n-string contract is being downgraded — but be explicit about it.

**Why it matters:** Without a primary/secondary ordering, the next refactor will pick whichever feels right and break the other — exactly the silent-regression hazard the spec wanted to preclude.

---

### Issue 6 (major): "Embed video from URL" affordance is silently disabled as a side effect of hiding `<MediaReplaceFlow>`

**What's wrong:** `block-controls.js:122-133` renders a `<MenuItem icon={link}>Embed video from URL</MenuItem>` as a **child** of `<MediaReplaceFlow>`. The design (§5.5) says to wrap the entire `<MediaReplaceFlow>` in `! bindingActive && ...`. This silently removes the "Embed video from URL" affordance from any Cover that has an active binding — including embed-video Covers with bindings (which the spec / AC-21 explicitly preserves as a working scenario for non-binding-affecting behavior, just without binding substitution).

Per AC-21: "Binding the `url`/`id` of an embed-video Cover has no observable runtime effect under this PR" — but the spec does NOT say the editor UI for changing the embed video URL must be hidden. The design's wrapping decision hides that affordance as a side effect that the spec does not require.

**Where in design doc:** §5.5 (the `<MediaReplaceFlow>` wrapping rule).

**Suggestion:** Either:
- (a) Restructure the gating to wrap only the parts of `<MediaReplaceFlow>` that surface the replace + featured-image controls, leaving the embed-video `<MenuItem>` accessible. Likely needs a separate toolbar `<ToolbarButton>` for the embed-URL flow when `bindingActive`.
- (b) Acknowledge in the design that "Embed video from URL" is also hidden under active binding, and trace this to a spec requirement. If no spec requirement covers it, this is feature scope creep beyond what the spec requires.

**Why it matters:** The spec is explicit about WHAT is hidden under active binding (parallax / repeat / media-replace / use-featured-image). Hiding other affordances by accident is a scope creep / scope contradiction that PR review will flag.

---

### Issue 7 (minor): `useEffectEvent` semantics for the observer — async race-token guard placement

**What's wrong:** §5.2 sketch:
```js
const onUrlResolved = useEffectEvent( async ( resolvedUrl ) => {
    if ( ! resolvedUrl ) return;
    const raceToken = ++raceTokenRef.current;
    const avg = await getMediaColor( resolvedUrl );
    if ( raceToken !== raceTokenRef.current ) return; // stale
    ...
} );
useEffect( () => {
    onUrlResolved( effectiveUrl );
}, [ effectiveUrl, onUrlResolved ] );
```

`useEffectEvent` is documented as a way to read latest values WITHOUT being reactive. Including `onUrlResolved` in the dep-array is correct per React docs (it's stable across renders), but the design doesn't explain *why* the race-token guard is placed in the body of `useEffectEvent` rather than as a cleanup of `useEffect`. React's recommendation for stale-async guarding inside an effect is a cleanup function setting an `isCancelled` flag — the race-token-via-ref pattern works but is non-idiomatic and easy to get wrong.

Also: the design says `raceTokenRef` is a Ref but doesn't show where it's declared. Implementers will need to add `const raceTokenRef = useRef( 0 );` somewhere; the design should sketch this.

**Where in design doc:** §5.2.

**Suggestion:** Either:
- (a) Switch to a `useEffect` cleanup-flag pattern: `let cancelled = false; ... if (cancelled) return; ... return () => { cancelled = true; };`. Simpler, no extra ref. The trade-off with `useEffectEvent` is that the cleanup needs to capture the effect's variables, which still works.
- (b) Keep the race-token-ref pattern but document the `useRef` declaration explicitly and explain why the ref-based guard was preferred (e.g. "to share the guard across multiple `useEffectEvent` invocations triggered by independent dependency-array changes").

**Why it matters:** Req 13's contract ("MUST be resilient against concurrent async `getMediaColor` resolutions") is enforced here. An implementer who copies the sketch verbatim without declaring `raceTokenRef` will get a runtime error; an implementer who switches to the cleanup-flag pattern (because they think it's cleaner) will diverge from the design.

---

### Issue 8 (minor): Sanity-check on `bindingResolvedId` is missing alongside other `useSelect` reads — potential excessive re-renders

**What's wrong:** §5.1 step 4: "Sanity-check `bindingResolvedId` against the media library via `select( coreStore ).getEntityRecord( 'postType', 'attachment', bindingResolvedId, { context: 'view' } )`". This is a network-blocking record fetch on every re-render where `bindingResolvedId` changes. The existing cover code (`inspector-controls.js:142-153`) does the same thing for `id`, but bounded by `id && isImageBackground` — i.e. only when the user explicitly has an image background. The new check fires on every Cover with bindings, even when the binding isn't being interactively edited.

For Pattern Overrides with many bound Covers on a single page, this multiplies the entity record fetches. Acceptable for v1 but the design doesn't acknowledge the cost or propose a deduping strategy (e.g. memo'd by id, or `select` predicate `( select ) => id ? select(coreStore).getEntityRecord(...) : null`).

**Where in design doc:** §5.1 step 4.

**Suggestion:** Add a memoization note: "`bindingResolvedId` is read inside the same `useSelect` as the source's `getValues` call, with dependencies `[ bindingResolvedId, clientId ]`. Avoid a separate `useSelect` for each lookup." Or explicitly call out that the cost is bounded by `bindingActive && bindingResolvedId !== undefined`.

**Why it matters:** Performance hazards that surface only with many bound blocks on a page will be hard to debug after merge. The design phase is the right place to flag them.

---

### Issue 9 (minor): Missing trace for AC-26 / AC-27 / AC-28 (PR-shape ACs)

**What's wrong:** AC-26 (file path `lib/compat/wordpress-7.1/block-bindings.php`), AC-27 (PR description content), AC-28 (~500 line budget) — the design covers AC-26 via §6.1 and §2.2, but AC-27 and AC-28 are not mentioned anywhere in the design doc. AC-27 is arguably a PR-creation step rather than a design concern, but AC-28's ~500-line budget IS a design constraint — it shapes how much new code is acceptable.

**Where in design doc:** Missing trace section for ACs 26–28.

**Suggestion:** Add a short paragraph in §12 or §14 acknowledging the ~500-line budget (AC-28) and stating the design's expected diff size. The design as outlined (~150 lines in the new PHP file, modest JS hook additions, a few JSX gating changes, the test additions) plausibly fits, but spelling this out keeps the design honest.

**Why it matters:** A spec AC with no trace in the design is a coverage gap by definition. The PR-shape ACs are testable post-hoc but should be acknowledged.

---

### Issue 10 (minor): `gutenberg_cover_bindings_expand` referenced but not defined

**What's wrong:** §6.1 Part 2 calls `gutenberg_cover_bindings_expand( $bindings )` to handle `__default` expansion server-side, but no definition is given. The design says elsewhere (§9) that the server uses `gutenberg_process_block_bindings` for expansion. The introduction of a separately-named helper without a definition leaves implementers to guess: is it a new helper, or just an internal reference to `gutenberg_process_block_bindings`'s inline expansion logic (which is private)?

**Where in design doc:** §6.1 Part 2 (the `if ( empty( $expanded['id'] ) || empty( $expanded['url'] ) ) ...` block).

**Suggestion:** Either define `gutenberg_cover_bindings_expand` inline (likely a copy of the `__default` expansion logic from `lib/compat/wordpress-6.9/block-bindings.php:257-281`, scoped to `[ 'id', 'url' ]`), or replace the call with the call to `gutenberg_process_block_bindings` (which already does the expansion as a side effect) — but then the design must clarify how the priority-9 filter detects the expanded bindings WITHOUT calling `gutenberg_process_block_bindings` twice (once for the bindingActive check, once for value resolution).

**Why it matters:** A pseudocode reference to a function that doesn't exist is a hidden dependency. The design doc's job is to surface these.

---

### Issue 11 (minor): Backport-changelog entry conditional language is too loose

**What's wrong:** §2.2 last row says "`backport-changelog/7.1/<core-pr>.md` — One-line entry when Core PR exists". The spec's Req 36 / AC-26 mandate the backport-changelog file when the Core PR exists. The design's wording (`<core-pr>` is a placeholder) doesn't commit to a path or to *when* the file is created — at PR-open time? After Core PR opens? The design phase is too early to know the Core PR number, but the design should commit to creating the file as a deferred follow-up.

**Where in design doc:** §2.2 last row.

**Suggestion:** Reword to: "Created when the corresponding Core PR is filed; tracked as a PR comment or follow-up task. Not a blocker for the Gutenberg PR landing." Or: "Created at the same time as the Core PR; the Gutenberg PR description includes the placeholder and is updated once the Core PR number is known."

**Why it matters:** Minor, but the design should not contain unresolved placeholders.

---

## Coverage summary

| AC                 | Traced in design                                                | Adequately addressed                                            |
| ------------------ | --------------------------------------------------------------- | --------------------------------------------------------------- |
| AC-1               | §8                                                              | Yes                                                             |
| AC-2               | §5.6, §9                                                        | Yes                                                             |
| AC-3               | §5.4, §6.5(1)                                                   | Yes                                                             |
| AC-4               | §5.4, §10, OQ-6                                                 | Partial — Issue 4, Issue 5                                      |
| AC-5               | §6.4                                                            | Yes                                                             |
| AC-6               | §6.4, §10                                                       | Yes                                                             |
| AC-7..AC-10        | §5.6, §9, OQ-2                                                  | Yes                                                             |
| AC-11..AC-12       | §5.5                                                            | Yes                                                             |
| AC-13              | §5.5                                                            | **No — Issue 2 (cover-placeholder.js gap)**                     |
| AC-14              | §5.5                                                            | Partial — Issue 2 (cover-placeholder.js upload affordance), Issue 6 (embed-video MenuItem side effect) |
| AC-15..AC-17       | §5.2, §5.4, §6.3, OQ-4                                          | Yes                                                             |
| AC-18              | §6.1(C), §12                                                    | **No — Issue 3 (first-pass injection not undone)**              |
| AC-19              | §6.2, OQ-3                                                      | **No — Issue 1 (mechanism uses non-existent API)**              |
| AC-20              | §12                                                             | Yes                                                             |
| AC-21              | §6.1, Risk 4                                                    | Yes (but see Issue 6)                                           |
| AC-22..AC-24       | §11.3                                                           | Partial — depends on Issues 2 & 5                               |
| AC-25              | §6.5                                                            | Yes                                                             |
| AC-26              | §2.2, §6.1                                                      | Yes                                                             |
| AC-27              | (not traced)                                                    | **No — Issue 9 (missing trace)**                                |
| AC-28              | (not traced)                                                    | **No — Issue 9 (missing trace)**                                |

## Open Questions resolution check

| OQ    | Choice                          | Rationale + rejected alternatives traced | Verdict                                  |
| ----- | ------------------------------- | ----------------------------------------- | ---------------------------------------- |
| OQ-1  | Approach A                      | Yes, with trade-off table in §13          | OK                                       |
| OQ-2  | Disable                         | Yes                                       | OK                                       |
| OQ-3  | Mechanism (i)                   | Yes — but mechanism uses non-existent API | **Fail — Issue 1**                       |
| OQ-4  | 50                              | Yes                                       | OK                                       |
| OQ-5  | Render-time force-off           | Yes                                       | OK                                       |
| OQ-6  | data-testid + i18n string       | Partial — primary/secondary not ordered   | **Partial — Issue 5**                    |

## Risks mitigation check

| Risk                                          | Mitigation                                                           | Adequate                                  |
| --------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------- |
| 1. Ockham single-observer                     | §5.2 single useEffect on `effectiveUrl`, useEffectEvent              | Yes (modulo Issue 7 race-token clarity)   |
| 2. Pattern Overrides reset                    | §5.6 reuse withPatternOverrideControls + ResetOverridesControl       | Yes                                       |
| 3. dimRatio: 100 default                      | §5.2/§5.4 effectiveDimRatio + §6.3 server class strip                | Yes                                       |
| 4. Embed-video collision                      | §6.1 short-circuit at both ends                                      | Yes (modulo Issue 6 unintended UI hide)   |
| 5. HTML API can't edit CSS-in-`style`         | §6.2 element-replace via byte-offset splice                          | **No — Issue 1 (API doesn't exist)**      |
