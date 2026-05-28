# Design Doc: Cover block bindings — internal-only `id` and `url`

Spec: `<artifacts>/1-spec/spec.md` (approved). All AC, DC, Req references resolve to that file.

## 1. Overview

`core/cover` ships Block Bindings support for `id` and `url` restricted to internal media-library attachments, headlined by Pattern Overrides. When a binding is active (post-`__default`-expansion: `id` AND `url` bound to the same source instance), the Edit component (a) hides parallax, repeat, media-replace and use-featured-image controls in *every* render surface (toolbar, inspector, AND the empty-cover placeholder), (b) reactively derives `overlayColor`, `effectiveDimRatio`, `effectiveUrl` from the resolved `url` through a **single observer** wired via `useEffectEvent`, and (c) never mutates stored attributes on binding state transitions. The server (a single Cover-scoped file in `lib/compat/wordpress-7.1/block-bindings.php`) uses an early `render_block_data` filter to neutralise `useFeaturedImage` before `render_callback` runs, then a `render_block` priority-9 filter to substitute the bound URL into the cover's `<img>` (via pure `preg_match` byte-splice for the parallax/repeat case, `WP_HTML_Tag_Processor::set_attribute` for the plain-`<img>` case) and to remove `has-background-dim-100` from the overlay span when the stored ratio is the default. Embed-video covers short-circuit both client and server binding paths.

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
       │ useCoverBindingState() hook (NEW) │   │ render_block_data (priority 10)  │
       │   - expandedBindings              │   │   gutenberg_cover_bindings_      │
       │   - bindingActive  (id+url, same  │   │     prepare_block( $parsed,      │
       │       source instance)            │   │       $source, $parent )         │
       │   - bindingResolvedUrl/Id (from   │   │     ↑ runs BEFORE render_call-   │
       │       source.getValues via        │   │       back, mutates $parsed_     │
       │       useSelect)                  │   │       block['attrs'] to set      │
       │   - bindingUnresolvable  (id      │   │       useFeaturedImage=false     │
       │       missing / mismatch / not    │   │       when bindingActive         │
       │       attachment / external)      │   │                                  │
       │                                   │   │ render_block (priority 9)        │
       │ Effective values (derived, no     │   │   gutenberg_cover_bindings_      │
       │   setAttributes):                 │   │     render_block( $content,      │
       │   - effectiveUrl = bindingResolvedUrl │       $block, $instance )         │
       │       ?? (useFeaturedImage?       │   │     ↑ runs BEFORE                │
       │             mediaUrl : originalUrl) │       gutenberg_block_bindings_  │
       │   - effectiveDimRatio = (bindingActive│       render_block (priority 10) │
       │       && dimRatio===100 &&             │                                  │
       │       effectiveUrl) ? 50 : dimRatio    │   if bindingActive &&            │
       │   - lockUrlControls = bindingActive   │      backgroundType !=='embed-   │
       │       && !canUserEditValue            │      video':                     │
       │                                   │   │     1. resolve url/id from       │
       │ Single observer (useEffect on     │   │        gutenberg_process_block_  │
       │   effectiveUrl):                  │   │        bindings()                │
       │   - getMediaColor(effectiveUrl)   │   │     2. if id missing/not in      │
       │     ↳ setOverlayColor (if not     │   │        media library → strip     │
       │        user-set)                  │   │        <img>/<div bg> entirely;  │
       │   - propsRef guard + race-token   │   │        early return              │
       │     to prevent stale overwrites   │   │     3. (A) rewrite img/div via   │
       │                                   │   │            preg_replace_callback │
       │ CoverInspectorControls / Block-   │   │            +Tag_Processor        │
       │   Controls / CoverPlaceholder     │   │     4. (B) strip has-background- │
       │   gated by bindingActive          │   │            dim-100 from overlay  │
       └───────────────────────────────────┘   │            span                  │
                                               └──────────────────────────────────┘
