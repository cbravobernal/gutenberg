<?php
/**
 * Cover block rendering tests.
 *
 * @package WordPress
 * @subpackage Blocks
 */

/**
 * Tests for the Cover block.
 *
 * @group blocks
 */
class Tests_Blocks_Render_Cover extends WP_UnitTestCase {
	/**
	 * Post object.
	 *
	 * @var object
	 */
	protected static $post;

	/**
	 * Default attachment id (used by the featured-image and parallax tests; also
	 * the post thumbnail).
	 *
	 * @var int
	 */
	protected static $attachment_id;

	/**
	 * Override attachment id — a second media-library attachment used by the
	 * binding-aware tests to assert that the BOUND value (not the featured-image
	 * or saved-markup URL) wins.
	 *
	 * @var int
	 */
	protected static $override_attachment_id;

	/**
	 * Name of the test binding source registered in `set_up()`. The source is
	 * configured per-test (its `get_value_callback` is rebound via a class
	 * property) so each test can drive a different resolution.
	 *
	 * @var string
	 */
	const TEST_SOURCE_NAME = 'test/cover-bindings';

	/**
	 * Holds the current test's `get_value_callback`. Set by each test before it
	 * calls `register_test_source()`; consumed by the registered closure.
	 *
	 * @var callable|null
	 */
	protected $source_callback;

	/**
	 * Setup method.
	 */
	public static function wpSetUpBeforeClass() {
		self::$post = self::factory()->post->create_and_get();
		$file       = DIR_TESTDATA . '/images/canola.jpg';

		self::$attachment_id = self::factory()->attachment->create_upload_object(
			$file,
			self::$post->ID,
			array(
				'post_mime_type' => 'image/jpeg',
			)
		);

		// Second attachment, used as the bound override target so tests can
		// assert that the bound URL wins over the featured-image URL.
		self::$override_attachment_id = self::factory()->attachment->create_upload_object(
			$file,
			self::$post->ID,
			array(
				'post_mime_type' => 'image/jpeg',
			)
		);

		set_post_thumbnail( self::$post, self::$attachment_id );

		// Populate alt metadata on the override attachment so the rebuilt-img
		// path has something deterministic to assert against.
		update_post_meta( self::$override_attachment_id, '_wp_attachment_image_alt', 'Override alt text' );
	}

	/**
	 * Tear down method.
	 */
	public static function wpTearDownAfterClass() {
		wp_delete_post( self::$post->ID, true );
		wp_delete_post( self::$attachment_id, true );
		wp_delete_post( self::$override_attachment_id, true );
	}

	/**
	 * Per-test set-up: registers a Cover-shaped test binding source whose
	 * `get_value_callback` is delegated to the `source_callback` property. The
	 * delegation indirection means each test can swap behaviour without
	 * re-registering the source.
	 */
	public function set_up() {
		parent::set_up();
		$this->source_callback = null;
	}

	/**
	 * Per-test tear-down: unregisters the test binding source if it was
	 * registered, so the next test starts from a clean registry.
	 */
	public function tear_down() {
		if ( get_block_bindings_source( self::TEST_SOURCE_NAME ) ) {
			unregister_block_bindings_source( self::TEST_SOURCE_NAME );
		}
		$this->source_callback = null;

		parent::tear_down();
	}

	/**
	 * Registers the test binding source. Tests call this after assigning their
	 * `source_callback`; the closure invokes the callback per attribute lookup
	 * so a single source can drive both `id` and `url` resolutions.
	 *
	 * @param callable $callback Function( $source_args, $block_instance, $attribute_name ).
	 */
	protected function register_test_source( callable $callback ) {
		$this->source_callback = $callback;
		$test                  = $this;
		register_block_bindings_source(
			self::TEST_SOURCE_NAME,
			array(
				'label'              => array( 'label' => 'Test cover source' ),
				'get_value_callback' => function ( $source_args, $block_instance, $attribute_name ) use ( $test ) {
					return call_user_func( $test->source_callback, $source_args, $block_instance, $attribute_name );
				},
			)
		);
	}

