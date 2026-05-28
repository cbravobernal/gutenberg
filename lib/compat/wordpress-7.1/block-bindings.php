<?php
/**
 * Block Bindings: Cover block support.
 *
 * Adds `id` and `url` to the server-side supported-attributes list for
 * `core/cover`, so the editor's `__experimentalBlockBindingsSupportedAttributes`
 * setting includes them and the Block Bindings panel exposes the corresponding
 * rows for binding. The matching client-side schema metadata (the `role: "content"`
 * marker on `core/cover`'s `id` attribute) is set in `block.json`.
 *
 * @since 7.1.0
 * @package gutenberg
 * @subpackage Block Bindings
 */

if ( ! function_exists( 'gutenberg_cover_bindings_add_supported_attributes' ) ) {
	/**
	 * Adds the `id` and `url` attributes to the list of supported block-bindings
	 * attributes for `core/cover`.
	 *
	 * Registered on the `block_bindings_supported_attributes` filter. For any
	 * block type other than `core/cover`, the input array is returned unchanged.
	 * Existing entries are preserved; `id` and `url` are appended only when not
	 * already present, so applying the filter twice on the same input remains
	 * stable (`[ 'id', 'url' ]`, never `[ 'id', 'url', 'id', 'url' ]`).
	 *
	 * @since 7.1.0
	 *
	 * @param string[] $attributes The list of attributes supported by Block Bindings
	 *                             for `$block_type`.
	 * @param string   $block_type The block type whose supported attributes are
	 *                             being filtered.
	 * @return string[] The (possibly augmented) list of supported attributes.
	 */
	function gutenberg_cover_bindings_add_supported_attributes( $attributes, $block_type ) {
		if ( 'core/cover' !== $block_type ) {
			return $attributes;
		}

		if ( ! in_array( 'id', $attributes, true ) ) {
			$attributes[] = 'id';
		}
		if ( ! in_array( 'url', $attributes, true ) ) {
			$attributes[] = 'url';
		}

		return $attributes;
	}
}

add_filter( 'block_bindings_supported_attributes', 'gutenberg_cover_bindings_add_supported_attributes', 10, 2 );

if ( ! function_exists( 'gutenberg_cover_bindings_expand_bindings' ) ) {
	/**
	 * Expands a Cover block's `metadata.bindings` array by materialising any
	 * `__default` entry into per-attribute slots.
	 *
	 * Mirrors the client-side `replacePatternOverridesDefaultBinding` helper at
	 * `packages/block-editor/src/utils/block-bindings.js` and the server-side
	 * expansion in `lib/compat/wordpress-6.9/block-bindings.php` (the
	 * `__default` branch inside `gutenberg_process_block_bindings`), scoped to
	 * the Cover-supported attribute list `[ 'id', 'url' ]`. Like both of those
	 * callers, expansion is only performed when `__default.source` is
	 * `core/pattern-overrides` — `__default` is currently a Pattern Overrides
	 * affordance and does not apply to other sources.
	 *
	 * When expansion runs, each Cover-supported attribute that does NOT already
	 * have an explicit binding entry inherits a `{ source: 'core/pattern-overrides' }`
	 * stub. Pre-existing explicit entries (e.g. a mixed-source configuration)
	 * are retained verbatim. The `__default` key itself is dropped from the
	 * returned array, matching the canonical expansion semantics.
	 *
	 * When `__default` is absent (or its source is not `core/pattern-overrides`),
	 * the input array is returned unchanged.
	 *
	 * @since 7.1.0
	 * @access private
	 *
	 * @param array<string, array<string, mixed>> $bindings The `metadata.bindings`
	 *                                                       map for a Cover block.
	 * @return array<string, array<string, mixed>> The expanded bindings map.
	 */
	function gutenberg_cover_bindings_expand_bindings( array $bindings ): array {
		if (
			! isset( $bindings['__default']['source'] ) ||
			'core/pattern-overrides' !== $bindings['__default']['source']
		) {
			return $bindings;
		}

		$expanded = array();
		foreach ( array( 'id', 'url' ) as $attribute_name ) {
			$expanded[ $attribute_name ] = isset( $bindings[ $attribute_name ] )
				? $bindings[ $attribute_name ]
				: array( 'source' => 'core/pattern-overrides' );
		}

		return $expanded;
	}
}

