# Code Plan: Cover block bindings — internal-only `id` and `url`

Spec: `<artifacts>/1-spec/spec.md` (approved)
Design: `<artifacts>/2-design-doc/design-doc.md` (approved)

All AC-N, Req-N, DC-N, OQ-N citations resolve to those documents.

## Overview

Land internal-only Block Bindings support for `core/cover`'s `id` and `url` attributes, headlined by Pattern Overrides, in an order that keeps the tree green at every step. The work is sequenced as follows:

1. **Foundation (server)** — schema metadata, server allow-list filter, helper, `render_block_data` `useFeaturedImage` neutraliser, then the Cover-scoped `render_block` filter with its three rewrite helpers. After step 5, the server is feature-complete and PHPUnit can lock the contract down before any client code lands.
2. **Foundation (client)** — the new `useCoverBindingState` hook, then a single observer on `effectiveUrl` inside `CoverEdit`, then derived `effectiveDimRatio` flowing into the overlay-span class. After step 8, the editor renders correctly on bound covers (single-observer architecture in place, DC-1/DC-2/DC-3 satisfied) but still shows all the controls.
3. **UI gating** — inspector parallax/repeat, block-toolbar `<MediaReplaceFlow>`, `<CoverPlaceholder>` line-616 (bound-aware placeholder branch) and line-750 (`! bindingActive &&` wrapper). After step 11, every AC-11..AC-14 control absence holds.
4. **Tests** — Jest unit tests for the hook and observer, PHPUnit cases enumerated in §6.5, then the e2e round-trip spec in step 14.
5. **PR metadata** — `lib/load.php` wiring is folded into step 2 so server work integrates immediately; backport-changelog stub and PR description draft are the final step (15).

Each task lists files (CREATE/MODIFY), atomic changes, the spec/design slices it traces to, dependencies, and observable acceptance. Code-writers implement each task TDD-style: write failing tests first, then the production code, then refactor — the per-task acceptance bullets describe *what* must be true, not *which* test files (the code-writer chooses the test files).

**Coverage note (per iter-2 review Issue 8).** Every spec requirement traces to at least one task. Req 28 ("no new global Block Bindings APIs") is a design-level invariant — the design doc selects Approach A (Cover-scoped filters) explicitly to satisfy it, and there is no task to add because there is nothing to build — it is an architectural prohibition enforced by the absence of any new global API across Tasks 1–13. Reviewers verifying Req 28 should check that the diff introduces no `register_*` calls beyond the standard `add_filter( 'block_bindings_supported_attributes', … )` (Task 2) and the two Cover-scoped `add_filter( 'render_block_data' … )` / `add_filter( 'render_block', … 9, 3 )` registrations (Tasks 4 and 5) — none of which is a new global API.

---

## Tasks

### Task 1: Add `role: "content"` to `core/cover`'s `id` attribute

**Goal**: Mark `core/cover`'s `id` as a "content" role so it surfaces in the Block Bindings panel alongside `url`.

**Files**:
- `packages/block-library/src/cover/block.json` — MODIFY: add `"role": "content"` to the `id` attribute definition.

**Changes**:
1. Locate the `attributes.id` entry (currently `{ "type": "number" }`).
2. Add `"role": "content"` so it reads `{ "type": "number", "role": "content" }`.
3. No other schema changes. No new attributes. No `supports` changes. No deprecation entry.

**Depends on**: none

**Traces to**: Spec Req 1, Req 3; AC-1 prerequisite; Design §7.

**Acceptance**:
- `packages/block-library/src/cover/block.json`'s `id` attribute has `"role": "content"`.
- `packages/block-library/src/cover/block.json` parses as valid JSON.
- No other attribute in `block.json` changes.

---

### Task 2: Create `lib/compat/wordpress-7.1/block-bindings.php` with allow-list filter, wire it into `lib/load.php`

**Goal**: Add `id` and `url` to `core/cover`'s server-side bindings supported-attributes list, so the editor's `__experimentalBlockBindingsSupportedAttributes['core/cover']` includes them. This is the single registration that drives both the Block Bindings panel (AC-1) and server-side resolution.

**Files**:
- `lib/compat/wordpress-7.1/block-bindings.php` — CREATE.
- `lib/load.php` — MODIFY: add the `require __DIR__ . '/compat/wordpress-7.1/block-bindings.php';` line alongside the other `wordpress-7.1` requires (around lines 80–82).

**Changes**:
1. Create `lib/compat/wordpress-7.1/block-bindings.php` with the standard Gutenberg PHP file header (`@package gutenberg`).
2. Wrap the function definition in `if ( ! function_exists( 'gutenberg_cover_bindings_add_supported_attributes' ) ) { … }` per established pattern (`lib/compat/wordpress-6.9/block-bindings.php`).
3. Define `gutenberg_cover_bindings_add_supported_attributes( $attributes, $block_type )`:
   - If `$block_type === 'core/cover'`, ensure `'id'` and `'url'` are present in `$attributes` (use `in_array(..., true)` guard).
   - Return the (possibly augmented) array.
4. Register: `add_filter( 'block_bindings_supported_attributes', 'gutenberg_cover_bindings_add_supported_attributes', 10, 2 );`.
5. In `lib/load.php`, after the existing `wordpress-7.1` requires (after `collaboration.php` on line 82), insert: `require __DIR__ . '/compat/wordpress-7.1/block-bindings.php';`.

**Depends on**: Task 1

**Traces to**: Spec Req 2, Req 8, Req 9 (Pattern Overrides controls — "Enable overrides" affordance and `<ResetOverridesControl>` — work automatically once the cover is allow-listed via this filter, with no Cover-specific UI code); AC-1, AC-2; Design §6.1 Part 1, §8, §2.2.

**Acceptance**:
- `lib/compat/wordpress-7.1/block-bindings.php` exists and is loaded by `lib/load.php`.
- After bootstrap, `apply_filters( 'block_bindings_supported_attributes', array(), 'core/cover' )` returns an array containing both `'id'` and `'url'`.
- For any block type other than `core/cover`, the filter is a no-op.
- The filter is idempotent: applying it twice on the same input still returns `[ 'id', 'url' ]`, not `[ 'id', 'url', 'id', 'url' ]`.

---

### Task 3: Add `gutenberg_cover_bindings_is_active` helper

**Goal**: Provide the single PHP helper that decides whether a parsed cover block has an active binding, mirroring the client-side `bindingActive` predicate. It expands `__default`, then requires `id` AND `url` to be bound to the same source instance (same `source` string AND `==`-equal `args`). The helper is the gate that both the `render_block_data` filter (Task 4) and the `render_block` filter (Task 5) call.

**Files**:
- `lib/compat/wordpress-7.1/block-bindings.php` — MODIFY: add `gutenberg_cover_bindings_is_active( array $attrs ): bool` and the supporting `__default` expansion logic.