	/**
	 * Test gutenberg_render_block_core_cover() method.
	 *
	 * @covers ::gutenberg_render_block_core_cover
	 */
	public function test_gutenberg_render_block_core_cover() {

		global $wp_query;

		// Fake being in the loop.
		$wp_query->in_the_loop = true;
		$wp_query->post        = self::$post;

		$wp_query->posts = array( self::$post );
		$GLOBALS['post'] = self::$post;

		$attributes = array(
			'useFeaturedImage' => true,
			'backgroundType'   => 'image',
			'hasParallax'      => true,
			'isRepeated'       => true,
			'minHeight'        => '100px',
		);

		$content  = '<div class="wp-block-cover" style="min-height:100px"><span></span><div class="wp-block-cover__inner-container"></div></div>';
		$rendered = gutenberg_render_block_core_cover( $attributes, $content );

		$this->assertStringContainsString( wp_get_attachment_image_url( self::$attachment_id, 'full' ), $rendered );
		$this->assertStringContainsString( 'background-image', $rendered );
		$this->assertStringContainsString( 'min-height', $rendered );

		// If cover background type is not image.
		$attributes['backgroundType'] = 'color';
		$rendered                     = gutenberg_render_block_core_cover( $attributes, '' );
		$this->assertEmpty( $rendered );

		// If cover background is not post featured image.
		$attributes['backgroundType']   = 'image';
		$attributes['useFeaturedImage'] = false;
		$rendered                       = gutenberg_render_block_core_cover( $attributes, '' );
		$this->assertEmpty( $rendered );
	}

	/**
	 * Test gutenberg_render_block_core_cover() method.
	 *
	 * @covers ::gutenberg_render_block_core_cover
	 */
	public function test_gutenberg_render_block_core_cover_fixed_or_repeated_background() {

		global $wp_query;

		// Fake being in the loop.
		$wp_query->post  = self::$post;
		$GLOBALS['post'] = self::$post;

		$attributes = array(
			'useFeaturedImage' => true,
			'backgroundType'   => 'image',
			'hasParallax'      => false,
			'isRepeated'       => false,
			'minHeight'        => '100px',
			'focalPoint'       => array(
				'x' => 10,
				'y' => 10,
			),
		);

		$content  = '<div class="wp-block-cover"><span></span><div class="wp-block-cover__inner-container"></div></div>';
		$rendered = gutenberg_render_block_core_cover( $attributes, $content );

		$this->assertStringContainsString( wp_get_attachment_image_url( self::$attachment_id, 'full' ), $rendered );
		$this->assertStringContainsString( 'object-position', $rendered );
		$this->assertStringNotContainsString( 'background-image', $rendered );
		$this->assertStringNotContainsString( 'min-height', $rendered );
	}

	/**
	 * Builds a parsed Cover block array with a `metadata.bindings` shape that
	 * targets the test source for both `id` and `url`. Returns the array shape
	 * `render_block()` accepts directly (no `parse_blocks` round-trip).
	 *
	 * @param string $saved_markup     The serialized Cover inner HTML.
	 * @param array  $extra_attributes Extra attributes to merge into the `attrs` array.
	 * @param array  $bindings_override Optional bindings shape; defaults to a
	 *                                  same-source `{ id, url }` shape against
	 *                                  the test source.
	 * @return array A parsed-block array suitable for `render_block()`.
	 */
	protected function build_bound_cover_block( string $saved_markup, array $extra_attributes = array(), $bindings_override = null ): array {
		$bindings = null !== $bindings_override
			? $bindings_override
			: array(
				'id'  => array( 'source' => self::TEST_SOURCE_NAME ),
				'url' => array( 'source' => self::TEST_SOURCE_NAME ),
			);

		$attrs = array_merge(
			array(
				'backgroundType' => 'image',
				'metadata'       => array( 'bindings' => $bindings ),
			),
			$extra_attributes
		);

		return array(
			'blockName'    => 'core/cover',
			'attrs'        => $attrs,
			'innerBlocks'  => array(),
			'innerHTML'    => $saved_markup,
			'innerContent' => array( $saved_markup ),
		);
	}