if ( ! function_exists( 'gutenberg_cover_bindings_is_active' ) ) {
	/**
	 * Determines whether a parsed Cover block has an active binding.
	 *
	 * Server-side mirror of the client `bindingActive` predicate computed in
	 * `useCoverBindingState`. A binding is "active" when, after `__default`
	 * expansion, BOTH the `id` and `url` attributes are bound to the same
	 * source instance — same `source` string AND `==`-equal `args`. Loose
	 * equality (`==`) on `args` matches the JS-side `JSON.stringify` parity
	 * check and is the correct semantic for the small associative bags that
	 * source `args` contain in practice; element ordering does not affect
	 * equality.
	 *
	 * The helper is intentionally pure-by-bindings: it does NOT short-circuit
	 * on `backgroundType === 'embed-video'` — that gate is the responsibility
	 * of the callers (the `render_block_data` and `render_block` filters that
	 * use this helper).
	 *
	 * @since 7.1.0
	 *
	 * @param array<string, mixed> $attrs The Cover block's attribute array
	 *                                    (typically `$parsed_block['attrs']`
	 *                                    or `$instance->attributes`).
	 * @return bool True when the Cover has an active `id`+`url` binding to the
	 *              same source instance; false otherwise (including the empty
	 *              and missing-bindings cases).
	 */
	function gutenberg_cover_bindings_is_active( array $attrs ): bool {
		$bindings = $attrs['metadata']['bindings'] ?? null;
		if ( empty( $bindings ) || ! is_array( $bindings ) ) {
			return false;
		}

		$expanded = gutenberg_cover_bindings_expand_bindings( $bindings );

		$same_source = ( $expanded['id']['source'] ?? null ) === ( $expanded['url']['source'] ?? null );
		// Loose equality on associative arrays per Design §6.1 — `args` are a
		// small bag of scalars and we want order-insensitive comparison.
		$same_args = ( $expanded['id']['args'] ?? null ) == ( $expanded['url']['args'] ?? null ); // phpcs:ignore WordPress.PHP.StrictComparisons.LooseComparison

		return ! empty( $expanded['id'] ) && ! empty( $expanded['url'] ) && $same_source && $same_args;
	}
}

if ( ! function_exists( 'gutenberg_cover_bindings_has_cover_relevant_configuration' ) ) {
	/**
	 * Determines whether a Cover block's `metadata.bindings` carries any
	 * cover-relevant binding configuration.
	 *
	 * "Cover-relevant" means at least one of `__default`, `id`, or `url` is
	 * present in the `metadata.bindings` map — i.e. the user has attempted to
	 * bind one of the Cover's two bindable attributes. The helper does NOT
	 * check whether the configuration is internally consistent; it answers
	 * "does this cover have any cover-binding intent?", so the
	 * `render_block` filter can distinguish:
	 *
	 *   - genuinely unbound covers (no `metadata.bindings` at all, or
	 *     `metadata.bindings` only mentions attributes other than `id`/`url`
	 *     /`__default`) — must render byte-identically to trunk (AC-20).
	 *
	 *   - covers whose binding configuration is present but
	 *     `gutenberg_cover_bindings_is_active()` returned `false` (mismatched
	 *     `source`, differing `args`, only one of `id`/`url` bound) — must
	 *     render in the "unresolvable" state, with the saved image stripped
	 *     (AC-6).
	 *
	 * This mirrors the client-side `bindingUnresolvable` predicate (per
	 * `useCoverBindingState`), which similarly treats "any cover-relevant
	 * bindings AND not active" as unresolvable.
	 *
	 * @since 7.1.0
	 * @access private
	 *
	 * @param array<string, mixed> $attrs The Cover block's attribute array.
	 * @return bool True when `metadata.bindings` has at least one of the
	 *              cover-relevant keys (`__default`, `id`, `url`).
	 */
	function gutenberg_cover_bindings_has_cover_relevant_configuration( array $attrs ): bool {
		$bindings = $attrs['metadata']['bindings'] ?? null;
		if ( empty( $bindings ) || ! is_array( $bindings ) ) {
			return false;
		}
		return isset( $bindings['__default'] ) || isset( $bindings['id'] ) || isset( $bindings['url'] );
	}
}

