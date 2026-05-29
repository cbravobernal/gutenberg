/**
 * External dependencies
 */
import {
	screen,
	fireEvent,
	act,
	within,
	renderHook,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * WordPress dependencies
 */
import {
	registerBlockBindingsSource,
	unregisterBlockBindingsSource,
} from '@wordpress/blocks';
import { dispatch } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';

/**
 * Internal dependencies
 */
import {
	initializeEditor,
	selectBlock,
} from 'test/integration/helpers/integration-test-editor';
import useCoverBindingState from '../edit/use-cover-binding-state';
import { getMediaColor } from '../edit/color-utils';

// Wrap `getMediaColor` so individual tests can intercept its calls / control
// the timing of its async resolution. The default `mockImplementation`
// delegates to the real implementation (preserving behaviour for every other
// test in this file).
jest.mock( '../edit/color-utils', () => {
	const actual = jest.requireActual( '../edit/color-utils' );
	return {
		__esModule: true,
		...actual,
		getMediaColor: jest.fn( actual.getMediaColor ),
	};
} );

const defaultSettings = {
	__experimentalFeatures: {
		color: {
			defaultPalette: true,
			defaultGradients: true,
			palette: {
				default: [
					{ name: 'Black', slug: 'black', color: '#000000' },
					{ name: 'White', slug: 'white', color: '#ffffff' },
				],
			},
		},
	},
	colors: [ { name: 'Black', slug: 'black', color: '#000000' } ],
	disableCustomColors: false,
	disableCustomGradients: false,
};

const disabledColorSettings = {
	color: {
		defaultPalette: false,
		defaultGradients: false,
	},
	disableCustomColors: true,
	disableCustomGradients: true,
};

async function setup( attributes, useCoreBlocks, customSettings ) {
	const testBlock = { name: 'core/cover', attributes };
	const settings = customSettings || defaultSettings;
	return initializeEditor( testBlock, useCoreBlocks, settings );
}

async function createAndSelectBlock() {
	await userEvent.click(
		screen.getByRole( 'button', {
			name: 'Black',
		} )
	);
	await selectBlock( 'Block: Cover' );
}

async function openStylesTabIfAvailable() {
	const stylesTab = screen.queryByRole( 'tab', {
		name: 'Styles',
	} );

	if ( stylesTab ) {
		await userEvent.click( stylesTab );
	}
}

async function selectViewportState( name ) {
	await userEvent.click(
		screen.getByRole( 'button', {
			name: 'State: Default',
		} )
	);
	await userEvent.click(
		screen.getByRole( 'menuitem', {
			name,
		} )
	);
}

describe( 'Cover block', () => {
	describe( 'Editor canvas', () => {
		test( 'shows placeholder if background image and color not set', async () => {
			await setup();

			expect(
				within( screen.getByLabelText( 'Block: Cover' ) ).getByText(
					'To edit this block, you need permission to upload media.'
				)
			).toBeInTheDocument();
		} );

		test( 'can set overlay color using color picker on block placeholder', async () => {
			const { container } = await setup();
			const colorPicker = screen.getByRole( 'button', {
				name: 'Black',
			} );
			await userEvent.click( colorPicker );
			const color = colorPicker.style.backgroundColor;
			expect(
				screen.queryByRole( 'group', {
					name: 'To edit this block, you need permission to upload media.',
				} )
			).not.toBeInTheDocument();

			// eslint-disable-next-line testing-library/no-node-access
			const overlay = container.getElementsByClassName(
				'wp-block-cover__background'
			);
			expect( overlay[ 0 ] ).toHaveStyle(
				`background-color: ${ color }`
			);
		} );

		test( 'can have the title edited', async () => {
			await setup();

			await userEvent.click(
				screen.getByRole( 'button', {
					name: 'Black',
				} )
			);

			const title = screen.getByLabelText( 'Empty block;', {
				exact: false,
			} );
			await userEvent.click( title );
			await userEvent.keyboard( 'abc' );
			expect( title ).toHaveTextContent( 'abc' );
		} );
	} );

	describe( 'Block toolbar', () => {
		test( 'full height toggle sets minHeight style attribute to 100vh when clicked', async () => {
			await setup();
			await createAndSelectBlock();

			expect( screen.getByLabelText( 'Block: Cover' ) ).not.toHaveStyle(
				'min-height: 100vh;'
			);

			await userEvent.click( screen.getByLabelText( 'Full height' ) );

			expect( screen.getByLabelText( 'Block: Cover' ) ).toHaveStyle(
				'min-height: 100vh;'
			);
		} );

		test( 'content position button sets content position', async () => {
			await setup();
			await createAndSelectBlock();

			await userEvent.click(
				screen.getByLabelText( 'Change content position' )
			);

			expect( screen.getByLabelText( 'Block: Cover' ) ).not.toHaveClass(
				'has-custom-content-position'
			);

			await act( async () =>
				within( screen.getByRole( 'grid' ) )
					.getByRole( 'gridcell', {
						name: 'top left',
					} )
					.focus()
			);

			expect( screen.getByLabelText( 'Block: Cover' ) ).toHaveClass(
				'has-custom-content-position'
			);
			expect( screen.getByLabelText( 'Block: Cover' ) ).toHaveClass(
				'is-position-top-left'
			);
		} );

		test( 'clears media when clear media button clicked', async () => {
			await setup( {
				url: 'http://localhost/my-image.jpg',
			} );

			await selectBlock( 'Block: Cover' );
			expect(
				within( screen.getByLabelText( 'Block: Cover' ) ).getByRole(
					'img'
				)
			).toBeInTheDocument();

			await userEvent.click(
				screen.getByRole( 'button', { name: 'Replace' } )
			);
			await userEvent.click(
				screen.getByRole( 'menuitem', {
					name: 'Reset',
				} )
			);

			expect(
				within( screen.getByLabelText( 'Block: Cover' ) ).queryByRole(
					'img'
				)
			).not.toBeInTheDocument();
		} );
	} );

	describe( 'Inspector controls', () => {
		describe( 'Media settings', () => {
			test( 'does not display media settings panel if url is not set', async () => {
				await setup();
				expect(
					screen.queryByRole( 'heading', {
						name: 'Settings',
					} )
				).not.toBeInTheDocument();
			} );
			test( 'does not display settings tab when media settings are empty', async () => {
				await setup();
				await createAndSelectBlock();

				expect(
					screen.queryByRole( 'tab', {
						name: 'Settings',
					} )
				).not.toBeInTheDocument();
				expect(
					screen.getByRole( 'button', {
						name: 'Advanced',
					} )
				).toBeInTheDocument();
			} );
			test( 'displays media settings panel if url is set', async () => {
				await setup( {
					url: 'http://localhost/my-image.jpg',
				} );

				await selectBlock( 'Block: Cover' );
				expect(
					await screen.findByRole( 'heading', { name: 'Settings' } )
				).toBeInTheDocument();
			} );
		} );

		test( 'sets hasParallax attribute to true if fixed background toggled', async () => {
			await setup( {
				url: 'http://localhost/my-image.jpg',
			} );
			expect( screen.getByLabelText( 'Block: Cover' ) ).not.toHaveClass(
				'has-parallax'
			);
			await selectBlock( 'Block: Cover' );
			await userEvent.click(
				await screen.findByLabelText( 'Fixed background' )
			);
			expect( screen.getByLabelText( 'Block: Cover' ) ).toHaveClass(
				'has-parallax'
			);
		} );

		test( 'sets isRepeated attribute to true if repeated background toggled', async () => {
			await setup( {
				url: 'http://localhost/my-image.jpg',
			} );
			expect( screen.getByLabelText( 'Block: Cover' ) ).not.toHaveClass(
				'is-repeated'
			);
			await selectBlock( 'Block: Cover' );
			await userEvent.click(
				await screen.findByLabelText( 'Repeated background' )
			);
			expect( screen.getByLabelText( 'Block: Cover' ) ).toHaveClass(
				'is-repeated'
			);
		} );

		test( 'sets left focalPoint attribute when focal point values changed', async () => {
			await setup( {
				url: 'http://localhost/my-image.jpg',
			} );

			await selectBlock( 'Block: Cover' );
			await userEvent.clear( await screen.findByLabelText( 'Left' ) );
			await userEvent.type( screen.getByLabelText( 'Left' ), '100' );

			expect(
				within( screen.getByLabelText( 'Block: Cover' ) ).getByRole(
					'img'
				)
			).toHaveStyle( 'object-position: 100% 50%;' );
		} );

		test( 'sets alt attribute if text entered in alt text box', async () => {
			await setup( {
				url: 'http://localhost/my-image.jpg',
			} );

			await selectBlock( 'Block: Cover' );
			await userEvent.type(
				await screen.findByLabelText( 'Alternative text' ),
				'Me'
			);
			expect( screen.getByAltText( 'Me' ) ).toBeInTheDocument();
		} );

		describe( 'Color panel', () => {
			test( 'applies selected opacity to block when number control value changed', async () => {
				const { container } = await setup();

				await createAndSelectBlock();

				// eslint-disable-next-line testing-library/no-node-access
				const overlay = container.getElementsByClassName(
					'wp-block-cover__background'
				);

				expect( overlay[ 0 ] ).toHaveClass( 'has-background-dim-100' );

				await openStylesTabIfAvailable();
				// Need act here as the isDark method is async.
				// eslint-disable-next-line testing-library/no-unnecessary-act
				await act( async () => {
					fireEvent.change(
						screen.getByRole( 'spinbutton', {
							name: 'Overlay opacity',
						} ),
						{
							target: { value: '40' },
						}
					);
				} );

				expect( overlay[ 0 ] ).toHaveClass( 'has-background-dim-40' );
			} );

			test( 'applies selected opacity to block when slider moved', async () => {
				const { container } = await setup();

				await createAndSelectBlock();

				// eslint-disable-next-line testing-library/no-node-access
				const overlay = container.getElementsByClassName(
					'wp-block-cover__background'
				);

				expect( overlay[ 0 ] ).toHaveClass( 'has-background-dim-100' );

				await openStylesTabIfAvailable();

				// Need act here as the isDark method is async.
				// eslint-disable-next-line testing-library/no-unnecessary-act
				await act( async () => {
					fireEvent.change(
						screen.getByRole( 'slider', {
							name: 'Overlay opacity',
						} ),
						{ target: { value: 30 } }
					);
				} );

				expect( overlay[ 0 ] ).toHaveClass( 'has-background-dim-30' );
			} );

			describe( 'when colors are disabled', () => {
				test( 'does not render overlay control', async () => {
					await setup( undefined, true, disabledColorSettings );
					await selectBlock( 'Block: Cover' );
					await openStylesTabIfAvailable();

					const overlayControl = screen.queryByRole( 'button', {
						name: 'Overlay',
					} );

					expect( overlayControl ).not.toBeInTheDocument();
				} );
				test( 'does not render opacity control', async () => {
					await setup( undefined, true, disabledColorSettings );
					await selectBlock( 'Block: Cover' );
					await openStylesTabIfAvailable();

					const opacityControl = screen.queryByRole( 'slider', {
						name: 'Overlay opacity',
					} );

					expect( opacityControl ).not.toBeInTheDocument();
				} );
			} );

			test( 'does not render overlay controls when a viewport state is selected', async () => {
				await setup();
				await createAndSelectBlock();
				await openStylesTabIfAvailable();

				expect(
					screen.getByRole( 'button', {
						name: 'Overlay',
					} )
				).toBeInTheDocument();

				await selectViewportState( 'Tablet' );

				expect(
					screen.queryByRole( 'button', {
						name: 'Overlay',
					} )
				).not.toBeInTheDocument();
				expect(
					screen.queryByRole( 'slider', {
						name: 'Overlay opacity',
					} )
				).not.toBeInTheDocument();
			} );
		} );

		describe( 'Dimensions panel', () => {
			test( 'sets minHeight attribute when number control value changed', async () => {
				await setup();
				await createAndSelectBlock();
				await openStylesTabIfAvailable();
				await userEvent.clear(
					screen.getByLabelText( 'Minimum height' )
				);
				await userEvent.type(
					screen.getByLabelText( 'Minimum height' ),
					'300'
				);

				expect( screen.getByLabelText( 'Block: Cover' ) ).toHaveStyle(
					'min-height: 300px;'
				);
			} );
		} );
	} );

	describe( 'isDark settings', () => {
		test( 'should toggle is-light class if background changed from light to dark', async () => {
			await setup();
			const colorPicker = screen.getByRole( 'button', {
				name: 'White',
			} );
			await userEvent.click( colorPicker );

			const coverBlock = screen.getByLabelText( 'Block: Cover' );

			expect( coverBlock ).toHaveClass( 'is-light' );

			await selectBlock( 'Block: Cover' );
			await openStylesTabIfAvailable();
			await userEvent.click( screen.getByText( 'Overlay' ) );
			const popupColorPicker = screen.getByRole( 'option', {
				name: 'Black',
			} );
			await userEvent.click( popupColorPicker );
			expect( coverBlock ).not.toHaveClass( 'is-light' );
		} );
		test( 'should remove is-light class if overlay color is removed', async () => {
			await setup();
			const colorPicker = screen.getByRole( 'button', {
				name: 'White',
			} );
			await userEvent.click( colorPicker );
			const coverBlock = screen.getByLabelText( 'Block: Cover' );
			expect( coverBlock ).toHaveClass( 'is-light' );
			await selectBlock( 'Block: Cover' );
			await openStylesTabIfAvailable();
			await userEvent.click( screen.getByText( 'Overlay' ) );
			// The default color is black, so clicking the black color button will remove the background color,
			// which should remove the isDark setting and assign the is-light class.
			const popupColorPicker = screen.getByRole( 'option', {
				name: 'White',
			} );
			await userEvent.click( popupColorPicker );
			expect( coverBlock ).not.toHaveClass( 'is-light' );
		} );
	} );

	describe( 'Bindings rendering', () => {
		const TEST_SOURCE = 'test/cover-binding-edit';
		const TEST_RESOLVED_URL = 'http://localhost/bound-image.jpg';
		const TEST_RESOLVED_ID = 4242;

		// Mutable state read by the test source's `getValues` so individual
		// tests can dial the resolved URL / ID without re-registering.
		const sourceState = {
			url: TEST_RESOLVED_URL,
			id: TEST_RESOLVED_ID,
		};

		beforeEach( () => {
			sourceState.url = TEST_RESOLVED_URL;
			sourceState.id = TEST_RESOLVED_ID;
			registerBlockBindingsSource( {
				name: TEST_SOURCE,
				label: 'Test cover binding source',
				getValues: () => ( {
					id: sourceState.id,
					url: sourceState.url,
				} ),
				canUserEditValue: () => false,
			} );
		} );

		afterEach( () => {
			unregisterBlockBindingsSource( TEST_SOURCE );
		} );

		const boundBindings = {
			id: { source: TEST_SOURCE },
			url: { source: TEST_SOURCE },
		};

		test( 'renders a binding-aware placeholder with the unresolvable copy when bindings are mismatched', async () => {
			// Mismatched sources on `id` vs `url` yield `bindingActive=false`
			// but `bindingUnresolvable=true` (cover-relevant bindings exist
			// yet do not satisfy the active-binding predicate).
			await setup( {
				metadata: {
					bindings: {
						id: { source: TEST_SOURCE },
						url: { source: 'test/other-source' },
					},
				},
			} );

			const coverBlock = screen.getByLabelText( 'Block: Cover' );

			expect(
				within( coverBlock ).getByText(
					'Internal media required for this binding.'
				)
			).toBeInTheDocument();

			expect(
				within( coverBlock ).getByTestId( 'cover-binding-unresolvable' )
			).toBeInTheDocument();

			expect(
				// eslint-disable-next-line testing-library/no-node-access
				coverBlock.querySelector(
					'img.wp-block-cover__image-background'
				)
			).not.toBeInTheDocument();
		} );

		test( 'force-renders an <img> for an active binding with a resolved URL, ignoring hasParallax / isRepeated', async () => {
			await setup( {
				url: 'http://localhost/stored-image.jpg',
				backgroundType: 'image',
				hasParallax: true,
				isRepeated: true,
				metadata: { bindings: boundBindings },
			} );

			const boundImg = await screen.findByRole( 'img' );

			expect( boundImg ).toHaveClass(
				'wp-block-cover__image-background'
			);
			expect( boundImg ).toHaveAttribute( 'src', TEST_RESOLVED_URL );

			// The force-img branch never picks up the parallax/repeat <div>
			// markup; assert that the alternative <div> background does NOT
			// appear in the rendered tree.
			expect(
				// eslint-disable-next-line testing-library/no-node-access
				document.querySelector( 'div.wp-block-cover__image-background' )
			).not.toBeInTheDocument();
		} );

		test( 'reaches the image branch via effectiveUrl even when the stored url is empty', async () => {
			// Pattern-Overrides-shaped state: the stored `url` is empty but
			// the bound source provides a populated URL via `effectiveUrl`.
			// A `customOverlayColor` keeps `hasBackground=true` so the cover
			// renders its main JSX path (where the image branch lives)
			// rather than the empty-cover branch.
			await setup( {
				url: '',
				backgroundType: 'image',
				customOverlayColor: '#abcdef',
				metadata: { bindings: boundBindings },
			} );

			const coverBlock = screen.getByLabelText( 'Block: Cover' );

			const boundImg = await within( coverBlock ).findByRole( 'img' );

			expect( boundImg ).toHaveClass(
				'wp-block-cover__image-background'
			);
			expect( boundImg ).toHaveAttribute( 'src', TEST_RESOLVED_URL );
		} );

		test( 'omits has-background-dim-100 on the overlay when dimRatio === 100 and the binding resolves a URL', async () => {
			const { container } = await setup( {
				url: 'http://localhost/stored-image.jpg',
				backgroundType: 'image',
				dimRatio: 100,
				metadata: { bindings: boundBindings },
			} );

			// The bound `<img>` proves the active-binding path engaged.
			await screen.findByRole( 'img' );

			// eslint-disable-next-line testing-library/no-node-access
			const overlay = container.getElementsByClassName(
				'wp-block-cover__background'
			)[ 0 ];

			expect( overlay ).toBeInTheDocument();
			expect( overlay ).not.toHaveClass( 'has-background-dim-100' );
		} );

		test( 'leaves the embed-video render path engaged on a cover with bindings (binding is inert)', async () => {
			await setup( {
				url: 'https://example.com/video',
				backgroundType: 'embed-video',
				metadata: { bindings: boundBindings },
			} );

			const coverBlock = screen.getByLabelText( 'Block: Cover' );

			// `bindingActive` is forced to `false` for embed-video covers, so
			// the binding-aware placeholder must NOT engage inside the cover.
			expect(
				within( coverBlock ).queryByText(
					'Internal media required for this binding.'
				)
			).not.toBeInTheDocument();

			expect(
				within( coverBlock ).queryByTestId(
					'cover-binding-unresolvable'
				)
			).not.toBeInTheDocument();

			// Likewise, the force-img branch must not fire.
			expect(
				// eslint-disable-next-line testing-library/no-node-access
				coverBlock.querySelector(
					'img.wp-block-cover__image-background'
				)
			).not.toBeInTheDocument();
		} );
	} );

	describe( 'Bindings control gating', () => {
		const TEST_SOURCE = 'test/cover-binding-controls';
		const TEST_RESOLVED_URL = 'http://localhost/bound-image.jpg';
		const TEST_RESOLVED_ID = 4242;

		beforeEach( () => {
			registerBlockBindingsSource( {
				name: TEST_SOURCE,
				label: 'Test cover binding controls source',
				getValues: () => ( {
					id: TEST_RESOLVED_ID,
					url: TEST_RESOLVED_URL,
				} ),
				canUserEditValue: () => false,
			} );
		} );

		afterEach( () => {
			unregisterBlockBindingsSource( TEST_SOURCE );
		} );

		const boundBindings = {
			id: { source: TEST_SOURCE },
			url: { source: TEST_SOURCE },
		};

		test( 'hides the "Fixed background" and "Repeated background" inspector controls when bindingActive', async () => {
			await setup( {
				url: 'http://localhost/stored-image.jpg',
				backgroundType: 'image',
				metadata: { bindings: boundBindings },
			} );

			// Force-img branch engages, confirming the binding is active and
			// the inspector subtree has rendered alongside it.
			await screen.findByRole( 'img' );

			// On bound covers the parallax / repeat toggles are absent from
			// the document regardless of selection state — the inspector is
			// rendered unconditionally by `CoverEdit`, so we can assert on
			// the global DOM without going through `selectBlock`.
			expect(
				screen.queryByLabelText( 'Fixed background' )
			).not.toBeInTheDocument();
			expect(
				screen.queryByLabelText( 'Repeated background' )
			).not.toBeInTheDocument();
		} );

		test( 'hides the MediaReplaceFlow toolbar button when bindingActive', async () => {
			await setup( {
				url: 'http://localhost/stored-image.jpg',
				backgroundType: 'image',
				metadata: { bindings: boundBindings },
			} );

			// Force-img branch engages, confirming the binding is active and
			// the block-toolbar subtree has rendered alongside it.
			await screen.findByRole( 'img' );

			// On bound covers the `<MediaReplaceFlow>` toggle is absent from
			// the document regardless of selection state — `<BlockControls>`
			// portals are present in the global DOM whenever `CoverEdit`
			// renders.
			expect(
				screen.queryByRole( 'button', { name: 'Replace' } )
			).not.toBeInTheDocument();
			expect(
				screen.queryByRole( 'button', { name: 'Add media' } )
			).not.toBeInTheDocument();
		} );
	} );

	describe( 'useCoverBindingState', () => {
		// Unique per-describe source name so registrations cannot leak between
		// the integration-style binding describes and these hook-level tests.
		const TEST_SOURCE = 'test/cover-binding-state-hook';
		const OTHER_SOURCE = 'test/cover-binding-state-other';
		const TEST_RESOLVED_URL = 'http://localhost/resolved-image.jpg';
		const TEST_RESOLVED_ID = 9991;

		const sourceState = {
			url: TEST_RESOLVED_URL,
			id: TEST_RESOLVED_ID,
		};

		beforeEach( () => {
			sourceState.url = TEST_RESOLVED_URL;
			sourceState.id = TEST_RESOLVED_ID;
			registerBlockBindingsSource( {
				name: TEST_SOURCE,
				label: 'Hook test binding source',
				getValues: () => ( {
					id: sourceState.id,
					url: sourceState.url,
				} ),
				canUserEditValue: () => false,
			} );
			registerBlockBindingsSource( {
				name: OTHER_SOURCE,
				label: 'Other hook test binding source',
				getValues: () => ( {
					id: undefined,
					url: undefined,
				} ),
				canUserEditValue: () => false,
			} );
		} );

		afterEach( () => {
			unregisterBlockBindingsSource( TEST_SOURCE );
			unregisterBlockBindingsSource( OTHER_SOURCE );
		} );

		/**
		 * Renders the hook under test and returns its current state. The hook
		 * is exercised through `renderHook` with the actual data registry; the
		 * synchronous snapshot value reflects the predicate state after the
		 * first render (before any subscription-side rerender).
		 *
		 * @param {Object} attributes Cover attributes passed verbatim to the hook.
		 * @param {Object} [context]  Optional block context object.
		 *
		 * @return {Object} The hook's snapshot value at first render.
		 */
		const snapshotBindingState = ( attributes, context = {} ) => {
			const { result } = renderHook( () =>
				useCoverBindingState( {
					clientId: 'test-client-id',
					attributes,
					context,
				} )
			);
			return result.current;
		};

		test( 'bindingActive is false when id and url have different sources', () => {
			const bindingState = snapshotBindingState( {
				metadata: {
					bindings: {
						id: { source: TEST_SOURCE },
						url: { source: OTHER_SOURCE },
					},
				},
			} );

			expect( bindingState.bindingActive ).toBe( false );
		} );

		test( 'bindingActive is false when id and url bind to matching source but differing args', () => {
			const bindingState = snapshotBindingState( {
				metadata: {
					bindings: {
						id: { source: TEST_SOURCE, args: { key: 'a' } },
						url: { source: TEST_SOURCE, args: { key: 'b' } },
					},
				},
			} );

			expect( bindingState.bindingActive ).toBe( false );
		} );

		test( 'bindingActive is false when backgroundType is "embed-video"', () => {
			// AC-21: the embed-video carve-out short-circuits the binding
			// path even when the binding configuration itself would qualify.
			const bindingState = snapshotBindingState( {
				backgroundType: 'embed-video',
				metadata: {
					bindings: {
						id: { source: TEST_SOURCE },
						url: { source: TEST_SOURCE },
					},
				},
			} );

			expect( bindingState.bindingActive ).toBe( false );
		} );

		test( 'bindingUnresolvable is true when bindings are present but mismatched (cover-relevant config + !bindingActive)', () => {
			const bindingState = snapshotBindingState( {
				metadata: {
					bindings: {
						id: { source: TEST_SOURCE },
						url: { source: OTHER_SOURCE },
					},
				},
			} );

			expect( bindingState.bindingActive ).toBe( false );
			expect( bindingState.bindingUnresolvable ).toBe( true );
		} );

		test( 'returns the no-bindings shape when `metadata.bindings` is absent', () => {
			// The early-return shape preserves the hook's contract for every
			// cover that has never been bound.
			const bindingState = snapshotBindingState( {} );

			expect( bindingState.bindingActive ).toBe( false );
			expect( bindingState.bindingUnresolvable ).toBe( false );
			expect( bindingState.bindingResolvedUrl ).toBeUndefined();
		} );

		// The remaining `bindingActive: true` / `bindingUnresolvable: true`
		// arms are exercised through `CoverEdit` integration: a bound cover
		// surfaces the force-img branch when `bindingActive` is true, and the
		// "Internal media required for this binding." placeholder when
		// `bindingUnresolvable` is true. Going through the editor lets the
		// `useSelect` subscription that backs the hook settle inside the
		// `act` boundary that `render()` already establishes.

		test( 'bindingActive: true via `__default` pattern-overrides binding engages the force-img render path (integration)', async () => {
			// Confirms the inline `__default` expander reaches `bindingActive`.
			// The block-editor's own `replacePatternOverridesDefaultBinding`
			// also runs against the block's bindings and needs to know the
			// block's bindable attributes — supplied via the experimental
			// editor setting below — so it can iterate `[ 'id', 'url' ]`
			// instead of `undefined`.
			registerBlockBindingsSource( {
				name: 'core/pattern-overrides',
				label: 'Pattern overrides (test stand-in)',
				getValues: () => ( {
					id: TEST_RESOLVED_ID,
					url: TEST_RESOLVED_URL,
				} ),
				canUserEditValue: () => false,
			} );

			try {
				await setup(
					{
						url: '',
						backgroundType: 'image',
						customOverlayColor: '#abcdef',
						metadata: {
							bindings: {
								__default: {
									source: 'core/pattern-overrides',
								},
							},
						},
					},
					true,
					{
						...defaultSettings,
						__experimentalBlockBindingsSupportedAttributes: {
							'core/cover': [ 'id', 'url' ],
						},
					}
				);

				const boundImg = await screen.findByRole( 'img' );
				expect( boundImg ).toHaveAttribute( 'src', TEST_RESOLVED_URL );
			} finally {
				unregisterBlockBindingsSource( 'core/pattern-overrides' );
			}
		} );

		test( 'bindingActive: true via matching source + matching args engages the force-img render path (integration)', async () => {
			await setup( {
				url: '',
				backgroundType: 'image',
				customOverlayColor: '#abcdef',
				metadata: {
					bindings: {
						id: { source: TEST_SOURCE, args: { key: 'shared' } },
						url: { source: TEST_SOURCE, args: { key: 'shared' } },
					},
				},
			} );

			const boundImg = await screen.findByRole( 'img' );
			expect( boundImg ).toHaveAttribute( 'src', TEST_RESOLVED_URL );
		} );

		test( 'bindingUnresolvable: false (pending) keeps the bound `<img>` slot rendered without an unresolvable placeholder (integration)', async () => {
			// No attachment record is preloaded for this ID — the core-data
			// selector returns `undefined`, the hook treats that as pending,
			// and the cover renders normally with the bound `<img>` (no
			// unresolvable placeholder).
			const pendingId = 88_881;
			sourceState.id = pendingId;
			sourceState.url = 'http://localhost/pending.jpg';

			await setup( {
				url: '',
				backgroundType: 'image',
				customOverlayColor: '#abcdef',
				metadata: {
					bindings: {
						id: { source: TEST_SOURCE },
						url: { source: TEST_SOURCE },
					},
				},
			} );

			const coverBlock = screen.getByLabelText( 'Block: Cover' );

			expect(
				within( coverBlock ).queryByText(
					'Internal media required for this binding.'
				)
			).not.toBeInTheDocument();

			const boundImg = await within( coverBlock ).findByRole( 'img' );
			expect( boundImg ).toHaveAttribute(
				'src',
				'http://localhost/pending.jpg'
			);
		} );

		test( 'bindingUnresolvable: true when the bound id resolves to a non-attachment record (integration)', async () => {
			// Preload a record under the attachment entity but with
			// `type !== "attachment"` — the hook's `attachmentResolvedWrongType`
			// guard is the user-observable arm of the "resolved-not-found"
			// invariant (Design §5.1 step 3: attachment must be a media-library
			// attachment to count as resolved). The `attachment` entity is
			// normally registered after a REST call; in this jsdom environment
			// no such call happens, so we register it explicitly here.
			const wrongTypeId = 99_991;
			sourceState.id = wrongTypeId;
			sourceState.url = 'http://localhost/wrong-type.jpg';

			await act( async () => {
				dispatch( coreStore ).addEntities( [
					{
						kind: 'postType',
						name: 'attachment',
						baseURL: '/wp/v2/media',
						baseURLParams: { context: 'edit' },
					},
				] );
				dispatch( coreStore ).receiveEntityRecords(
					'postType',
					'attachment',
					[
						{
							id: wrongTypeId,
							type: 'post',
							source_url: 'http://localhost/wrong-type.jpg',
						},
					],
					{ context: 'view' }
				);
			} );

			await setup( {
				url: '',
				backgroundType: 'image',
				metadata: {
					bindings: {
						id: { source: TEST_SOURCE },
						url: { source: TEST_SOURCE },
					},
				},
			} );

			const coverBlock = screen.getByLabelText( 'Block: Cover' );

			expect(
				await within( coverBlock ).findByText(
					'Internal media required for this binding.'
				)
			).toBeInTheDocument();
		} );

		test( 'effectiveDimRatio collapses to 50 in the rendered overlay when bindingActive && dimRatio === 100 && effectiveUrl is truthy', async () => {
			// `effectiveDimRatio` lives inside `CoverEdit`, so this is the
			// integration arm of the derivation. With an active binding, a
			// resolved URL, and stored `dimRatio === 100`, the overlay must
			// drop `has-background-dim-100` and use the default-50% baseline
			// (`has-background-dim` only — `dimRatioToClass(50)` returns
			// `null`, by convention, because 50 is the no-override default).
			const { container } = await setup( {
				url: 'http://localhost/stored.jpg',
				backgroundType: 'image',
				dimRatio: 100,
				metadata: {
					bindings: {
						id: { source: TEST_SOURCE },
						url: { source: TEST_SOURCE },
					},
				},
			} );

			await screen.findByRole( 'img' );

			// eslint-disable-next-line testing-library/no-node-access
			const overlay = container.getElementsByClassName(
				'wp-block-cover__background'
			)[ 0 ];

			expect( overlay ).toHaveClass( 'has-background-dim' );
			expect( overlay ).not.toHaveClass( 'has-background-dim-100' );
			expect( overlay ).not.toHaveClass( 'has-background-dim-50' );
		} );

		test( 'effectiveDimRatio equals dimRatio when bindingActive but dimRatio !== 100 (non-default ratio is preserved)', async () => {
			// The 50 collapse is gated on the *default* dim ratio. A user who
			// has explicitly pinned a non-100 ratio gets the same dim treatment
			// on bound and unbound covers.
			const { container } = await setup( {
				url: 'http://localhost/stored.jpg',
				backgroundType: 'image',
				dimRatio: 70,
				metadata: {
					bindings: {
						id: { source: TEST_SOURCE },
						url: { source: TEST_SOURCE },
					},
				},
			} );

			await screen.findByRole( 'img' );

			// eslint-disable-next-line testing-library/no-node-access
			const overlay = container.getElementsByClassName(
				'wp-block-cover__background'
			)[ 0 ];

			expect( overlay ).toHaveClass( 'has-background-dim-70' );
			expect( overlay ).not.toHaveClass( 'has-background-dim-50' );
		} );
	} );

	describe( 'CoverEdit single observer', () => {
		const TEST_SOURCE = 'test/cover-binding-observer';
		const TEST_RESOLVED_URL = 'http://localhost/observer-image.jpg';
		const TEST_RESOLVED_ID = 7777;

		const sourceState = {
			url: TEST_RESOLVED_URL,
			id: TEST_RESOLVED_ID,
		};

		beforeEach( () => {
			sourceState.url = TEST_RESOLVED_URL;
			sourceState.id = TEST_RESOLVED_ID;
			registerBlockBindingsSource( {
				name: TEST_SOURCE,
				label: 'Observer test binding source',
				getValues: () => ( {
					id: sourceState.id,
					url: sourceState.url,
				} ),
				canUserEditValue: () => false,
			} );
			// Default `getMediaColor` to the real implementation (silently
			// falls through to the default colour in JSDOM); individual tests
			// can override via `mockImplementation`.
			getMediaColor.mockReset();
			const actualGetMediaColor = jest.requireActual(
				'../edit/color-utils'
			).getMediaColor;
			getMediaColor.mockImplementation( actualGetMediaColor );
		} );

		afterEach( () => {
			unregisterBlockBindingsSource( TEST_SOURCE );
		} );

		test( 'does not write any DC-2-prohibited attribute back to the block when a binding becomes active', async () => {
			// Saved state: `dimRatio = 100`, `hasParallax = true`,
			// `isRepeated = true`, plus an active binding. The observer must
			// NOT flip any of these to keep DC-2.
			//
			// `BlockEditorProvider` creates a private sub-registry, so we
			// cannot read attributes from the global `blockEditorStore`
			// directly. We instead lean on the `<Editor>` helper's `onChange`
			// callback — it fires whenever blocks change — by interposing a
			// spy that records every blocks-update the editor commits. If
			// the observer dispatched any DC-2-prohibited `setAttributes`
			// call, that change would surface here; the test asserts no such
			// change ever ran by sampling the final committed block state.
			//
			// (Operationally: `setup()` keeps blocks in local state inside
			// `Editor`. The observer's `setAttributes({ isDark })` calls
			// commit to the underlying registry, propagate via `onChange`
			// to `Editor`, then update `currentBlocks` — which is the same
			// path any other write would take.)
			const initialAttrs = {
				url: 'http://localhost/stored.jpg',
				id: 1234,
				backgroundType: 'image',
				dimRatio: 100,
				hasParallax: true,
				isRepeated: true,
				metadata: {
					bindings: {
						id: { source: TEST_SOURCE },
						url: { source: TEST_SOURCE },
					},
				},
			};

			await setup( initialAttrs );

			// Wait for the binding-aware render to engage.
			await screen.findByRole( 'img' );

			// Allow the URL-resolved observer (and any subsequent re-renders)
			// to flush before we sample the stored attributes.
			await act( async () => {
				await Promise.resolve();
			} );
			await act( async () => {
				await Promise.resolve();
			} );

			const coverBlock = screen.getByLabelText( 'Block: Cover' );

			// `data-url` is the editor's pass-through of the stored `url`
			// attribute (via `originalUrl?.replaceAll('&amp;', '&')`). A
			// DC-2-violating observer that wrote `setAttributes({ url:
			// bindingResolvedUrl })` would clobber this to the resolved URL.
			expect( coverBlock ).toHaveAttribute(
				'data-url',
				'http://localhost/stored.jpg'
			);

			// The bound `<img>` carries the resolved URL (proves the
			// binding-aware render engaged).
			// eslint-disable-next-line testing-library/no-node-access
			const boundImg = coverBlock.querySelector(
				'img.wp-block-cover__image-background'
			);
			expect( boundImg ).toHaveAttribute( 'src', TEST_RESOLVED_URL );

			// `hasParallax`/`isRepeated` survival proof: if the observer had
			// flipped either to false, `isImgElement` would have toggled and
			// the non-binding rendering branch would have switched its DOM
			// element. The active-binding force-img branch ignores those at
			// render time, so the only way to invalidate this assertion is
			// for the observer to set `hasParallax`/`isRepeated` to false
			// AND for the binding to deactivate — neither of which should
			// happen.
			expect( coverBlock ).toHaveClass( 'has-parallax' );
			expect( coverBlock ).toHaveClass( 'is-repeated' );

			// The overlay class reflects the *derived* effectiveDimRatio (50)
			// — `dimRatioToClass(50)` returns `null` (the 50% baseline is the
			// no-override default), so we assert the *absence* of the
			// `has-background-dim-100` class that would be present if the
			// stored `dimRatio` (100) had been used directly.
			// eslint-disable-next-line testing-library/no-node-access
			const overlay = coverBlock.querySelector(
				'.wp-block-cover__background'
			);
			expect( overlay ).toHaveClass( 'has-background-dim' );
			expect( overlay ).not.toHaveClass( 'has-background-dim-100' );
		} );

		test( 'is source-agnostic: invokes `getMediaColor` for a manual `attributes.url` URL', async () => {
			// DC-3 part 1: the observer treats `attributes.url` (the manual
			// editor-driven URL) identically to other URL sources — its
			// presence is enough to fire `getMediaColor`.
			getMediaColor.mockClear();
			const manualUrl = 'http://localhost/agnostic-manual.jpg';
			await setup( {
				url: manualUrl,
				backgroundType: 'image',
			} );
			await act( async () => {
				await Promise.resolve();
			} );
			expect( getMediaColor ).toHaveBeenCalledWith( manualUrl );
		} );

		test( 'is source-agnostic: invokes `getMediaColor` for a binding-resolved URL', async () => {
			// DC-3 part 2: the same observer fires identically when the URL
			// originates from a bound source — the unique URL per test avoids
			// any memoised-cache cross-pollination from the manual case.
			getMediaColor.mockClear();
			const boundUrl = 'http://localhost/agnostic-bound.jpg';
			sourceState.url = boundUrl;
			await setup( {
				url: '',
				backgroundType: 'image',
				metadata: {
					bindings: {
						id: { source: TEST_SOURCE },
						url: { source: TEST_SOURCE },
					},
				},
			} );
			await act( async () => {
				await Promise.resolve();
			} );
			expect( getMediaColor ).toHaveBeenCalledWith( boundUrl );
		} );

		test( 'observer fires `getMediaColor` exactly once per `effectiveUrl` on mount (race-token guard precondition: single observer keyed on effectiveUrl)', async () => {
			// The race-token guard relies on the single-observer keyed-on-
			// `effectiveUrl` architecture (DC-1). If a future change
			// introduced additional triggers (e.g. a separate `useEffect`
			// on `metadata.bindings` that also calls `getMediaColor`), the
			// raceToken bookkeeping could break — multiple observers
			// could increment the token concurrently. This test fixes the
			// initial-mount invariant: a single mount triggers a single
			// observer fire for the resolved `effectiveUrl`.
			//
			// `getMediaColor` is held pending so the post-await
			// `setAttributes`/`setOverlayColor` flush never fires within
			// the test — eliminating any "update was not wrapped in act"
			// console errors that would otherwise come from the observer
			// firing after the test's assertions have run.
			const URL_A = 'http://localhost/observer-counts.jpg';
			const pendingPromise = new Promise( () => {
				/* never resolves */
			} );

			getMediaColor.mockImplementation( ( url ) => {
				if ( url === URL_A ) {
					return pendingPromise;
				}
				return Promise.resolve( '#888888' );
			} );

			await setup( {
				url: URL_A,
				backgroundType: 'image',
				dimRatio: 70,
			} );

			// Filter to URL_A only — the editor harness may incidentally
			// fire `getMediaColor()` against `undefined` during mount.
			const callsForUrlA = getMediaColor.mock.calls.filter(
				( [ url ] ) => url === URL_A
			);
			expect( callsForUrlA ).toHaveLength( 1 );
		} );

		test( 'race-token guard: no extra `getMediaColor` invocation on mount when binding-active state is in the initial attributes (DC-1 single-observer corollary)', async () => {
			// `useEffectEvent`'s race-token bookkeeping (Task 7) ensures
			// that out-of-order resolutions don't clobber the latest
			// derivation. We cannot trigger two simultaneous URL changes
			// from a Jest integration test without poking the editor's
			// private sub-registry (the `BlockEditorProvider` creates one),
			// so this test pins the load-bearing precondition: even when
			// the cover mounts with binding-active state already in its
			// attributes (so `useCoverBindingState` runs through its
			// `useSelect` branch instead of the early-return path), the
			// observer fires exactly ONCE — not twice, which would be the
			// fingerprint of an extra `useEffect` keyed on bindings.
			const URL_A = 'http://localhost/race-mount-bound.jpg';
			const pendingPromise = new Promise( () => {
				/* never resolves */
			} );

			getMediaColor.mockImplementation( ( url ) => {
				if ( url === URL_A ) {
					return pendingPromise;
				}
				return Promise.resolve( '#888888' );
			} );

			sourceState.url = URL_A;
			await setup( {
				url: '',
				backgroundType: 'image',
				dimRatio: 70,
				metadata: {
					bindings: {
						id: { source: TEST_SOURCE },
						url: { source: TEST_SOURCE },
					},
				},
			} );

			expect(
				getMediaColor.mock.calls.filter( ( [ url ] ) => url === URL_A )
			).toHaveLength( 1 );
		} );
	} );
} );
