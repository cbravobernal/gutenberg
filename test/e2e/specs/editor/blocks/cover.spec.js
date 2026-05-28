/**
 * External dependencies
 */
const path = require( 'path' );
const fs = require( 'fs/promises' );
const os = require( 'os' );
const { randomUUID } = require( 'crypto' );

/** @typedef {import('@playwright/test').Page} Page */

/**
 * WordPress dependencies
 */
const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

test.use( {
	coverBlockUtils: async ( { page }, use ) => {
		await use( new CoverBlockUtils( { page } ) );
	},
} );

async function openStylesTabIfAvailable( editorSettings ) {
	const stylesTab = editorSettings.getByRole( 'tab', { name: 'Styles' } );
	if ( await stylesTab.count() ) {
		await stylesTab.click();
	}
}

test.describe( 'Cover', () => {
	test.beforeEach( async ( { admin } ) => {
		await admin.createNewPost();
	} );

	test.afterAll( async ( { requestUtils } ) => {
		await requestUtils.deleteAllMedia();
	} );

	test( 'can set overlay color using color picker on block placeholder', async ( {
		editor,
	} ) => {
		await editor.insertBlock( { name: 'core/cover' } );
		const coverBlock = editor.canvas.getByRole( 'document', {
			name: 'Block: Cover',
		} );

		// Locate the Black color swatch.
		const blackColorSwatch = coverBlock.getByRole( 'button', {
			name: 'Black',
		} );
		await expect( blackColorSwatch ).toBeVisible();

		// Create the block by clicking selected color button.
		await blackColorSwatch.click();

		// Assert that after clicking black, the background color is black.
		await expect( coverBlock ).toHaveCSS(
			'background-color',
			'rgb(0, 0, 0)'
		);
	} );

	test( 'computes overlay color correctly for uploaded image', async ( {
		editor,
		page,
		coverBlockUtils,
	} ) => {
		let coverBlock;

		await test.step( 'can set background image using image upload on block placeholder', async () => {
			await editor.insertBlock( { name: 'core/cover' } );
			coverBlock = editor.canvas.getByRole( 'document', {
				name: 'Block: Cover',
			} );

			const fileName = await coverBlockUtils.upload(
				coverBlock.getByTestId( 'form-file-upload-input' )
			);
			const fileBasename = path.basename( fileName );

			// Wait for the img's src attribute to be prefixed with http.
			// Otherwise, the URL for the img src attribute starts is a placeholder
			// beginning with `blob`.
			await expect( async () => {
				const src = await coverBlock
					.locator( 'img' )
					.getAttribute( 'src' );
				expect( src.includes( fileBasename ) ).toBe( true );
			} ).toPass();
		} );

		await test.step( 'dims background image down by 50% with the average image color when an image is uploaded', async () => {
			// The overlay is a separate aria-hidden span before the image.
			const overlay = coverBlock.locator( '.wp-block-cover__background' );

			await expect( overlay ).toHaveCSS(
				'background-color',
				'rgb(179, 179, 179)'
			);
			await expect( overlay ).toHaveCSS( 'opacity', '0.5' );
		} );

		await test.step( 'auto-updates overlay color when replacing image after save and reload', async () => {
			// Save and reload.
			await editor.saveDraft();
			await page.reload();

			// Replace the image with a green one.
			coverBlock = editor.canvas.getByRole( 'document', {
				name: 'Block: Cover',
			} );
			await expect( coverBlock ).toBeVisible();
			await editor.selectBlocks( coverBlock );
			await editor.showBlockToolbar();

			await page
				.getByRole( 'toolbar', { name: 'Block tools' } )
				.getByRole( 'button', { name: 'Replace' } )
				.click();

			const replaceInput = page.getByTestId( 'form-file-upload-input' );
			await coverBlockUtils.upload(
				replaceInput,
				coverBlockUtils.GREEN_IMAGE_FILE_PATH
			);
			await expect( coverBlock.locator( 'img' ) ).toBeVisible();

			// The overlay should have auto-updated to the green image's average
			// color — no longer the gray from the first image.
			// This is the regression from PR #65105 / issue #64702.
			const overlay = coverBlock.locator( '.wp-block-cover__background' );
			await expect( overlay ).toHaveCSS(
				'background-color',
				'rgb(179, 255, 179)'
			);
		} );

		await test.step( 'should not auto-update a manually set overlay color when replacing image after save and reload', async () => {
			// Manually change the overlay color to blue.
			await editor.selectBlocks( coverBlock );
			await editor.openDocumentSettingsSidebar();
			const editorSettings = page.getByRole( 'region', {
				name: 'Editor settings',
			} );
			await openStylesTabIfAvailable( editorSettings );
			await editorSettings
				.getByRole( 'button', { name: 'Overlay' } )
				.click();
			await page
				.getByRole( 'button', { name: 'Custom color picker' } )
				.click();
			await page
				.getByRole( 'textbox', { name: 'Hex color' } )
				.fill( '0000ff' );

			const overlay = coverBlock.locator( '.wp-block-cover__background' );
			await expect( overlay ).toHaveCSS(
				'background-color',
				'rgb(0, 0, 255)'
			);

			// Replace the image again with the original black-and-white one.
			// Because the user explicitly set the overlay color, it should NOT
			// be auto-detected from the new image.
			await editor.selectBlocks( coverBlock );
			await editor.showBlockToolbar();

			await page
				.getByRole( 'toolbar', { name: 'Block tools' } )
				.getByRole( 'button', { name: 'Replace' } )
				.click();

			const secondReplaceInput = page.getByTestId(
				'form-file-upload-input'
			);
			await coverBlockUtils.upload( secondReplaceInput );
			await expect( coverBlock.locator( 'img' ) ).toBeVisible();

			// The overlay should still be blue — the user's manual choice is
			// preserved even after replacing the image.
			await expect( overlay ).toHaveCSS(
				'background-color',
				'rgb(0, 0, 255)'
			);
		} );
	} );

	test( 'can have the title edited', async ( { editor } ) => {
		const titleText = 'foo';

		await editor.insertBlock( { name: 'core/cover' } );
		const coverBlock = editor.canvas.getByRole( 'document', {
			name: 'Block: Cover',
		} );

		// Choose a color swatch to transform the placeholder block into
		// a functioning block.
		await coverBlock
			.getByRole( 'button', {
				name: 'Black',
			} )
			.click();

		// Activate the paragraph block inside the Cover block.
		// The name of the block differs depending on whether text has been entered or not.
		const coverBlockParagraph = coverBlock.getByRole( 'document', {
			name: /Block: Paragraph|Empty block; start writing or type forward slash to choose a block/,
		} );
		await expect( coverBlockParagraph ).toBeEditable();

		await coverBlockParagraph.fill( titleText );

		await expect( coverBlockParagraph ).toContainText( titleText );
	} );

	test( 'can be resized using drag & drop', async ( { page, editor } ) => {
		await editor.insertBlock( { name: 'core/cover' } );
		const coverBlock = editor.canvas.getByRole( 'document', {
			name: 'Block: Cover',
		} );
		await coverBlock
			.getByRole( 'button', {
				name: 'Black',
			} )
			.click();

		// Open the document sidebar.
		await editor.openDocumentSettingsSidebar();

		// Open the block list viewer from the Editor toolbar.
		await page
			.getByRole( 'toolbar', { name: 'Document tools' } )
			.getByRole( 'button', { name: 'Document Overview' } )
			.click();

		// Select the Cover block from the Document Overview.
		await page
			.getByRole( 'region', { name: 'Document Overview' } )
			.getByRole( 'link', { name: 'Cover' } )
			.click();

		// In the Block Editor Settings panel, click on the Styles subpanel if
		// the selected block has more than one inspector tab.
		const coverBlockEditorSettings = page.getByRole( 'region', {
			name: 'Editor settings',
		} );
		await openStylesTabIfAvailable( coverBlockEditorSettings );

		// Ensure there the default value for the minimum height of cover is undefined.
		await expect(
			coverBlockEditorSettings.getByLabel( 'Minimum height' )
		).toHaveValue( '' );

		// There is no accessible locator for the draggable block resize edge,
		// which is he bottom edge of the Cover block.
		// Therefore a CSS selector must be used.
		const coverBlockResizeHandle = page.locator(
			'.components-resizable-box__handle-bottom'
		);

		// Ensure the resize handle is in view before measuring its bounding box,
		// so the cached coordinates match the actual position during the drag.
		await coverBlockResizeHandle.scrollIntoViewIfNeeded();

		// Establish the existing bounding boxes for the Cover block
		// and the Cover block's resizing handle.
		const coverBlockBox = await coverBlock.boundingBox();
		const coverBlockResizeHandleBox =
			await coverBlockResizeHandle.boundingBox();
		expect( coverBlockBox.height ).toBeTruthy();
		expect( coverBlockResizeHandleBox.height ).toBeTruthy();

		// Increase the Cover block height by 100px.
		// Move the mouse to the handle's center, press, then drag exactly 100px down.
		// This avoids the off-by-half-handle-height bug that arises from using
		// `handleBox.y + 100` (top + 100) while the mouse starts at the center.
		const handleCenterX =
			coverBlockResizeHandleBox.x + coverBlockResizeHandleBox.width / 2;
		const handleCenterY =
			coverBlockResizeHandleBox.y + coverBlockResizeHandleBox.height / 2;
		await page.mouse.move( handleCenterX, handleCenterY );
		await page.mouse.down();
		await page.mouse.move( handleCenterX, handleCenterY + 100 );
		await page.mouse.up();

		const newCoverBlockBox = await coverBlock.boundingBox();
		expect( newCoverBlockBox.height ).toBe( coverBlockBox.height + 100 );
	} );

	test( 'dims the background image down by 50% black when transformed from the Image block', async ( {
		editor,
		coverBlockUtils,
	} ) => {
		await editor.insertBlock( { name: 'core/image' } );

		const imageBlock = editor.canvas.getByRole( 'document', {
			name: 'Block: Image',
		} );

		await coverBlockUtils.upload(
			imageBlock.getByTestId( 'form-file-upload-input' )
		);

		await expect(
			editor.canvas
				.getByRole( 'document', { name: 'Block: Image' } )
				.locator( 'img' )
		).toBeVisible();

		await editor.transformBlockTo( 'core/cover' );

		const coverBlock = editor.canvas.getByRole( 'document', {
			name: 'Block: Cover',
		} );

		// The overlay is a separate aria-hidden span before the image.
		const overlay = coverBlock.locator( '.wp-block-cover__background' );

		await expect( overlay ).toHaveCSS( 'background-color', 'rgb(0, 0, 0)' );
		await expect( overlay ).toHaveCSS( 'opacity', '0.5' );
	} );

	test( 'other cover blocks are not over the navigation block when the menu is open', async ( {
		editor,
		page,
	} ) => {
		// Insert a Cover block
		await editor.insertBlock( { name: 'core/cover' } );
		const coverBlock = editor.canvas.getByRole( 'document', {
			name: 'Block: Cover',
		} );

		// Choose a color swatch to transform the placeholder block into
		// a functioning block.
		await coverBlock
			.getByRole( 'button', {
				name: 'Black',
			} )
			.click();

		// Insert a Navigation block inside the Cover block
		await editor.selectBlocks( coverBlock );
		await coverBlock.getByRole( 'button', { name: 'Add block' } ).click();
		await page.keyboard.type( 'Navigation' );
		const blockResults = page.getByRole( 'listbox', {
			name: 'Blocks',
		} );
		const blockResultOptions = blockResults.getByRole( 'option' );
		await blockResultOptions.nth( 0 ).click();

		// Insert a second Cover block.
		await editor.insertBlock( { name: 'core/cover' } );
		const secondCoverBlock = editor.canvas
			.getByRole( 'document', {
				name: 'Block: Cover',
			} )
			.last();

		// Choose a color swatch to transform the placeholder block into
		// a functioning block.
		await secondCoverBlock
			.getByRole( 'button', {
				name: 'Black',
			} )
			.click();

		// Set the viewport to a small screen and open menu.
		await page.setViewportSize( { width: 375, height: 1000 } );
		const navigationBlock = editor.canvas.getByRole( 'document', {
			name: 'Block: Navigation',
		} );
		await editor.selectBlocks( navigationBlock );
		await editor.canvas
			.getByRole( 'button', { name: 'Open menu' } )
			.click();

		// Check if inner container of the second cover is clickable.
		const secondInnerContainer = secondCoverBlock.locator(
			'.wp-block-cover__inner-container'
		);
		let isClickable;
		try {
			isClickable = await secondInnerContainer.click( {
				trial: true,
				timeout: 1000, // This test will always take 1 second to run.
			} );
		} catch {
			isClickable = false;
		}

		expect( isClickable ).toBe( false );
	} );

	test( 'can use focal point picker to set the focal point of the cover image', async ( {
		editor,
		coverBlockUtils,
		page,
	} ) => {
		await editor.insertBlock( { name: 'core/cover' } );
		const coverBlock = editor.canvas.getByRole( 'document', {
			name: 'Block: Cover',
		} );

		await coverBlockUtils.upload(
			coverBlock.getByTestId( 'form-file-upload-input' )
		);

		// Wait for the image upload to complete and the image to appear.
		await expect(
			coverBlock.locator( 'img.wp-block-cover__image-background' )
		).toBeVisible();

		await editor.selectBlocks( coverBlock );

		const focalPointLeft = page.getByRole( 'spinbutton', {
			name: 'Focal point left position',
		} );

		const focalPointTop = page.getByRole( 'spinbutton', {
			name: 'Focal point top position',
		} );

		await focalPointLeft.fill( '20' );
		await focalPointTop.fill( '30' );

		await expect( focalPointLeft ).toHaveValue( '20' );
		await expect( focalPointTop ).toHaveValue( '30' );

		await expect.poll( editor.getBlocks ).toMatchObject( [
			{
				name: 'core/cover',
				attributes: {
					focalPoint: { x: 0.2, y: 0.3 },
				},
			},
		] );

		const coverImage = coverBlock.locator(
			'img.wp-block-cover__image-background'
		);

		await expect( coverImage ).toHaveCSS( 'object-position', '20% 30%' );
	} );

	test( 'correctly computes isDark based on dimRatio and overlay color', async ( {
		page,
		editor,
	} ) => {
		// A cover with a black overlay at 100% should be dark.
		await editor.insertBlock( { name: 'core/cover' } );
		const coverBlock = editor.canvas.getByRole( 'document', {
			name: 'Block: Cover',
		} );
		await coverBlock
			.getByRole( 'button', {
				name: 'Black',
			} )
			.click();

		// Black overlay at default 100% opacity → dark theme.
		await expect( coverBlock ).toHaveClass( /is-dark-theme/ );

		// Select the Cover block (not the inner Paragraph) before opening sidebar.
		await editor.selectBlocks( coverBlock );

		// Open sidebar and set overlay opacity to 0.
		await editor.openDocumentSettingsSidebar();
		const editorSettings = page.getByRole( 'region', {
			name: 'Editor settings',
		} );
		await openStylesTabIfAvailable( editorSettings );

		const opacitySlider = editorSettings.getByRole( 'slider', {
			name: 'Overlay opacity',
		} );

		// With dimRatio at 0, the overlay is fully transparent.
		// The background defaults to white → should be light, not dark.
		// This is the regression from PR #53253.
		await opacitySlider.fill( '0' );
		await expect( coverBlock ).toHaveClass( /is-light/ );

		// Set it back to 100 → should be dark again.
		await opacitySlider.fill( '100' );
		await expect( coverBlock ).toHaveClass( /is-dark-theme/ );
	} );

	test( 'preserves explicit dimRatio of 100 when replacing an image', async ( {
		page,
		editor,
		coverBlockUtils,
	} ) => {
		await editor.insertBlock( { name: 'core/cover' } );
		const coverBlock = editor.canvas.getByRole( 'document', {
			name: 'Block: Cover',
		} );

		// Upload an initial image.
		await coverBlockUtils.upload(
			coverBlock.getByTestId( 'form-file-upload-input' )
		);

		// Wait for the image to load.
		await expect( coverBlock.locator( 'img' ) ).toBeVisible();

		// Select the Cover block (not the inner Paragraph) before opening sidebar.
		await editor.selectBlocks( coverBlock );

		// Open the sidebar and set overlay opacity to 100.
		await editor.openDocumentSettingsSidebar();
		const editorSettings = page.getByRole( 'region', {
			name: 'Editor settings',
		} );
		await openStylesTabIfAvailable( editorSettings );

		const opacitySlider = editorSettings.getByRole( 'slider', {
			name: 'Overlay opacity',
		} );
		await opacitySlider.fill( '100' );

		// Verify the overlay opacity is now 100%.
		const overlay = coverBlock.locator( '.wp-block-cover__background' );
		await expect( overlay ).toHaveCSS(
			'background-color',
			'rgb(179, 179, 179)'
		);
		await expect( overlay ).toHaveCSS( 'opacity', '1' );

		// Replace the image via the toolbar.
		await editor.selectBlocks( coverBlock );
		await editor.showBlockToolbar();

		await page
			.getByRole( 'toolbar', { name: 'Block tools' } )
			.getByRole( 'button', { name: 'Replace' } )
			.click();

		// Upload a new image via the replace dropdown.
		const replaceInput = page.getByTestId( 'form-file-upload-input' );
		await coverBlockUtils.upload( replaceInput );

		// Wait for the new image to load.
		await expect( coverBlock.locator( 'img' ) ).toBeVisible();

		// The dimRatio should STILL be 1, not reset to 0.5.
		// This is the regression from PR #55422 / issue #52835.
		await expect( overlay ).toHaveCSS(
			'background-color',
			'rgb(179, 179, 179)'
		);
		await expect( overlay ).toHaveCSS( 'opacity', '1' );
	} );

	test( 'shows the overlay when using an empty featured image', async ( {
		editor,
	} ) => {
		await editor.insertBlock( { name: 'core/cover' } );
		const coverBlock = editor.canvas.getByRole( 'document', {
			name: 'Block: Cover',
		} );

		// Enable "Use featured image" without setting a featured image.
		// This is the scenario from issue #57887 / PR #59855: the overlay
		// was not rendered when useFeaturedImage was true but the featured
		// image was empty.
		await coverBlock
			.getByRole( 'button', { name: 'Use featured image' } )
			.click();

		const overlay = coverBlock.locator( '.wp-block-cover__background' );
		await expect( overlay ).toBeVisible();
	} );
} );