if ( ! function_exists( 'gutenberg_cover_bindings_prepare_block' ) ) {
	/**
	 * Neutralises `useFeaturedImage` on Cover blocks whose `id`+`url` bindings
	 * are active, before `WP_Block::render()` builds its instance attributes.
	 *
	 * Registered on the `render_block_data` filter, which fires inside
	 * `render_block()` (see `wp-includes/blocks.php`) BEFORE `WP_Block` is
	 * constructed for the parsed block. By forcing
	 * `$parsed_block['attrs']['useFeaturedImage']` to `false` here when a
	 * Cover-scoped binding is active, `render_block_core_cover` skips its
	 * featured-image injection branch on the first render pass. This is the
	 * AC-18 precedence rule: an active `id`+`url` binding always wins over
	 * `useFeaturedImage`, with no double-`<img>` window.
	 *
	 * Gating order (each step short-circuits to "return unchanged"):
	 *
	 * 1. The block is not `core/cover`.
	 * 2. `backgroundType === 'embed-video'` — embed-video covers are explicitly
	 *    out of scope for the Cover-scoped binding path (AC-21); their existing
	 *    `useFeaturedImage` semantics remain untouched.
	 * 3. The bindings are not active per `gutenberg_cover_bindings_is_active()`
	 *    (no `metadata.bindings`, mismatched source, or differing `args`).
	 *
	 * Only after all three gates pass — AND `useFeaturedImage` is currently
	 * truthy — does the mutation run. When `useFeaturedImage` is already
	 * falsy/absent, the array is returned unchanged.
	 *
	 * Persistence safety: the mutation is scoped to the in-flight
	 * `$parsed_block` array used for this render pass only. PHP arrays are
	 * value-copied on assignment, so the caller's array is not modified, and
	 * the persisted `post_content` is never touched.
	 *
	 * @since 7.1.0
	 *
	 * @param array              $parsed_block The parsed block array, including
	 *                                         `blockName` and `attrs` keys.
	 * @param array              $source_block The original block as parsed (passed
	 *                                         through unchanged).
	 * @param WP_Block|null      $parent_block The parent block, if any (unused).
	 * @return array The (possibly mutated) parsed block array.
	 */
	function gutenberg_cover_bindings_prepare_block( $parsed_block, $source_block, $parent_block ) {
		if ( 'core/cover' !== ( $parsed_block['blockName'] ?? '' ) ) {
			return $parsed_block;
		}

		$attrs = $parsed_block['attrs'] ?? array();

		// AC-21: never engage for embed-video covers.
		if ( ! empty( $attrs['backgroundType'] ) && 'embed-video' === $attrs['backgroundType'] ) {
			return $parsed_block;
		}

		if ( ! gutenberg_cover_bindings_is_active( $attrs ) ) {
			return $parsed_block;
		}

		// AC-18: an active binding wins over useFeaturedImage. Only mutate when
		// there is something to flip, so the array is touched as little as
		// possible.
		if ( ! empty( $attrs['useFeaturedImage'] ) ) {
			$parsed_block['attrs']['useFeaturedImage'] = false;
		}

		return $parsed_block;
	}
}

add_filter( 'render_block_data', 'gutenberg_cover_bindings_prepare_block', 10, 3 );

if ( ! function_exists( 'gutenberg_cover_bindings_strip_image' ) ) {
	/**
	 * Removes the saved Cover image element from a rendered Cover block.
	 *
	 * The Cover block's `save.js` emits the background image as one of two
	 * mutually exclusive forms:
	 *
	 * 1. A void `<img class="wp-block-cover__image-background" …>` (the
	 *    non-parallax / non-repeat path).
	 * 2. A `<div class="wp-block-cover__image-background" style="background-
	 *    image:url(…)"></div>` (the parallax / repeat path).
	 *
	 * This helper locates whichever form is present and splices it out of the
	 * content. The `<div>` form is probed first because it would otherwise be
	 * missed by an `<img>`-only regex. If neither pattern matches, the input is
	 * returned unchanged.
	 *
	 * The patterns use the `\b` word-boundary anchor around the class name so
	 * matches only on elements that actually carry the
	 * `wp-block-cover__image-background` class (no coincidental substring hits
	 * on neighbouring attributes), and the `U` (ungreedy) modifier ensures
	 * `[^>]*` does not run past intermediate `>` boundaries.
	 *
	 * Used when an active binding cannot be resolved (no `id`, no `url`, or the
	 * resolved `id` is not an attachment) — see
	 * `gutenberg_cover_bindings_render_block` — so the cover renders without an
	 * image element, overlay-only.
	 *
	 * @since 7.1.0
	 * @access private
	 *
	 * @param string $content The rendered Cover block HTML.
	 * @return string The content with the image element removed, or the input
	 *                unchanged when no matching element is present.
	 */
	function gutenberg_cover_bindings_strip_image( string $content ): string {
		// Form 2: parallax/repeat saved form — an empty <div>.
		$form2_pattern = '/<div\s+[^>]*\bwp-block-cover__image-background\b[^>]*><\/div>/U';
		// Form 1: plain saved form — a void <img> (with or without trailing slash).
		$form1_pattern = '/<img\s+[^>]*\bwp-block-cover__image-background\b[^>]*\/?\s*>/U';

		foreach ( array( $form2_pattern, $form1_pattern ) as $pattern ) {
			if ( 1 === preg_match( $pattern, $content, $matches, PREG_OFFSET_CAPTURE ) ) {
				$start  = $matches[0][1];
				$length = strlen( $matches[0][0] );
				return substr( $content, 0, $start ) . substr( $content, $start + $length );
			}
		}
		return $content;
	}
}