	/**
	 * AC-3: the resolved binding URL is substituted into the plain `<img>`
	 * saved form. Asserts the bound URL appears in `src`, the previous saved
	 * src does NOT appear, and the resolved attachment's `wp-image-{id}` class
	 * replaces any pre-existing `wp-image-*` class.
	 */
	public function test_bound_url_substitutes_in_plain_img_form() {
		$bound_url = wp_get_attachment_image_url( self::$override_attachment_id, 'full' );
		$bound_id  = self::$override_attachment_id;

		$this->register_test_source(
			function ( $source_args, $block_instance, $attribute_name ) use ( $bound_url, $bound_id ) {
				return 'url' === $attribute_name ? $bound_url : $bound_id;
			}
		);

		$saved_markup = '<div class="wp-block-cover"><img class="wp-block-cover__image-background wp-image-999" alt="" src="https://saved.example.com/old.jpg" data-object-fit="cover"/><span aria-hidden="true" class="wp-block-cover__background has-background-dim has-background-dim-100"></span><div class="wp-block-cover__inner-container"></div></div>';
		$parsed_block = $this->build_bound_cover_block( $saved_markup );
		$rendered     = render_block( $parsed_block );

		$this->assertStringContainsString( 'src="' . esc_attr( $bound_url ) . '"', $rendered, 'The bound URL must be substituted into the saved <img>.' );
		$this->assertStringNotContainsString( 'https://saved.example.com/old.jpg', $rendered, 'The pre-existing saved src must be replaced.' );
		$this->assertStringContainsString( 'wp-image-' . $bound_id, $rendered, 'The resolved attachment id must surface as a wp-image-{id} class.' );
		$this->assertStringNotContainsString( 'wp-image-999', $rendered, 'The pre-existing wp-image-999 class must be removed before the new one is added.' );
	}

	/**
	 * AC-16 / AC-25: stored `dimRatio: 100` is the cover default, but on a
	 * bound cover the fully-opaque overlay would hide the bound image. The
	 * server filter relaxes the class to "no modifier" — the rendered overlay
	 * span contains `has-background-dim` but NOT `has-background-dim-100`.
	 */
	public function test_default_dim_ratio_class_is_relaxed() {
		$bound_url = wp_get_attachment_image_url( self::$override_attachment_id, 'full' );
		$bound_id  = self::$override_attachment_id;

		$this->register_test_source(
			function ( $source_args, $block_instance, $attribute_name ) use ( $bound_url, $bound_id ) {
				return 'url' === $attribute_name ? $bound_url : $bound_id;
			}
		);

		$saved_markup = '<div class="wp-block-cover"><img class="wp-block-cover__image-background" alt="" src="https://saved.example.com/old.jpg" data-object-fit="cover"/><span aria-hidden="true" class="wp-block-cover__background has-background-dim has-background-dim-100"></span><div class="wp-block-cover__inner-container"></div></div>';
		$parsed_block = $this->build_bound_cover_block( $saved_markup, array( 'dimRatio' => 100 ) );
		$rendered     = render_block( $parsed_block );

		$this->assertStringNotContainsString(
			'has-background-dim-100',
			$rendered,
			'has-background-dim-100 must be removed when the stored dimRatio is the default 100.'
		);
		$this->assertStringContainsString(
			'has-background-dim',
			$rendered,
			'has-background-dim (the 50%-opacity baseline) must be preserved per OQ-4.'
		);
	}

	/**
	 * AC-17: a non-default `dimRatio` (here, 70) is preserved untouched on a
	 * bound cover — the relax pass only fires on the 100 default.
	 */
	public function test_non_default_dim_ratio_is_preserved() {
		$bound_url = wp_get_attachment_image_url( self::$override_attachment_id, 'full' );
		$bound_id  = self::$override_attachment_id;

		$this->register_test_source(
			function ( $source_args, $block_instance, $attribute_name ) use ( $bound_url, $bound_id ) {
				return 'url' === $attribute_name ? $bound_url : $bound_id;
			}
		);

		$saved_markup = '<div class="wp-block-cover"><img class="wp-block-cover__image-background" alt="" src="https://saved.example.com/old.jpg" data-object-fit="cover"/><span aria-hidden="true" class="wp-block-cover__background has-background-dim has-background-dim-70"></span><div class="wp-block-cover__inner-container"></div></div>';
		$parsed_block = $this->build_bound_cover_block( $saved_markup, array( 'dimRatio' => 70 ) );
		$rendered     = render_block( $parsed_block );

		$this->assertStringContainsString(
			'has-background-dim-70',
			$rendered,
			'A user-set non-default dimRatio class must survive the bound render.'
		);
		$this->assertStringContainsString( 'src="' . esc_attr( $bound_url ) . '"', $rendered, 'The bound URL must still be substituted on the non-default dimRatio path.' );
	}

