// scripts/check-duplicates.mjs
const S = 'scripts/check-duplicates.mjs';
const uniq = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');
const pg = (body, path = '/') => `<!doctype html><html><body><header>nav</header><main>${body}</main></body></html>`;

export const duplicates = {
  name: 'duplicates',
  async run({ html, makeSite, run, expectRun }) {
    const go = (files, extra = []) => { const s = makeSite(files); return run(S, ['--dist', s.dist, ...extra]); };
    const A = uniq('alpha', 120), B = uniq('bravo', 120);

    expectRun('different pages score low, no warning', go({ 'a/index.html': pg(`<h1>A</h1><p>${A}</p>`), 'b/index.html': pg(`<h1>B</h1><p>${B}</p>`) }),
      { code: 0, includes: ['2 pages compared', '0 HIGH, 0 WARN'], excludes: ['HIGH\n', '  WARN'] });
    expectRun('same text with one word swapped scores HIGH but only warns', go({ 'a/index.html': pg(`<h1>Plumbing</h1><p>${A}</p>`), 'b/index.html': pg(`<h1>Hvac</h1><p>${A}</p>`) }),
      { code: 0, includes: ['HIGH', '1 HIGH'] });
    expectRun('--strict fails on HIGH', go({ 'a/index.html': pg(`<h1>Plumbing</h1><p>${A}</p>`), 'b/index.html': pg(`<h1>Hvac</h1><p>${A}</p>`) }, ['--strict']), { code: 1, includes: ['1 HIGH'] });

    const shared = uniq('shared', 200);
    expectRun('boilerplate-marked block is ignored', go({
      'a/index.html': pg(`<h1>A</h1><p>${A}</p><div data-boilerplate><div>${shared}</div><p>more</p></div>`),
      'b/index.html': pg(`<h1>B</h1><p>${B}</p><div data-boilerplate><div>${shared}</div><p>more</p></div>`),
    }), { code: 0, includes: ['0 HIGH, 0 WARN'] });
    expectRun('same shared block without the marker is flagged', go({
      'a/index.html': pg(`<h1>A</h1><p>${A}</p><div><div>${shared}</div><p>more</p></div>`),
      'b/index.html': pg(`<h1>B</h1><p>${B}</p><div><div>${shared}</div><p>more</p></div>`),
    }), { code: 0, includes: ['WARN'], excludes: ['0 HIGH, 0 WARN'] });

    expectRun('short pages are reported as not checked', go({ 'a/index.html': pg('<h1>A</h1><p>tiny</p>'), 'b/index.html': pg(`<h1>B</h1><p>${B}</p>`) }),
      { code: 0, includes: ['NOT CHECKED: /a/: only', '1 pages compared'] });
    expectRun('data-dup-exempt pages are skipped', go({ 'a/index.html': pg(`<h1>A</h1><p data-dup-exempt>${A}</p>`), 'b/index.html': pg(`<h1>B</h1><p>${B}</p>`) }),
      { code: 0, includes: ['marked data-dup-exempt'] });

    const v = (names, text) => pg(`<h1>x</h1><p>${text}</p>` + names.map((n) => `<span data-vendor="${n}"></span>`).join(''));
    expectRun('identical vendor sets warn', go({ 'a/index.html': v(['Abby', 'Ruby'], A), 'b/index.html': v(['Ruby', 'Abby'], B) }), { code: 0, includes: ['WARN identical vendor set'] });
    expectRun('different vendor sets do not warn', go({ 'a/index.html': v(['Abby', 'Ruby'], A), 'b/index.html': v(['Abby', 'Smith'], B) }), { code: 0, excludes: ['WARN identical vendor set'] });
    expectRun('missing vendor markers are reported as not checked', go({ 'a/index.html': pg(`<h1>A</h1><p>${A}</p>`), 'b/index.html': pg(`<h1>B</h1><p>${B}</p>`) }), { code: 0, includes: ['NOT CHECKED: vendor-set comparison'] });
    expectRun('404 page is ignored and one-page site is fine', go({ 'index.html': pg(`<h1>A</h1><p>${A}</p>`) }), { code: 0, includes: ['1 pages compared, 0 pairs'] });
  },
};