if ( ! function_exists( 'gutenberg_cover_bindings_relax_dim_class' ) ) {
	/**
	 * Removes `has-background-dim-100` from the Cover overlay span when an
	 * active binding resolved its `id`+`url` and the stored `dimRatio` is the
	 * default 100.
	 *
	 * Stored `dimRatio: 100` is the saved-attribute default for Cover; in the
	 * pre-bindings universe that translated to a fully-opaque overlay
	 * (`dim-100` -> 100% opacity), but on bound covers a fully-opaque overlay
	 * would completely hide the bound image. The chosen "effective" dimRatio
	 * for that case is 50 (see Design OQ-4), and because
	 * `dimRatioToClass( 50 ) === null` the rewrite is mechanically "remove
	 * `has-background-dim-100`" — no replacement modifier class is added. The
	 * remaining `has-background-dim` class preserves the 50% opacity baseline.
	 *
	 * The pass is idempotent: when the class is already absent the call is a
	 * no-op. The matcher is scoped to `<span class="wp-block-cover__background">`
	 * elements via the Tag Processor so neighbouring spans are not touched.
	 *
	 * @since 7.1.0
	 * @access private
	 *
	 * @param string $content The rendered Cover block HTML.
	 * @return string The content with `has-background-dim-100` removed from any
	 *                Cover overlay span, or the input unchanged when no such
	 *                span is present.
	 */
	function gutenberg_cover_bindings_relax_dim_class( string $content ): string {
		$processor = new WP_HTML_Tag_Processor( $content );
		while ( $processor->next_tag(
			array(
				'tag_name'   => 'SPAN',
				'class_name' => 'wp-block-cover__background',
			)
		) ) {
			$processor->remove_class( 'has-background-dim-100' );
		}
		return $processor->get_updated_html();
	}
}

