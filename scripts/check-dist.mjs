// Pre-publish gate. Reads ./dist and fails on rule breaks. Never edits anything.
// Rules from Project Plan: Ahrefs 8 static-site problems, title/meta limits, disclosure, rel=sponsored,
// no experience claims on research pages, tables in HTML, real 404 page.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';
const fails = [];
const fail = (page, msg) => fails.push(`${page}: ${msg}`);

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
if (!existsSync(DIST)) { console.error('dist/ missing: run build first'); process.exit(1); }

const files = walk(DIST);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const pages = new Map(); // url path -> html
for (const f of htmlFiles) {
  const rel = '/' + relative(DIST, f).replace(/index\.html$/, '').replace(/\\/g, '/');
  pages.set(rel === '/404.html' ? '/404.html' : rel, readFileSync(f, 'utf8'));
}

const isProd = process.env.PUBLIC_ENV === 'production';
const BANNED = /\b(we tested|we've tested|hands-on|in our testing|i used|i tested|we used)\b/i;
const AFFILIATE_HOSTS = (process.env.AFFILIATE_HOSTS || '').split(',').filter(Boolean);

for (const [path, html] of pages) {
  const is404 = path === '/404.html';
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  const canon = (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
  const robots = (html.match(/<meta name="robots" content="([^"]*)"/) || [])[1] || '';

  if (!title) fail(path, 'missing <title>');
  if (title.length > 60) fail(path, `title ${title.length} chars (>60)`);
  if (!desc) fail(path, 'missing meta description');
  if (desc.length > 155) fail(path, `meta description ${desc.length} chars (>155)`);
  if ((html.match(/<h1[ >]/g) || []).length !== 1) fail(path, 'must have exactly one <h1>');
  if (!is404) {
    if (!path.endsWith('/')) fail(path, 'URL without trailing slash');
    if (!canon) fail(path, 'missing canonical');
    else if (canon !== `https://pickupfinch.com${path}`) fail(path, `canonical mismatch: ${canon}`);
  }
  if (isProd && !is404 && /noindex/.test(robots)) fail(path, 'noindex on a production page');
  if (!isProd && !/noindex/.test(robots)) fail(path, 'preview build must be noindex');

  if (BANNED.test(html) && !/data-track="tested"/.test(html)) fail(path, 'experience phrase on a page not marked data-track="tested"');

  // affiliate links: rel must include sponsored; disclosure must exist before the first one
  const links = [...html.matchAll(/<a\s[^>]*href="(https?:\/\/[^"]+)"[^>]*>/g)];
  const aff = links.filter((m) => {
    try { return AFFILIATE_HOSTS.some((h) => new URL(m[1]).hostname.endsWith(h)); } catch { return false; }
  });
  for (const m of aff) if (!/rel="[^"]*sponsored/.test(m[0])) fail(path, `affiliate link without rel="sponsored": ${m[1]}`);
  if (aff.length) {
    const firstAt = html.indexOf(aff[0][0]);
    if (!/data-disclosure/.test(html.slice(0, firstAt))) fail(path, 'no data-disclosure element above the first affiliate link');
  }

  // internal links must resolve to a built page
  for (const m of html.matchAll(/<a\s[^>]*href="(\/[^"#?]*)"/g)) {
    const target = m[1];
    if (!pages.has(target) && !files.includes(join(DIST, target))) fail(path, `broken internal link ${target}`);
  }
}

if (!pages.has('/404.html')) fail('site', 'no 404.html');
if (!files.some((f) => /sitemap-index\.xml$/.test(f))) fail('site', 'no sitemap-index.xml');
const robotsTxt = existsSync(join(DIST, 'robots.txt')) ? readFileSync(join(DIST, 'robots.txt'), 'utf8') : '';
if (!/Sitemap:/i.test(robotsTxt)) fail('site', 'robots.txt missing Sitemap line');
if (/Disallow:\s*\/\s*$/m.test(robotsTxt)) fail('site', 'robots.txt blocks the whole site');

if (fails.length) { console.error(`CHECK FAILED (${fails.length})\n` + fails.map((x) => ' - ' + x).join('\n')); process.exit(1); }
console.log(`CHECK PASSED: ${pages.size} pages`);