```

### 2.2 Files touched

| File | Role | Change |
| --- | --- | --- |
| `packages/block-library/src/cover/block.json` | Attribute schema | Add `"role": "content"` to `id` (AC-1, AC-2 prerequisite) |
| `lib/compat/wordpress-7.1/block-bindings.php` (NEW) | Server allow-list + Cover-scoped render filters | (a) `block_bindings_supported_attributes` filter adds `id`,`url` to `core/cover`; (b) `render_block_data` filter to neutralise `useFeaturedImage` before `render_callback`; (c) `gutenberg_cover_bindings_render_block` filter on `render_block` priority 9 |
| `lib/load.php` | Bootstrap | `require __DIR__ . '/compat/wordpress-7.1/block-bindings.php';` in the REST-server block (alongside other 7.1 entries) |
| `packages/block-library/src/cover/edit/index.js` | Reactive observer, derived values, render-tree gating | New `useCoverBindingState` hook, replace existing `useEffect([mediaUrl])` with a single observer on `effectiveUrl`, gate the empty-cover branch on `bindingActive \|\| bindingUnresolvable`, render the `<Placeholder>` for the unresolvable case inline, AND wrap the line-750 `<CoverPlaceholder>` call site in `! bindingActive && (…)` so the drop zone is not present on bound covers (§5.5 / Issue 5 of iter-2 review). |
| `packages/block-library/src/cover/edit/inspector-controls.js` | UI gating | Gate parallax/repeat ToolsPanelItems on `! bindingActive` |
| `packages/block-library/src/cover/edit/block-controls.js` | UI gating | Pass `bindingActive`. Render `<MediaReplaceFlow>` ONLY when `! bindingActive`. The "Embed video from URL" `<MenuItem>` is dropped from the bound-cover toolbar by construction; this is acceptable because (a) embed-video × bindings is explicitly out-of-scope per spec Out-of-Scope, (b) AC-21's "no regression on embed-video" only applies to covers where `backgroundType === 'embed-video'`, which (per §5.1 step 2) forces `bindingActive = false`, so the `<MediaReplaceFlow>` remains rendered there. See §5.5 for the full rationale and the verified gating mechanism. |
| `phpunit/blocks/render-block-cover-test.php` | PHPUnit | New cases: bound-url → `<img src=$bound>`; default `dimRatio:100` + binding → `has-background-dim-50`; mismatched/unresolvable → no `<img>`; `useFeaturedImage:true + bindingActive` → exactly one `<img>` with bound URL |
| `test/e2e/specs/editor/blocks/cover.spec.js` | E2E | New `describe('Block Bindings — Pattern Overrides')` block (AC-22..AC-24) |
| `backport-changelog/7.1/<core-pr>.md` | Metadata | Created at the same time the Core PR is filed; Gutenberg PR description includes a `TODO: backport-changelog entry pending Core PR` note and is updated once the Core PR number is known. Not a blocker for the Gutenberg PR landing. |

No other Cover files change. **`cover-placeholder.js` is NOT touched** — the gating happens at the call sites in `index.js` (see §5.4 / §5.5). No new `__experimental*` APIs are introduced. No `save.js`, `deprecated.js`, or block-list-renderer changes.

## 3. Open Questions resolved

### OQ-1: Server-side approach — Cover-scoped filter (chosen)

**Choice: Approach A — Cover-scoped filters in `lib/compat/wordpress-7.1/block-bindings.php`.**

Concretely: one `add_filter( 'render_block_data', ..., 10, 3 )` (Cover-only neutralisation of `useFeaturedImage` before `render_callback`) plus one `add_filter( 'render_block', 'gutenberg_cover_bindings_render_block', 9, 3 )` that gates on `$block['blockName'] === 'core/cover'`.

**Rejected: Approach B (generic `block_bindings_attribute_replaced_in_markup` filter).**

Reasoning:
- Approach B (PR #74610) only solves `<img src>` substitution. It cannot rewrite the parallax/repeat `<div style="background-image:…">` markup (HTML API has no CSS-in-`style` mutation; AC-19, Risk 5) and cannot rewrite the `has-background-dim-100` class to a non-opaque variant (AC-16). Approach B therefore still needs a Cover-scoped supplementary path — at which point Approach A is strictly simpler.
- Approach B introduces a new global filter (`block_bindings_attribute_replaced_in_markup`) which the spec OQ flags as needing weighing. Approach A introduces zero new global APIs (Req 28, Out-of-Scope on global APIs).
- Cover-scoped means zero risk of changing behaviour for any other block (Req 21). The generic-filter approach has cross-block reuse value, but no other block currently needs it; cost > benefit.
- Approach A keeps the entire substitution surface in one file (the new 7.1 compat file). Easier to review, easier to delete when Core absorbs the change.

**Traces to:** Req 21, Req 28, AC-16, AC-18, AC-19, Risk 5, Out-of-Scope item "New global Block Bindings APIs".

### OQ-2: Reset affordance — disable (chosen)

**Choice: keep existing `ResetOverridesControl` semantics: button is **disabled** (not removed from DOM) when the instance value matches the pattern default.**

Reasoning:
- Cover-specific code zero. Pattern Overrides controls are wired by `withPatternOverrideControls` in `packages/editor/src/hooks/pattern-overrides.js`; the toolbar `ResetOverridesControl` (`packages/patterns/src/components/reset-overrides-control.js`) already renders `disabled={ ! isOverridden }`.
- Consistent with every other bindable block (paragraph, heading, image, button).
- Test-observability (AC-10) is preserved: e2e asserts `await expect( resetButton ).toBeDisabled()` rather than absence-from-DOM.

**Traces to:** AC-10, Req 24(d).

### OQ-3: Saved-markup parallax/repeat rewrite mechanism — `preg_match` byte splice + `WP_HTML_Tag_Processor` (chosen)

**Choice: Mechanism (i) — detect the parallax/repeat case in the new Cover render filter and replace the entire `<div class="wp-block-cover__image-background" style="background-image:url(…)">` fragment in `$content` with a rebuilt `<img>` HTML string, located via `preg_match( … , PREG_OFFSET_CAPTURE )` (the exact same pattern shape that `render_block_core_cover` already uses at `packages/block-library/src/cover/index.php:117-125, 193-197`).**

**Why not the previously-cited byte-offset Tag-Processor helpers.** The prior design draft cited `WP_HTML_Tag_Processor::get_token_byte_offset_in_source_text()` and `get_full_token_length()` as public accessors. Verified at `/Users/carlos/.wp-env/cc4ba7b5738d99b49b19f399987f6e49/WordPress/wp-includes/html-api/class-wp-html-tag-processor.php` — neither method exists. The class's public surface (lines 836–4797) exposes `next_tag`, `set_attribute`, `add_class`, `remove_class`, `set_bookmark`, `seek`, `get_updated_html`, `has_class`, `class_list`, `get_attribute`, `get_token_name`, `get_token_type`, `is_tag_closer`, `has_self_closing_flag`, `get_modifiable_text`, `set_modifiable_text`, `paused_at_incomplete_token`, etc., but `$token_starts_at` (line 609) and `$token_length` (line 628) are declared `private`. Token positions are not exposed by the public API. `set_bookmark` / `seek` allow movement to a previously-visited tag but do not yield substring ranges either. Therefore byte-offset splicing through Tag-Processor private accessors is not a viable mechanism.

**Why not pure `WP_HTML_Tag_Processor` mutation.** The Tag Processor cannot rewrite a `<div>` element into an `<img>` element (no `set_tag()` operation in its public API; verified). It also cannot edit a CSS value inside `style="background-image: url(…)"` (Risk 5). For the parallax/repeat saved form, neither of those is feasible.

**Why not `DOMDocument` for the whole markup.** `DOMDocument::loadHTML` aggressively normalises HTML (wrapping in `<html>/<body>`, expanding void elements, decoding entities), risking observable byte-level diffs versus saved markup for unrelated content (AC-20 non-regression). Round-tripping through `saveHTML` is known-lossy for `class="..."` / `style="..."` attribute ordering and self-closing-slash form. Out of proportion for the small, surgical edit we need.

**Why not "synthesise the full `<img>` from scratch and discard saved markup".** Re-implementing `save.js`'s output (classes including `wp-image-{id} size-{slug}`, `data-object-position`, alt, focal-point style) duplicates client logic. Risk of drift between client save and server output is real and would surface as classname diffs on subsequent re-edits (round-trip / AC-20 hazard).

**Concrete shape — parallax/repeat saved form (mechanism (i)):**

```php
// Pattern mirrors the one already used at packages/block-library/src/cover/index.php:117-125
// for the figure.wp-block-embed case.
$div_pattern = '/<div\s+[^>]*\bwp-block-cover__image-background\b[^>]*><\/div>/U';
if ( 1 === preg_match( $div_pattern, $content, $matches, PREG_OFFSET_CAPTURE ) ) {
    $div_start  = $matches[0][1];
    $div_length = strlen( $matches[0][0] );
    // Build the replacement <img>. wp-image-{id}, size-{slug}, alt, optional object-position
    // come from the bound attachment metadata + the cover's saved $attrs.
    $rebuilt_img = sprintf(
        '<img class="wp-block-cover__image-background wp-image-%d%s" alt="%s" src="%s" data-object-fit="cover"%s />',
        (int) $resolved_id,
        $size_class_suffix,     // e.g. ' size-large' or ''
        esc_attr( $alt ),
        esc_url( $resolved_url ),
        $object_position_attrs  // ' data-object-position="50% 50%" style="object-position:50% 50%;"' or ''
    );
    $content = substr( $content, 0, $div_start ) . $rebuilt_img . substr( $content, $div_start + $div_length );
}
```

**Concrete shape — plain `<img>` saved form (no parallax/repeat at save time):**

```php
$processor = new WP_HTML_Tag_Processor( $content );
if ( $processor->next_tag( array(
    'tag_name'   => 'IMG',
    'class_name' => 'wp-block-cover__image-background',
) ) ) {
    $processor->set_attribute( 'src', $resolved_url );
    $processor->set_attribute( 'alt', $alt );
    // Substitute wp-image-{old} → wp-image-{new}: scan classes and rewrite.
    // class_list() iterates current classes; remove_class + add_class are public.
    foreach ( $processor->class_list() as $cls ) {
        if ( 0 === strpos( $cls, 'wp-image-' ) ) {
            $processor->remove_class( $cls );
        }
    }
    $processor->add_class( 'wp-image-' . (int) $resolved_id );
    $content = $processor->get_updated_html();
}
```

Both methods used (`set_attribute`, `class_list`, `remove_class`, `add_class`, `next_tag`, `get_updated_html`) are confirmed public methods in `WP_HTML_Tag_Processor` (lines 1181, 4310, 4539, 4581, 887, 4637 respectively of `wp-includes/html-api/class-wp-html-tag-processor.php`).

**Traces to:** AC-19, Risk 5, OQ-3 spec text.

### OQ-4: Non-opaque effective `dimRatio` — **50** (chosen)

**Choice: 50.**

Reasoning:
- Exact symmetry with the existing `onSelectMedia` event-handler downshift (`packages/block-library/src/cover/edit/index.js`: `currentAttrs.url === undefined && currentAttrs.dimRatio === 100 ? 50 : ...`). Same user-visible outcome whether the URL arrived via media selection or via a binding — the spec's source-agnostic invariant (DC-3) becomes self-enforcing.
- `dimRatioToClass( 50 ) === null` (see `packages/block-library/src/cover/shared.js`), so the overlay span emits `has-background-dim` without any `has-background-dim-N` modifier — i.e. the CSS default of 50% opacity. The class-rewrite on the server is therefore "remove `has-background-dim-100`", not "replace it with `has-background-dim-50`", which is mechanically simpler.

**Traces to:** AC-15, AC-16, Req 14, Req 18.

### OQ-5: Pre-existing `hasParallax=true` on a Cover that gains a binding — **render-time force-off** (chosen)

**Choice: do not migrate the saved attribute. At render time (both client and server) treat `hasParallax` and `isRepeated` as effectively `false` whenever `bindingActive && backgroundType !== 'embed-video'`. The stored attributes are untouched. The UI hides the toggles so the user cannot newly set them.**

Reasoning:
- DC-2 / Req 11 prohibit attribute mutation from binding-state changes. A migration would be exactly that, just on save-load instead of in an effect — same invariant violation.
- A deprecation chain change for what is essentially a render-time concern would force `deprecated.js` work and risks breaking saved unbound covers (AC-20 non-regression).
- The render-time path already has to strip `has-parallax`/`is-repeated` classes by construction from the rebuilt `<img>` (see OQ-3); the editor preview's `<img>` element is rendered unconditionally once `effectiveUrl` resolves AND `bindingActive` (the existing `isImgElement = !(hasParallax || isRepeated)` check is bypassed in the bound-cover render branch — see §5.4). Force-off therefore comes free.

**Traces to:** Req 11, DC-2, AC-19, AC-20.

### OQ-6: Test-observable signal for the "internal media required" affordance

**Choice: primary contract is the i18n message string `__( 'Internal media required for this binding.' )`. Secondary stability hook is `data-testid="cover-binding-unresolvable"`.**

**E2E assertion uses the i18n string** (per spec Req 16: "a known i18n message string … accessible to the e2e test"):

```js
await expect(
    page.getByText( 'Internal media required for this binding.' )
).toBeVisible();
```

The `data-testid` attribute is added to the `<Placeholder>` element as a translation-resistant fallback hook. It is **secondary**: the e2e test does not assert on it. Code review may legitimately challenge `data-testid` on production DOM; if removed, AC-24 remains satisfied by the i18n-string locator. The design's intent (versus a hard "must remove `data-testid` if reviewer objects" position) is: keep `data-testid` for cross-locale stability but accept its removal during review if challenged — the i18n-string contract is the load-bearing one.

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
- Server: both the `render_block_data` filter and `gutenberg_cover_bindings_render_block` early-return when `! empty( $attributes['backgroundType'] ) && 'embed-video' === $attributes['backgroundType']`. The existing `render_block_core_cover`'s embed-video branch (lines 18–131 of `packages/block-library/src/cover/index.php`) runs unmodified.

Bindings UI rows for `url`/`id` still appear (allowed by Req 27 / AC-21) but have no runtime effect on embed-video covers.

### Risk 5 — HTML API can't edit CSS-in-`style`

Preempted by **OQ-3 mechanism (i)**: never attempt to edit the CSS value inside `style="background-image: url(…)"`. Instead, locate the `<div class="wp-block-cover__image-background">` and **replace the entire element** with a rebuilt `<img>` via `preg_match` + `substr` splice — no CSS parsing involved, no Tag-Processor private accessors required.

## 5. Client-side design

### 5.1 New hook: `useCoverBindingState`

Location: new file `packages/block-library/src/cover/edit/use-cover-binding-state.js`.

Exported shape:

```js
/**
 * @typedef {Object} CoverBindingState
 * @property {boolean}            bindingActive          true iff (after __default expansion) `id` AND `url` are bound to the same source instance AND backgroundType !== 'embed-video'.
 * @property {boolean}            bindingUnresolvable    true iff metadata.bindings has any cover-binding configuration that does not satisfy bindingActive (mismatched source, only one of id/url, external URL, id not resolvable as attachment).
 * @property {string|undefined}   bindingResolvedUrl     URL resolved from the bound source via useSelect.
 * @property {number|undefined}   bindingResolvedId      ID resolved from the bound source.
 * @property {boolean}            canUserEditBindingValue Source.canUserEditValue() result; gates lockUrlControls.
 */