if ( ! function_exists( 'gutenberg_cover_bindings_rewrite_image' ) ) {
	/**
	 * Rewrites the saved Cover image element to point at the bound URL/ID.
	 *
	 * Handles both forms emitted by `save.js`:
	 *
	 * 1. **Parallax / repeat `<div>` form** (probed first via `preg_match`):
	 *    the entire `<div class="wp-block-cover__image-background" …></div>`
	 *    is replaced with a freshly-built `<img>` that carries the bound URL,
	 *    bound ID class (`wp-image-{id}`), and — when stored on the block —
	 *    `size-{sizeSlug}` and `data-object-position`/`style="object-position:…"`
	 *    attributes computed from `attrs.focalPoint`. The rebuilt element
	 *    never contains `has-parallax`, `is-repeated`, or a `style="background-
	 *    image:…"` declaration by construction. The `alt` attribute is read
	 *    from the bound attachment's `_wp_attachment_image_alt` meta.
	 *
	 * 2. **Plain `<img>` form** (fall-through path): the existing `<img>` is
	 *    visited via `WP_HTML_Tag_Processor` and `src`, `alt`, and the
	 *    `wp-image-…` class are rewritten in place. Any pre-existing
	 *    `wp-image-…` class is removed before the new one is added, so a saved
	 *    `wp-image-99` does not survive after a binding resolves a different
	 *    attachment.
	 *
	 * The function is idempotent on its own output: a second pass over an
	 * already-rewritten plain `<img>` form re-asserts the same attributes; a
	 * second pass over the parallax-rebuilt `<img>` falls through to the
	 * plain-`<img>` path (because the rebuilt element is now a plain `<img>`)
	 * and produces byte-identical output.
	 *
	 * When neither form matches, the input is returned unchanged.
	 *
	 * @since 7.1.0
	 * @access private
	 *
	 * @param string $content      The rendered Cover block HTML.
	 * @param string $resolved_url The URL resolved from the bound source.
	 * @param int    $resolved_id  The attachment ID resolved from the bound source.
	 * @param array  $attrs        The Cover block's stored attribute array
	 *                             (used for `sizeSlug` and `focalPoint`).
	 * @return string The content with the image element rewritten, or the input
	 *                unchanged when no matching image element is present.
	 */
	function gutenberg_cover_bindings_rewrite_image( string $content, string $resolved_url, int $resolved_id, array $attrs ): string {
		$alt             = trim( strip_tags( (string) get_post_meta( $resolved_id, '_wp_attachment_image_alt', true ) ) );
		$size_slug       = isset( $attrs['sizeSlug'] ) && '' !== $attrs['sizeSlug']
			? ' size-' . $attrs['sizeSlug']
			: '';
		$object_position = '';
		if (
			isset( $attrs['focalPoint']['x'] ) &&
			isset( $attrs['focalPoint']['y'] ) &&
			is_numeric( $attrs['focalPoint']['x'] ) &&
			is_numeric( $attrs['focalPoint']['y'] )
		) {
			$object_position = sprintf(
				'%s%% %s%%',
				round( (float) $attrs['focalPoint']['x'] * 100 ),
				round( (float) $attrs['focalPoint']['y'] * 100 )
			);
		}

		// Form 2 first: parallax/repeat saved form — replace the empty <div>
		// element wholesale with a rebuilt <img>. Saved markup is the source of
		// truth (NOT $attrs['hasParallax'] / $attrs['isRepeated']) — the
		// pattern matches the literal serialized form emitted by save.js.
		$form2_pattern = '/<div\s+[^>]*\bwp-block-cover__image-background\b[^>]*><\/div>/U';
		if ( 1 === preg_match( $form2_pattern, $content, $matches, PREG_OFFSET_CAPTURE ) ) {
			$div_start  = $matches[0][1];
			$div_length = strlen( $matches[0][0] );

			$object_position_attrs = '';
			if ( '' !== $object_position ) {
				$object_position_attrs = sprintf(
					' data-object-position="%s" style="object-position:%s;"',
					esc_attr( $object_position ),
					esc_attr( $object_position )
				);
			}

			$rebuilt_img = sprintf(
				'<img class="wp-block-cover__image-background wp-image-%d%s" alt="%s" src="%s" data-object-fit="cover"%s />',
				$resolved_id,
				esc_attr( $size_slug ),
				esc_attr( $alt ),
				esc_url( $resolved_url ),
				$object_position_attrs
			);

			return substr( $content, 0, $div_start ) . $rebuilt_img . substr( $content, $div_start + $div_length );
		}

		// Form 1: plain <img> saved form — rewrite attributes in place.
		$processor = new WP_HTML_Tag_Processor( $content );
		if ( $processor->next_tag(
			array(
				'tag_name'   => 'IMG',
				'class_name' => 'wp-block-cover__image-background',
			)
		) ) {
			$processor->set_attribute( 'src', $resolved_url );
			$processor->set_attribute( 'alt', $alt );

			// Replace any existing wp-image-{old} with the resolved id. class_list()
			// yields the current classes, including ones added in this same pass.
			$class_list = $processor->class_list();
			if ( null !== $class_list ) {
				$wp_image_classes_to_remove = array();
				foreach ( $class_list as $cls ) {
					if ( 0 === strpos( $cls, 'wp-image-' ) ) {
						$wp_image_classes_to_remove[] = $cls;
					}
				}
				foreach ( $wp_image_classes_to_remove as $cls ) {
					$processor->remove_class( $cls );
				}
			}
			$processor->add_class( 'wp-image-' . $resolved_id );

			return $processor->get_updated_html();
		}

		// Neither form matched; render proceeds overlay-only.
		return $content;
	}
}

