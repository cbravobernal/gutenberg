<?php
/**
 * Block Bindings: Cover block support.
 *
 * Adds `id` and `url` to the server-side supported-attributes list for
 * `core/cover` and rewrites the rendered output to honour active bindings.
 *
 * @since 7.1.0
 * @package gutenberg
 */

if ( ! function_exists( 'gutenberg_cover_bindings_add_supported_attributes' ) ) {
	/**
	 * Adds `id` and `url` to the bindings-supported attributes for `core/cover`.
	 *
	 * @since 7.1.0
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

if ( ! function_exists( 'gutenberg_cover_bindings_is_active' ) ) {
	/**
	 * Whether a parsed Cover has both `id` and `url` bound to the same source instance.
	 *
	 * Server-side mirror of `useCoverBindingState`'s `bindingActive`. A
	 * `__default` entry from `core/pattern-overrides` counts as active because
	 * Core's `process_block_bindings` materialises it into per-attribute slots
	 * before resolution.
	 *
	 * @since 7.1.0
	 */
	function gutenberg_cover_bindings_is_active( array $attrs ): bool {
		$bindings = $attrs['metadata']['bindings'] ?? null;
		if ( empty( $bindings ) || ! is_array( $bindings ) ) {
			return false;
		}

		if ( isset( $bindings['__default']['source'] ) && 'core/pattern-overrides' === $bindings['__default']['source'] ) {
			return true;
		}

		$id_binding  = $bindings['id'] ?? null;
		$url_binding = $bindings['url'] ?? null;
		if ( empty( $id_binding ) || empty( $url_binding ) ) {
			return false;
		}

		$same_source = ( $id_binding['source'] ?? null ) === ( $url_binding['source'] ?? null );
		// Loose `==` on `args` per Pattern Overrides convention: order-insensitive
		// associative-bag comparison.
		$same_args = ( $id_binding['args'] ?? null ) == ( $url_binding['args'] ?? null ); // phpcs:ignore WordPress.PHP.StrictComparisons.LooseComparison

		return $same_source && $same_args;
	}
}

if ( ! function_exists( 'gutenberg_cover_bindings_has_cover_relevant_configuration' ) ) {
	/**
	 * Whether `metadata.bindings` mentions `__default`, `id`, or `url`.
	 *
	 * Distinguishes genuinely unbound covers (AC-20) from covers whose binding
	 * config is present but inactive (AC-6).
	 *
	 * @since 7.1.0
	 * @access private
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
	 * Forces `useFeaturedImage` off on bound covers before `WP_Block::render()`.
	 *
	 * AC-18: an active `id`+`url` binding always wins over `useFeaturedImage`.
	 * Mutation is scoped to the in-flight `$parsed_block` only.
	 *
	 * @since 7.1.0
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

		if ( ! empty( $attrs['useFeaturedImage'] ) ) {
			$parsed_block['attrs']['useFeaturedImage'] = false;
		}

		return $parsed_block;
	}
}

add_filter( 'render_block_data', 'gutenberg_cover_bindings_prepare_block', 10, 3 );

if ( ! function_exists( 'gutenberg_cover_bindings_strip_image' ) ) {
	/**
	 * Removes the saved Cover image element (either `<img>` or parallax `<div>`).
	 *
	 * @since 7.1.0
	 * @access private
	 */
	function gutenberg_cover_bindings_strip_image( string $content ): string {
		// Parallax/repeat saved form is probed first; an <img>-only regex would miss it.
		$form2_pattern = '/<div\s+[^>]*\bwp-block-cover__image-background\b[^>]*><\/div>/U';
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
	 * Removes `has-background-dim-100` from the Cover overlay span.
	 *
	 * Stored `dimRatio: 100` is the saved default; on bound covers a fully-opaque
	 * overlay would hide the image, so the effective dimRatio is 50 (OQ-4) and
	 * `dimRatioToClass( 50 )` is null — i.e. just remove `dim-100`.
	 *
	 * @since 7.1.0
	 * @access private
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
	 * Handles both forms emitted by `save.js`: the parallax/repeat `<div>` is
	 * replaced wholesale with a freshly-built `<img>`; the plain `<img>` form is
	 * rewritten in place via Tag Processor. Idempotent on its own output.
	 *
	 * @since 7.1.0
	 * @access private
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

		// Parallax/repeat form: saved markup is the source of truth (NOT
		// $attrs['hasParallax']/$attrs['isRepeated']) — the pattern matches the
		// literal serialized form emitted by save.js.
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

		// Plain <img> form: rewrite attributes in place.
		$processor = new WP_HTML_Tag_Processor( $content );
		if ( $processor->next_tag(
			array(
				'tag_name'   => 'IMG',
				'class_name' => 'wp-block-cover__image-background',
			)
		) ) {
			$processor->set_attribute( 'src', $resolved_url );
			$processor->set_attribute( 'alt', $alt );

			// Remove any saved wp-image-{old} before adding the resolved one.
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

		return $content;
	}
}

if ( ! function_exists( 'gutenberg_cover_bindings_render_block' ) ) {
	/**
	 * Rewrites a rendered Cover block to honour an active `id`+`url` binding.
	 *
	 * Registered at priority 9 — MUST run before the generic priority-10
	 * `gutenberg_block_bindings_render_block` in `wordpress-6.9/block-bindings.php`
	 * so the substitution runs on saved markup, not bindings-resolved markup.
	 *
	 * @since 7.1.0
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
			// AC-6: cover-relevant binding config present but inactive — strip the
			// saved image so the cover renders overlay-only. AC-20: genuinely
			// unbound covers pass through unchanged.
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

		// AC-16 / OQ-4: relax stored dimRatio:100 so the bound image is visible.
		if ( 100 === (int) ( $attrs['dimRatio'] ?? 100 ) ) {
			$block_content = gutenberg_cover_bindings_relax_dim_class( $block_content );
		}

		return $block_content;
	}
}

// Priority 9 — must run before the generic priority-10
// gutenberg_block_bindings_render_block filter.
add_filter( 'render_block', 'gutenberg_cover_bindings_render_block', 9, 3 );