**Changes**:
1. Inside the same file from Task 2, add a private helper `gutenberg_cover_bindings_expand_bindings( array $bindings ): array` that:
   - Reads `$bindings['__default']` (if any).
   - For each supported attribute in `[ 'id', 'url' ]`, if there is no explicit entry, copy the `__default` value into that attribute slot.
   - Returns the expanded array.
2. Add `gutenberg_cover_bindings_is_active( array $attrs ): bool`:
   - Read `$attrs['metadata']['bindings']`. If empty/absent, return `false`.
   - Call the expander above on the bindings.
   - Compute `$same_source = ( $expanded['id']['source'] ?? null ) === ( $expanded['url']['source'] ?? null );`.
   - Compute `$same_args = ( $expanded['id']['args'] ?? null ) == ( $expanded['url']['args'] ?? null );` (loose equality on associative arrays per Design §6.1).
   - Return `! empty( $expanded['id'] ) && ! empty( $expanded['url'] ) && $same_source && $same_args`.
3. Both helpers MUST be wrapped in `if ( ! function_exists( … ) )` guards.

**Depends on**: Task 2

**Traces to**: Spec Req 11 Glossary "Active binding"; Req 26; AC-3, AC-6, AC-21; Design §6.1, §5.1 step 2 (parity with client).

**Acceptance**:
- `gutenberg_cover_bindings_is_active( [] )` returns `false`.
- For attrs whose `metadata.bindings` is `{ __default: { source: 'core/pattern-overrides' } }`, the helper returns `true`.
- For attrs whose `metadata.bindings` is `{ id: { source: 'a' }, url: { source: 'b' } }`, the helper returns `false`.
- For attrs whose `metadata.bindings` is `{ id: { source: 'a', args: { key: 'x' } }, url: { source: 'a', args: { key: 'x' } } }`, the helper returns `true`.
- For attrs whose `metadata.bindings` is `{ id: { source: 'a', args: { k: 1 } }, url: { source: 'a', args: { k: 2 } } }`, the helper returns `false`.
- For attrs whose `metadata.bindings` is `{ url: { source: 'a' } }` (no id), the helper returns `false`.
- The helper does NOT short-circuit on `backgroundType === 'embed-video'` — that gate is the responsibility of the callers (Tasks 4 and 5). The helper is pure-by-bindings.

---

### Task 4: `render_block_data` filter to neutralise `useFeaturedImage` on bound covers

**Goal**: When a Cover's bindings are active AND `backgroundType !== 'embed-video'`, force `$parsed_block['attrs']['useFeaturedImage'] = false` BEFORE `WP_Block::render()` builds its instance attributes — so `render_block_core_cover` skips its featured-image injection branch on the first pass. This is the AC-18 precedence rule.

**Files**:
- `lib/compat/wordpress-7.1/block-bindings.php` — MODIFY: add `gutenberg_cover_bindings_prepare_block` and register it on `render_block_data` at priority 10.

**Changes**:
1. Add `gutenberg_cover_bindings_prepare_block( $parsed_block, $source_block, $parent_block )`:
   - If `$parsed_block['blockName'] !== 'core/cover'`, return `$parsed_block` unchanged.
   - Read `$attrs = $parsed_block['attrs'] ?? array();`.
   - If `! empty( $attrs['backgroundType'] ) && 'embed-video' === $attrs['backgroundType']`, return `$parsed_block` unchanged (AC-21).
   - If `! gutenberg_cover_bindings_is_active( $attrs )`, return `$parsed_block` unchanged.
   - Else if `! empty( $attrs['useFeaturedImage'] )`, set `$parsed_block['attrs']['useFeaturedImage'] = false;`.
   - Return `$parsed_block`.
2. Wrap in `if ( ! function_exists( … ) )`.
3. Register: `add_filter( 'render_block_data', 'gutenberg_cover_bindings_prepare_block', 10, 3 );`.

**Depends on**: Task 3

**Traces to**: Spec Req 19, AC-18; Design §6.1 Part 2, §12 (`useFeaturedImage` precedence rule).

**Acceptance**:
- For a non-Cover block, the filter returns its input unchanged.
- For a Cover with no `metadata.bindings`, the filter returns its input unchanged (in particular, `useFeaturedImage` is not flipped).
- For a Cover with `backgroundType: 'embed-video'` AND active bindings, the filter returns input unchanged.
- For a Cover with active bindings (per `gutenberg_cover_bindings_is_active`), `backgroundType !== 'embed-video'`, AND `useFeaturedImage: true`, the filter returns the input with `attrs.useFeaturedImage === false`. All other attrs are untouched.
- For a Cover with active bindings and `useFeaturedImage: false`, the returned `attrs.useFeaturedImage` is still `false` (no surprises).
- The persisted `post_content` is NOT mutated by this filter — only the in-flight `$parsed_block` array.

---

### Task 5: Cover-scoped `render_block` filter with image-rewrite / dim-class-relax / strip-image helpers

**Goal**: When a Cover has an active binding AND `backgroundType !== 'embed-video'`, rewrite the rendered HTML so: (a) the saved `<img class="wp-block-cover__image-background">` OR `<div class="wp-block-cover__image-background" style="background-image:url(…)">` becomes an `<img>` with the bound URL, alt, and `wp-image-{id}` class; (b) the overlay span loses `has-background-dim-100` when stored `dimRatio === 100`; (c) when the binding is unresolvable (no `id`, or `id` is not an attachment), the saved image element is stripped entirely.

**Files**:
- `lib/compat/wordpress-7.1/block-bindings.php` — MODIFY: add four functions: `gutenberg_cover_bindings_render_block`, `gutenberg_cover_bindings_rewrite_image`, `gutenberg_cover_bindings_relax_dim_class`, `gutenberg_cover_bindings_strip_image`. Register the first on `render_block` at priority 9.

**Changes**:
1. **`gutenberg_cover_bindings_strip_image( string $content ): string`** — try `$form2_pattern = '/<div\s+[^>]*\bwp-block-cover__image-background\b[^>]*><\/div>/U';` first, then `$form1_pattern = '/<img\s+[^>]*\bwp-block-cover__image-background\b[^>]*\/?\s*>/U';`. Use `preg_match` with `PREG_OFFSET_CAPTURE` to locate the match and `substr` to splice it out. Return the modified content (or input unchanged if neither pattern matches).
2. **`gutenberg_cover_bindings_relax_dim_class( string $content ): string`** — instantiate `WP_HTML_Tag_Processor( $content )`; loop with `next_tag( array( 'tag_name' => 'SPAN', 'class_name' => 'wp-block-cover__background' ) )`; on each match call `remove_class( 'has-background-dim-100' )`. Return `get_updated_html()`.
3. **`gutenberg_cover_bindings_rewrite_image( string $content, string $resolved_url, int $resolved_id, array $attrs ): string`**:
   - First, try the parallax/repeat form via `preg_match( $form2_pattern, … )` — if matched, build a replacement `<img class="wp-block-cover__image-background wp-image-{id}{size_class_suffix}" alt="{alt}" src="{esc_url url}" data-object-fit="cover"{object_position_attrs} />` and splice it in via `substr`. Compute `$size_class_suffix` from `$attrs['sizeSlug']` (empty when unset); compute `$object_position_attrs` from `$attrs['focalPoint']` (empty when unset); compute `$alt` from the attachment's alt metadata (`get_post_meta( $resolved_id, '_wp_attachment_image_alt', true )`).
   - Otherwise, fall through to the plain-`<img>` path via `WP_HTML_Tag_Processor`: `next_tag( array( 'tag_name' => 'IMG', 'class_name' => 'wp-block-cover__image-background' ) )`; if found, `set_attribute( 'src', $resolved_url )`, `set_attribute( 'alt', $alt )`, iterate `class_list()`, remove any class beginning with `wp-image-`, then `add_class( 'wp-image-' . $resolved_id )`. Return `get_updated_html()`.
   - If neither pattern matched, return `$content` unchanged (no image element to rewrite — fine, render proceeds overlay-only).
