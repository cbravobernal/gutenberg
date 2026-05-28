/**
 * WordPress dependencies
 */
import { useState } from '@wordpress/element';

import {
	BlockControls,
	MediaReplaceFlow,
	__experimentalBlockAlignmentMatrixControl as BlockAlignmentMatrixControl,
	__experimentalBlockFullHeightAligmentControl as FullHeightAlignmentControl,
	privateApis as blockEditorPrivateApis,
} from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';
import { MenuItem } from '@wordpress/components';
import { link } from '@wordpress/icons';

/**
 * Internal dependencies
 */
import { ALLOWED_MEDIA_TYPES, EMBED_VIDEO_BACKGROUND_TYPE } from '../shared';
import { unlock } from '../../lock-unlock';
import EmbedVideoUrlInput from './embed-video-url-input';

const { cleanEmptyObject } = unlock( blockEditorPrivateApis );

/**
 * Block toolbar controls rendered for the Cover block.
 *
 * @param {Object}   props                        The component props.
 * @param {Object}   props.attributes             The block's stored attributes.
 * @param {Function} props.setAttributes          Setter for the block's
 *                                                attributes.
 * @param {Function} props.onSelectMedia          Handler invoked when the
 *                                                user selects a media item.
 * @param {Object}   props.currentSettings        Source-agnostic snapshot of
 *                                                the cover's render state
 *                                                (`url`, `hasInnerBlocks`, …).
 * @param {Function} props.toggleUseFeaturedImage Handler toggling
 *                                                `useFeaturedImage`.
 * @param {Function} props.onClearMedia           Handler that resets the
 *                                                media attributes back to
 *                                                their unbound default.
 * @param {Function} props.onSelectEmbedUrl       Handler invoked when the
 *                                                user picks an embed URL
 *                                                from the "Embed video from
 *                                                URL" affordance.
 * @param {string}   props.blockEditingMode       Editing mode reported by
 *                                                `useBlockEditingMode`.
 * @param {boolean}  props.bindingActive          Whether the cover has an
 *                                                active block binding on
 *                                                `id` / `url`. When `true`,
 *                                                the entire
 *                                                `<MediaReplaceFlow>`
 *                                                affordance (including its
 *                                                "Embed video from URL"
 *                                                child item) is omitted from
 *                                                the toolbar — a literal DOM
 *                                                absence rather than a
 *                                                `disabled` state. Embed-video
 *                                                covers force
 *                                                `bindingActive=false`
 *                                                upstream, so the affordance
 *                                                remains accessible on the
 *                                                AC-21 population.
 */
export default function CoverBlockControls( {
	attributes,
	setAttributes,
	onSelectMedia,
	currentSettings,
	toggleUseFeaturedImage,
	onClearMedia,
	onSelectEmbedUrl,
	blockEditingMode,
	bindingActive,
} ) {
	const {
		contentPosition,
		id,
		useFeaturedImage,
		minHeight,
		minHeightUnit,
		backgroundType,
	} = attributes;
	const { hasInnerBlocks, url } = currentSettings;

	const [ prevMinHeightValue, setPrevMinHeightValue ] = useState( minHeight );
	const [ prevMinHeightUnit, setPrevMinHeightUnit ] =
		useState( minHeightUnit );
	const [ isEmbedUrlInputOpen, setIsEmbedUrlInputOpen ] = useState( false );
	const isMinFullHeight =
		minHeightUnit === 'vh' &&
		minHeight === 100 &&
		! attributes?.style?.dimensions?.aspectRatio;
	const isContentOnlyMode = blockEditingMode === 'contentOnly';

	const toggleMinFullHeight = () => {
		if ( isMinFullHeight ) {
			// If there aren't previous values, take the default ones.
			if ( prevMinHeightUnit === 'vh' && prevMinHeightValue === 100 ) {
				return setAttributes( {
					minHeight: undefined,
					minHeightUnit: undefined,
				} );
			}

			// Set the previous values of height.
			return setAttributes( {
				minHeight: prevMinHeightValue,
				minHeightUnit: prevMinHeightUnit,
			} );
		}

		setPrevMinHeightValue( minHeight );
		setPrevMinHeightUnit( minHeightUnit );

		// Set full height, and clear any aspect ratio value.
		return setAttributes( {
			minHeight: 100,
			minHeightUnit: 'vh',
			style: cleanEmptyObject( {
				...attributes?.style,
				dimensions: {
					...attributes?.style?.dimensions,
					aspectRatio: undefined, // Reset aspect ratio when minHeight is set.
				},
			} ),
		} );
	};

	return (
		<>
			{ ! isContentOnlyMode && (
				<BlockControls group="block">
					<BlockAlignmentMatrixControl
						label={ __( 'Change content position' ) }
						value={ contentPosition }
						onChange={ ( nextPosition ) =>
							setAttributes( {
								contentPosition: nextPosition,
							} )
						}
						isDisabled={ ! hasInnerBlocks }
					/>
					<FullHeightAlignmentControl
						isActive={ isMinFullHeight }
						onToggle={ toggleMinFullHeight }
						isDisabled={ ! hasInnerBlocks }
					/>
				</BlockControls>
			) }
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
			{ isEmbedUrlInputOpen && (
				<EmbedVideoUrlInput
					onSubmit={ ( embedUrl ) => {
						onSelectEmbedUrl( embedUrl );
					} }
					onClose={ () => setIsEmbedUrlInputOpen( false ) }
					initialUrl={
						backgroundType === EMBED_VIDEO_BACKGROUND_TYPE
							? url
							: ''
					}
				/>
			) }
		</>
	);
}