test.describe( 'Cover — Block Bindings — Pattern Overrides round-trip', () => {
	/**
	 * The synced pattern's Cover block is given a stable `metadata.name` so
	 * pattern-override values keyed off it can be addressed unambiguously from
	 * the pattern instance's `content` attribute. The same name appears in
	 * every override / reset step below.
	 */
	const coverBindingName = 'Bound Cover';

	let defaultMedia;
	let overrideMedia;

	test.beforeAll( async ( { requestUtils } ) => {
		// Two attachments: `defaultMedia` is baked into the pattern's saved
		// cover; `overrideMedia` is written into a pattern instance via the
		// `core/block` `content` attribute below.
		[ defaultMedia, overrideMedia ] = await Promise.all( [
			requestUtils.uploadMedia(
				'./assets/10x10_e2e_test_image_z9T8jK.png'
			),
			requestUtils.uploadMedia(
				'./assets/1024x768_e2e_test_image_size.jpeg'
			),
		] );
		// Sanity: distinct attachments so the round-trip assertions are
		// observable in both directions (default → override → reset).
		expect( overrideMedia.id ).not.toBe( defaultMedia.id );
		expect( overrideMedia.source_url ).not.toBe( defaultMedia.source_url );
	} );

	test.beforeEach( async ( { admin, requestUtils } ) => {
		// Reset blocks between phases so each top-level step starts from a
		// known post + pattern store.
		await requestUtils.deleteAllBlocks();
		await admin.createNewPost();
	} );

	test.afterAll( async ( { requestUtils } ) => {
		await requestUtils.deleteAllBlocks();
		await requestUtils.deleteAllMedia();
	} );

	test( 'Cover round-trips through default → override → reset', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		// Synced pattern carrying a bound Cover. `__default` pattern-overrides
		// expands to per-attribute `id` / `url` bindings on the server and in
		// the editor hook, so the inner Cover renders the saved
		// `defaultMedia` until a parent `core/block` `content` override is
		// applied.
		const pattern = await requestUtils.createBlock( {
			title: 'Cover Pattern',
			content: `<!-- wp:cover {"url":"${ defaultMedia.source_url }","id":${ defaultMedia.id },"dimRatio":100,"customOverlayColor":"#000000","minHeight":80,"metadata":{"name":"${ coverBindingName }","bindings":{"__default":{"source":"core/pattern-overrides"}}}} -->
<div class="wp-block-cover" style="min-height:80px"><span aria-hidden="true" class="wp-block-cover__background has-background-dim-100 has-background-dim" style="background-color:#000000"></span><img class="wp-block-cover__image-background wp-image-${ defaultMedia.id }" alt="" src="${ defaultMedia.source_url }" data-object-fit="cover"/><div class="wp-block-cover__inner-container"><!-- wp:paragraph {"align":"center","placeholder":"Write title…"} -->
<p class="has-text-align-center"></p>
<!-- /wp:paragraph --></div></div>
<!-- /wp:cover -->`,
			status: 'publish',
		} );

		let patternBlock;
		let coverBlock;

		await test.step( 'Default state — pattern instance shows defaultMedia and hides bound controls', async () => {
			await editor.insertBlock( {
				name: 'core/block',
				attributes: { ref: pattern.id },
			} );

			patternBlock = editor.canvas.getByRole( 'document', {
				name: 'Block: Pattern',
			} );
			coverBlock = patternBlock.getByRole( 'document', {
				name: 'Block: Cover',
			} );
			await expect( coverBlock ).toBeVisible();

			// AC-7 / AC-22: the editor preview img resolves to the pattern's
			// default attachment because no override is set on the instance.
			await expect( coverBlock.locator( 'img' ) ).toHaveAttribute(
				'src',
				defaultMedia.source_url
			);

			// AC-15: editor overlay should keep `has-background-dim` but drop
			// the `-100` modifier so the bound `<img>` remains visible (the
			// hook downshifts `effectiveDimRatio` to 50 when `dimRatio===100`).
			const overlay = coverBlock.locator( '.wp-block-cover__background' );
			await expect( overlay ).toHaveClass( /has-background-dim(?!-100)/ );
			await expect( overlay ).not.toHaveClass( /has-background-dim-100/ );

			// Select the bound Cover so its inspector + toolbar render.
			await editor.selectBlocks( coverBlock );
			await editor.openDocumentSettingsSidebar();
			await editor.showBlockToolbar();

			const editorSettings = page.getByRole( 'region', {
				name: 'Editor settings',
			} );
			await openStylesTabIfAvailable( editorSettings );

			// AC-11 / AC-12: the parallax + repeated-background tools-panel
			// items are absent for bound covers.
			await expect(
				editorSettings.getByRole( 'checkbox', {
					name: 'Fixed background',
				} )
			).toHaveCount( 0 );
			await expect(
				editorSettings.getByRole( 'checkbox', {
					name: 'Repeated background',
				} )
			).toHaveCount( 0 );

			// AC-13 / AC-14: the `<MediaReplaceFlow>` toolbar dropdown — the
			// only DOM site of both the "Replace" and "Add media" toolbar
			// labels — is omitted entirely. Zero matches is the positive
			// assertion the design doc (§5.5) and the task spec require.
			const blockToolbar = page.getByRole( 'toolbar', {
				name: 'Block tools',
			} );
			await expect(
				blockToolbar.getByRole( 'button', {
					name: /^(Replace|Add media)$/,
				} )
			).toHaveCount( 0 );

			// AC-10: the `ResetOverridesControl` toolbar button reports
			// disabled because no override has been written yet.
			const resetButton = blockToolbar.getByRole( 'button', {
				name: 'Reset',
			} );
			await expect( resetButton ).toBeDisabled();
		} );

		await test.step( 'AC-21 — embed-video covers retain Replace + "Embed video from URL"', async () => {
			// Embed-video covers force `bindingActive=false` upstream even
			// when `metadata.bindings` is present, so the
			// `<MediaReplaceFlow>` affordance — including the "Embed video
			// from URL" `<MenuItem>` child — must still render. Use a brand
			// new post to keep the assertion focused on a single block tree.
			await admin.createNewPost();
			await editor.insertBlock( {
				name: 'core/cover',
				attributes: {
					url: 'https://videopress.com/v/example',
					backgroundType: 'embed-video',
					dimRatio: 50,
					customOverlayColor: '#111111',
					metadata: {
						name: 'Embed cover',
						bindings: {
							url: { source: 'core/pattern-overrides' },
							id: { source: 'core/pattern-overrides' },
						},
					},
				},
			} );
			const embedCover = editor.canvas
				.getByRole( 'document', { name: 'Block: Cover' } )
				.last();
			await editor.selectBlocks( embedCover );
			await editor.showBlockToolbar();

			const embedToolbar = page.getByRole( 'toolbar', {
				name: 'Block tools',
			} );
			const replaceToggle = embedToolbar.getByRole( 'button', {
				name: /^(Replace|Add media)$/,
			} );
			await expect( replaceToggle ).toBeVisible();

			await replaceToggle.click();
			await expect(
				page.getByRole( 'menuitem', {
					name: 'Embed video from URL',
				} )
			).toBeVisible();

			// Close the dropdown so it does not bleed into the next step.
			await page.keyboard.press( 'Escape' );
		} );

		await test.step( 'Override — instance content writes overrideMedia through the binding', async () => {
			await admin.createNewPost();
			await editor.insertBlock( {
				name: 'core/block',
				attributes: { ref: pattern.id },
			} );

			patternBlock = editor.canvas.getByRole( 'document', {
				name: 'Block: Pattern',
			} );
			coverBlock = patternBlock.getByRole( 'document', {
				name: 'Block: Cover',
			} );
			await expect( coverBlock ).toBeVisible();

			// Write the override directly onto the pattern instance's
			// `content` attribute. This is exactly what
			// `ResetOverridesControl` undoes in the reset step below.
			await page.evaluate(
				( { name, overrideId, overrideUrl } ) => {
					const { dispatch, select } = window.wp.data;
					const blocks = select( 'core/block-editor' ).getBlocks();
					const patternClientId = blocks.find(
						( block ) => block.name === 'core/block'
					)?.clientId;
					dispatch( 'core/block-editor' ).updateBlockAttributes(
						patternClientId,
						{
							content: {
								[ name ]: {
									id: overrideId,
									url: overrideUrl,
								},
							},
						}
					);
				},
				{
					name: coverBindingName,
					overrideId: overrideMedia.id,
					overrideUrl: overrideMedia.source_url,
				}
			);

			// AC-22 editor: the bound `<img src>` flips to the override.
			await expect( coverBlock.locator( 'img' ) ).toHaveAttribute(
				'src',
				overrideMedia.source_url
			);

			// AC-10: the now-written override flips `ResetOverridesControl`
			// to enabled.
			await editor.selectBlocks( coverBlock );
			await editor.showBlockToolbar();
			const blockToolbar = page.getByRole( 'toolbar', {
				name: 'Block tools',
			} );
			await expect(
				blockToolbar.getByRole( 'button', { name: 'Reset' } )
			).toBeEnabled();

			// AC-8 / AC-16: publish, then read the rendered post on the
			// front-end. The server-rendered `<img src>` must match the
			// override and the overlay span must keep `has-background-dim`
			// while losing the `-100` modifier.
			const postId = await editor.publishPost();
			await page.goto( `/?p=${ postId }` );

			const renderedImage = page.locator(
				'.wp-block-cover__image-background'
			);
			await expect( renderedImage ).toHaveAttribute(
				'src',
				overrideMedia.source_url
			);

			const renderedOverlay = page.locator(
				'.wp-block-cover__background'
			);
			await expect( renderedOverlay ).toHaveClass(
				/has-background-dim(?!-100)/
			);
			await expect( renderedOverlay ).not.toHaveClass(
				/has-background-dim-100/
			);
		} );

		await test.step( 'Reset — clicking Reset clears the override on both editor and front-end', async () => {
			await admin.createNewPost();
			await editor.insertBlock( {
				name: 'core/block',
				attributes: {
					ref: pattern.id,
					content: {
						[ coverBindingName ]: {
							id: overrideMedia.id,
							url: overrideMedia.source_url,
						},
					},
				},
			} );

			patternBlock = editor.canvas.getByRole( 'document', {
				name: 'Block: Pattern',
			} );
			coverBlock = patternBlock.getByRole( 'document', {
				name: 'Block: Cover',
			} );

			// Confirm the override is in effect before resetting.
			await expect( coverBlock.locator( 'img' ) ).toHaveAttribute(
				'src',
				overrideMedia.source_url
			);

			await editor.selectBlocks( coverBlock );
			await editor.showBlockToolbar();
			const blockToolbar = page.getByRole( 'toolbar', {
				name: 'Block tools',
			} );
			const resetButton = blockToolbar.getByRole( 'button', {
				name: 'Reset',
			} );
			await expect( resetButton ).toBeEnabled();
			await resetButton.click();

			// AC-9 editor: the bound `<img src>` falls back to the pattern's
			// stored default attachment.
			await expect( coverBlock.locator( 'img' ) ).toHaveAttribute(
				'src',
				defaultMedia.source_url
			);

			// AC-9 front-end: the rendered post likewise serves the default
			// attachment after the reset persists.
			const postId = await editor.publishPost();
			await page.goto( `/?p=${ postId }` );
			await expect(
				page.locator( '.wp-block-cover__image-background' )
			).toHaveAttribute( 'src', defaultMedia.source_url );
		} );

		await test.step( 'Unresolvable — mismatched-source bindings surface the i18n affordance', async () => {
			await admin.createNewPost();

			// `id` and `url` bound to different sources never satisfy the
			// hook's `bindingActive` predicate, so the Cover renders the
			// unresolvable placeholder branch. The mismatched source-set is
			// intentionally not Pattern Overrides on both sides; the second
			// source need not actually resolve — the affordance is driven
			// purely by the source-mismatch detection.
			await editor.insertBlock( {
				name: 'core/cover',
				attributes: {
					metadata: {
						name: 'Mismatched Cover',
						bindings: {
							id: { source: 'core/pattern-overrides' },
							url: {
								source: 'core/post-meta',
								args: { key: 'url_custom_field' },
							},
						},
					},
				},
			} );

			// OQ-6: the user-facing affordance is the i18n message — not a
			// data-testid — exactly per the task contract.
			await expect(
				page.getByText( 'Internal media required for this binding.' )
			).toBeVisible();
		} );
	} );
} );

class CoverBlockUtils {
	constructor( { page } ) {
		/** @type {Page} */
		this.page = page;

		this.TEST_IMAGE_FILE_PATH = './assets/10x10_e2e_test_image_z9T8jK.png';

		this.GREEN_IMAGE_FILE_PATH = './assets/10x10_e2e_test_image_green.png';
	}

	async upload( locator, imagePath ) {
		const srcPath = imagePath || this.TEST_IMAGE_FILE_PATH;
		const tmpDirectory = await fs.mkdtemp(
			path.join( os.tmpdir(), 'gutenberg-test-image-' )
		);
		const fileName = randomUUID();
		const tmpFileName = path.join( tmpDirectory, fileName + '.png' );
		await fs.copyFile( srcPath, tmpFileName );

		await locator.setInputFiles( tmpFileName );

		return fileName;
	}
}