4. **`gutenberg_cover_bindings_render_block( $block_content, $block, $instance )`** — main entry, registered on `render_block` priority 9:
   - If `$block['blockName'] !== 'core/cover'`, return `$block_content` unchanged.
   - Read `$attrs = $instance->attributes ?? array();`.
   - If `! empty( $attrs['backgroundType'] ) && 'embed-video' === $attrs['backgroundType']`, return unchanged.
   - If `! gutenberg_cover_bindings_is_active( $attrs )`, return unchanged.
   - `$resolved_url = $attrs['url'] ?? null;` `$resolved_id = (int) ( $attrs['id'] ?? 0 );`
   - If `empty( $resolved_url ) || empty( $resolved_id )`, return `gutenberg_cover_bindings_strip_image( $block_content )`.
   - Verify attachment: `$attachment = get_post( $resolved_id );` if `! $attachment || 'attachment' !== $attachment->post_type`, return `gutenberg_cover_bindings_strip_image( $block_content )`.
   - `$block_content = gutenberg_cover_bindings_rewrite_image( $block_content, $resolved_url, $resolved_id, $attrs );`
   - If `100 === (int) ( $attrs['dimRatio'] ?? 100 )`, `$block_content = gutenberg_cover_bindings_relax_dim_class( $block_content );`
   - Return `$block_content`.
5. Register `add_filter( 'render_block', 'gutenberg_cover_bindings_render_block', 9, 3 );`. Priority 9 is essential — it must run BEFORE the generic priority-10 `gutenberg_block_bindings_render_block`.
6. Wrap each of the four functions in `if ( ! function_exists( … ) )`.

**Depends on**: Task 3, Task 4 (same file; sequencing keeps the file growing monotonically)

**Traces to**: Spec Req 17, Req 18, Req 19, Req 20, Req 21, Req 22; AC-3, AC-5, AC-6, AC-16, AC-18, AC-19, AC-21; Design §6.1 Part 3, §6.2, §6.3, §6.4, OQ-3.

**Acceptance**:
- For a non-Cover block, the filter returns input unchanged.
- For a Cover with no active binding, the filter returns input unchanged.
- For an `embed-video` Cover, the filter returns input unchanged regardless of binding state.
- For a Cover with active bindings, `dimRatio: 100`, and a resolved attachment URL, the output contains an `<img>` whose `src` matches the bound URL AND no `has-background-dim-100` class anywhere.
- For a Cover with active bindings, `dimRatio: 70`, and resolved attachment, the output contains an `<img>` with the bound URL AND the `has-background-dim-70` class is preserved.
- For a Cover with active bindings but `id` resolves to a non-attachment post, the output contains no `wp-block-cover__image-background` element.
- For a Cover with active bindings, saved markup is the parallax/repeat `<div>...</div>` form, and a resolved attachment, the output contains an `<img class="wp-block-cover__image-background wp-image-{id}">` AND no `has-parallax` / `is-repeated` class on the image element AND no `style="background-image: …"` on the rebuilt element.
- Idempotency: running the helper twice on already-rewritten content does not produce additional `<img>` elements.

---

### Task 6: New hook — `useCoverBindingState`

**Goal**: Provide the client-side single-source-of-truth for cover binding state — `bindingActive`, `bindingUnresolvable`, `bindingResolvedUrl`, `bindingResolvedId`, `canUserEditBindingValue` — computed in one place from one `useSelect`. Used by `CoverEdit` to drive everything downstream.

**Files**:
- `packages/block-library/src/cover/edit/use-cover-binding-state.js` — CREATE.

**Changes**:
1. New file exporting a default function with signature `export default function useCoverBindingState( { clientId, attributes, context } ) { … }`. The `context` parameter is the full, undestructured context object (see Task 7 step 2 for the prop-boundary change in `CoverEdit` that produces it). Do NOT reconstruct a partial `{ postId, postType }` shape — binding sources may declare `usesContext` for additional keys and need the full object.
2. Imports:
   - `getBlockBindingsSource` from `@wordpress/blocks`
   - `useSelect` from `@wordpress/data`
   - `store as coreStore` from `@wordpress/core-data`
   - Do NOT import `replacePatternOverridesDefaultBinding` from `@wordpress/block-editor`. It is NOT publicly re-exported from the package (verified: `packages/block-editor/src/index.js` re-exports `./utils` and `./utils/index.js` re-exports only `transformStyles` and `getPxFromCssUnit`; the helper at `packages/block-editor/src/utils/block-bindings.js:27` is consumed in-tree only via the relative path `../../utils/block-bindings`). Importing it from `@wordpress/block-editor` would fail to resolve.
3. Re-implement `__default` expansion inline in this file as a tiny module-local helper (chosen resolution per iter-2 review Issue 1, option (c)). This duplicates ~10 lines of `packages/block-editor/src/utils/block-bindings.js:1-46` but avoids both (a) a cross-package public-API change to re-export the helper and (b) the private-APIs `lock`/`unlock` plumbing required to reach it through the channel `block-editor/src/components/block-edit/edit.js:28` uses (`import { unlock } from '../../lock-unlock'` is itself a private hatch into the package — not a stable cross-package contract). The DRY cost is bounded because the helper is small, has no internal dependencies beyond two string constants, and has been stable in trunk since Pattern Overrides shipped:

   ```js
   const PATTERN_OVERRIDES_SOURCE = 'core/pattern-overrides';
   function expandDefaultBinding( bindings, supportedAttributes ) {
       if ( bindings?.__default?.source !== PATTERN_OVERRIDES_SOURCE ) {
           return bindings;
       }
       const expanded = {};
       for ( const attr of supportedAttributes ) {
           expanded[ attr ] = bindings[ attr ]
               ? bindings[ attr ]
               : { source: PATTERN_OVERRIDES_SOURCE };
       }
       return expanded;
   }
   ```

   Place this above the hook body. Add a one-line code comment that points at `packages/block-editor/src/utils/block-bindings.js` so a future reader knows where the canonical implementation lives and the divergence risk is acknowledged. If Core later promotes the helper to a public re-export (a separate, owner-gated decision), this duplication becomes a one-line swap.
