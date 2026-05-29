/**
 * WordPress dependencies
 */
import { getBlockBindingsSource } from '@wordpress/blocks';
import { useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';

// Canonical implementation lives at
// `packages/block-editor/src/utils/block-bindings.js` (not publicly re-exported
// from `@wordpress/block-editor`); duplicated inline here to avoid reaching
// through private APIs across package boundaries.
const PATTERN_OVERRIDES_SOURCE = 'core/pattern-overrides';

/**
 * Expands a `__default` pattern-overrides binding into per-attribute entries.
 *
 * Mirrors the semantics of `replacePatternOverridesDefaultBinding` in
 * `packages/block-editor/src/utils/block-bindings.js`: when the supplied
 * bindings object declares a `__default` entry sourced from
 * `core/pattern-overrides`, every supported attribute that does not already
 * have its own explicit binding receives a synthesised pattern-overrides
 * binding. Non-pattern-overrides bindings pass through unchanged.
 *
 * @param {?Record<string, Object>} bindings            A block's bindings from the metadata attribute.
 * @param {string[]}                supportedAttributes Attribute names eligible for expansion.
 *
 * @return {?Record<string, Object>} Either the input bindings (unchanged) or a
 *                                   new object whose keys cover every
 *                                   supported attribute.
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
 * The shape of state returned by {@link useCoverBindingState}.
 *
 * @typedef {Object} CoverBindingState
 * @property {boolean}          bindingActive       True iff (after `__default` expansion) both `id` AND `url` are bound to the same source instance (same source, same `args`) AND `attributes.backgroundType !== 'embed-video'`.
 * @property {boolean}          bindingUnresolvable True iff `metadata.bindings` carries any cover-relevant configuration but the binding is not active, OR the bound attachment resolved to a record that is not a media-library attachment.
 * @property {string|undefined} bindingResolvedUrl  URL resolved from the bound source (or `undefined` when no binding is active or the source is missing).
 */

/**
 * Computes Cover-block binding state in a single `useSelect` subscription.
 *
 * The hook is the client-side single source of truth for whether
 * a Cover's `id` and `url` attributes are bound, what the bound source
 * currently resolves to, and whether the bound configuration is itself
 * unresolvable (mismatched source, only one of `id`/`url` bound, the bound
 * `id` does not resolve to an attachment, etc.). Callers (e.g. `CoverEdit`)
 * destructure the returned object to drive every downstream binding-aware
 * derivation — derived URL, derived dim ratio, control gating, the
 * unresolvable-binding placeholder.
 *
 * @param {Object} options            Hook options.
 * @param {string} options.clientId   The Cover block's client id, forwarded to the source's `getValues` callback.
 * @param {Object} options.attributes The Cover block's current attributes (the hook reads `metadata`, `backgroundType`).
 * @param {Object} options.context    The full, undestructured block-context object received by `CoverEdit`; forwarded verbatim to the source's `getValues` callback because sources may declare `usesContext` for keys beyond `postId`/`postType`.
 *
 * @return {CoverBindingState} Plain-value binding state, recomputed on each render.
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
			const resolvedUrl = values?.url;
			const resolvedId = values?.id;
			const attachment = resolvedId
				? select( coreStore ).getEntityRecord(
						'postType',
						'attachment',
						resolvedId,
						{ context: 'view' }
				  )
				: undefined;
			return {
				bindingResolvedUrl: resolvedUrl,
				bindingResolvedAttachment: attachment,
			};
		},
		// The dependency array is intentionally narrow: source identity (which
		// determines whether to re-subscribe) plus the inputs forwarded into
		// `source.getValues`. `expanded.id` / `expanded.url` get a fresh
		// object identity on every render even when the underlying binding
		// instance is stable, so listing them would re-run the selector
		// spuriously without changing the result.
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

	const attachmentResolvedNotFound =
		bindingActive && bindingResolvedAttachment === null;

	const attachmentResolvedWrongType =
		bindingActive &&
		!! bindingResolvedAttachment?.type &&
		bindingResolvedAttachment.type !== 'attachment';

	const bindingUnresolvable =
		( hasAnyCoverBinding && ! bindingActive ) ||
		attachmentResolvedNotFound ||
		attachmentResolvedWrongType;

	return {
		bindingActive,
		bindingUnresolvable,
		bindingResolvedUrl,
	};
}
