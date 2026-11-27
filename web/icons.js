// Original pictograms generated with Genex; see assets/icons/provenance.json.
const names = new Set([
  'discover', 'portfolio', 'onchain', 'watchlist', 'sectors', 'tokens',
  'community', 'methodology', 'data', 'close', 'search', 'share', 'check',
  'menu', 'star-filled', 'network',
]);

export function icon(name) {
  const id = names.has(name) ? name : 'onchain';
  return `<i class="ui-icon ui-icon-${id}" data-icon="${id}" aria-hidden="true"></i>`;
}
