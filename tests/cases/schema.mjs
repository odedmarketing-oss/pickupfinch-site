// JSON-LD rules (scripts/lib/schema.mjs, run through check-dist).
const S = 'scripts/check-dist.mjs';
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const review = (over = {}) => ({
  '@context': 'https://schema.org', '@type': 'Product', name: 'Acme Desk',
  review: {
    '@type': 'Review', author: { '@type': 'Person', name: 'Jane', url: 'https://pickupfinch.com/author/jane/' },
    datePublished: '2026-11-26', reviewRating: { '@type': 'Rating', ratingValue: '4', bestRating: '5' },
    positiveNotes: { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Fast setup' }] },
    negativeNotes: { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Pricey overage' }] },
    ...over,
  },
});
const BODY = '<h1>Acme</h1><ul><li>Fast setup</li></ul><ul><li>Pricey overage</li></ul>';

export const schema = {
  name: 'schema',
  async run({ html, makeSite, run, expectRun }) {
    const AUTHOR = { 'author/jane/index.html': html({ path: '/author/jane/', body: '<h1>Jane</h1>' }) };
    const go = (page, extra = {}, pageOpts = {}) => {
      const s = makeSite({ 'index.html': html({ body: BODY, head: ld(page), ...pageOpts }), ...AUTHOR, ...extra });
      return run(S, ['--dist', s.dist, '--hosts', s.hosts]);
    };
    expectRun('valid review passes', go(review()), { code: 0, includes: ['schema: 1 of'] });
    expectRun('page without JSON-LD is fine', (() => { const s = makeSite({ 'index.html': html() }); return run(S, ['--dist', s.dist, '--hosts', s.hosts]); })(), { code: 0, includes: ['schema: 0 of'] });
    expectRun('invalid JSON fails', (() => { const s = makeSite({ 'index.html': html({ head: '<script type="application/ld+json">{oops</script>' }) }); return run(S, ['--dist', s.dist, '--hosts', s.hosts]); })(), { code: 1, includes: ['invalid JSON-LD'] });
    expectRun('missing @context fails', go({ ...review(), '@context': undefined }), { code: 1, includes: ['@context'] });
    expectRun('FAQPage fails', go({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [] }), { code: 1, includes: ['FAQPage is not allowed'] });
    expectRun('ProsCons type fails', go({ '@context': 'https://schema.org', '@type': 'ProsCons' }), { code: 1, includes: ['ProsCons is not allowed'] });
    expectRun('Author type fails', go({ '@context': 'https://schema.org', '@type': 'Author' }), { code: 1, includes: ['Author is not allowed'] });
    expectRun('self-made aggregateRating fails', go({ ...review(), aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.8', reviewCount: '12' } }), { code: 1, includes: ['aggregateRating'] });
    expectRun('string author fails', go(review({ author: 'Jane' })), { code: 1, includes: ['author must be an object'] });
    expectRun('missing datePublished fails', go(review({ datePublished: undefined })), { code: 1, includes: ['datePublished'] });
    expectRun('rating out of range fails', go(review({ reviewRating: { '@type': 'Rating', ratingValue: '9', bestRating: '5' } })), { code: 1, includes: ['outside 1-5'] });
    expectRun('only one pros/cons statement fails', go(review({ negativeNotes: undefined })), { code: 1, includes: ['at least 2 statements'] });
    expectRun('notes missing from the visible page fail', go(review({ positiveNotes: { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Invisible claim' }] } })), { code: 1, includes: ['Invisible claim'] });
    const noAuthorPage = makeSite({ 'index.html': html({ body: BODY, head: ld(review()) }) });
    expectRun('author url that is not a built page fails', run(S, ['--dist', noAuthorPage.dist, '--hosts', noAuthorPage.hosts]), { code: 1, includes: ['not a built page'] });
    expectRun('Review with no notes only warns', go(review({ positiveNotes: undefined, negativeNotes: undefined })), { code: 0, includes: ['no positiveNotes/negativeNotes'] });
    expectRun('Offer warns about price freshness', go({ ...review(), offers: { '@type': 'Offer', price: '10', priceCurrency: 'USD' } }), { code: 0, includes: ['Offer present'] });
    expectRun('Product markup on a list page fails', go(review(), {}, { body: BODY + '<div data-page-type="list"></div>' }), { code: 1, includes: ['data-page-type="list"'] });
    expectRun('entities in notes match the visible text', go(review({ positiveNotes: { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Q&A included' }] } }), {}, { body: '<h1>A</h1><ul><li>Q&amp;A included</li></ul><ul><li>Pricey overage</li></ul>' }), { code: 0 });
  },
};