if ( ! function_exists( 'gutenberg_cover_bindings_render_block' ) ) {
	/**
	 * Rewrites a rendered Cover block to honour an active `id`+`url` binding.
	 *
	 * Registered on the `render_block` filter at priority 9 so it runs BEFORE
	 * the generic priority-10 `gutenberg_block_bindings_render_block`
	 * (`lib/compat/wordpress-6.9/block-bindings.php`) — the binding-aware
	 * substitution must happen on the saved markup before the generic filter
	 * potentially re-runs `$instance->render()`.
	 *
	 * Gating order:
	 *
	 * 1. The block is not `core/cover` — return unchanged.
	 * 2. `backgroundType === 'embed-video'` — embed-video covers are explicitly
	 *    out of scope for the Cover-scoped binding render path (AC-21); the
	 *    existing oEmbed code path remains intact — return unchanged.
	 * 3. The cover has `metadata.bindings` configuration for `id` and/or `url`
	 *    but the configuration is not active (mismatched `source`, differing
	 *    `args`, or only one of the two attributes bound). This is the
	 *    server-side mirror of the client's `bindingUnresolvable` predicate:
	 *    the binding cannot be honoured, so the saved image element is stripped
	 *    and the cover renders overlay-only (AC-6).
	 * 4. The bindings are not active AND there is no cover-relevant
	 *    configuration — return unchanged (unbound cover, AC-20 non-regression).
	 *
	 * After the gates, the resolved URL and ID come from `$instance->attributes`
	 * (which `WP_Block::render()` has already merged the resolved bindings
	 * into — see `wp-includes/class-wp-block.php`). If either value is missing,
	 * or the resolved ID is not an attachment in the media library, the saved
	 * image element is stripped from `$content` and the cover renders
	 * overlay-only (AC-5).
	 *
	 * Otherwise the saved image element is rewritten in place by
	 * `gutenberg_cover_bindings_rewrite_image()` to carry the bound URL, ID
	 * class, and alt text (AC-3, AC-19). When the stored `dimRatio` is the
	 * default 100, `gutenberg_cover_bindings_relax_dim_class()` removes
	 * `has-background-dim-100` from the overlay span so the bound image is not
	 * hidden by a fully-opaque overlay (AC-16, OQ-4). Non-default `dimRatio`
	 * values are preserved (AC-17).
	 *
	 * @since 7.1.0
	 *
	 * @param string   $block_content The rendered block HTML, as passed in by
	 *                                the `render_block` filter.
	 * @param array    $block         The parsed block array (`blockName`, etc.).
	 * @param WP_Block $instance      The block instance, whose `attributes`
	 *                                already include any resolved binding values.
	 * @return string The (possibly rewritten) block HTML.
	 */
	function gutenberg_cover_bindings_render_block( $block_content, $block, $instance ) {
		if ( 'core/cover' !== ( $block['blockName'] ?? '' ) ) {
			return $block_content;
		}

		$attrs = $instance->attributes ?? array();

		// AC-21: never engage for embed-video covers.
		if ( ! empty( $attrs['backgroundType'] ) && 'embed-video' === $attrs['backgroundType'] ) {
			return $block_content;
		}

		if ( ! gutenberg_cover_bindings_is_active( $attrs ) ) {
			// AC-6: explicit per-attribute bindings whose `source` or `args`
			// don't match (or only one of `id`/`url` is bound) cannot be
			// honoured — strip the saved cover image element so the cover
			// renders overlay-only, matching the client's `bindingUnresolvable`
			// affordance. Covers with no cover-relevant binding configuration
			// (the AC-20 unbound population) are returned unchanged.
			if ( gutenberg_cover_bindings_has_cover_relevant_configuration( $attrs ) ) {
				return gutenberg_cover_bindings_strip_image( $block_content );
			}
			return $block_content;
		}

		$resolved_url = $attrs['url'] ?? null;
		$resolved_id  = (int) ( $attrs['id'] ?? 0 );

		if ( empty( $resolved_url ) || empty( $resolved_id ) ) {
			return gutenberg_cover_bindings_strip_image( $block_content );
		}

		$attachment = get_post( $resolved_id );
		if ( ! $attachment || 'attachment' !== $attachment->post_type ) {
			return gutenberg_cover_bindings_strip_image( $block_content );
		}

		$block_content = gutenberg_cover_bindings_rewrite_image(
			$block_content,
			(string) $resolved_url,
			$resolved_id,
			$attrs
		);

		// AC-16 / OQ-4: stored dimRatio defaults to 100; relax it to "no
		// modifier class" (effectively 50%) so the bound image is visible.
		if ( 100 === (int) ( $attrs['dimRatio'] ?? 100 ) ) {
			$block_content = gutenberg_cover_bindings_relax_dim_class( $block_content );
		}

		return $block_content;
	}
}

// Priority 9 is essential — see the docblock above: must run BEFORE the
// generic priority-10 gutenberg_block_bindings_render_block filter from
// lib/compat/wordpress-6.9/block-bindings.php so the Cover-scoped substitution
// runs on saved markup, not on already-bindings-resolved markup.
add_filter( 'render_block', 'gutenberg_cover_bindings_render_block', 9, 3 );