export default function useCoverBindingState( { clientId, attributes, context } ) { … }
```

Implementation outline:
1. Expand `attributes.metadata?.bindings` via `replacePatternOverridesDefaultBinding( bindings, [ 'id', 'url' ] )` from `packages/block-editor/src/utils/block-bindings.js`.
2. `bindingActive = expanded?.id && expanded?.url && expanded.id.source === expanded.url.source && JSON.stringify(expanded.id.args ?? null) === JSON.stringify(expanded.url.args ?? null) && backgroundType !== 'embed-video'`.
3. Resolve values via **a single `useSelect`** that reads both the bound URL and ID and the attachment record in one closure, deduplicating subscription work. `getBlockBindingsSource` is imported directly from `@wordpress/blocks` — it is a registry lookup (not a state-dependent selector) verified at `packages/blocks/src/api/registration.ts:903-907` as a module-level export that internally calls `select( blocksStore ).getBlockBindingsSource( name )`. The `@wordpress/blocks` store is the canonical home of the bindings-source registry (private selector at `packages/blocks/src/store/private-selectors.ts:252`); it is NOT on `blockEditorStore`. Existing trunk callers follow the same pattern (`packages/block-editor/src/components/block-bindings/source-fields-list.js:9`, `packages/block-editor/src/components/rich-text/index.js:23`).

   ```js
   import { getBlockBindingsSource } from '@wordpress/blocks';
   // ... inside the hook body:
   const { bindingResolvedUrl, bindingResolvedId, bindingResolvedAttachment } =
       useSelect( ( select ) => {
           if ( ! bindingActive ) {
               return { bindingResolvedUrl: undefined, bindingResolvedId: undefined, bindingResolvedAttachment: undefined };
           }
           const source = getBlockBindingsSource( expanded.url.source );
           if ( ! source ) {
               return { bindingResolvedUrl: undefined, bindingResolvedId: undefined, bindingResolvedAttachment: undefined };
           }
           const values = source.getValues( {
               select,
               clientId,
               context,
               bindings: { id: expanded.id, url: expanded.url },
           } );
           const url = values?.url;
           const id = values?.id;
           const attachment = id
               ? select( coreStore ).getEntityRecord( 'postType', 'attachment', id, { context: 'view' } )
               : undefined;
           return { bindingResolvedUrl: url, bindingResolvedId: id, bindingResolvedAttachment: attachment };
       }, [ bindingActive, expanded?.id?.source, expanded?.url?.source, clientId ] );
   ```

   Notes on performance and correctness:
   - **Single `useSelect`**: dedupes the subscription. Reading the attachment record in the same closure means the subscription re-fires only when *any* of the closure's reads change, not on every render.
   - **`undefined` vs `null`**: `getEntityRecord` returns `undefined` while loading (resolution not yet started/resolved), `null` once resolved and not found. The hook treats `undefined` as pending (no unresolvable affordance yet) and `null` as definitively unresolvable. This matches `core/image`'s pattern.
   - **Pattern Overrides scale**: for N bound Covers on the same post, each instance fires its own `useSelect`, but the `getEntityRecord` selector is memoised by `core-data` (same `( 'postType', 'attachment', id )` key dedupes across consumers). Acceptable for v1; if profiling later reveals churn, the hook can be promoted to a parent-context provider.

4. `bindingUnresolvable = (hasAnyCoverBinding) && ! bindingActive` OR `bindingActive && bindingResolvedAttachment === null` (resolved-not-found) OR `bindingActive && bindingResolvedAttachment && bindingResolvedAttachment.type !== 'attachment'`.

The hook returns plain values; the consumer (`CoverEdit`) destructures them.

### 5.2 Single observer (in `CoverEdit`)

Replaces the existing `useEffect( [ mediaUrl ] )` block in `packages/block-library/src/cover/edit/index.js`. Source-agnostic per DC-3:

```js
// Declared once at the top of the component body, before any useEffect.
const raceTokenRef = useRef( 0 );

// Derived: the URL the editor should display.
const effectiveUrl =
    bindingResolvedUrl ??
    ( useFeaturedImage ? mediaUrl : originalUrl?.replaceAll( '&amp;', '&' ) );

// Derived: effective dimRatio for preview-time class computation.
const effectiveDimRatio =
    bindingActive && dimRatio === 100 && effectiveUrl ? 50 : dimRatio;