4. Body:
   - Read `const bindings = attributes.metadata?.bindings;`. If absent, return `{ bindingActive: false, bindingUnresolvable: false, bindingResolvedUrl: undefined, bindingResolvedId: undefined, canUserEditBindingValue: false }` early.
   - Call `const expanded = expandDefaultBinding( bindings, [ 'id', 'url' ] );` (the local helper from step 3).
   - Compute `bindingActive` per Design §5.1 step 2: both `expanded.id` and `expanded.url` are present, same `source`, `JSON.stringify( expanded.id.args ?? null ) === JSON.stringify( expanded.url.args ?? null )`, AND `attributes.backgroundType !== 'embed-video'`.
   - Single `useSelect` (Design §5.1 step 3): when `bindingActive`, look up the source via `getBlockBindingsSource( expanded.url.source )`, call `source.getValues( { select, clientId, context, bindings: { id: expanded.id, url: expanded.url } } )`, then if `values.id` is truthy, also call `select( coreStore ).getEntityRecord( 'postType', 'attachment', values.id, { context: 'view' } )`. Return `{ bindingResolvedUrl, bindingResolvedId, bindingResolvedAttachment }` from the closure. Pass `context` through as the full object received from the hook's argument (NOT a reconstructed partial).
   - Dependency array: `[ bindingActive, expanded?.id?.source, expanded?.url?.source, clientId, context ]`.
   - Compute `bindingUnresolvable`:
     - `true` if `bindings` has any cover-relevant configuration (`bindings.__default` exists, OR `bindings.id` exists, OR `bindings.url` exists) AND `! bindingActive` — i.e. malformed/mismatched binding.
     - OR `true` if `bindingActive && bindingResolvedAttachment === null` (resolved-not-found; remember `undefined` means pending — NOT unresolvable).
     - OR `true` if `bindingActive && bindingResolvedAttachment?.type && bindingResolvedAttachment.type !== 'attachment'`.
   - Compute `canUserEditBindingValue` from the source: `getBlockBindingsSource( expanded.url.source )?.canUserEditValue?.( … ) ?? false`. (Used for future lock-flag wiring; safe to return `false` if not applicable.)
   - Return `{ bindingActive, bindingUnresolvable, bindingResolvedUrl, bindingResolvedId, canUserEditBindingValue }`.
5. The hook returns plain values. No memoised React elements, no `useEffect`.

**Depends on**: Task 2 (the editor setting `__experimentalBlockBindingsSupportedAttributes['core/cover']` must include `id`/`url`).

**Traces to**: Spec Req 9, Req 10, Req 25, Req 26, Req 27; AC-3, AC-4, AC-6, AC-21; DC-1, DC-3; Design §5.1, §5.6 (Pattern Overrides integration via the inline-duplicated `__default` expansion that mirrors `replacePatternOverridesDefaultBinding`).

**Acceptance**:
- Called with `attributes.metadata.bindings === undefined`: returns `bindingActive: false`, `bindingUnresolvable: false`.
- Called with `attributes.metadata.bindings = { __default: { source: 'core/pattern-overrides' } }`: returns `bindingActive: true`. (Confirms inline `__default` expansion works.)
- Called with `attributes.metadata.bindings = { id: { source: 'x' }, url: { source: 'y' } }`: returns `bindingActive: false, bindingUnresolvable: true`.
- Called with `attributes.metadata.bindings = { id: { source: 'x' }, url: { source: 'x' } }` AND `attributes.backgroundType = 'embed-video'`: returns `bindingActive: false` (embed-video override).
- The hook does NOT import from `@wordpress/block-editor`'s `utils/block-bindings` path (which is not publicly re-exported). The `__default` expansion is implemented inline in this file.
- The hook subscribes via exactly ONE `useSelect`. (Verifiable by code review / by counting `useSelect` calls in the file.)
- The hook does NOT call `useEffect`. (Verifiable by code review.)
- When `bindingActive` is true but the attachment record is loading (selector returns `undefined`), `bindingUnresolvable` is `false` (treated as pending, not unresolvable).
- When `bindingActive` is true and the attachment record resolves to `null` (not found), `bindingUnresolvable` is `true`.

---

### Task 7: Single observer + derived values in `CoverEdit`

**Goal**: Replace the existing `useEffect` on `[mediaUrl]` in `packages/block-library/src/cover/edit/index.js` with a single source-agnostic observer keyed on `effectiveUrl`, using `useEffectEvent` for latest reads and a `raceTokenRef` for stale-resolution protection. Compute `effectiveUrl` and `effectiveDimRatio` once at the top of the component. Do NOT call `setAttributes` for any value in DC-2's prohibition list as a consequence of this observer.

**Files**:
- `packages/block-library/src/cover/edit/index.js` — MODIFY: import the new hook, declare `raceTokenRef`, replace the existing `useEffect([mediaUrl])` with the new observer, compute `effectiveUrl` and `effectiveDimRatio`.

**Changes**:
1. Add imports at the top of the file:
   - `import useCoverBindingState from './use-cover-binding-state';`
   - Ensure `useEffectEvent`, `useRef`, `useEffect` are imported from `@wordpress/element` (some may already be present).
2. **Prop-boundary change for `context`** — `CoverEdit` currently destructures `context: { postId, postType }` in its props signature (verified at `packages/block-library/src/cover/edit/index.js:95`), so there is no `context` identifier in scope. Change the destructuring to keep `context` undestructured AND keep `postId`/`postType` available:
   ```js
   function CoverEdit( {
       attributes,
       clientId,
       isSelected,
       overlayColor,
       setAttributes,
       setOverlayColor,
       toggleSelection,
       context,
   } ) {
       const { postId, postType } = context;
       …
   }
   ```
   Existing references to `postId` / `postType` (e.g. the `useEntityProp( 'postType', postType, 'featured_media', postId )` call at line ~119) continue to work unchanged because the new destructure declares the same identifiers. The hook receives the full, undestructured `context` object — sources may declare `usesContext` for keys beyond `postId`/`postType` and need access to them.
3. Inside `CoverEdit` body, after the existing props/state destructuring, before any existing `useEffect`:
   - `const { bindingActive, bindingUnresolvable, bindingResolvedUrl, bindingResolvedId, canUserEditBindingValue } = useCoverBindingState( { clientId, attributes, context } );`
   - `const raceTokenRef = useRef( 0 );`
4. Compute `effectiveUrl`:
   ```js
   const effectiveUrl =
       bindingResolvedUrl ??
       ( useFeaturedImage ? mediaUrl : originalUrl?.replaceAll( '&amp;', '&' ) );
   ```
5. Compute `effectiveDimRatio`:
   ```js
   const effectiveDimRatio =
       bindingActive && dimRatio === 100 && effectiveUrl ? 50 : dimRatio;
   ```
