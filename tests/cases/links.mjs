// scripts/check-external-links.mjs against a local HTTP server (no internet needed).
import http from 'node:http';
const S = 'scripts/check-external-links.mjs';
const LONG = '<p>' + 'This is an ordinary page with enough visible text to not look like a JavaScript only shell. '.repeat(5) + '</p>';

function startServer() {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push({ m: req.method, u: req.url, ua: req.headers['user-agent'] });
    const send = (code, body = '', headers = {}) => { res.writeHead(code, { 'content-type': 'text/html', ...headers }); res.end(req.method === 'HEAD' ? undefined : body); };
    switch (req.url) {
      case '/robots.txt': return send(200, 'User-agent: *\nDisallow: /private\n', { 'content-type': 'text/plain' });
      case '/': return send(200, `<title>Home</title><h1>Home</h1>${LONG}`);
      case '/pass': return send(200, `<title>Product</title><h1>Product</h1>${LONG}`);
      case '/gone': return send(404, 'nope');
      case '/removed': return send(410, 'gone');
      case '/boom': return send(500, 'err');
      case '/blocked': return send(403, 'bot check');
      case '/limited': return send(429, 'slow down');
      case '/one-hop': return send(302, '', { location: '/pass' });
      case '/two-hops': return send(302, '', { location: '/one-hop' });
      case '/loop': return send(302, '', { location: '/loop' });
      case '/head405': return req.method === 'HEAD' ? send(405) : send(200, `<title>Ok</title><h1>Ok</h1>${LONG}`);
      case '/private': return send(200, 'secret');
      case '/soft': return send(200, `<title>Page not found</title><h1>Sorry</h1>${LONG}`);
      case '/to-home': return send(302, '', { location: '/' });
      case '/js': return send(200, '<html><body><div id="root"></div><script src="/app.js"></script></body></html>');
      default: return send(200, `<title>Misc</title><h1>Misc</h1>${LONG}`);
    }
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, hits, base: `http://127.0.0.1:${srv.address().port}` })));
}

export const links = {
  name: 'external-links',
  async run({ html, makeSite, runAsync, expectRun, check }) {
    const { srv, hits, base } = await startServer();
    const env = { LINKCHECK_DELAY_MS: '0', LINKCHECK_TIMEOUT_MS: '5000' };
    const page = (paths) => ({ 'index.html': html({ body: '<h1>x</h1>' + paths.map((p) => `<a href="${p.startsWith('http') ? p : base + p}">l</a>`).join('') }) });
    const go = async (paths, hostsOpt) => { const s = makeSite(page(paths), hostsOpt); return runAsync(S, ['--dist', s.dist, '--hosts', s.hosts], env); };

    // citation links (host not in the affiliate list)
    const c = await go(['/pass', '/gone', '/removed', '/boom', '/blocked', '/limited', '/one-hop', '/two-hops', '/loop', '/head405', '/private', 'https://www.amazon.com/dp/B000TEST']);
    expectRun('citation run reports the dead ones and exits 1', c, { code: 1, includes: [`${base}/gone | HTTP 404`, `${base}/removed | HTTP 410`, `${base}/boom | HTTP 500`, `${base}/loop | redirect loop`, 'FAILS: 0 P1, 4 P2'] });
    expectRun('citation: blocked and rate limited are UNVERIFIED, never PASS', c, { code: 1, includes: [`UNVERIFIED: ${base}/blocked`, 'blocked or rate limited (HTTP 403)', `UNVERIFIED: ${base}/limited`] });
    expectRun('citation: 2 hops only warns, 1 hop passes', c, { code: 1, includes: [`WARN: ${base}/two-hops`, '2 redirect hops'], excludes: [`${base}/one-hop`, `${base}/pass`] });
    expectRun('HEAD 405 falls back to GET and passes', c, { code: 1, excludes: [`${base}/head405`] });
    expectRun('robots.txt disallow is respected and reported', c, { code: 1, includes: [`NOT CHECKED: ${base}/private`, 'robots.txt'] });
    check('the disallowed URL was never requested', !hits.some((h) => h.u === '/private'));
    expectRun('Amazon is never fetched', c, { code: 1, includes: ['NOT CHECKED: https://www.amazon.com/dp/B000TEST', 'Amazon is never fetched'] });
    check('every request carries the identifiable user agent', hits.length > 0 && hits.every((h) => /PickupFinchLinkCheck/.test(h.ua || '')));
    check('a 500 is retried once', hits.filter((h) => h.u === '/boom').length === 2);

    expectRun('only healthy links: exit 0', await go(['/pass', '/one-hop']), { code: 0, includes: ['FAILS: 0 P1, 0 P2'] });
    expectRun('a blocked link alone does not fail the run', await go(['/blocked']), { code: 0, includes: ['UNVERIFIED: 1'] });
    expectRun('no external links: nothing to check, exit 0', await go([]), { code: 0, includes: ['no external links'] });

    // affiliate links (host listed)
    const a = await go(['/pass', '/one-hop', '/two-hops', '/gone', '/soft', '/to-home', '/js'], { hosts: ['127.0.0.1'] });
    expectRun('affiliate: dead link and 2 hops are P1 FAILs', a, { code: 1, includes: [`${base}/gone | HTTP 404`, `${base}/two-hops | 2 redirect hops (max 1)`, 'FAILS: 2 P1, 0 P2', '| P1 |'] });
    expectRun('affiliate: soft-404 patterns only warn', a, { code: 1, includes: [`WARN: ${base}/soft`, 'title/heading says not found', `WARN: ${base}/to-home`, 'landed on the merchant homepage'] });
    expectRun('affiliate: JavaScript-only page is UNVERIFIED', a, { code: 1, includes: [`UNVERIFIED: ${base}/js`, 'JavaScript-only'] });
    expectRun('affiliate: healthy links are not listed', a, { code: 1, excludes: [`${base}/pass `, `${base}/one-hop`] });

    // rate limit: 3 links on one host with a 300 ms gap -> robots.txt + 3 requests need >= 900 ms of slots
    const s = makeSite(page(['/pass', '/gone', '/blocked']));
    const t = await runAsync(S, ['--dist', s.dist, '--hosts', s.hosts], { ...env, LINKCHECK_DELAY_MS: '300' });
    check(`per-host rate limit holds (took ${t.ms} ms, need >= 800)`, t.ms >= 800);

    srv.close();
  },
};