// useEffectEvent reads latest non-tracked values without dep-array churn.
const onUrlResolved = useEffectEvent( async ( resolvedUrl ) => {
    if ( ! resolvedUrl ) return;
    const myToken = ++raceTokenRef.current;
    const avg = await getMediaColor( resolvedUrl );
    if ( myToken !== raceTokenRef.current ) return; // stale resolution; bail

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

Key properties and design rationale:
- **One** `useEffect`, keyed on `effectiveUrl`. The dependency array has stable references for everything else (DC-1).
- `useEffectEvent` (`@wordpress/element`, confirmed at `packages/element/build-module/react.mjs`) reads latest `attributes`, `overlayColor` without dep-array churn.
- **Race token via ref, NOT cleanup flag.** The `useEffectEvent` callback is invoked freshly on every dependency change, but `useEffectEvent`'s identity is stable across renders. A `useEffect` cleanup-flag pattern (`let cancelled = false; … return () => { cancelled = true; };`) would require co-locating the cleanup inside the `useEffect` body — but the async work lives inside `useEffectEvent` (so latest props/state are read). Hoisting the flag out of `useEffectEvent` defeats the latest-value guarantee. The ref-based race token is the simplest pattern that survives both async resolution ordering AND `useEffectEvent`'s "latest reads" contract. **The `raceTokenRef = useRef( 0 )` declaration is explicit (declared at component top, before observer);** implementers reading the sketch verbatim will not encounter an undeclared identifier.
- `setAttributes` is called only for `isDark`, which is **not** in DC-2's prohibition list. The DC-2 list is `dimRatio`, `useFeaturedImage`, `backgroundType`, `id`, `url`, `hasParallax`, `isRepeated`, `overlayColor`, `customOverlayColor`.

### 5.3 Existing event handlers — unchanged

`onSelectMedia`, `onClearMedia`, `onSetOverlayColor`, `onUpdateDimRatio`, `toggleUseFeaturedImage`, `onSelectEmbedUrl` keep their current shapes. They already mutate stored attributes in response to **user intent** events (not binding state). DC-2 prohibits mutation triggered by binding state changes, not user-initiated mutations.

There is one nuance: the existing observer has a side-effect on `isDark`/`isUserOverlayColor`. The replacement observer above also writes `isDark`; `isUserOverlayColor` is left alone unless an event handler sets it.

### 5.4 Render-tree changes in `CoverEdit`

Two structural changes to `packages/block-library/src/cover/edit/index.js`:

**(1) Empty-cover branch (currently `if ( ! useFeaturedImage && ! hasInnerBlocks && ! hasBackground )` at index.js line 599):** add `bindingActive || bindingUnresolvable` to the predicate so the standard `<CoverPlaceholder>` (which exposes upload + featured-image toggle affordances) NEVER renders on a bound cover. Replace with a binding-aware placeholder branch:

```jsx
if ( ! useFeaturedImage && ! hasInnerBlocks && ! hasBackground ) {
    if ( bindingActive || bindingUnresolvable ) {
        return (
            <>
                { blockControls }
                { inspectorControls }
                { hasNonContentControls && isSelected && (
                    <ResizableCoverPopover { ...resizableCoverProps } />
                ) }
                <TagName
                    { ...blockProps }
                    className={ clsx( 'is-placeholder', blockProps.className ) }
                    style={ { ...blockProps.style, minHeight: minHeightWithUnit || undefined } }
                >
                    { resizeListener }
                    { bindingUnresolvable ? (
                        <Placeholder
                            data-testid="cover-binding-unresolvable"
                            className="wp-block-cover__binding-unresolvable"
                            withIllustration
                            instructions={ __( 'Internal media required for this binding.' ) }
                        />
                    ) : (
                        /* bindingActive but pending resolution; render an empty placeholder
                           with no affordances. The single observer will populate the cover
                           once effectiveUrl arrives. */
                        <Placeholder
                            className="wp-block-cover__binding-pending"
                            withIllustration
                        />
                    ) }
                </TagName>
            </>
        );
    }
    /* Existing CoverPlaceholder branch (unbound case) — unchanged. */
    return ( /* … existing return with <CoverPlaceholder> … */ );
}
```

The standard `<CoverPlaceholder>` continues to render in the unbound empty-cover branch (this branch in §5.4 (1)) and (lower in the component, line 750) inside the `<TagName>`. **The line-750 `<CoverPlaceholder>` IS reached on bound covers when `hasBackground=true`**; verified at `packages/block-editor/src/components/media-placeholder/index.js:551-552`, `disableMediaButtons` short-circuits to `<MediaUploadCheck>{ renderDropZone() }</MediaUploadCheck>` — the upload / media-library / featured-image buttons are hidden, but the drop zone IS still rendered. The drop-zone's `onFilesDrop` is wired (line 385) to the parent's `onFilesUpload`, which in `cover-placeholder.js:22-26` calls `onSelectMedia({ url: createBlobURL(file) })` — mutating the cover's `url` attribute. To keep AC-14 / Req 7's intent ("direct media replacement from inside the Cover is not offered when bound") whole, the line-750 site is gated at its call site in `index.js`:

```jsx
{ ! bindingActive && (
    <CoverPlaceholder
        disableMediaButtons
        onSelectMedia={ onSelectMedia }
        onError={ onUploadError }
        toggleUseFeaturedImage={ toggleUseFeaturedImage }
    />
) }
```

This is a one-line wrapper added immediately around the existing line-750 call site. On unbound covers (`bindingActive=false`), the behaviour is byte-identical to trunk (AC-20). On bound covers, the entire `<CoverPlaceholder>` — including its drop zone — is omitted from the render tree. `cover-placeholder.js` itself is NOT edited (§2.2 invariant preserved). See §13 trade-off table "Line-750 `<CoverPlaceholder>` drop-zone" for alternatives considered.

**(2) Non-empty render branch (around `url && isImageBackground` at index.js line 672):**

```jsx
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

**`inspector-controls.js`** — wrap the `<>` fragment containing the "Fixed background" and "Repeated background" `ToolsPanelItem`s in `! bindingActive && …`. Pass `bindingActive` as a new prop from `CoverEdit`.

**`block-controls.js`** — the entire `<MediaReplaceFlow>` element is conditionally rendered. When `! bindingActive`, the current trunk shape is preserved verbatim (including the "Embed video from URL" `<MenuItem>` child). When `bindingActive`, the `<MediaReplaceFlow>` is omitted from the render output entirely; the `<BlockControls group="other">` group renders empty (or is itself elided), and no media-replace / upload / featured-image / embed-URL affordances exist on the bound-cover toolbar:

```jsx
<BlockControls group="other">
    { ! bindingActive && (
        <MediaReplaceFlow
            mediaId={ id }
            mediaURL={ url }
            allowedTypes={ ALLOWED_MEDIA_TYPES }
            onSelect={ onSelectMedia }
            onToggleFeaturedImage={ toggleUseFeaturedImage }
            useFeaturedImage={ useFeaturedImage }
            name={ ! url ? __( 'Add media' ) : __( 'Replace' ) }
            onReset={ onClearMedia }
            variant="toolbar"
        >
            { ( { onClose } ) => (
                <MenuItem
                    icon={ link }
                    onClick={ () => {
                        setIsEmbedUrlInputOpen( true );
                        onClose();
                    } }
                >
                    { __( 'Embed video from URL' ) }
                </MenuItem>
            ) }
        </MediaReplaceFlow>
    ) }
</BlockControls>
```

**Why conditional render and NOT prop-level gating.** Verified against `packages/block-editor/src/components/media-replace-flow/index.js`:
- Line 233: the "Use featured image" `<MenuItem>` IS gated on `onToggleFeaturedImage &&` — prop-level `undefined` does remove it.
- Line 245: the "Reset" `<MenuItem>` IS gated on `mediaURL && onReset &&` — prop-level `undefined` does remove it.
- Lines 193–212: the `<MediaUpload>` ("Open Media Library") and `<FormFileUpload>` ("Upload") `<MenuItem>`s render unconditionally inside `<MediaUploadCheck>`. **Neither is gated on `onSelect`.** Setting `onSelect={ undefined }` does NOT remove them from the dropdown. Worse: line 115 calls `onSelect( media )` directly from the internal `selectMedia` helper, and line 124 calls `onSelect( files )` directly from `uploadFiles`. Setting `onSelect={ undefined }` would crash with `TypeError: onSelect is not a function` when a user clicks "Open Media Library" or "Upload". The prior-iteration prop-level gating approach was therefore a runtime hazard.

Removing the entire `<MediaReplaceFlow>` is the only mechanism that achieves AC-14's literal-DOM-absence wording (the toolbar's media-replace dropdown is not present at all when `bindingActive`).

**Why losing the "Embed video from URL" affordance on bound covers is acceptable.** AC-21 requires non-regression for covers with `backgroundType === 'embed-video'`. Per §5.1 step 2, embed-video covers force `bindingActive = false` (the guard `backgroundType !== 'embed-video'` is part of the active-binding predicate). So embed-video covers ALWAYS render the full `<MediaReplaceFlow>` including the embed-URL menu item — AC-21 is preserved. The only case that loses the embed-URL menu item is a bound non-embed-video cover, where the user has actively chosen to bind `id`+`url` to a media-library attachment; converting such a cover to embed-video is out-of-scope under "Embed-video × bindings interaction" in the spec's Out-of-Scope section, and the user can unbind first if needed. This trade-off is explicit and tied to the resolved Out-of-Scope item.

**Verification of AC-14 surface coverage (post-fix).** AC-14 requires the media-replace control to be NOT in the DOM. Under the conditional render above, `<MediaReplaceFlow>` is completely absent from the bound-cover DOM. The e2e test (§11.3) asserts on the absence of the toolbar replace-button (the rendered `<ToolbarButton>` from `<MediaReplaceFlow>`'s `renderToggle` path at lines 180–189 of media-replace-flow/index.js) — a single locator. AC-13 (Use featured image) and AC-14 (media-replace) are both satisfied by the wrapper's absence; no need to reason about individual `<MenuItem>` gating any more.

**`cover-placeholder.js` itself is not modified.** Its sole call sites are in `index.js` (lines 616 and 750). The line-616 site is now unreachable under `bindingActive || bindingUnresolvable` (replaced by the binding-aware placeholder branch in §5.4 (1)). The line-750 site is reached on bound covers (when `hasBackground === true`) but renders `<CoverPlaceholder disableMediaButtons … />`. Verified at `packages/block-editor/src/components/media-placeholder/index.js:551-552`: when `disableMediaButtons` is true, only the drop zone renders (no upload / media-library / featured-image buttons). The drop-zone IS still rendered, however, and its `onFilesDrop` is wired to `onFilesUpload` (line 385), which in `cover-placeholder.js:22-26` calls `onSelectMedia({ url: createBlobURL(file) })`. **A user dragging a file onto a bound cover would still mutate the cover's `url` attribute** through `onSelectMedia`. This is a *user-initiated* mutation (DC-2 only prohibits derivation-path mutation triggered by binding state changes), so DC-2 is technically satisfied; however, AC-14 / Req 7's *intent* is "direct media replacement from inside the Cover is not offered when bound", and a drop zone IS an alternative form of media-replace surface.

To resolve this cleanly without editing `cover-placeholder.js`, the line-750 site is gated at its call site in `index.js`: render the `<CoverPlaceholder>` only when `! bindingActive`. `MediaPlaceholder`'s `disableDropZone` prop (verified at `packages/block-editor/src/components/media-placeholder/index.js:378-381`: `if ( disableDropZone ) { return null; }` short-circuits drop-zone rendering) is an alternative — but the call site is in `index.js`, and gating the whole `<CoverPlaceholder>` is the surgical one-line change. Concrete edit at index.js line 750:

```jsx
{ ! bindingActive && (
    <CoverPlaceholder
        disableMediaButtons
        onSelectMedia={ onSelectMedia }
        onError={ onUploadError }
        toggleUseFeaturedImage={ toggleUseFeaturedImage }
    />
) }
```

`bindingActive=false` covers (the entire pre-bindings universe of Covers) keep the current `<CoverPlaceholder>` behaviour byte-for-byte. AC-13, AC-14, AC-20 (non-regression) all satisfied; Req 7's intent honoured; `cover-placeholder.js` source unchanged.

**`<MediaReplaceFlow>` "Use featured image" toggle** is removed alongside the rest of `<MediaReplaceFlow>` by the conditional render above. AC-13 satisfied. **Inspector-controls.js does NOT separately render a use-featured-image toggle**, verified by inspection — there is no second inspector site.

### 5.6 Pattern Overrides integration

Zero Cover-specific code. `withPatternOverrideControls` in `packages/editor/src/hooks/pattern-overrides.js` reads `__experimentalBlockBindingsSupportedAttributes?.[ blockName ]`; once the server-side filter (§6.1) adds `core/cover` to that list, the `<PatternOverridesControls>` "Enable overrides" button and the `<ResetOverridesControl>` toolbar button appear automatically (AC-2, AC-7..AC-10).

`replacePatternOverridesDefaultBinding` in `packages/block-editor/src/utils/block-bindings.js` is used directly inside `useCoverBindingState`. This is the **same** helper the Block Bindings panel uses and the **same** semantics the server's `gutenberg_process_block_bindings` expansion uses (`lib/compat/wordpress-6.9/block-bindings.php:257-281`). Client and server agree on expansion by construction.

## 6. Server-side design

### 6.1 File: `lib/compat/wordpress-7.1/block-bindings.php` (NEW)

Loaded from `lib/load.php` alongside the other 7.1 compat entries:

```php
require __DIR__ . '/compat/wordpress-7.1/block-bindings.php';
```

Wrapped in `! function_exists( … )` per the established 7.1 backport pattern.

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

**Part 2 — `render_block_data` filter (NEW — solves AC-18 first-pass injection):**

This filter runs **before** `render_callback` (verified at `wp-includes/blocks.php:2398` — `render_block_data` fires as `$inner_block->parsed_block = apply_filters( 'render_block_data', $inner_block->parsed_block, $source_block, $parent_block )`; for top-level blocks the equivalent fires in `render_block()` itself). By mutating `$parsed_block['attrs']['useFeaturedImage'] = false` here when bindings are active, we prevent `render_block_core_cover` from injecting the featured-image `<img>` in its first pass.

```php
if ( ! function_exists( 'gutenberg_cover_bindings_prepare_block' ) ) {
    function gutenberg_cover_bindings_prepare_block( $parsed_block, $source_block, $parent_block ) {
        // Gate: Cover only.
        if ( 'core/cover' !== ( $parsed_block['blockName'] ?? '' ) ) {
            return $parsed_block;
        }
        $attrs = $parsed_block['attrs'] ?? array();
        // Gate: never engage for embed-video covers (AC-21).
        if ( ! empty( $attrs['backgroundType'] ) && 'embed-video' === $attrs['backgroundType'] ) {
            return $parsed_block;
        }
        // Gate: must have bindings on id AND url after __default expansion.
        if ( ! gutenberg_cover_bindings_is_active( $attrs ) ) {
            return $parsed_block;
        }
        // Neutralise useFeaturedImage so render_block_core_cover skips its
        // featured-image branch entirely (Req 19, AC-18). DC-2 is preserved:
        // this mutation is scoped to the in-flight $parsed_block array used by
        // this single render pass; the persisted post_content is untouched.
        if ( ! empty( $attrs['useFeaturedImage'] ) ) {
            $parsed_block['attrs']['useFeaturedImage'] = false;
        }
        return $parsed_block;
    }
    add_filter( 'render_block_data', 'gutenberg_cover_bindings_prepare_block', 10, 3 );
}
```

`gutenberg_cover_bindings_is_active( $attrs )` is a private helper defined in the same file. It applies `__default` expansion (via inline logic copied from `lib/compat/wordpress-6.9/block-bindings.php:257-281`, scoped to `[ 'id', 'url' ]`), then checks both bindings exist AND resolve to the same source instance via the following two-part equality, mirroring §5.1 step 2's client-side check:

```php
$same_source = ( $expanded['id']['source'] ?? null ) === ( $expanded['url']['source'] ?? null );
$same_args   = ( $expanded['id']['args']   ?? null ) ==  ( $expanded['url']['args']   ?? null );
// Note: `==` (loose) compares associative arrays element-wise irrespective of key order;
// `===` would require identical key ordering. Loose comparison is the correct semantic
// for source `args` (a small associative bag of scalars), and it matches the JS-side
// JSON.stringify check (which is order-sensitive only on object literals — and source
// args in practice come from the same builder for both `id` and `url` of a Cover, so
// key order is identical in real shapes; loose-equality is the safe relaxation).
return $same_source && $same_args && ! empty( $expanded['id'] ) && ! empty( $expanded['url'] );
```

The bool result is what gates Part 2's `useFeaturedImage` mutation and Part 3's URL substitution. **This replaces the previously-undefined `gutenberg_cover_bindings_expand` helper.** Spec Req 26 / Glossary "Active binding" explicitly require `args` equality where applicable; the explicit check here closes the client/server agreement gap.

**Why `render_block_data` solves the AC-18 first-pass injection problem.** Verified at `/Users/carlos/.wp-env/cc4ba7b5738d99b49b19f399987f6e49/WordPress/wp-includes/class-wp-block.php:531-596`: `WP_Block::render()` calls `process_block_bindings()` (line 532), merges resolved bindings into `$this->attributes` (lines 534-536), and then calls `render_callback` (line 596). The `render_block_data` filter runs **before** `WP_Block::render()` is constructed (`render_block()` in `wp-includes/blocks.php:2398` applies it on the parsed block array). By that point, `$parsed_block['attrs']['useFeaturedImage']` has been forced to `false`, so:

1. `WP_Block::__construct` builds `$this->attributes` from the (modified) `$parsed_block['attrs']`, with `useFeaturedImage = false`.
2. `process_block_bindings` resolves `id`+`url` from the source and merges them into `$this->attributes`. `useFeaturedImage` is not in the bindings shape, so it remains `false`.
3. `render_callback` (= `render_block_core_cover`) runs with `useFeaturedImage = false` AND the bound `url`. The featured-image branch (`packages/block-library/src/cover/index.php:133`: `if ( 'image' !== $attributes['backgroundType'] || false === $attributes['useFeaturedImage'] ) { return $content; }`) is skipped. No featured-image `<img>` is injected. `$content` contains only the saved-markup `<img>` / `<div bg>`, with the saved-`url` not yet substituted.
4. The priority-9 `gutenberg_cover_bindings_render_block` filter (Part 3 below) runs on this `$content`, substitutes the bound URL into the saved `<img>` / rebuilt `<img>`, and rewrites the dim class.

No double-`<img>`. AC-18 satisfied for both first-pass and any subsequent re-render (`gutenberg_block_bindings_render_block` at priority 10 calls `$instance->render()` again — `useFeaturedImage` is still false on `$instance->attributes`, so the second pass also skips the featured-image branch).

**Part 3 — `render_block` filter (priority 9):**

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
        if ( ! gutenberg_cover_bindings_is_active( $attrs ) ) {
            return $block_content;
        }

        // Resolve via the standard bindings infrastructure. By this point,
        // WP_Block::render() has already merged resolved bindings into
        // $instance->attributes (verified at class-wp-block.php:531-536), so
        // $attrs['url'] and $attrs['id'] are the bound values.
        $resolved_url = $attrs['url'] ?? null;
        $resolved_id  = $attrs['id']  ?? null;
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

        return $block_content;
    }
    add_filter( 'render_block', 'gutenberg_cover_bindings_render_block', 9, 3 );
}
```

**Filter priority 9** is essential: `gutenberg_block_bindings_render_block` (the generic bindings filter from `lib/compat/wordpress-6.9/block-bindings.php`) registers at priority 10. Running before it means our Cover-scoped substitution happens on the saved markup before the generic filter re-runs `$instance->render()` (which would re-execute `render_block_core_cover`, but at that point `useFeaturedImage` is already false thanks to Part 2 — so the second pass produces the same `$content` shape as the first, and our priority-9 substitution remains correct).

**Notes on `gutenberg_process_block_bindings` double-call.** Core 6.9's `process_block_bindings` is called once inside `WP_Block::render()` (line 532). The generic filter's priority-10 re-render path calls `$instance->render()` again, which calls `process_block_bindings()` a second time. Functionally correct (resolution is idempotent); cost is bounded and acceptable for v1. Listed under §15 risks for future optimisation.

### 6.2 Helper: `gutenberg_cover_bindings_rewrite_image`

Per §3 OQ-3, two paths:

1. **Plain `<img>` saved form** (`!hasParallax && !isRepeated` at save time): `WP_HTML_Tag_Processor::next_tag(['tag_name'=>'IMG','class_name'=>'wp-block-cover__image-background'])`, then `set_attribute( 'src', $resolved_url )` + `set_attribute( 'alt', $alt )` + `remove_class( 'wp-image-{old}' )` + `add_class( 'wp-image-{new}' )`. All four methods verified public.

2. **`<div style="background-image:url(…)">` saved form** (parallax or repeat): use `preg_match` with `PREG_OFFSET_CAPTURE` on the pattern `/<div\s+[^>]*\bwp-block-cover__image-background\b[^>]*><\/div>/U` (same shape as `packages/block-library/src/cover/index.php:117-125, 193-197`), compute byte range, splice in a rebuilt `<img>` HTML string. Drop `has-parallax`/`is-repeated` classes by construction (the rebuilt string never contains them). AC-19.

The function probes form (2) first (`preg_match` succeeds when the saved-markup is the `<div>` form, regardless of presence of `hasParallax`/`isRepeated` in `$attrs` — saved markup is the source of truth, not the attributes); falls through to form (1) (plain `<img>`) otherwise.

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

For the unresolvable / mismatched / external-URL case (Req 20, AC-5, AC-6): use the same `preg_match` + `substr`-splice approach to **remove** any element with class `wp-block-cover__image-background` from `$content`. The cover renders without an image element, overlay-only.

Two patterns are tried in sequence (whichever matches first wins; both forms never co-exist in a Cover's saved markup because `save.js` emits exactly one image element):

```php
// Form 2: parallax/repeat saved form — a self-closed empty <div>.
$form2_pattern = '/<div\s+[^>]*\bwp-block-cover__image-background\b[^>]*><\/div>/U';

// Form 1: plain saved form — a void <img> (with or without trailing slash).
// Matches everything up to the closing ">"; void elements have no </img>.
$form1_pattern = '/<img\s+[^>]*\bwp-block-cover__image-background\b[^>]*\/?\s*>/U';

foreach ( array( $form2_pattern, $form1_pattern ) as $pattern ) {
    if ( 1 === preg_match( $pattern, $content, $matches, PREG_OFFSET_CAPTURE ) ) {
        $start  = $matches[0][1];
        $length = strlen( $matches[0][0] );
        return substr( $content, 0, $start ) . substr( $content, $start + $length );
    }
}
return $content;
```

The `U` (ungreedy) modifier is essential for both patterns — without it, `[^>]*` would greedily span past intermediate `>` boundaries when other attributes contain `>` literals (rare but possible in well-formed but edge-case markup). The form-1 pattern matches both XHTML-style `<img ... />` and HTML5-style `<img ... >` because `\/?\s*>` makes the trailing slash optional. Both patterns are scoped by the `\b...\b` word-boundary anchor around the class name, ensuring matches only on elements that actually carry the `wp-block-cover__image-background` class (not coincidental substring hits on neighbouring attributes).

### 6.5 PHPUnit coverage

New cases in `phpunit/blocks/render-block-cover-test.php`:

1. **Bound URL substitution (plain `<img>` saved form).** Construct a parsed-block array with `metadata.bindings.url = { source: testing/x }` and `metadata.bindings.id` likewise; register a test source returning a known media-library attachment. Assert `<img src="…">` contains the resolved URL.
2. **Default-dimRatio class rewrite.** Same setup, `dimRatio` omitted (defaults to 100). Assert resulting HTML contains `wp-block-cover__background has-background-dim` but NOT `has-background-dim-100` (AC-16, AC-25).
3. **Non-default dimRatio preserved.** Same setup with `dimRatio: 70`. Assert `has-background-dim-70` is present (AC-17).
4. **Parallax saved markup gets rebuilt.** Construct saved markup with the `<div class="wp-block-cover__image-background" style="background-image:url(…)"></div>` form. Assert resulting HTML has `<img class="wp-block-cover__image-background"` and no `has-parallax` / `is-repeated` classes on it (AC-19).
5. **Mismatched sources strip the image.** `metadata.bindings.id.source === 'A'`, `metadata.bindings.url.source === 'B'`. Assert no `wp-block-cover__image-background` element in output (AC-6).
6. **External URL strip.** Source returns a URL but a non-attachment id. Assert no `wp-block-cover__image-background` (AC-5).
7. **`useFeaturedImage: true` short-circuit.** `useFeaturedImage: true` with active bindings AND a featured-image set on the test post. Assert exactly one `wp-block-cover__image-background` element and its `src` is the bound URL, not the featured image URL (AC-18). This directly validates the `render_block_data` filter (§6.1 Part 2): without it, two elements would appear.
8. **Embed-video carve-out.** `backgroundType: 'embed-video'` with active bindings. Assert no `<img>` substitution; the iframe path runs (AC-21).
9. **Unbound cover untouched.** No bindings. Assert the existing `render_block_core_cover` output is byte-identical to trunk (AC-20).

## 7. `block.json` changes

Add `"role": "content"` to the `id` attribute of `packages/block-library/src/cover/block.json`. The current `url` attribute already has `role: "content"`.

```diff
   "id": {
-    "type": "number"
+    "type": "number",
+    "role": "content"
   },
```

No other attribute schema changes. No new attributes. No supports changes. No deprecation entry needed (role is metadata-only).

## 8. Block Bindings registration

Bindings for `id` and `url` on `core/cover` are added by the new `block_bindings_supported_attributes` filter (§6.1 Part 1). This feeds both server resolution (`gutenberg_process_block_bindings` reads from `gutenberg_get_block_bindings_supported_attributes`) and the editor settings (`__experimentalBlockBindingsSupportedAttributes` is built from the same function via `lib/compat/wordpress-6.9/block-bindings.php:33-46`).

Exact code references:
- `lib/compat/wordpress-6.9/block-bindings.php:118-167` (`gutenberg_get_block_bindings_supported_attributes`) — the function our filter hooks into.
- `lib/compat/wordpress-6.9/block-bindings.php:33-46` (`block_editor_settings_all` filter) — populates the editor setting that `packages/block-editor/src/hooks/block-bindings.js` reads.
- `packages/block-editor/src/hooks/block-bindings.js:122-127` — Cover is NOT in the excluded-blocks list. Once the server filter adds `id`/`url`, the Block Bindings panel renders automatically (AC-1).

No new editor-side allow-list, no Cover-specific UI registration code.

## 9. Pattern Overrides integration

Driven entirely by existing infrastructure:

1. **`__default` expansion (client).** `useCoverBindingState` calls `replacePatternOverridesDefaultBinding( bindings, [ 'id', 'url' ] )` from `packages/block-editor/src/utils/block-bindings.js`. After expansion, the `__default: { source: 'core/pattern-overrides' }` shape becomes `{ id: { source: 'core/pattern-overrides' }, url: { source: 'core/pattern-overrides' } }`, which is exactly the same-source-instance shape `bindingActive` accepts. Per Glossary "Expanded bindings".
2. **`__default` expansion (server).** `gutenberg_process_block_bindings` (`lib/compat/wordpress-6.9/block-bindings.php:257-281`) expands `__default` server-side. Same semantics. Our `gutenberg_cover_bindings_is_active` helper (§6.1) re-implements the same expansion locally (because we need to read the expansion BEFORE `gutenberg_process_block_bindings` runs, in the `render_block_data` filter).
3. **Reset toolbar.** `withPatternOverrideControls` (`packages/editor/src/hooks/pattern-overrides.js`) wires `<ResetOverridesControl>` automatically once the block is allow-listed.
4. **Enable Overrides button.** Same HOC wires `<PatternOverridesControls>` for the synced-pattern authoring view.

Zero Cover code touches Pattern Overrides directly.

## 10. Same-source / internal-media invariant

Three layers of enforcement, all gated by the same `bindingActive` semantic:

| Layer | Enforcement site | Outcome |
| --- | --- | --- |
| Editor render | `CoverEdit` render tree (§5.4) | If `bindingUnresolvable`, render `<Placeholder>` with `instructions={ __( 'Internal media required for this binding.' ) }` and do NOT render an `<img>` (AC-4). |
| Editor controls | `useCoverBindingState` flips `bindingActive: false` when sources don't match | Parallax/repeat/replace/featured-image controls return to their unbound rendering. This is intentional: a mismatched-binding cover is treated as if there's no binding, so the user has the normal cover affordances to fix it. |
| Server render | `gutenberg_cover_bindings_render_block` (§6.1) | Mismatched/missing/non-attachment id → `gutenberg_cover_bindings_strip_image` → no `<img>` in output (AC-5, AC-6). |

The "internal media required" affordance test-observable signal is the i18n message string `__( 'Internal media required for this binding.' )` (primary; e2e asserts via `getByText`), with `data-testid="cover-binding-unresolvable"` as a secondary stability hook (OQ-6).

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
        // 2. Save pattern. Open new post. Insert the synced pattern.
        // 3. Assert (default state):
        //    - Editor preview <img src> points at defaultMedia.url.
        //    - Parallax / Repeat ToolsPanelItems are not visible (AC-11, AC-12).
        //    - <MediaReplaceFlow> toolbar dropdown button is not in the DOM (AC-13 + AC-14).
        //      The single locator `page.getByRole('button', { name: /^(Replace|Add media)$/ })`
        //      should resolve to zero matches inside the Cover's BlockControls toolbar.
        //    - On a SEPARATE embed-video Cover (control case), the same button IS visible
        //      with the "Embed video from URL" MenuItem accessible (AC-21 preserved on
        //      the population where `backgroundType === 'embed-video'`).
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
        //    (id.source !== url.source). Assert the i18n message is visible (AC-24):
        //    await expect( page.getByText( 'Internal media required for this binding.' ) ).toBeVisible();
    } );
} );
```

Test fixture follows the `packages/e2e-tests/plugins/block-bindings.php` pattern for additional non-Pattern-Overrides binding sources used in the mismatched-source test.

### 11.4 Non-regression

Existing `cover.spec.js` cases run untouched. Existing `packages/block-library/src/cover/test/edit.js` cases run untouched. Existing `phpunit/blocks/render-block-cover-test.php` cases run untouched. AC-20, AC-35.

## 12. Backwards compatibility

- **Unbound covers untouched.** All gating predicates (`bindingActive`, the server filters' early-return on `! gutenberg_cover_bindings_is_active( $attrs )`) flip false when `metadata.bindings` is absent. The new code path is dead code on every existing unbound cover. AC-20.
- **No `save.js` change.** The serialized markup shape is identical to trunk. Deprecation chain unchanged. AC-20.
- **No new attribute.** `id` gains a `role: "content"` annotation only — metadata-only, not part of the saved markup.
- **Embed-video carve-out.** Both client and server short-circuit on `backgroundType === 'embed-video'`, regardless of binding presence. AC-21. On embed-video covers, `bindingActive=false` per §5.1 step 2, so `<MediaReplaceFlow>` (including the "Embed video from URL" `<MenuItem>` child) renders as on trunk — the affordance is fully preserved on the AC-21 population. On bound NON-embed-video covers, `<MediaReplaceFlow>` is conditionally omitted (§5.5), so the embed-URL menu item is unreachable there; this is consistent with the Out-of-Scope "Embed-video × bindings interaction" bullet (the bound→embed-video conversion path is not supported in this PR).
- **`useFeaturedImage` precedence rule (AC-18).** When both `useFeaturedImage: true` and an active binding co-exist on the same cover, the binding wins. Mechanism: the `render_block_data` filter (§6.1 Part 2) mutates `$parsed_block['attrs']['useFeaturedImage'] = false` BEFORE `render_callback` runs, so `render_block_core_cover` skips its featured-image injection branch. The stored `useFeaturedImage` attribute on the post content is NOT mutated (the mutation is to the in-flight `$parsed_block` array, scoped to this single render pass). DC-2 is preserved on the persistence path (no `setAttributes` on client, no persisted post_content change on server). On the client, `bindingActive` is derived from the persisted attribute state including `useFeaturedImage`; if a saved Cover has both `useFeaturedImage: true` and bindings, the editor's `effectiveUrl` prefers `bindingResolvedUrl` over `mediaUrl` per §5.2, matching the server's precedence. AC-18 satisfied.
- **`! function_exists` / version guards.** The new compat file follows the established pattern from `lib/compat/wordpress-6.9/block-comments.php:63,84`. Graceful degradation on a WP install lacking the bindings infrastructure (Req 39). The Cover Edit component's new hook reads `metadata?.bindings` defensively — when `__experimentalBlockBindingsSupportedAttributes['core/cover']` is undefined (pre-7.1 server), `bindingActive` returns false and the existing code path runs.
- **AC-26 (PR shape — file path).** The new compat file lives at `lib/compat/wordpress-7.1/block-bindings.php` and is loaded via `lib/load.php`. No file under `lib/compat/wordpress-7.0/`. See §2.2 and §6.1.
- **AC-27 (PR description).** The Gutenberg PR description MUST link issue #77199 and MUST explicitly state whether/how this PR subsumes #74109 and #74610. This is a PR-creation step rather than a code change; the design records it as a hard requirement on the PR-open phase. Suggested wording is included in the Code phase's PR-creation step.
- **AC-28 (~500-line diff budget).** Estimated diff sizes (additions):
  - `lib/compat/wordpress-7.1/block-bindings.php`: ~160 lines
  - `packages/block-library/src/cover/edit/use-cover-binding-state.js` (new): ~70 lines
  - `packages/block-library/src/cover/edit/index.js`: ~60 lines net (observer replacement + render-tree gating)
  - `packages/block-library/src/cover/edit/inspector-controls.js`: ~10 lines
  - `packages/block-library/src/cover/edit/block-controls.js`: ~10 lines
  - `packages/block-library/src/cover/block.json`: ~2 lines
  - `lib/load.php`: ~1 line
  - PHPUnit (9 cases): ~140 lines
  - E2E (1 describe block, ~6 assertion steps): ~80 lines
  - **Total: ~533 lines.** Just over budget; the +0.5K-line ceiling is "SHOULD" (Req 38) not MUST. Acceptable; if reviewers push back, the e2e block can be trimmed to ~50 lines by combining steps 4 + 5.

## 13. Trade-offs and alternatives considered

### Server-side: Approach A vs Approach B (revisited)

Approach B (PR #74610's generic `block_bindings_attribute_replaced_in_markup` filter) was rejected per OQ-1 above. Summary of trade-offs:

| | Approach A (chosen) | Approach B (rejected) |
| --- | --- | --- |
| New global filter | No | Yes (`block_bindings_attribute_replaced_in_markup`) |
| Solves `<img src>` substitution | Yes (Cover-scoped) | Yes (generic) |
| Solves dim-class rewrite | Yes | No — needs Cover-side supplement |
| Solves parallax-div → `<img>` rebuild | Yes | No — needs Cover-side supplement (Risk 5) |
| Solves `useFeaturedImage` short-circuit | Yes (via render_block_data) | No — needs Cover-side supplement |
| Lines added to PR | Single file, ~160 lines | Generic filter + Cover-side supplement: ~210 lines |
| Cross-block risk surface | Zero | Non-zero (filter affects every binding-substituted block) |
| Reuse value for future bindable blocks | Zero | Some (e.g. a future block with non-source-declared `url`) |

Net: Approach A wins on every dimension that touches this spec. Approach B's reuse value is real but speculative; the spec also flags it as out-of-scope absent a clear cross-block need (Req 28, Out-of-Scope "New global Block Bindings APIs").

### AC-18 mitigation: render_block_data vs in-callback override vs filter

Three options considered for the `useFeaturedImage: true + bindingActive` precedence:

| | Chosen: `render_block_data` filter | Alt A: in `render_block_core_cover` | Alt B: in priority-9 `render_block` filter (prior design) |
| --- | --- | --- | --- |
| Where suppression happens | Before `render_callback` | Inside `render_callback` | After `render_callback` |
| First-pass injection prevented | Yes | Yes | **No** — already happened |
| Touches `render_block_core_cover` | No | Yes | No |
| Cross-PR-coordination needed | No (Gutenberg-side only) | Yes (touches a Core-owned callback) | No |
| AC-18 satisfied | **Yes** | Yes | **No** |

Alt A would require modifying `render_block_core_cover` itself to peek at `metadata.bindings`, adding a binding-awareness coupling to a Core callback. Better to keep all binding-awareness in the new compat file (consistent with the file-table in §2.2).

Alt B (the prior design's approach) leaves a window in which `render_callback` emits the featured-image element, then our filter rewrites the saved `<img>` but the *injected* featured-image element survives → double `<img>`. Rejected per the iter-1 review Issue 3.

The chosen `render_block_data` approach intercepts at the parsed-block level, before `WP_Block::render` even begins. Verified at `wp-includes/blocks.php:2398` and `wp-includes/class-wp-block.php:531-596`. DC-2 is preserved because the mutation is on the in-flight `$parsed_block` array passed by reference for this render only — the persisted post_content is not touched.

### AC-14 gating: conditional render vs prop-level `undefined` vs upstream change

Three options considered for hiding `<MediaReplaceFlow>` on bound covers:

| | Chosen: conditional render in block-controls.js | Alt A: prop-level undefined (iter-2 design) | Alt B: modify `<MediaReplaceFlow>` upstream |
| --- | --- | --- | --- |
| AC-14 literal DOM absence | Yes | **No** — toolbar button + Open Media Library + Upload menu items remain | Yes (if upstream gate added) |
| Runtime safety | Safe | **Crash** — clicking "Open Media Library" or "Upload" calls `onSelect(media)` with `onSelect=undefined` (verified at `media-replace-flow/index.js:115, 124`) → TypeError | Safe |
| "Embed video from URL" preserved on bound covers | No (acceptable per §5.5 trade-off) | Yes | Depends on upstream change shape |
| Shared-component churn | None | None | Significant (affects every `<MediaReplaceFlow>` consumer) |
| Owner-review cost | Cover-scoped only | Cover-scoped only | Cross-team (block-editor + every consumer) |

Alt A (the iter-2 design) was rejected per the iter-2 review (Issue 1): `<MediaUploadCheck>`-wrapped `<MediaUpload>` ("Open Media Library") and `<FormFileUpload>` ("Upload") render unconditionally at lines 193–232 of `media-replace-flow/index.js`; the internal `selectMedia` helper calls `onSelect(media)` at line 115 and `uploadFiles` calls `onSelect(files)` at line 124, both crashing when `onSelect=undefined`. Prop-level gating works for "Use featured image" (line 233) and "Reset" (line 245) which ARE gated on their callbacks, but not for the upload/media-library paths.

Alt B (upstream gate on `<MediaUploadCheck>` subtree) is the right long-term fix but out-of-scope for this PR — it requires owner-team sign-off and touches every `<MediaReplaceFlow>` consumer.

The chosen conditional render is the smallest correct change. The cost is losing the "Embed video from URL" affordance on bound non-embed-video covers; the §5.5 trade-off section traces this to the Out-of-Scope "Embed-video × bindings interaction" item.

### Line-750 `<CoverPlaceholder>` drop-zone: gate at call site vs `disableDropZone` vs accept

Three options for the line-750 `<CoverPlaceholder disableMediaButtons …/>` site (which on bound covers with `hasBackground=true` still renders a drop zone that calls `onSelectMedia` when files are dropped, verified at `media-placeholder/index.js:378-385, 551-552` and `cover-placeholder.js:22-26`):

| | Chosen: gate at call site `! bindingActive && <CoverPlaceholder …/>` | Alt A: pass `disableDropZone` through `<CoverPlaceholder>` | Alt B: accept the drop-zone as a user-initiated DC-2-exempt path |
| --- | --- | --- | --- |
| Lines changed | 1 (wrapper around line-750 site in `index.js`) | 2–3 (add `disableDropZone` prop forwarding in `cover-placeholder.js`) | 0 (documentation only) |
| Touches `cover-placeholder.js` | No | Yes | No |
| Honours AC-14 / Req 7 intent (no media-replace surface on bound covers) | Yes | Yes | Stretched (a drop zone IS a media-replace surface) |
| Unbound-cover non-regression (AC-20) | Identical to trunk when `bindingActive=false` | Identical | Identical |

Chosen approach: gate at the call site. The §2.2 "no `cover-placeholder.js` edits" invariant is preserved. The drop-zone path is removed for bound covers along with the rest of `<CoverPlaceholder>`'s functionality at that site. `bindingUnresolvable` covers fall through the line-616 binding-aware branch in §5.4 (1) and never reach line 750 in any case. The line-750 drop-zone's absence is implicitly covered by the bound-cover render tree no longer including `<CoverPlaceholder>`; an explicit "drag-and-drop on bound cover does not mutate `url`" assertion can be added to the §11.3 e2e plan as a follow-up if reviewers ask.

### Client-side: source-agnostic observer vs explicit `useBindings` derivation

Considered: a separate `useEffect` keyed on `metadata.bindings` that synchronises a derived `bindingUrl` state into the existing observer. Rejected: that is exactly the multi-`useEffect` proliferation Risk 1 / DC-1 forbid. The chosen design (one effect, keyed on `effectiveUrl`, with `useEffectEvent` for latest-value reads) collapses every URL-derivation trigger into a single signal.

### Client-side: race-token via ref vs cleanup-flag in useEffect

The cleanup-flag pattern (`let cancelled = false; ...; return () => { cancelled = true; };`) is React's documented idiom for async work inside `useEffect`. The chosen ref-based pattern was preferred because:
- The async work lives inside `useEffectEvent`, not `useEffect` body. `useEffectEvent`'s contract is to read latest values; binding a `cancelled` flag in the `useEffect` body's closure would couple the flag to a stale snapshot. Hoisting it to `useEffectEvent` would re-introduce dep-array churn.
- The ref-based token is monotonic and shared across all observer invocations — a clean primitive for "newest resolution wins" that survives observer re-runs caused by multiple effectiveUrl changes between resolutions.
- Explicit `useRef( 0 )` declaration at the top of the component is required (sketched in §5.2).

### Pattern Overrides reset: disable vs hide

OQ-2 chose disable. Hiding the button would require Cover-specific overrides of `ResetOverridesControl` (or a wholesale change to all bindable blocks). The hide approach has no UX advantage and would diverge Cover from every other bindable block; the disable approach is the existing contract.

### OQ-6 test-observable signal: i18n string vs data-testid

Both retained, with primary/secondary ordering. The i18n string is the load-bearing contract per spec Req 16; `data-testid` is a translation-resilience safety net. E2E asserts on the i18n string (`page.getByText( 'Internal media required for this binding.' )`). If a future reviewer removes `data-testid` because "test-only props in production DOM smell bad", the e2e test remains green.

## 14. Out-of-scope reminders (from spec, repeated here to keep design honest)

The design explicitly does NOT implement:

- **External / non-media-library URL binding.** Unresolved-id covers render the "internal media required" Placeholder (client) or strip the `<img>` (server). No best-effort fallback for an external URL.
- **Mismatched-source binding.** Treated as unresolvable. Same render path as external URL.
- **Parallax × bindings beyond force-off.** No CSS-in-`style` rewrites. The parallax/repeat saved markup is replaced with a plain `<img>` when bindings have resolved a value (OQ-3 mechanism (i)).
- **Embed-video × bindings beyond non-regression.** Both client and server short-circuit. The iframe's `src` is the saved `url`, never substituted from the bound `url`. AC-21.
- **Featured-image binding** (expressing `useFeaturedImage` AS a binding source). Separate follow-up PR. This PR enforces the precedence rule only (AC-18).
- **New global Block Bindings APIs.** None introduced. The chosen Cover-scoped filters are `add_filter( 'render_block_data', ..., 10, 3 )` and `add_filter( 'render_block', ..., 9, 3 )` with the standard signatures — not a new API.
- **Post-data source `featured_media.url` / `featured_media.id`.** Out of scope.

## 15. Risks / open questions surfaced by this design

1. **Priority-9 vs priority-10 ordering.** The Cover render filter runs at priority 9. The neutralisation of `useFeaturedImage` runs even earlier at `render_block_data` priority 10. If a future change to either generic filter changes registration priority, the ordering invariant breaks. Mitigation: PHPUnit case §6.5(7) catches this regression; add a comment in the new compat file pinning the rationale.
2. **`gutenberg_cover_bindings_is_active` duplicates `__default` expansion logic** from `lib/compat/wordpress-6.9/block-bindings.php:257-281`. This is intentional (we need the expansion result BEFORE `gutenberg_process_block_bindings` runs, in the `render_block_data` filter, while the generic helper does it inline) but introduces a small divergence risk if Core changes expansion semantics. Mitigation: PHPUnit case §6.5(7) and #6.5(5) catch behavioural divergence; if Core promotes expansion into a public helper, swap to it.
3. **`gutenberg_process_block_bindings` is called twice per render** (once via `WP_Block::render()` at line 532, once via the priority-10 generic filter's `$instance->render()` re-call). Functionally correct (resolution is idempotent) but wastes work. Acceptable for v1; a future micro-optimisation could cache resolution per `$instance`.
4. **Race between `attachment` REST loading and `bindingResolvedId` check.** Client-side, the media-library record lookup via `useSelect` returns `undefined` while loading and `null` if resolved-not-found. The hook treats `undefined` as pending (bound-but-pending placeholder per §5.4 (1)) and `null` as unresolvable. There's a transient render where the cover shows the pending placeholder instead of the resolved image — duration is one network round-trip. Acceptable; pattern matches how `core/image` handles the same race.
5. **AC-14 surface — embed-video affordance trade-off.** The chosen design removes `<MediaReplaceFlow>` from the bound-cover toolbar entirely (literal-DOM-absence per AC-14), which has the side effect of removing the "Embed video from URL" `<MenuItem>` from bound covers. This is acceptable because: (a) embed-video covers force `bindingActive=false` per §5.1 step 2 — so the affordance remains accessible on the population AC-21 actually protects; (b) the Out-of-Scope "Embed-video × bindings interaction" bullet rules out the bound-non-embed-video → bound-embed-video conversion path. The user can unbind a Cover first, then use the embed-URL affordance. Documented in §5.5 and §2.2.
6. **Backport-changelog entry timing.** `backport-changelog/7.1/<core-pr>.md` is created when the corresponding Core PR is filed; not a blocker for the Gutenberg PR landing. The Gutenberg PR description includes a `TODO: backport-changelog entry pending Core PR #NNN` note and is updated once the Core PR number is known.
