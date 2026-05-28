# Design Doc: Cover block bindings — internal-only `id` and `url`

Spec: `<artifacts>/1-spec/spec.md` (approved). All AC and DC references below resolve to that file.

## 1. Overview

`core/cover` ships Block Bindings support for `id` and `url` restricted to internal media-library attachments, headlined by Pattern Overrides. When a binding is active (post-`__default`-expansion: `id` AND `url` bound to the same source instance), the Edit component (a) hides parallax, repeat, media-replace and use-featured-image controls, (b) reactively derives `overlayColor`, `effectiveDimRatio`, `effectiveUrl` from the resolved `url` through a **single observer** wired via `useEffectEvent`, and (c) never mutates stored attributes on binding state transitions. The server (a Cover-scoped `render_block` filter in a new compat file) substitutes the bound `url` into the cover's `<img>`, rewrites `has-background-dim-100` to `has-background-dim-50` when the stored ratio is the default, and rebuilds the parallax/repeat `<div style="background-image:…">` into a plain `<img>` when bindings have resolved a value. Embed-video covers short-circuit both client and server binding paths.

## 2. Architecture

### 2.1 ASCII data flow

```
                            ┌─────────────────────────────────────────────────┐
                            │  metadata.bindings (with __default expansion)   │
                            └───────────────┬─────────────────────────────────┘
                                            │
                            ┌───────────────┴────────────────┐
                            │                                │
                            ▼                                ▼
       ┌───────────────────────────────────┐   ┌──────────────────────────────────┐
       │ CLIENT  (packages/block-library/  │   │ SERVER (PHP)                     │
       │         src/cover/edit/index.js)  │   │                                  │
       ├───────────────────────────────────┤   ├──────────────────────────────────┤
       │ useBindingState() hook (NEW)      │   │ render_block (priority 9)        │
       │   - expandedBindings              │   │   gutenberg_cover_bindings_      │
       │   - bindingActive  (id+url, same  │   │     render_block( $content,      │
       │       source instance)            │   │       $block, $instance )        │
       │   - bindingResolvedUrl/Id (from   │   │     ↑ runs BEFORE                │
       │       source.getValues via        │   │       gutenberg_block_bindings_  │
       │       useSelect)                  │   │       render_block (priority 10) │
       │   - bindingUnresolvable  (id      │   │                                  │
       │       missing / mismatch / not    │   │   if bindingActive &&            │
       │       attachment / external)     │   │      backgroundType !=='embed-   │
       │                                   │   │      video':                     │
       │ Effective values (derived, no    │   │     1. resolve url/id from       │
       │   setAttributes):                 │   │        gutenberg_process_block_  │
       │   - effectiveUrl = bindingResolvedUrl │      bindings()                  │
       │       ?? (useFeaturedImage?       │   │     2. if id missing/not in      │
       │             mediaUrl : originalUrl)   │        media library → strip     │
       │   - effectiveDimRatio = (bindingActive│        <img>/<div bg> entirely;  │
       │       && dimRatio===100 &&             │        early return             │
       │       effectiveUrl) ? 50 : dimRatio    │     3. compute newDimRatio (50  │
       │   - lockUrlControls = bindingActive   │        if 100 default && url)    │
       │       && !canUserEditValue            │     4. rewrite cover via         │
       │                                   │   │        WP_HTML_Tag_Processor:    │
       │ Single observer (useEffect on    │   │          - swap <div bg-image>   │
       │   effectiveUrl):                  │   │            ↳ rebuilt <img>      │
       │   - getMediaColor(effectiveUrl)   │   │          - <img src=…> updated   │
       │     ↳ setOverlayColor (if not    │   │          - drop has-parallax,    │
       │        user-set)                  │   │            is-repeated classes   │
       │   - propsRef guard + race-token  │   │          - swap has-background-  │
       │     to prevent stale overwrites   │   │            dim-100 → -50         │
       │                                   │   │     5. short-circuit            │
       │ CoverInspectorControls / Block-  │   │        useFeaturedImage branch   │
       │   Controls gated by               │   │                                  │
       │   bindingActive + lockUrlControls │   │   else if embed-video:           │
       └───────────────────────────────────┘   │     pass through unchanged       │
                                               └──────────────────────────────────┘
```

### 2.2 Files touched

| File | Role | Change |
| --- | --- | --- |
| `packages/block-library/src/cover/block.json` | Attribute schema | Add `"role": "content"` to `id` (AC-1, AC-2 prerequisite) |
| `lib/compat/wordpress-7.1/block-bindings.php` (NEW) | Server allow-list + Cover-scoped render filter | (a) `block_bindings_supported_attributes` filter adds `id`,`url` to `core/cover`; (b) `gutenberg_cover_bindings_render_block` filter on `render_block` priority 9 |
| `lib/load.php` | Bootstrap | `require __DIR__ . '/compat/wordpress-7.1/block-bindings.php';` in the REST-server block (alongside other 7.1 entries) |
| `packages/block-library/src/cover/edit/index.js` | Reactive observer, derived values | New `useCoverBindingState` hook, replace existing `useEffect([mediaUrl])` with a single observer on `effectiveUrl`, propagate derived values to children |
| `packages/block-library/src/cover/edit/inspector-controls.js` | UI gating | Gate parallax/repeat ToolsPanelItems on `! bindingActive` |
| `packages/block-library/src/cover/edit/block-controls.js` | UI gating | Conditionally render `<MediaReplaceFlow>` based on `! bindingActive`; hide "Use featured image" toggle (passed through `useFeaturedImage` prop of `MediaReplaceFlow`) when bound |
| `packages/block-library/src/cover/edit/cover-placeholder.js` | Unresolvable affordance | New "internal media required" Placeholder copy gated by `bindingUnresolvable` |
| `phpunit/blocks/render-block-cover-test.php` | PHPUnit | New cases: bound-url → `<img src=$bound>`; default `dimRatio:100` + binding → `has-background-dim-50`; mismatched/unresolvable → no `<img>` |
| `test/e2e/specs/editor/blocks/cover.spec.js` | E2E | New `describe('Block Bindings — Pattern Overrides')` block (AC-22..AC-24) |
| `backport-changelog/7.1/<core-pr>.md` | Metadata | One-line entry when Core PR exists |

