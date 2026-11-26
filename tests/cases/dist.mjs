// Rules in scripts/check-dist.mjs (basic page rules + affiliate hosts).
const S = 'scripts/check-dist.mjs';
export const dist = {
  name: 'check-dist',
  async run({ html, makeSite, run, expectRun }) {
    const go = (files, env) => { const s = makeSite(files); return run(S, ['--dist', s.dist, '--hosts', s.hosts], env); };
    const AFF = '<a href="https://partner.example/go" rel="sponsored nofollow">Try it</a>';

    expectRun('good home page passes', go({ 'index.html': html() }), { code: 0, includes: ['CHECK PASSED'] });
    expectRun('title over 60 chars fails', go({ 'index.html': html({ title: 'x'.repeat(61) }) }), { code: 1, includes: ['title 61 chars'] });
    expectRun('meta over 155 chars fails', go({ 'index.html': html({ desc: 'x'.repeat(156) }) }), { code: 1, includes: ['meta description 156'] });
    expectRun('two H1 fails', go({ 'index.html': html({ body: '<h1>A</h1><h1>B</h1>' }) }), { code: 1, includes: ['exactly one <h1>'] });
    expectRun('broken internal link fails', go({ 'index.html': html({ body: '<h1>A</h1><a href="/nope/">x</a>' }) }), { code: 1, includes: ['broken internal link /nope/'] });
    expectRun('canonical mismatch fails', go({ 'index.html': html({ canonical: 'https://pickupfinch.com/other/' }) }), { code: 1, includes: ['canonical mismatch'] });
    expectRun('noindex on production fails', go({ 'index.html': html({ robots: 'noindex, nofollow' }) }), { code: 1, includes: ['noindex on a production page'] });
    expectRun('index on preview build fails', go({ 'index.html': html() }, { PUBLIC_ENV: '' }), { code: 1, includes: ['preview build must be noindex'] });
    expectRun('experience phrase fails', go({ 'index.html': html({ body: '<h1>A</h1><p>We tested it.</p>' }) }), { code: 1, includes: ['experience phrase'] });
    expectRun('experience phrase allowed on tested page', go({ 'index.html': html({ body: '<h1>A</h1><p data-track="tested">We tested it.</p>' }) }), { code: 0 });

    expectRun('affiliate link without rel=sponsored fails', go({ 'index.html': html({ body: '<h1>A</h1><div data-disclosure>Ad</div><a href="https://partner.example/go">x</a>' }) }), { code: 1, includes: ['rel="sponsored"'] });
    expectRun('affiliate link without disclosure above fails', go({ 'index.html': html({ body: `<h1>A</h1>${AFF}` }) }), { code: 1, includes: ['data-disclosure'] });
    expectRun('disclosure after the link still fails', go({ 'index.html': html({ body: `<h1>A</h1>${AFF}<div data-disclosure>Ad</div>` }) }), { code: 1, includes: ['data-disclosure'] });
    expectRun('affiliate link with rel and disclosure passes', go({ 'index.html': html({ body: `<h1>A</h1><div data-disclosure>Ad</div>${AFF}` }) }), { code: 0 });
    expectRun('affiliate subdomain is matched', go({ 'index.html': html({ body: '<h1>A</h1><a href="https://track.partner.example/x">x</a>' }) }), { code: 1, includes: ['rel="sponsored"'] });
    expectRun('non-affiliate external link is not an affiliate link', go({ 'index.html': html({ body: '<h1>A</h1><a href="https://other.example/x">x</a>' }) }), { code: 0 });

    const noFile = makeSite({ 'index.html': html() });
    expectRun('missing affiliate hosts file fails (never silently empty)', run(S, ['--dist', noFile.dist, '--hosts', noFile.dir + '/nope.json']), { code: 1, includes: ['affiliate hosts file missing'] });
    const badHost = makeSite({ 'index.html': html() });
    expectRun('real repo hosts file loads', run(S, ['--dist', badHost.dist]), { code: 0, includes: ['affiliate host list is empty'] });
  },
};