	/**
	 * AC-19: when a cover saved with `hasParallax`/`isRepeated` (the `<div
	 * style="background-image:url(…)">` form) gains an active binding, the
	 * `<div>` is rebuilt into a plain `<img>` carrying the bound URL, the
	 * `wp-image-{id}` class, and NO parallax/repeat classes or
	 * background-image style.
	 */
	public function test_parallax_saved_markup_is_rebuilt_as_img() {
		$bound_url = wp_get_attachment_image_url( self::$override_attachment_id, 'full' );
		$bound_id  = self::$override_attachment_id;

		$this->register_test_source(
			function ( $source_args, $block_instance, $attribute_name ) use ( $bound_url, $bound_id ) {
				return 'url' === $attribute_name ? $bound_url : $bound_id;
			}
		);

		$saved_markup = '<div class="wp-block-cover has-parallax is-repeated"><div role="img" aria-label="" class="wp-block-cover__image-background wp-image-555 has-parallax is-repeated" style="background-position:50% 50%;background-image:url(https://saved.example.com/old.jpg)"></div><span aria-hidden="true" class="wp-block-cover__background has-background-dim has-background-dim-100"></span><div class="wp-block-cover__inner-container"></div></div>';
		$parsed_block = $this->build_bound_cover_block(
			$saved_markup,
			array(
				'hasParallax' => true,
				'isRepeated'  => true,
			)
		);
		$rendered     = render_block( $parsed_block );

		$this->assertMatchesRegularExpression(
			'/<img[^>]*\bwp-block-cover__image-background\b[^>]*>/',
			$rendered,
			'The parallax/repeat <div> must be replaced with an <img>.'
		);
		$this->assertStringNotContainsString(
			'background-image:url(https://saved.example.com/old.jpg)',
			$rendered,
			'The saved background-image:url() CSS must not survive in the rebuilt element.'
		);
		// The rebuilt <img> element must not carry has-parallax / is-repeated.
		// (The outer wrapper `<div class="wp-block-cover has-parallax is-repeated">`
		// MAY still contain them — the bind path only rewrites the inner image.)
		$this->assertDoesNotMatchRegularExpression(
			'/<img[^>]*\bwp-block-cover__image-background\b[^>]*\bhas-parallax\b/',
			$rendered,
			'The rebuilt <img> must not carry has-parallax.'
		);
		$this->assertDoesNotMatchRegularExpression(
			'/<img[^>]*\bwp-block-cover__image-background\b[^>]*\bis-repeated\b/',
			$rendered,
			'The rebuilt <img> must not carry is-repeated.'
		);
		$this->assertStringContainsString( 'src="' . esc_attr( $bound_url ) . '"', $rendered, 'The rebuilt <img> must carry the bound URL.' );
		$this->assertStringContainsString( 'wp-image-' . $bound_id, $rendered, 'The rebuilt <img> must carry wp-image-{resolved id}.' );
	}

	/**
	 * AC-6: when `metadata.bindings.id` and `metadata.bindings.url` resolve via
	 * different sources, the binding is unresolvable and the saved image
	 * element is stripped from the output — the cover renders overlay-only.
	 */
	public function test_mismatched_source_strips_image() {
		// Register only one of the two sources; the other reference is
		// deliberately to an unregistered source so the bindings can't possibly
		// match.
		$this->register_test_source(
			function () {
				return 'unused';
			}
		);

		$saved_markup = '<div class="wp-block-cover"><img class="wp-block-cover__image-background" alt="" src="https://saved.example.com/old.jpg" data-object-fit="cover"/><span aria-hidden="true" class="wp-block-cover__background has-background-dim has-background-dim-100"></span><div class="wp-block-cover__inner-container"></div></div>';
		$parsed_block = $this->build_bound_cover_block(
			$saved_markup,
			array(),
			array(
				'id'  => array( 'source' => self::TEST_SOURCE_NAME ),
				'url' => array( 'source' => 'test/other-source-that-does-not-exist' ),
			)
		);
		$rendered     = render_block( $parsed_block );

		$this->assertStringNotContainsString(
			'wp-block-cover__image-background',
			$rendered,
			'A mismatched binding must strip the saved cover image element entirely.'
		);
	}