No other Cover files change. No new `__experimental*` APIs are introduced. No `save.js`, `deprecated.js`, or block-list-renderer changes.

## 3. Open Questions resolved

### OQ-1: Server-side approach — Cover-scoped filter (chosen)

**Choice: Approach A — Cover-scoped `render_block` filter in `lib/compat/wordpress-7.1/block-bindings.php`.**

Concretely: one `add_filter( 'render_block', 'gutenberg_cover_bindings_render_block', 9, 3 )` that gates on `$block['blockName'] === 'core/cover'` and exits the filter for every other block.

**Rejected: Approach B (generic `block_bindings_attribute_replaced_in_markup` filter).**

Reasoning:
- Approach B (PR #74610) only solves `<img src>` substitution. It cannot rewrite the parallax/repeat `<div style="background-image:…">` markup (HTML API has no CSS-in-`style` mutation; AC-19, Risk 5) and cannot rewrite the `has-background-dim-100` class to a non-opaque variant (AC-16). Approach B therefore still needs a Cover-scoped supplementary path — at which point Approach A is strictly simpler.
- Approach B introduces a new global filter (`block_bindings_attribute_replaced_in_markup`) which the spec OQ flags as needing weighing. Approach A introduces zero new global APIs (Req 28, AC-out-of-scope on global APIs).
- Cover-scoped means zero risk of changing behaviour for any other block (Req 21). The generic-filter approach has cross-block reuse value, but no other block currently needs it; cost > benefit.
- Approach A keeps the entire substitution surface in one file (the new 7.1 compat file). Easier to review, easier to delete when Core absorbs the change.

**Traces to:** Req 21, Req 28, AC-16, AC-18, AC-19, Risk 5, Out-of-Scope item "New global Block Bindings APIs".

### OQ-2: Reset affordance — disable (chosen)

**Choice: keep existing `ResetOverridesControl` semantics: button is **disabled** (not removed from DOM) when the instance value matches the pattern default.**

Reasoning:
- Cover-specific code zero. Pattern Overrides controls are wired by `withPatternOverrideControls` in `packages/editor/src/hooks/pattern-overrides.js`; the toolbar `ResetOverridesControl` (line 84 of `packages/patterns/src/components/reset-overrides-control.js`) already renders `disabled={ ! isOverridden }`.
- Consistent with every other bindable block (paragraph, heading, image, button) — diverging would be a UX regression.
- Test-observability (AC-10) is preserved: e2e asserts `await expect( resetButton ).toBeDisabled()` rather than absence-from-DOM.

**Traces to:** AC-10, Req 24(d).

### OQ-3: Saved-markup parallax/repeat rewrite mechanism — bookmark-bounded substring replacement (chosen)

**Choice: Mechanism (i) — detect the parallax/repeat case in the new Cover render filter and replace the entire `<div class="wp-block-cover__image-background" style="background-image:url(…)">` fragment in `$content` with a rebuilt `<img>` HTML string, using `WP_HTML_Tag_Processor` to locate the element and Tag-Processor bookmarks (via the source-text byte positions exposed through `get_token_byte_offset_in_source_text`/`get_token_length_in_source_text` on `WP_HTML_Processor::create_fragment`) to compute the substring range to splice.**

If the saved markup is already the non-parallax/repeat form (plain `<img>`), the filter takes the simpler path: locate `<img class="wp-block-cover__image-background">` and `set_attribute( 'src', $resolved_url )` in place — no fragment splice needed.

Rejected: Mechanism (ii) "bypass saved markup entirely and synthesise the full `<img>` server-side from resolved `url`/`id`". Reasoning: it re-implements the entire cover markup server-side (classes, alt, focal-point `data-object-position`, `wp-image-{id}`, size slug), duplicating `save.js` logic. Risk of drift between client save and server output is real and would surface as classname diffs on subsequent re-edits. Mechanism (i) preserves the saved markup as the source of truth for everything that is not the URL/class/element-tag.

**Concrete shape (pseudo-PHP, mechanism (i)):**

```php
// $content is the saved Cover markup.
$processor = new WP_HTML_Tag_Processor( $content );
if ( $processor->next_tag( array(
    'tag_name'   => 'DIV',
    'class_name' => 'wp-block-cover__image-background',
) ) ) {
    // Parallax/repeat saved form. Compute byte range via the
    // processor's reported source position; splice in a rebuilt <img>.
    $start  = $processor->get_token_byte_offset_in_source_text();
    $length = $processor->get_full_token_length(); // div opener + content + closer
    $rebuilt_img = sprintf(
        '<img class="wp-block-cover__image-background%s" alt="%s" src="%s" data-object-fit="cover"%s />',
        $size_class,           // " wp-image-{$id} size-{$slug}"
        esc_attr( $alt ),
        esc_url( $resolved_url ),
        $object_position_attrs // optional data-object-position + style
    );
    $content = substr( $content, 0, $start ) . $rebuilt_img . substr( $content, $start + $length );
} else {
    // Plain <img> saved form: substitute src in place.
    $processor = new WP_HTML_Tag_Processor( $content );
    if ( $processor->next_tag( array(
        'tag_name'   => 'IMG',
        'class_name' => 'wp-block-cover__image-background',
    ) ) ) {
        $processor->set_attribute( 'src', $resolved_url );
        $content = $processor->get_updated_html();
    }
}
```

(`WP_HTML_Tag_Processor::get_token_byte_offset_in_source_text`/`get_full_token_length` are public; if a particular WP version lacks the closer-aware helper, fall back to `preg_match` on `/<div\s+[^>]*\bwp-block-cover__image-background\b[^>]*>\s*<\/div>/is` — the same pattern `render_block_core_cover` already uses on lines 117–125 of `packages/block-library/src/cover/index.php` for the embed-figure case.)

**Traces to:** AC-19, Risk 5, OQ-3 spec text.

### OQ-4: Non-opaque effective `dimRatio` — **50** (chosen)

**Choice: 50.**

Reasoning:
- Exact symmetry with the existing `onSelectMedia` event-handler downshift (`packages/block-library/src/cover/edit/index.js:244-247`: `currentAttrs.url === undefined && currentAttrs.dimRatio === 100 ? 50 : ...`). Same user-visible outcome whether the URL arrived via media selection or via a binding — the spec's source-agnostic invariant (DC-3) becomes self-enforcing.
- `dimRatioToClass( 50 ) === null` (see `packages/block-library/src/cover/shared.js:32-36`), so the overlay span emits `has-background-dim` without any `has-background-dim-N` modifier — i.e. the CSS default of 50% opacity. The class-rewrite on the server is therefore "remove `has-background-dim-100`", not "replace it with `has-background-dim-50`", which is mechanically simpler.

**Traces to:** AC-15, AC-16, Req 14, Req 18.

### OQ-5: Pre-existing `hasParallax=true` on a Cover that gains a binding — **render-time force-off** (chosen)

**Choice: do not migrate the saved attribute. At render time (both client and server) treat `hasParallax` and `isRepeated` as effectively `false` whenever `bindingActive && backgroundType !== 'embed-video'`. The stored attributes are untouched. The UI hides the toggles so the user cannot newly set them.**

Reasoning:
- DC-2 / Req 11 prohibit attribute mutation from binding-state changes. A migration would be exactly that, just on save-load instead of in an effect — same invariant violation.
- A deprecation chain change for what is essentially a render-time concern would force `deprecated.js` work and risks breaking saved unbound covers (AC-20 non-regression).
- The render-time path already has to strip `has-parallax`/`is-repeated` classes from the rebuilt `<img>` (see OQ-3 sketch) and the editor preview's `<img>` element is unconditional once `effectiveUrl` resolves (the existing `isImgElement = !(hasParallax || isRepeated)` check is bypassed in the bound-cover render branch — see §5.4). Force-off therefore comes free.

The "error" alternative was rejected: silently breaking a saved cover on load with no migration path would surprise pattern authors. Force-off + UI hide gives a clean transition where the parallax simply stops applying when the cover becomes a Pattern Overrides target — and resumes if the binding is removed.

**Traces to:** Req 11, DC-2, AC-19, AC-20.

### OQ-6 (newly identified): Test-observable signal for the "internal media required" affordance

**Choice: a `<Placeholder>` with a stable `data-testid="cover-binding-unresolvable"` attribute AND the i18n string `__( 'Internal media required for this binding.' )`.**

The e2e test (AC-24) locates by `data-testid` for stability across translations. The string is also a stable contract — adding it to the requirements vocabulary.

**Traces to:** Req 16, AC-4, AC-24.

## 4. Risks addressed

### Risk 1 — Ockham architecture gate (preempt with single-observer design)

Preempted by **§5 "Client-side design"**: every URL-derived piece of state (overlay color, effective dim ratio, effective URL, lock flags) flows from one `useEffect` keyed on `effectiveUrl`. There is no per-event `useEffect` for "binding detected" / "blur" / "media replaced". Existing event handlers (`onSelectMedia`, `toggleUseFeaturedImage`, `onClearMedia`, `onSetOverlayColor`, `onUpdateDimRatio`) keep their current side-effects on attributes (they mutate `url`, `id`, `dimRatio`, etc.) but no longer need to also compute overlay color — that is delegated to the observer. `useEffectEvent` reads `isUserOverlayColor`, latest `dimRatio`, and the current overlayColor without making them dep-array entries, eliminating stale-closure risk. The PR review checklist must tick **DC-1, DC-2, DC-3** explicitly per spec §"Design Constraints".

### Risk 2 — Pattern Overrides reset semantics

Preempted by **reusing the existing `withPatternOverrideControls` HOC and `ResetOverridesControl`** unchanged (OQ-2 chose disable-not-hide). Cover-side code adds zero Pattern-Overrides-specific logic. The four states (AC-7..AC-10) round-trip through the existing infrastructure once Cover is allow-listed by the server-side filter.

### Risk 3 — Default `dimRatio: 100` opacity

Preempted by **render-time `effectiveDimRatio = (bindingActive && dimRatio === 100 && effectiveUrl) ? 50 : dimRatio`** in the editor preview (passed through `dimRatioToClass`) AND by the server-side class rewrite (remove `has-background-dim-100` from the overlay span). The stored attribute remains 100 (DC-2, Req 11). When the user explicitly sets `dimRatio` to a non-default value, the conditional fails and the stored value is honoured (AC-17).

### Risk 4 — Embed-video collision

Preempted by an **explicit `backgroundType === 'embed-video'` short-circuit at both client and server**:
- Client: `useCoverBindingState` returns `bindingActive: false` when `backgroundType === 'embed-video'`, regardless of `metadata.bindings`. Derivations short-circuit; the existing oEmbed path runs as today (AC-21).
- Server: `gutenberg_cover_bindings_render_block` early-returns `$content` unchanged when `! empty( $attributes['backgroundType'] ) && 'embed-video' === $attributes['backgroundType']`. The existing `render_block_core_cover`'s embed-video branch (lines 18–131 of `packages/block-library/src/cover/index.php`) runs unmodified.

Bindings UI rows for `url`/`id` still appear (allowed by Req 27 / AC-21) but have no runtime effect on embed-video covers.

### Risk 5 — HTML API can't edit CSS-in-`style`

Preempted by **OQ-3 mechanism (i)**: never attempt to edit the CSS value inside `style="background-image: url(…)"`. Instead, locate the `<div class="wp-block-cover__image-background">` and **replace the entire element** with a rebuilt `<img>`. The substitution is a substring splice keyed by HTML-Tag-Processor byte offsets — no CSS parsing involved.

## 5. Client-side design

### 5.1 New hook: `useCoverBindingState`

Location: new file `packages/block-library/src/cover/edit/use-cover-binding-state.js`.

Exported shape:

```js
/**
 * @typedef {Object} CoverBindingState
 * @property {boolean}            bindingActive          true iff (after __default expansion) `id` AND `url` are bound to the same source instance AND backgroundType !== 'embed-video'.
 * @property {boolean}            bindingUnresolvable    true iff metadata.bindings has any cover-binding configuration that does not satisfy bindingActive (mismatched source, only one of id/url, external URL, id not resolvable as attachment).
 * @property {string|undefined}   bindingResolvedUrl     URL resolved from the bound source via useSelect( … getBlockBindingsSource(...).getValues ).
 * @property {number|undefined}   bindingResolvedId      ID resolved from the bound source.
 * @property {boolean}            canUserEditBindingValue Source.canUserEditValue() result; gates lockUrlControls.
 */
export default function useCoverBindingState( { clientId, attributes, context } ) { … }
```

Implementation outline:
1. Expand `attributes.metadata?.bindings` via `replacePatternOverridesDefaultBinding( bindings, [ 'id', 'url' ] )` from `packages/block-editor/src/utils/block-bindings.js`. Use `[ 'id', 'url' ]` as the supportedAttributes argument.
2. `bindingActive = expanded?.id && expanded?.url && expanded.id.source === expanded.url.source && JSON.stringify(expanded.id.args ?? null) === JSON.stringify(expanded.url.args ?? null) && backgroundType !== 'embed-video'`.
3. Resolve values via `useSelect`: for each `attr` in `[ 'id', 'url' ]`, look up `getBlockBindingsSource( expanded[attr].source ).getValues({ select, clientId, context, bindings: { [attr]: expanded[attr] } })[ attr ]`. The Pattern Overrides source returns the block's own attribute when no override is set (see `packages/editor/src/bindings/pattern-overrides.js:13-36`), so the "default state" naturally resolves to the block's pattern-default attribute value.
4. Sanity-check `bindingResolvedId` against the media library via `select( coreStore ).getEntityRecord( 'postType', 'attachment', bindingResolvedId, { context: 'view' } )` — if the record is `undefined` (still loading) treat as pending; if `null` (resolved, not found) treat as unresolvable.
5. `bindingUnresolvable = (hasAnyCoverBinding) && ! bindingActive` OR `bindingActive && bindingResolvedId resolves to null`.

The hook returns plain values; the consumer (`CoverEdit`) destructures them.

### 5.2 Single observer (in `CoverEdit`)

Replaces the existing `useEffect( [ mediaUrl ] )` block (`packages/block-library/src/cover/edit/index.js:163-201`). Source-agnostic per DC-3:

```js
// Derived: the URL the editor should display.
const effectiveUrl =
    bindingResolvedUrl ??
    ( useFeaturedImage ? mediaUrl : originalUrl?.replaceAll( '&amp;', '&' ) );

// Derived: effective dimRatio for preview-time class computation.
const effectiveDimRatio =
    bindingActive && dimRatio === 100 && effectiveUrl ? 50 : dimRatio;

// Latest non-tracked reads via useEffectEvent (eliminates stale closure pitfalls).
const onUrlResolved = useEffectEvent( async ( resolvedUrl ) => {
    if ( ! resolvedUrl ) return;
    const raceToken = ++raceTokenRef.current;
    const avg = await getMediaColor( resolvedUrl );
    if ( raceToken !== raceTokenRef.current ) return; // stale

    const { attributes: latestAttrs, overlayColor: latestOverlay } = propsRef.current;
    if ( ! latestAttrs.isUserOverlayColor ) {
        __unstableMarkNextChangeAsNotPersistent();
        setOverlayColor( avg );
    }
    const newIsDark = compositeIsDark(
        latestAttrs.dimRatio === 100 && latestAttrs.url ? 50 : latestAttrs.dimRatio, // mirror effectiveDimRatio
        latestAttrs.isUserOverlayColor ? latestOverlay.color : avg,
        avg
    );
    __unstableMarkNextChangeAsNotPersistent();
    setAttributes( { isDark: newIsDark } ); // isDark is NOT in the DC-2 prohibition list
} );

useEffect( () => {
    onUrlResolved( effectiveUrl );
}, [ effectiveUrl, onUrlResolved ] );
```

Key properties:
- **One** `useEffect`, keyed on `effectiveUrl`. The dependency array has stable references for everything else (DC-1).
- `useEffectEvent` (`@wordpress/element`, confirmed at `packages/element/build-module/react.mjs:23,97`) reads latest `attributes`, `overlayColor` without dep-array churn.
- A monotonically-increasing `raceTokenRef` (Req 13) prevents an older `getMediaColor` resolution from overwriting a newer one. Replaces the existing `propsRef`-only guard for the same purpose.
- `setAttributes` is called only for `isDark`, which is **not** in DC-2's prohibition list. The DC-2 list is `dimRatio`, `useFeaturedImage`, `backgroundType`, `id`, `url`, `hasParallax`, `isRepeated`, `overlayColor`, `customOverlayColor`.

### 5.3 Existing event handlers — unchanged

`onSelectMedia`, `onClearMedia`, `onSetOverlayColor`, `onUpdateDimRatio`, `toggleUseFeaturedImage`, `onSelectEmbedUrl` keep their current shapes. They already mutate stored attributes in response to **user intent** events (not binding state). DC-2 prohibits mutation triggered by binding state changes, not user-initiated mutations.

There is one nuance: the existing observer at lines 163–201 has a side-effect on `isDark`/`isUserOverlayColor`. The replacement observer above also writes `isDark`; `isUserOverlayColor` is left alone unless an event handler sets it.

### 5.4 Render-tree changes in `CoverEdit`

Around the existing image rendering (lines 672–693):

```jsx
{ bindingUnresolvable && (
    <Placeholder
        data-testid="cover-binding-unresolvable"
        className="wp-block-cover__binding-unresolvable"
        instructions={ __( 'Internal media required for this binding.' ) }
        withIllustration
    />
) }

{ ! bindingUnresolvable && effectiveUrl && isImageBackground && (
    bindingActive ? (
        // Force-img form: bindings override parallax/repeat
        <img
            ref={ mediaElement }
            className="wp-block-cover__image-background"
            alt={ alt }
            src={ effectiveUrl }
            style={ mediaStyle }
        />
    ) : (
        // unchanged existing branch (img-or-div based on isImgElement)
        …
    )
) }
```

And the overlay span class computation uses `effectiveDimRatio` rather than `dimRatio`:

```jsx
<span
    className={ clsx(
        'wp-block-cover__background',
        dimRatioToClass( effectiveDimRatio ),
        { 'has-background-dim': effectiveDimRatio !== undefined, … }
    ) }
/>
```

### 5.5 Control gating

`inspector-controls.js` (lines 223–260) — wrap the `<>` fragment containing the "Fixed background" and "Repeated background" `ToolsPanelItem`s in `! bindingActive && …`. Pass `bindingActive` as a new prop from `CoverEdit`.

`block-controls.js` (lines 111–135) — wrap the entire `<MediaReplaceFlow>` (which carries both the replace UI and the `useFeaturedImage` toggle via `onToggleFeaturedImage` + `useFeaturedImage` prop) in `! bindingActive && …`. Per AC-14, media-replace is hidden on **any** active binding including Pattern Overrides. Pattern Overrides authors edit the override via the pattern instance's outer media-replace pathway, not from within the cover.

Per Req 7 + AC-14: media-replace hides on bindingActive regardless of `canUserEditValue`. (The `canUserEditValue` distinction surfaces in `lockUrlControls`, which is still computed but currently only gates the Block Bindings panel's own per-attribute UI — not Cover's controls.)

The "Use featured image" toggle is rendered by `<MediaReplaceFlow>` (`onToggleFeaturedImage` + `useFeaturedImage` props at `block-controls.js:117-118`); hiding `<MediaReplaceFlow>` hides the toggle automatically (AC-13). The inspector-controls surface does NOT separately render a use-featured-image toggle, so no second-site gating is needed.

### 5.6 Pattern Overrides integration

Zero Cover-specific code. `withPatternOverrideControls` in `packages/editor/src/hooks/pattern-overrides.js` reads `__experimentalBlockBindingsSupportedAttributes?.[ blockName ]` (line 43); once the server-side filter (§6.1) adds `core/cover` to that list, the `<PatternOverridesControls>` "Enable overrides" button and the `<ResetOverridesControl>` toolbar button appear automatically (AC-2, AC-7..AC-10).

`replacePatternOverridesDefaultBinding` in `packages/block-editor/src/utils/block-bindings.js` is used directly inside `useCoverBindingState`. This is the **same** helper the Block Bindings panel uses and the **same** semantics the server's `gutenberg_process_block_bindings` expansion uses (`lib/compat/wordpress-6.9/block-bindings.php:257-281`). Client and server agree on expansion by construction.

## 6. Server-side design

### 6.1 File: `lib/compat/wordpress-7.1/block-bindings.php` (NEW)

Loaded from `lib/load.php` line ~83 alongside the other 7.1 REST-server-block entries:

```php
require __DIR__ . '/compat/wordpress-7.1/block-bindings.php';
```

Wrapped in `! function_exists( 'gutenberg_cover_bindings_render_block' )` per the established 7.1 backport pattern.

**Part 1 — allow-list filter:**

```php
if ( ! function_exists( 'gutenberg_cover_bindings_add_supported_attributes' ) ) {
    function gutenberg_cover_bindings_add_supported_attributes( $attributes, $block_type ) {
        if ( 'core/cover' === $block_type ) {
            foreach ( array( 'id', 'url' ) as $attr ) {
                if ( ! in_array( $attr, $attributes, true ) ) {
                    $attributes[] = $attr;
                }
            }
        }
        return $attributes;
    }
    add_filter( 'block_bindings_supported_attributes', 'gutenberg_cover_bindings_add_supported_attributes', 10, 2 );
}
```

This filter feeds both `gutenberg_get_block_bindings_supported_attributes('core/cover')` (server-side resolution) and `__experimentalBlockBindingsSupportedAttributes['core/cover']` (editor setting via the existing `block_editor_settings_all` filter at `lib/compat/wordpress-6.9/block-bindings.php:33-46`). Single source of truth.

**Part 2 — Cover-scoped render filter:**

```php
if ( ! function_exists( 'gutenberg_cover_bindings_render_block' ) ) {
    function gutenberg_cover_bindings_render_block( $block_content, $block, $instance ) {
        // Gate: Cover only.
        if ( 'core/cover' !== ( $block['blockName'] ?? '' ) ) {
            return $block_content;
        }
        $attrs = $instance->attributes ?? array();

        // Gate: never engage for embed-video covers (AC-21).
        if ( ! empty( $attrs['backgroundType'] ) && 'embed-video' === $attrs['backgroundType'] ) {
            return $block_content;
        }

        // Gate: must have bindings on id AND url after __default expansion.
        $bindings = $block['attrs']['metadata']['bindings'] ?? null;
        if ( empty( $bindings ) ) {
            return $block_content;
        }
        $expanded = gutenberg_cover_bindings_expand( $bindings ); // applies __default to id/url
        if ( empty( $expanded['id'] ) || empty( $expanded['url'] ) ) {
            return $block_content;
        }
        if (
            $expanded['id']['source'] !== $expanded['url']['source']
            || ( $expanded['id']['args'] ?? null ) !== ( $expanded['url']['args'] ?? null )
        ) {
            // Mismatched sources — unresolvable. Strip the saved <img>/<div bg> entirely (Req 26, AC-6).
            return gutenberg_cover_bindings_strip_image( $block_content );
        }

        // Resolve via the standard bindings infrastructure.
        $resolved = gutenberg_process_block_bindings( $instance );
        $resolved_url = $resolved['url'] ?? null;
        $resolved_id  = $resolved['id']  ?? null;
        if ( empty( $resolved_url ) || empty( $resolved_id ) ) {
            return gutenberg_cover_bindings_strip_image( $block_content );
        }
        // Verify $resolved_id is an attachment in the media library.
        $attachment = get_post( (int) $resolved_id );
        if ( ! $attachment || 'attachment' !== $attachment->post_type ) {
            return gutenberg_cover_bindings_strip_image( $block_content );
        }

        // (A) Substitute <img src> / rebuild <div bg> → <img> (OQ-3 mechanism (i)).
        $block_content = gutenberg_cover_bindings_rewrite_image(
            $block_content,
            $resolved_url,
            $resolved_id,
            $attrs
        );

        // (B) Rewrite overlay span: remove has-background-dim-100 when dimRatio is the default 100.
        if ( 100 === ( $attrs['dimRatio'] ?? 100 ) ) {
            $block_content = gutenberg_cover_bindings_relax_dim_class( $block_content );
        }

        // (C) Suppress the useFeaturedImage injection in render_block_core_cover (Req 19, AC-18).
        // Achieved by mutating $instance->attributes BEFORE the priority-10 render path runs.
        if ( ! empty( $attrs['useFeaturedImage'] ) ) {
            $instance->attributes['useFeaturedImage'] = false;
        }
        // Also stop render_block_core_cover from re-running the parallax/featured-image branch on
        // a now-image-substituted markup: render_callback executes BEFORE this filter (render_callback
        // produces $content; render_block filters run on $content). Setting useFeaturedImage=false here
        // applies only to the gutenberg_block_bindings_render_block re-render at priority 10 (see below).

        return $block_content;
    }
    add_filter( 'render_block', 'gutenberg_cover_bindings_render_block', 9, 3 );
}
```

**Filter priority 9** is essential: `gutenberg_block_bindings_render_block` (the generic bindings filter from `lib/compat/wordpress-6.9/block-bindings.php`) registers at priority 10. Running before it means our Cover-scoped substitution happens on the saved markup, before the generic filter re-runs `$instance->render()` (which would re-execute `render_block_core_cover` and could re-inject a featured image).

Alternative considered: run at priority 11 (after) and let the generic filter's `gutenberg_replace_html` no-op on Cover's `url`/`id` (they have no `source` declaration so it's already a no-op for non-`source`-declared attributes per `lib/compat/wordpress-6.9/block-bindings.php:347-349`). Rejected: the generic filter calls `$instance->render()` which re-executes `render_block_core_cover` with the resolved attributes, and that callback's `useFeaturedImage` branch may inject a featured-image `<img>` — exactly the double-insertion AC-18 forbids. Running at priority 9 lets us mutate `$instance->attributes['useFeaturedImage'] = false` before the priority-10 re-render. (See AC-18 trace.)

### 6.2 Helper: `gutenberg_cover_bindings_rewrite_image`

Per §3 OQ-3, two paths:

1. **Plain `<img>` saved form** (`!hasParallax && !isRepeated` at save time): `WP_HTML_Tag_Processor::next_tag(['tag_name'=>'IMG','class_name'=>'wp-block-cover__image-background'])` + `set_attribute('src', $resolved_url)` + `set_attribute('alt', $attrs['alt'] ?? '')` + (optional) `set_attribute('class', preg_replace('/\bwp-image-\d+\b/', "wp-image-{$resolved_id}", $current))`.

2. **`<div style="background-image:url(…)">` saved form** (parallax or repeat): locate via `WP_HTML_Tag_Processor` with `tag_name=>'DIV'` and `class_name=>'wp-block-cover__image-background'`, compute byte range, splice in a rebuilt `<img>` HTML string. Drop `has-parallax`/`is-repeated` classes by construction (the rebuilt string never contains them). AC-19.

Both paths also need to drop a stale `wp-image-{old_id}` class and substitute `wp-image-{new_id}`; the `WP_HTML_Tag_Processor::remove_class` / `add_class` methods cover this for path 1.

### 6.3 Helper: `gutenberg_cover_bindings_relax_dim_class`

```php
function gutenberg_cover_bindings_relax_dim_class( $content ) {
    $processor = new WP_HTML_Tag_Processor( $content );
    while ( $processor->next_tag( array( 'tag_name' => 'SPAN', 'class_name' => 'wp-block-cover__background' ) ) ) {
        $processor->remove_class( 'has-background-dim-100' );
        // Per OQ-4, dim 50 ≡ no class modifier (dimRatioToClass(50)===null).
        // No has-background-dim-50 class is added.
    }
    return $processor->get_updated_html();
}
```

Idempotent (calling twice is harmless). Targets the overlay span only; the `has-background-dim` modifier class stays (50%-opacity baseline).

### 6.4 Helper: `gutenberg_cover_bindings_strip_image`

For the unresolvable / mismatched / external-URL case (Req 20, AC-5, AC-6): use `WP_HTML_Tag_Processor` to locate any element with `class_name=>'wp-block-cover__image-background'` (both `IMG` and `DIV` forms) and **remove the element entirely** from `$content` via the same byte-offset splice as OQ-3 mechanism (i). The cover renders without an image element, overlay-only.

### 6.5 PHPUnit coverage

New cases in `phpunit/blocks/render-block-cover-test.php`:

1. **Bound URL substitution.** Construct a parsed-block array with `metadata.bindings.url = { source: testing/x }` and `metadata.bindings.id` likewise; register a test source returning a known media-library attachment. Assert `<img src="…">` contains the resolved URL.
2. **Default-dimRatio class rewrite.** Same setup, `dimRatio` omitted (defaults to 100). Assert resulting HTML contains `wp-block-cover__background has-background-dim` but NOT `has-background-dim-100` (AC-16, AC-25).
3. **Non-default dimRatio preserved.** Same setup with `dimRatio: 70`. Assert `has-background-dim-70` is present (AC-17).
4. **Parallax saved markup gets rebuilt.** Construct saved markup with the `<div class="wp-block-cover__image-background" style="background-image:url(…)"></div>` form. Assert resulting HTML has `<img class="wp-block-cover__image-background"` and no `has-parallax` / `is-repeated` classes on it (AC-19).
5. **Mismatched sources strip the image.** `metadata.bindings.id.source === 'A'`, `metadata.bindings.url.source === 'B'`. Assert no `wp-block-cover__image-background` element in output (AC-6).
6. **External URL strip.** Source returns a URL but a non-attachment id. Assert no `wp-block-cover__image-background` (AC-5).
7. **`useFeaturedImage` short-circuit.** `useFeaturedImage: true` with active bindings. Assert exactly one `wp-block-cover__image-background` element and its `src` is the bound URL, not the featured image URL (AC-18).
8. **Embed-video carve-out.** `backgroundType: 'embed-video'` with active bindings. Assert no `<img>` substitution; the iframe path runs (AC-21).
9. **Unbound cover untouched.** No bindings. Assert the existing `render_block_core_cover` output is byte-identical to trunk (AC-20).

## 7. `block.json` changes

Add `"role": "content"` to the `id` attribute (lines 18–20 of `packages/block-library/src/cover/block.json`). The current `url` attribute already has `role: "content"` (lines 10–13).

```diff
   "id": {
-    "type": "number"
+    "type": "number",
+    "role": "content"
   },
```

No other attribute schema changes. No new attributes. No supports changes. No deprecation entry needed (role is metadata-only — see Q19 in requirements.md).

## 8. Block Bindings registration

Bindings for `id` and `url` on `core/cover` are added by the new `block_bindings_supported_attributes` filter (§6.1 Part 1). This feeds both server resolution (`gutenberg_process_block_bindings` reads from `gutenberg_get_block_bindings_supported_attributes`) and the editor settings (`__experimentalBlockBindingsSupportedAttributes` is built from the same function via `lib/compat/wordpress-6.9/block-bindings.php:33-46`).

Exact code references:
- `lib/compat/wordpress-6.9/block-bindings.php:118-167` (`gutenberg_get_block_bindings_supported_attributes`) — the function our filter hooks into.
- `lib/compat/wordpress-6.9/block-bindings.php:33-46` (`block_editor_settings_all` filter) — populates the editor setting that `packages/block-editor/src/hooks/block-bindings.js:40-100` reads.
- `packages/block-editor/src/hooks/block-bindings.js:122-127` — Cover is NOT in the excluded-blocks list. Once the server filter adds `id`/`url`, the Block Bindings panel renders automatically (AC-1, Q12).

No new editor-side allow-list, no Cover-specific UI registration code.

## 9. Pattern Overrides integration

Driven entirely by existing infrastructure:

1. **`__default` expansion (client).** `useCoverBindingState` calls `replacePatternOverridesDefaultBinding( bindings, [ 'id', 'url' ] )` from `packages/block-editor/src/utils/block-bindings.js:27-46`. After expansion, the `__default: { source: 'core/pattern-overrides' }` shape becomes `{ id: { source: 'core/pattern-overrides' }, url: { source: 'core/pattern-overrides' } }`, which is exactly the same-source-instance shape `bindingActive` accepts. Per Glossary "Expanded bindings".
2. **`__default` expansion (server).** `gutenberg_process_block_bindings` (`lib/compat/wordpress-6.9/block-bindings.php:257-281`) expands `__default` server-side. Same semantics.
3. **Reset toolbar.** `withPatternOverrideControls` (`packages/editor/src/hooks/pattern-overrides.js:37-122`) wires `<ResetOverridesControl>` automatically once the block is allow-listed.
4. **Enable Overrides button.** Same HOC wires `<PatternOverridesControls>` for the synced-pattern authoring view.

Zero Cover code touches Pattern Overrides directly.

## 10. Same-source / internal-media invariant

Three layers of enforcement, all gated by the same `bindingActive` semantic:

| Layer | Enforcement site | Outcome |
| --- | --- | --- |
| Editor render | `CoverEdit` render tree (§5.4) | If `bindingUnresolvable`, render the `<Placeholder data-testid="cover-binding-unresolvable">` and do NOT render an `<img>` (AC-4). |
| Editor controls | `useCoverBindingState` flips `bindingActive: false` when sources don't match | Parallax/repeat/replace/featured-image controls return to their unbound rendering. This is intentional: a mismatched-binding cover is treated as if there's no binding, so the user has the normal cover affordances to fix it. |
| Server render | `gutenberg_cover_bindings_render_block` (§6.1) | Mismatched/missing/non-attachment id → `gutenberg_cover_bindings_strip_image` → no `<img>` in output (AC-5, AC-6, AC-20 unresolvable path). |

The "internal media required" affordance test-observable signal is `data-testid="cover-binding-unresolvable"` AND the i18n string `__( 'Internal media required for this binding.' )` (OQ-6).

## 11. Testing strategy

### 11.1 Unit (Jest)

`packages/block-library/src/cover/test/edit.js` — extend with cases for `useCoverBindingState`:

- `bindingActive` true when `__default: { source: 'core/pattern-overrides' }` expanded.
- `bindingActive` true when `{ id: { source: X, args: A }, url: { source: X, args: A } }`.
- `bindingActive` false when sources differ.
- `bindingActive` false when args differ.
- `bindingActive` false when backgroundType is `embed-video`.
- `bindingUnresolvable` true on mismatched sources.
- `effectiveDimRatio` returns 50 only when `bindingActive && dimRatio===100 && effectiveUrl`.

### 11.2 PHPUnit

Cases enumerated in §6.5, added to `phpunit/blocks/render-block-cover-test.php`. Covers AC-3, AC-5, AC-6, AC-15..AC-21, AC-25.

### 11.3 E2E

New describe block in `test/e2e/specs/editor/blocks/cover.spec.js`: `'Block Bindings — Pattern Overrides round-trip'`.

Test outline (one spec, multiple assertions, satisfies AC-22..AC-24):

```js
test.describe( 'Block Bindings — Pattern Overrides round-trip', () => {
    test( 'Cover round-trips through default → override → reset', async ({ editor, page, requestUtils, admin }) => {
        // Setup: upload two attachments (defaultMedia, overrideMedia).
        // 1. Create synced pattern with a Cover whose url+id are bound via "Enable overrides".
        //    Insert Cover → set media to defaultMedia → open Inspector → Advanced → "Enable overrides".
        // 2. Save pattern. Open new post. Insert the synced pattern.
        // 3. Assert (default state):
        //    - Editor preview <img src> points at defaultMedia.url.
        //    - Parallax / Repeat ToolsPanelItems are not visible (AC-11, AC-12).
        //    - <MediaReplaceFlow> toolbar button is not visible (AC-13, AC-14).
        //    - "Use featured image" menu item is not visible (AC-13).
        //    - Overlay span class does NOT contain 'has-background-dim-100' (AC-15).
        //    - ResetOverridesControl toolbar button is disabled (AC-10, OQ-2).
        // 4. Override the instance: programmatically setBlockAttributes with new url+id.
        //    - Assert ResetOverridesControl is now enabled.
        //    - Assert editor preview <img src> points at overrideMedia.url.
        //    - Publish post; navigate to front-end.
        //    - Assert front-end <img src> points at overrideMedia.url.
        //    - Assert front-end overlay class contains 'has-background-dim' but NOT 'has-background-dim-100' (AC-16).
        // 5. Reset: click the toolbar Reset button.
        //    - Assert editor preview <img src> back to defaultMedia.url.
        //    - Publish; front-end same.
        // 6. Unresolvable case: programmatically create a Cover with mismatched bindings
        //    (id.source !== url.source). Assert the `data-testid="cover-binding-unresolvable"`
        //    Placeholder is visible (AC-24).
    } );
} );
```

Test fixture follows the `packages/e2e-tests/plugins/block-bindings.php` pattern for additional non-Pattern-Overrides binding sources used in the mismatched-source test.

### 11.4 Non-regression

Existing `cover.spec.js` cases run untouched. Existing `packages/block-library/src/cover/test/edit.js` cases run untouched. Existing `phpunit/blocks/render-block-cover-test.php` cases run untouched. AC-20, AC-35.

## 12. Backwards compatibility

- **Unbound covers untouched.** All gating predicates (`bindingActive`, the server filter's early-return on `empty($bindings)`) flip false when `metadata.bindings` is absent. The new code path is dead code on every existing unbound cover. AC-20.
- **No `save.js` change.** The serialized markup shape is identical to trunk. Deprecation chain unchanged. AC-20.
- **No new attribute.** `id` gains a `role: "content"` annotation only — metadata-only, not part of the saved markup.
- **Embed-video carve-out.** Both client and server short-circuit on `backgroundType === 'embed-video'`, regardless of binding presence. AC-21.
- **`useFeaturedImage` precedence rule.** When both `useFeaturedImage: true` and an active binding co-exist on the same cover, the binding wins (server: `$instance->attributes['useFeaturedImage'] = false` is set BEFORE the priority-10 generic-bindings re-render). The stored `useFeaturedImage` attribute is NOT mutated (the mutation is to the in-flight `$instance` object, scoped to this single render pass — not to the post content). AC-18, DC-2 satisfied (no `setAttributes` on client, no persisted attribute change on server).
- **`! function_exists` / version guards.** The new compat file follows the established pattern from `lib/compat/wordpress-6.9/block-comments.php:63,84`. Graceful degradation on a WP install lacking the bindings infrastructure (Req 39). The Cover Edit component's new hook reads `metadata?.bindings` defensively — when `__experimentalBlockBindingsSupportedAttributes['core/cover']` is undefined (pre-7.1 server), `bindingActive` returns false and the existing code path runs.

## 13. Trade-offs and alternatives considered

### Server-side: Approach A vs Approach B (revisited)

Approach B (PR #74610's generic `block_bindings_attribute_replaced_in_markup` filter) was rejected per OQ-1 above. Summary of trade-offs:

| | Approach A (chosen) | Approach B (rejected) |
| --- | --- | --- |
| New global filter | No | Yes (`block_bindings_attribute_replaced_in_markup`) |
| Solves `<img src>` substitution | Yes (Cover-scoped) | Yes (generic) |
| Solves dim-class rewrite | Yes | No — needs Cover-side supplement |
| Solves parallax-div → `<img>` rebuild | Yes | No — needs Cover-side supplement (Risk 5) |
| Solves `useFeaturedImage` short-circuit | Yes | No — needs Cover-side supplement |
| Lines added to PR | Single file, ~150 lines | Generic filter + Cover-side supplement: ~200 lines |
| Cross-block risk surface | Zero | Non-zero (filter affects every binding-substituted block) |
| Reuse value for future bindable blocks | Zero | Some (e.g. a future block with non-source-declared `url`) |

Net: Approach A wins on every dimension that touches this spec. Approach B's reuse value is real but speculative; the spec also flags it as out-of-scope absent a clear cross-block need (Req 28, Out-of-Scope "New global Block Bindings APIs").

### Client-side: source-agnostic observer vs explicit `useBindings` derivation

Considered: a separate `useEffect` keyed on `metadata.bindings` that synchronises a derived `bindingUrl` state into the existing observer. Rejected: that is exactly the multi-`useEffect` proliferation Risk 1 / DC-1 forbid. The chosen design (one effect, keyed on `effectiveUrl`, with `useEffectEvent` for latest-value reads) collapses every URL-derivation trigger into a single signal.

### Pattern Overrides reset: disable vs hide

OQ-2 chose disable. Hiding the button would require Cover-specific overrides of `ResetOverridesControl` (or a wholesale change to all bindable blocks). The hide approach has no UX advantage and would diverge Cover from every other bindable block; the disable approach is the existing contract.

## 14. Out-of-scope reminders (from spec, repeated here to keep design honest)

The design explicitly does NOT implement:

- **External / non-media-library URL binding.** Unresolved-id covers render the "internal media required" Placeholder (client) or strip the `<img>` (server). No best-effort fallback for an external URL.
- **Mismatched-source binding.** Treated as unresolvable. Same render path as external URL.
- **Parallax × bindings beyond force-off.** No CSS-in-`style` rewrites. The parallax/repeat saved markup is replaced with a plain `<img>` when bindings have resolved a value (OQ-3 mechanism (i)).
- **Embed-video × bindings beyond non-regression.** Both client and server short-circuit. The iframe's `src` is the saved `url`, never substituted from the bound `url`. AC-21.
- **Featured-image binding** (expressing `useFeaturedImage` AS a binding source). Separate follow-up PR. This PR enforces the precedence rule only (AC-18).
- **New global Block Bindings APIs.** None introduced. The chosen Cover-scoped filter is `add_filter( 'render_block', ..., 9, 3 )` with the standard signature — not a new API.
- **Post-data source `featured_media.url` / `featured_media.id`.** Out of scope.

## 15. Risks / open questions surfaced by this design

1. **Priority-9 vs priority-10 ordering.** The Cover render filter runs at priority 9 to mutate `$instance->attributes['useFeaturedImage'] = false` before `gutenberg_block_bindings_render_block` re-runs `$instance->render()`. If a future change to the generic filter changes its registration priority, the ordering invariant breaks. Mitigation: PHPUnit case §6.5(7) catches this regression. Add a comment in the new compat file pinning the rationale.
2. **`WP_HTML_Tag_Processor` byte-offset helpers**. OQ-3 mechanism (i) leans on `get_token_byte_offset_in_source_text()` / `get_full_token_length()`. These are public WP HTML API methods but availability across WP versions in the version-guard window needs confirmation during implementation. Fallback: `preg_match` with `PREG_OFFSET_CAPTURE` mirrors the pattern already used at `packages/block-library/src/cover/index.php:117-125`.
3. **`gutenberg_process_block_bindings` is called twice per render** (once in our priority-9 filter, once in the priority-10 generic filter). This is functionally correct but wastes work. Acceptable for v1; a future micro-optimisation could cache resolution per `$instance`.
4. **Race between `attachment` REST loading and `bindingResolvedId` check.** Client-side, the media-library record lookup via `useSelect` returns `undefined` while loading and `null` if resolved-not-found. The hook currently treats `undefined` as pending (no unresolvable affordance yet) and `null` as unresolvable. There's a single render where the cover shows neither image nor unresolvable affordance. Acceptable; pattern matches how `core/image` handles the same race.
