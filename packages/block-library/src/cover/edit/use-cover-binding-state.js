/**
 * WordPress dependencies
 */
import { getBlockBindingsSource } from '@wordpress/blocks';
import { useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';

// Mirrors `replacePatternOverridesDefaultBinding` in
// `packages/block-editor/src/utils/block-bindings.js` (not publicly re-exported).
const PATTERN_OVERRIDES_SOURCE = 'core/pattern-overrides';

/**
 * Expands a `__default` pattern-overrides binding into per-attribute entries.
 * Non-pattern-overrides bindings pass through unchanged.
 *
 * @param {?Object}  bindings            A block's `metadata.bindings` map.
 * @param {string[]} supportedAttributes Attribute names eligible for expansion.
 * @return {?Object} Expanded bindings, or the input unchanged.
 */
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

/**
 * Client-side single source of truth for Cover-block binding state. Returns
 * `{ bindingActive, bindingUnresolvable, bindingResolvedUrl }` driving every
 * downstream binding-aware derivation in `CoverEdit`.
 *
 * @param {Object} options            Hook options.
 * @param {string} options.clientId   The Cover block's client id.
 * @param {Object} options.attributes The Cover block's attributes.
 * @param {Object} options.context    Block-context object forwarded to `getValues`.
 * @return {{ bindingActive: boolean, bindingUnresolvable: boolean, bindingResolvedUrl: (string|undefined) }} Binding state.
 */
export default function useCoverBindingState( {
	clientId,
	attributes,
	context,
} ) {
	const bindings = attributes.metadata?.bindings;

	const expanded = bindings
		? expandDefaultBinding( bindings, [ 'id', 'url' ] )
		: undefined;

	const sameArgs =
		!! expanded?.id &&
		!! expanded?.url &&
		JSON.stringify( expanded.id.args ?? null ) ===
			JSON.stringify( expanded.url.args ?? null );

	const bindingActive =
		!! expanded?.id &&
		!! expanded?.url &&
		expanded.id.source === expanded.url.source &&
		sameArgs &&
		attributes.backgroundType !== 'embed-video';

	const { bindingResolvedUrl, bindingResolvedAttachment } = useSelect(
		( select ) => {
			if ( ! bindingActive ) {
				return {
					bindingResolvedUrl: undefined,
					bindingResolvedAttachment: undefined,
				};
			}
			const source = getBlockBindingsSource( expanded.url.source );
			if ( ! source ) {
				return {
					bindingResolvedUrl: undefined,
					bindingResolvedAttachment: undefined,
				};
			}
			const values = source.getValues( {
				select,
				clientId,
				context,
				bindings: { id: expanded.id, url: expanded.url },
			} );
			const resolvedId = values?.id;
			return {
				bindingResolvedUrl: values?.url,
				bindingResolvedAttachment: resolvedId
					? select( coreStore ).getEntityRecord(
							'postType',
							'attachment',
							resolvedId,
							{ context: 'view' }
					  )
					: undefined,
			};
		},
		// `expanded.id` / `expanded.url` get fresh identities on every render;
		// listing them would re-run the selector without changing the result.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[
			bindingActive,
			expanded?.id?.source,
			expanded?.url?.source,
			clientId,
			context,
		]
	);

	if ( ! bindings ) {
		return {
			bindingActive: false,
			bindingUnresolvable: false,
			bindingResolvedUrl: undefined,
		};
	}

	const hasAnyCoverBinding =
		!! bindings.__default || !! bindings.id || !! bindings.url;

	const bindingUnresolvable =
		( hasAnyCoverBinding && ! bindingActive ) ||
		( bindingActive &&
			( bindingResolvedAttachment === null ||
				( !! bindingResolvedAttachment?.type &&
					bindingResolvedAttachment.type !== 'attachment' ) ) );

	return {
		bindingActive,
		bindingUnresolvable,
		bindingResolvedUrl,
	};
}