	/**
	 * AC-5: when the binding resolves a URL but the `id` does not correspond
	 * to a media-library attachment (here, the post id), the saved image
	 * element is stripped — internal-only media is required.
	 */
	public function test_external_url_strips_image() {
		$bound_url = 'https://external.example.com/photo.jpg';
		$bound_id  = self::$post->ID; // A post, not an attachment.

		$this->register_test_source(
			function ( $source_args, $block_instance, $attribute_name ) use ( $bound_url, $bound_id ) {
				return 'url' === $attribute_name ? $bound_url : $bound_id;
			}
		);

		$saved_markup = '<div class="wp-block-cover"><img class="wp-block-cover__image-background" alt="" src="https://saved.example.com/old.jpg" data-object-fit="cover"/><span aria-hidden="true" class="wp-block-cover__background has-background-dim has-background-dim-100"></span><div class="wp-block-cover__inner-container"></div></div>';
		$parsed_block = $this->build_bound_cover_block( $saved_markup );
		$rendered     = render_block( $parsed_block );

		$this->assertStringNotContainsString(
			'wp-block-cover__image-background',
			$rendered,
			'An id that is not an attachment must strip the saved cover image element.'
		);
		$this->assertStringNotContainsString(
			$bound_url,
			$rendered,
			'The non-attachment URL must not leak into the rendered output.'
		);
	}

	/**
	 * AC-18: when both `useFeaturedImage: true` AND an active binding co-exist
	 * on a cover, the binding wins. The rendered output contains exactly ONE
	 * `wp-block-cover__image-background` element, its `src` is the bound URL,
	 * and the featured-image URL does not appear at all.
	 */
	public function test_use_featured_image_with_active_binding_emits_exactly_one_img_with_bound_url() {
		global $wp_query;
		$wp_query->in_the_loop = true;
		$wp_query->post        = self::$post;
		$wp_query->posts       = array( self::$post );
		$GLOBALS['post']       = self::$post;

		$bound_url    = wp_get_attachment_image_url( self::$override_attachment_id, 'full' );
		$bound_id     = self::$override_attachment_id;
		$featured_url = wp_get_attachment_image_url( self::$attachment_id, 'full' );

		$this->register_test_source(
			function ( $source_args, $block_instance, $attribute_name ) use ( $bound_url, $bound_id ) {
				return 'url' === $attribute_name ? $bound_url : $bound_id;
			}
		);

		// Plain `<img>` saved form — the saved src does not matter since the
		// bound URL is substituted in place.
		$saved_markup = '<div class="wp-block-cover"><img class="wp-block-cover__image-background" alt="" src="" data-object-fit="cover"/><span aria-hidden="true" class="wp-block-cover__background has-background-dim has-background-dim-100"></span><div class="wp-block-cover__inner-container"></div></div>';
		$parsed_block = $this->build_bound_cover_block(
			$saved_markup,
			array(
				'useFeaturedImage' => true,
				'hasParallax'      => false,
				'isRepeated'       => false,
			)
		);
		$rendered     = render_block( $parsed_block );

		// Bound URL appears once.
		$this->assertSame(
			1,
			substr_count( $rendered, esc_attr( $bound_url ) ),
			'The bound URL must appear exactly once in the rendered cover (AC-18).'
		);
		// The featured-image URL must not appear at all.
		$this->assertStringNotContainsString(
			$featured_url,
			$rendered,
			'The featured-image URL must not be injected when a binding is active (AC-18).'
		);
		// Exactly one `wp-block-cover__image-background` element survives.
		$this->assertSame(
			1,
			preg_match_all( '/class="[^"]*\bwp-block-cover__image-background\b[^"]*"/', $rendered ),
			'Exactly one wp-block-cover__image-background element must survive on a useFeaturedImage+bound cover.'
		);
	}