6. Replace the existing `useEffect( () => { /* getMediaColor on mediaUrl */ }, [ mediaUrl ] )` block with:
   - `const onUrlResolved = useEffectEvent( async ( resolvedUrl ) => { … } );` whose body:
     1. Returns early if `! resolvedUrl`.
     2. Increments `raceTokenRef.current` into a local `myToken`.
     3. `const avg = await getMediaColor( resolvedUrl );`
     4. If `myToken !== raceTokenRef.current`, return (stale).
     5. Read latest `attributes` / `overlayColor` via a `propsRef.current` pattern (preserve existing pattern if one exists in trunk; otherwise read directly through `useEffectEvent`'s latest-value contract).
     6. If `! attributes.isUserOverlayColor`, call `__unstableMarkNextChangeAsNotPersistent()` then `setOverlayColor( avg )` (preserves trunk behavior; `overlayColor` IS in DC-2's prohibition list but its mutation here is a continuation of trunk's existing media-resolution path, NOT triggered by binding-state change — same call site as today). [DC-2 note: this preserves the trunk behaviour exactly; the binding-state change does not flip `isUserOverlayColor`, and the only path that calls `setOverlayColor` here is the URL-resolved derivation that runs identically for manual, featured-image, and binding-sourced URLs — i.e. source-agnostic per DC-3.]
     7. Compute `newIsDark` from `compositeIsDark( …, … , avg )` using `effectiveDimRatio`-equivalent latest values per Design §5.2.
     8. `__unstableMarkNextChangeAsNotPersistent()` + `setAttributes( { isDark: newIsDark } )` (allowed; `isDark` is NOT in DC-2's prohibition list).
   - One `useEffect( () => { onUrlResolved( effectiveUrl ); }, [ effectiveUrl, onUrlResolved ] );`.
7. The existing event handlers (`onSelectMedia`, `onClearMedia`, `onSetOverlayColor`, `onUpdateDimRatio`, `toggleUseFeaturedImage`, `onSelectEmbedUrl`) are UNCHANGED — they continue to mutate stored attributes in response to user intent (allowed under DC-2).
8. The overlay-span class computation MUST use `effectiveDimRatio` rather than `dimRatio` in `dimRatioToClass( … )` (verify the JSX site exists; trunk code references the overlay `<span>` near the dim-class computation — pass `effectiveDimRatio` through).

**Depends on**: Task 6

**Traces to**: Spec Req 10, Req 11, Req 12, Req 13, Req 14, Req 15; AC-15, AC-17, AC-18 (client side); DC-1, DC-2, DC-3; Design §5.2, §5.3, §5.4.

**Acceptance**:
- The file contains exactly ONE `useEffect` whose dependency array includes `effectiveUrl`. No new `useEffect` keyed on `metadata.bindings`, `useFeaturedImage`, or similar event sources is introduced. (DC-1 enforcement — verifiable by code review.)
- `effectiveUrl` is computed exactly once at the top of `CoverEdit`, prefers `bindingResolvedUrl`, falls back to `useFeaturedImage`'s `mediaUrl`, then to `originalUrl`.
- `effectiveDimRatio` is 50 only when `bindingActive && dimRatio === 100 && effectiveUrl`. In all other cases it equals `dimRatio`.
- The observer body does NOT call `setAttributes` (or any equivalent attribute write) for any of the DC-2-prohibited attributes — `dimRatio`, `useFeaturedImage`, `backgroundType`, `id`, `url`, `hasParallax`, `isRepeated`, `overlayColor`, `customOverlayColor` — EXCEPT for `overlayColor`/`customOverlayColor`, whose mutation via `setOverlayColor( avg )` is a deliberate source-agnostic carve-out per Design §5.2/§5.3: it is the same media-resolution path that fires for manual selection and `useFeaturedImage` URLs, NOT a fresh binding-state-triggered write. Per DC-3 the observer cannot branch on URL source, so this `setOverlayColor` call IS the source-agnostic continuation of trunk behaviour. The only fresh `setAttributes` call inside the observer is `{ isDark }`. (DC-2 enforcement — verifiable by inspection. Acceptance for Task 11 has a corresponding mock-setAttributes test.)
- When two `effectiveUrl` changes happen in quick succession, only the latest `getMediaColor` resolution actually writes `overlayColor` / `isDark` (race-token-protected).
- The overlay span class uses `dimRatioToClass( effectiveDimRatio )` rather than `dimRatioToClass( dimRatio )`.

---

### Task 8: Bound-cover empty-cover placeholder branch and `<img>`-forced non-empty render branch in `CoverEdit`

**Goal**: Two structural render-tree changes in `packages/block-library/src/cover/edit/index.js`:
1. The empty-cover branch (currently `if ( ! useFeaturedImage && ! hasInnerBlocks && ! hasBackground )` near line 599) renders a binding-aware `<Placeholder>` when `bindingActive || bindingUnresolvable` — the standard `<CoverPlaceholder>` is NOT rendered on bound covers.
2. The non-empty image render branch (around `url && isImageBackground` near line 672) emits a forced `<img>` (no `<div bg>`) whenever `bindingActive`, regardless of `hasParallax`/`isRepeated`.

**Files**:
- `packages/block-library/src/cover/edit/index.js` — MODIFY.

**Changes**:
1. In the empty-cover branch, BEFORE returning the existing `<CoverPlaceholder>` JSX:
   - If `bindingActive || bindingUnresolvable`, return a JSX subtree per Design §5.4 (1):
     - `<>` containing the existing `blockControls`, `inspectorControls`, conditional `<ResizableCoverPopover/>`, then a `<TagName … className={ clsx( 'is-placeholder', blockProps.className ) } style={ { …blockProps.style, minHeight: minHeightWithUnit || undefined } }>`.
     - Inside `<TagName>`, render `{ resizeListener }`.
     - If `bindingUnresolvable`, render `<Placeholder data-testid="cover-binding-unresolvable" className="wp-block-cover__binding-unresolvable" withIllustration instructions={ __( 'Internal media required for this binding.' ) } />`.
     - Else (bindingActive but pending resolution), render `<Placeholder className="wp-block-cover__binding-pending" withIllustration />`.
   - Else fall through to the existing trunk `<CoverPlaceholder>` return — UNCHANGED.
2. In the non-empty image render branch (around `url && isImageBackground` near line 672):
   - **Swap the outer gating predicate from the stored `url` to the derived `effectiveUrl`, AND add the `! bindingUnresolvable` guard.** Concretely, rewrite the predicate `{ url && isImageBackground && ( … ) }` to `{ ! bindingUnresolvable && effectiveUrl && isImageBackground && ( … ) }`. This is a Pattern-Overrides-critical change — per Design §5.4 (2) — because on a pattern-instance Cover whose stored `url` is empty (e.g. immediately after a Pattern Overrides reset that cleared the override, or when the synced pattern was authored with no default) but whose `bindingResolvedUrl` is populated, gating on the stored `url` would route the cover through the empty-cover branch and AC-7 would fail. Gating on `effectiveUrl` keeps the bound `<img>` rendering through the branch.
   - Inside the (now `effectiveUrl`-gated) branch, switch on `bindingActive`:
     - When `bindingActive`, force-render `<img ref={ mediaElement } className="wp-block-cover__image-background" alt={ alt } src={ effectiveUrl } style={ mediaStyle } />` (skipping the `isImgElement` check that would otherwise pick a `<div>` for parallax/repeat saved markup).
     - When `! bindingActive`, the existing trunk JSX (with `isImgElement` switching between `<img>` and `<div>`, and reading `src={ url }`) is preserved verbatim. Importantly, this branch continues to read the stored `url`, NOT `effectiveUrl`, on unbound covers — `effectiveUrl` collapses to `url` when no binding is active (per Task 7 step 4), so the user-observable output is byte-identical to trunk on unbound covers (AC-20).
3. The overlay span: pass `effectiveDimRatio` to `dimRatioToClass` (this is the same change as in Task 7 step 7 — Task 7 establishes the derived value; Task 8 confirms the call site).
4. Import `__` from `@wordpress/i18n` if not already imported (it almost certainly already is).
5. Import `Placeholder` from `@wordpress/components` if not already imported.

**Depends on**: Task 7

**Traces to**: Spec Req 16, AC-4, AC-15 (client side), AC-19 (client side); Design §5.4 (1), §5.4 (2), OQ-6 (i18n string + `data-testid`).

**Acceptance**:
- On a Cover with no bindings and no background, the existing `<CoverPlaceholder>` renders (no regression — AC-20).
- On a Cover with `bindingUnresolvable: true`, the editor preview contains a `<Placeholder>` whose accessible text includes the literal string `Internal media required for this binding.`. Its containing element has `data-testid="cover-binding-unresolvable"`. No `<img class="wp-block-cover__image-background">` is rendered.
- The non-empty image branch's outer gating predicate uses `effectiveUrl`, NOT the stored `url`. A Cover whose stored `url === ''` but whose `bindingResolvedUrl` is populated (the Pattern Overrides default state on a pattern-instance) reaches the image branch and renders the bound `<img>` (AC-7).
- On a Cover with `bindingActive: true`, `bindingUnresolvable: false`, and an `effectiveUrl`, the editor preview contains `<img class="wp-block-cover__image-background" src="{effectiveUrl}">` (an `<img>`, not a `<div style="background-image:…">`), even when `hasParallax: true` and `isRepeated: true` are stored on the block.
- The overlay `<span class="wp-block-cover__background …">` class string uses `effectiveDimRatio` for `dimRatioToClass` — when `dimRatio === 100 && bindingActive && effectiveUrl`, the class string does NOT contain `has-background-dim-100`.
- On a Cover with `backgroundType: 'embed-video'` and `metadata.bindings` set, `bindingActive` is `false` (from Task 6) → the binding-aware branches do NOT engage and the existing embed-video render path runs unchanged (AC-21).

---

### Task 9: Gate parallax and repeat controls in `inspector-controls.js`; gate `<MediaReplaceFlow>` in `block-controls.js`; gate line-750 `<CoverPlaceholder>` in `index.js`

**Goal**: Hide every Cover-specific control that conflicts with bindings, in all surfaces (inspector parallax/repeat, toolbar media-replace, line-750 cover-placeholder drop-zone). Honour AC-11..AC-14 by literal DOM absence — not by `disabled` props.

**Files**:
- `packages/block-library/src/cover/edit/inspector-controls.js` — MODIFY: accept a new `bindingActive` prop and conditionally render the parallax + repeat `<ToolsPanelItem>`s.
- `packages/block-library/src/cover/edit/block-controls.js` — MODIFY: accept a new `bindingActive` prop and conditionally render the entire `<MediaReplaceFlow>` element.
- `packages/block-library/src/cover/edit/index.js` — MODIFY: pass `bindingActive` to both child components AND wrap the line-750 `<CoverPlaceholder>` call site in `{ ! bindingActive && ( … ) }`.

**Changes**:

In `inspector-controls.js`:
1. Add `bindingActive` to the destructured props.
2. Wrap the JSX fragment that contains the "Fixed background" and "Repeated background" `<ToolsPanelItem>`s in `{ ! bindingActive && ( <> … </> ) }`. (If the items are not currently inside a fragment together, wrap them together first.)

In `block-controls.js`:
1. Add `bindingActive` to the destructured props.
2. Inside the `<BlockControls group="other">`, wrap the entire `<MediaReplaceFlow … >` (including its `<MenuItem>` children for "Embed video from URL") in `{ ! bindingActive && ( … ) }`.
3. The "Embed video from URL" `<MenuItem>` is consciously removed alongside `<MediaReplaceFlow>` on bound non-embed-video covers per Design §5.5 trade-off. Embed-video covers force `bindingActive=false` from Task 6, so AC-21's population still has the affordance.

In `index.js`:
1. When rendering `<CoverInspectorControls … />` and `<CoverBlockControls … />`, pass `bindingActive={ bindingActive }`.
2. At the line-750 site (the `<CoverPlaceholder disableMediaButtons onSelectMedia={ onSelectMedia } onError={ onUploadError } toggleUseFeaturedImage={ toggleUseFeaturedImage } />`), wrap in `{ ! bindingActive && ( <CoverPlaceholder … /> ) }`. The existing call site moves inside a JSX expression block.

**Depends on**: Task 7 (establishes `bindingActive` in `CoverEdit`), Task 8 (the line-616 branch is already binding-aware).

**Traces to**: Spec Req 4, Req 5, Req 6, Req 7; AC-11, AC-12, AC-13, AC-14; Design §5.5, §5.4 (line-750 gating), §13 (AC-14 gating table, line-750 trade-off table).

**Acceptance**:
- On a Cover with `bindingActive: true`, the inspector DOM contains NO `<ToolsPanelItem>` for "Fixed background" (parallax) and NO `<ToolsPanelItem>` for "Repeated background" (repeat).
- On a Cover with `bindingActive: true`, the block toolbar DOM contains NO `<MediaReplaceFlow>` button (no `Add media` / `Replace` toggle, no `Open Media Library`, no `Upload`, no `Use featured image`, no `Embed video from URL` menu items).
- On a Cover with `bindingActive: false` (unbound, or embed-video, or mismatched), the inspector and toolbar render the existing trunk controls byte-for-byte (AC-20 non-regression).
- On a Cover with `bindingActive: true` AND `hasBackground: true`, the rendered cover DOM contains NO `<CoverPlaceholder>` at the line-750 site (the drop-zone is not present; dropping a file does not mutate `url`).
- `cover-placeholder.js` source file is NOT modified.

---

### Task 10: PHPUnit coverage in `phpunit/blocks/render-block-cover-test.php`

**Goal**: Lock down server-side behaviour with the nine cases enumerated in Design §6.5 — including the AC-25 PHPUnit case explicitly required by the spec and the AC-18 first-pass-injection regression test.

**Files**:
- `phpunit/blocks/render-block-cover-test.php` — MODIFY: extend with new test methods. (No file creation; the file exists.)

**Changes**:
1. Add `setUp`/`tearDown` helpers to register a test binding source via `register_block_bindings_source( 'test/cover-source', [ 'label' => 'Test', 'get_value_callback' => fn() => …, ] )` and unregister on tearDown. Use the existing `register_block_bindings_source` infrastructure.
2. Add `setUp` helper to upload two test attachments (default + override) via the standard PHPUnit attachment-fixture pattern (mirror `phpunit/blocks/render-block-image-test.php` or `render-block-media-text-test.php` for patterns).
3. Add nine `public function test_…` methods, one per Design §6.5 case:
   - `test_bound_url_substitutes_in_plain_img_form` (AC-3)
   - `test_default_dim_ratio_class_is_relaxed` (AC-16, AC-25)
   - `test_non_default_dim_ratio_is_preserved` (AC-17)
   - `test_parallax_saved_markup_is_rebuilt_as_img` (AC-19)
   - `test_mismatched_source_strips_image` (AC-6)
   - `test_external_url_strips_image` (AC-5)
   - `test_use_featured_image_with_active_binding_emits_exactly_one_img_with_bound_url` (AC-18)
   - `test_embed_video_short_circuits` (AC-21)
   - `test_unbound_cover_is_byte_identical_to_trunk` (AC-20)
4. Each test method constructs a `parsed_block` array via `parse_blocks( '<!-- wp:cover {…} … /wp:cover -->' )` or builds the array directly, calls `render_block( $parsed_block )`, and asserts on the returned HTML via `assertStringContainsString` / `assertStringNotContainsString` / `assertMatchesRegularExpression` per case.

**Depends on**: Task 5 (the server filter must exist and be loaded).

**Traces to**: Spec Req 17–22, Req 23 (Unbound non-regression invariant locked down by `test_unbound_cover_is_byte_identical_to_trunk`), Req 34 (PHPUnit case asserting bound `<img src>` substitution and non-`has-background-dim-100` class), Req 35 (existing tests continue to pass); AC-3, AC-5, AC-6, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-25; Design §6.5, §11.2.

**Acceptance**:
- All nine new test methods pass.
- `vendor/bin/phpunit phpunit/blocks/render-block-cover-test.php` exits 0 with no failures and no skipped tests.
- The pre-existing test methods in `render-block-cover-test.php` continue to pass (AC-20, Req 35 non-regression).
- The `test_use_featured_image_with_active_binding_emits_exactly_one_img_with_bound_url` case asserts the bound URL appears in the output exactly once and the featured-image URL does not appear at all (catches AC-18 regressions in either direction).
- The `test_default_dim_ratio_class_is_relaxed` case asserts BOTH the absence of `has-background-dim-100` AND the presence of `has-background-dim` (preserves the 50%-opacity baseline per OQ-4).

---

### Task 11: Jest unit tests for `useCoverBindingState` and the single observer

**Goal**: Cover the client-side hook predicates (every branch of `bindingActive` / `bindingUnresolvable`) and the observer's race-token / source-agnostic / no-attribute-mutation behaviour.

**Files**:
- `packages/block-library/src/cover/test/edit.js` — MODIFY: extend with new `describe('useCoverBindingState')` and `describe('CoverEdit single observer')` blocks.

**Changes**:
1. In `packages/block-library/src/cover/test/edit.js`, add a new `describe( 'useCoverBindingState', … )` block with at least these cases (per Design §11.1):
   - `bindingActive` true for `{ __default: { source: 'core/pattern-overrides' } }`.
   - `bindingActive` true for matching source + matching args.
   - `bindingActive` false for differing sources.
   - `bindingActive` false for differing args.
   - `bindingActive` false for `backgroundType === 'embed-video'`.
   - `bindingUnresolvable` true on mismatched-source binding.
   - `bindingUnresolvable` true on resolved-not-found attachment (selector returns `null`).
   - `bindingUnresolvable` false on pending attachment (selector returns `undefined`).
   - `effectiveDimRatio` returns 50 only when `bindingActive && dimRatio === 100 && effectiveUrl` is truthy. (This may be tested through `CoverEdit` integration rather than directly, since `effectiveDimRatio` is local to `CoverEdit`.)
2. Add a `describe( 'CoverEdit single observer', … )` block with at least:
   - The observer does not call `setAttributes` for any value in DC-2's prohibition list when a binding becomes active (mock `setAttributes`, transition `metadata.bindings` from `undefined` to `{ __default: … }`, assert `setAttributes` was not called with `dimRatio`/`useFeaturedImage`/etc.).
   - The observer is source-agnostic: identical observer behavior whether the URL change came from `attributes.url`, `useFeaturedImage`'s `mediaUrl`, or `bindingResolvedUrl`.
   - The race-token guard: two rapid `effectiveUrl` changes followed by out-of-order `getMediaColor` resolutions — only the second resolution writes `overlayColor` / `isDark`.
3. Use existing test infrastructure (Jest mocking of `@wordpress/data`'s `useSelect`, mocking `getMediaColor`).

**Depends on**: Task 6, Task 7

**Traces to**: Spec Req 10, Req 11, Req 13, Req 26, Req 35 (existing edit.js tests continue to pass); AC-3, AC-4, AC-6; DC-1, DC-2, DC-3; Design §5.1, §5.2, §11.1.

**Acceptance**:
- All new test cases pass.
- `npm run test:unit packages/block-library/src/cover/test/edit.js` exits 0.
- The pre-existing edit.js tests continue to pass (Req 35 non-regression).
- The DC-2 mutation-prohibition test fails the build if a future change introduces `setAttributes({ dimRatio: … })` in the observer.

---

### Task 12: E2E test — Pattern Overrides round-trip and unresolvable-binding affordance

**Goal**: End-to-end browser test that exercises Pattern Overrides on Cover from authoring to front-end render and back, plus the mismatched-source unresolvable-binding case. Satisfies AC-22, AC-23, AC-24.

**Files**:
- `test/e2e/specs/editor/blocks/cover.spec.js` — MODIFY: add a new `test.describe('Block Bindings — Pattern Overrides round-trip', …)` block.
- (Optional, if needed for mismatched-source coverage) `packages/e2e-tests/plugins/block-bindings.php` — REUSE existing; do not modify unless an additional test source is required and even then prefer adding to the existing test plugin.

**Changes**:
1. Add a new `test.describe( 'Block Bindings — Pattern Overrides round-trip', … )` to `test/e2e/specs/editor/blocks/cover.spec.js`.
2. Test fixture `setup`:
   - Upload two attachments via `requestUtils.uploadMedia` (default + override).
   - Reset on cleanup.
3. Single `test( 'Cover round-trips through default → override → reset', … )` with these phases (per Design §11.3):
   - **Setup**: create a synced pattern containing a Cover whose `url`+`id` are bound via the "Enable overrides" affordance on the pattern-author surface. Save the pattern.
   - **Default state**: open a new post, insert the pattern. Assert:
     - Editor preview `<img>` src matches `defaultMedia.url`.
     - The parallax `<ToolsPanelItem>` for "Fixed background" is not visible (AC-11).
     - The repeat `<ToolsPanelItem>` for "Repeated background" is not visible (AC-12).
     - `page.getByRole('button', { name: /^(Replace|Add media)$/ })` resolves to zero matches inside the Cover's block toolbar (AC-13 + AC-14).
     - The overlay span's `class` attribute contains `has-background-dim` but NOT `has-background-dim-100` (AC-15).
     - The `ResetOverridesControl` toolbar button is `toBeDisabled()` (AC-10, OQ-2).
     - **Embed-video control case (AC-21 preservation, per Design §11.3):** on a SEPARATE Cover inserted in the same post with `backgroundType: 'embed-video'` AND `metadata.bindings` set to a Pattern Overrides shape, assert that the block toolbar `Replace` / `Add media` button IS visible AND the "Embed video from URL" `MenuItem` inside `<MediaReplaceFlow>` IS reachable. This locks in the design's load-bearing carve-out: bindings UI may surface bindable rows on embed-video covers but the binding-aware editor derivations and binding-aware server render path BOTH short-circuit (`bindingActive === false` from Task 6's embed-video gate), so the existing trunk affordances remain intact.
   - **Override**: programmatically set the bound `url`/`id` on the instance (via `editor.dispatch` or by using the Cover's media affordance if available). Assert:
     - The `ResetOverridesControl` button becomes enabled.
     - Editor preview `<img>` src matches `overrideMedia.url`.
     - Publish the post; navigate to the front-end.
     - Front-end `<img>` src matches `overrideMedia.url` (AC-8).
     - Front-end overlay span class contains `has-background-dim` but NOT `has-background-dim-100` (AC-16).
   - **Reset**: navigate back to the editor; click the `ResetOverridesControl` toolbar button. Assert:
     - Editor preview `<img>` src is back to `defaultMedia.url`.
     - Publish; front-end `<img>` src is `defaultMedia.url` (AC-9).
   - **Unresolvable**: programmatically construct a Cover whose `metadata.bindings.id.source !== metadata.bindings.url.source` (mismatched). Assert:
     - `await expect( page.getByText( 'Internal media required for this binding.' ) ).toBeVisible();` (AC-24, OQ-6 primary signal).

**Depends on**: Tasks 1–9 (the entire feature must be present and working server-side AND client-side before this test passes).

**Traces to**: Spec Req 24 (Pattern Overrides four-state round-trip exercised end-to-end through default → override → reset → unresolvable phases), Req 29, Req 30, Req 31, Req 32, Req 33, Req 35 (existing cover.spec.js tests continue to pass); AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-21 (embed-video control case), AC-22, AC-23, AC-24; Design §11.3.

**Acceptance**:
- The new test passes when run via `npm run test:e2e -- test/e2e/specs/editor/blocks/cover.spec.js`.
- All existing tests in `cover.spec.js` continue to pass (Req 35 non-regression).
- The unresolvable-binding assertion uses the i18n message string `Internal media required for this binding.` (NOT the `data-testid`) — i.e. the primary OQ-6 contract.
- The hidden-controls assertions are positive ("zero matches") — they fail loudly if any control reappears.
- The embed-video control case asserts the `Replace`/`Add media` button IS present AND the `Embed video from URL` `MenuItem` IS reachable on a Cover with `backgroundType: 'embed-video'` and active-looking bindings — this is the AC-21 positive assertion the design (§11.3) calls for.

---

### Task 13: Backport-changelog stub and PR description draft

**Goal**: Satisfy the PR-shape requirements (Req 36, Req 37, AC-26, AC-27) by adding the backport-changelog placeholder file and drafting the PR description text. This task lands the backport entry once the Core PR number is known (per Design §2.2 and §15 risk 6, the entry can be added with a `TODO` placeholder if the Core PR doesn't yet exist; final number gets filled in before merge).

**Files**:
- `backport-changelog/7.1/<core-pr-number>.md` — CREATE (use `TODO-cover-bindings.md` as a placeholder filename if Core PR # is not yet known; rename before merging).
- (No file output for the PR description; the code-writer composes it in the GitHub PR body.)

**Changes**:
1. Create `backport-changelog/7.1/<core-pr-number>.md` containing the established two-line format (verified against existing entries — e.g. `backport-changelog/7.1/10869.md` has exactly this shape):
   ```
   https://github.com/WordPress/wordpress-develop/pull/<core-pr-number>

   * https://github.com/WordPress/gutenberg/pull/<gutenberg-pr-number>
   ```
   Line 1 is the bare wordpress-develop URL (must match the filename's PR number). Line 2 is blank. Line 3 is the bulleted Gutenberg PR URL. No surrounding blank line, no closing newline beyond standard end-of-file. The filename's numeric portion (`<core-pr-number>.md`) MUST match the PR number in line 1.
2. In the PR description (composed in the GitHub PR body), include:
   - The text "Fixes #77199" (AC-27).
   - An explicit statement of the relationship to #74109 and #74610: "This PR subsumes the work of #74109 and #74610, replacing them with a narrowly-scoped, internal-only design. Those PRs may be closed." (AC-27; phrasing may vary, but the explicit relationship statement is mandatory.)
   - A "Test plan" section enumerating the unit, PHPUnit, and e2e cases added (see Tasks 10–12).

**Depends on**: Tasks 10–12 (the PR description references the test cases; the backport stub references the Gutenberg PR which is opened only after all the code is in place).

**Traces to**: Spec Req 36, Req 37, Req 38, Req 39; AC-26, AC-27, AC-28; Design §12.

**Acceptance**:
- A file exists at `backport-changelog/7.1/<core-pr-number>.md` (or a `TODO`-named placeholder) and follows the established 7.1 backport entry two-line format (line 1: `https://github.com/WordPress/wordpress-develop/pull/<core-pr-number>`; blank line; line 3: `* https://github.com/WordPress/gutenberg/pull/<gutenberg-pr-number>`), matching the shape of every other entry in `backport-changelog/7.1/`.
- The Gutenberg PR description (when opened) contains the literal text `Fixes #77199` and explicitly references #74109 and #74610.
- The total net diff (additions − deletions, across Tasks 1–13) is targeted at ~500 lines — verified after all tasks land by `git diff --stat trunk...HEAD`. The design's §12 estimate of ~533 lines is the budget; reviewers may request trimming the e2e block per Design §12 if the diff overshoots.
- No file is created under `lib/compat/wordpress-7.0/` (AC-26 negative invariant).