	/**
	 * AC-21: `backgroundType: 'embed-video'` covers short-circuit both the
	 * binding-aware filters. Even with same-source `id`+`url` bindings
	 * configured, the Cover render path remains the trunk embed-video path —
	 * no `<img>` substitution, no dim-class relaxation.
	 */
	public function test_embed_video_short_circuits() {
		$bound_url = wp_get_attachment_image_url( self::$override_attachment_id, 'full' );
		$bound_id  = self::$override_attachment_id;

		$this->register_test_source(
			function ( $source_args, $block_instance, $attribute_name ) use ( $bound_url, $bound_id ) {
				return 'url' === $attribute_name ? $bound_url : $bound_id;
			}
		);

		// Embed-video covers serialize as a `<figure class="wp-block-embed">`
		// inside the cover wrapper. We assert the bound-cover code path does
		// NOT engage: the bound URL must not appear and the
		// `has-background-dim-100` class must survive untouched.
		$saved_markup = '<div class="wp-block-cover"><figure class="wp-block-cover__video-background wp-block-cover__embed-background wp-block-embed"><div class="wp-block-embed__wrapper">https://example.com/video</div></figure><span aria-hidden="true" class="wp-block-cover__background has-background-dim has-background-dim-100"></span><div class="wp-block-cover__inner-container"></div></div>';
		$parsed_block = $this->build_bound_cover_block(
			$saved_markup,
			array(
				'backgroundType' => 'embed-video',
				'url'            => 'https://example.com/video',
			)
		);
		$rendered     = render_block( $parsed_block );

		$this->assertStringNotContainsString(
			$bound_url,
			$rendered,
			'The bound URL must not be substituted into an embed-video cover (AC-21).'
		);
		$this->assertStringContainsString(
			'has-background-dim-100',
			$rendered,
			'The dim-class relax pass must not run on an embed-video cover (AC-21).'
		);
	}

	/**
	 * AC-20: an unbound cover (no `metadata.bindings`) is byte-identical to
	 * trunk — the binding-aware filters are pure no-ops on unbound content.
	 */
	public function test_unbound_cover_is_byte_identical_to_trunk() {
		// Render an unbound cover through the full `render_block()` pipeline
		// (including the new priority-9 filter) and through `render_block()`
		// again after temporarily removing the priority-9 filter, then assert
		// the outputs match byte-for-byte. This is a stronger guarantee than
		// "the new filter returned its input unchanged" because it also covers
		// any incidental interference with neighbouring filters.
		$saved_markup = '<div class="wp-block-cover"><img class="wp-block-cover__image-background wp-image-42" alt="" src="https://example.com/local.jpg" data-object-fit="cover"/><span aria-hidden="true" class="wp-block-cover__background has-background-dim has-background-dim-100"></span><div class="wp-block-cover__inner-container"></div></div>';
		$parsed_block = array(
			'blockName'    => 'core/cover',
			'attrs'        => array(
				'backgroundType' => 'image',
				'url'            => 'https://example.com/local.jpg',
				'id'             => 42,
				'dimRatio'       => 100,
			),
			'innerBlocks'  => array(),
			'innerHTML'    => $saved_markup,
			'innerContent' => array( $saved_markup ),
		);

		$with_filter = render_block( $parsed_block );

		remove_filter( 'render_block', 'gutenberg_cover_bindings_render_block', 9 );
		remove_filter( 'render_block_data', 'gutenberg_cover_bindings_prepare_block', 10 );
		$without_filter = render_block( $parsed_block );
		add_filter( 'render_block', 'gutenberg_cover_bindings_render_block', 9, 3 );
		add_filter( 'render_block_data', 'gutenberg_cover_bindings_prepare_block', 10, 3 );

		$this->assertSame(
			$without_filter,
			$with_filter,
			'An unbound cover must render byte-identically with and without the binding-aware filters (AC-20).'
		);
	}
}
