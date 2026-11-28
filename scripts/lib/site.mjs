// Shared helpers for the checkers. Read-only: nothing here writes into dist/.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

export const SITE = 'https://pickupfinch.com';

export function parseArgs(argv, defaults = {}) {
  const out = { ...defaults, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

export function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Returns { files, pages } where pages maps URL path -> html (404 page is '/404.html').
export function loadSite(dist) {
  if (!existsSync(dist)) throw new Error(`${dist}/ missing: run build first`);
  const files = walk(dist);
  const pages = new Map();
  for (const f of files.filter((x) => x.endsWith('.html'))) {
    const rel = '/' + relative(dist, f).replace(/index\.html$/, '').replace(/\\/g, '/');
    pages.set(rel, readFileSync(f, 'utf8'));
  }
  return { files, pages };
}

// Affiliate host list: data/affiliate-hosts.json plus optional AFFILIATE_HOSTS env (comma separated).
// A missing or malformed file is an error, never an empty list: a silent empty list switched the
// rel=sponsored and disclosure checks off before this file existed.
export function loadAffiliateHosts(file) {
  if (!existsSync(file)) throw new Error(`affiliate hosts file missing: ${file}`);
  let data;
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`affiliate hosts file is not valid JSON: ${file}`); }
  if (!data || !Array.isArray(data.hosts)) throw new Error(`affiliate hosts file needs a "hosts" array: ${file}`);
  const hosts = [...data.hosts, ...(process.env.AFFILIATE_HOSTS || '').split(',')].map((h) => String(h).trim().toLowerCase()).filter(Boolean);
  for (const h of hosts) if (!/^[a-z0-9.-]+$/.test(h)) throw new Error(`invalid affiliate host "${h}" (hostname only, no scheme or path)`);
  return hosts;
}

export function hostMatches(hostname, hosts) {
  const h = hostname.toLowerCase();
  return hosts.some((x) => h === x || h.endsWith('.' + x));
}

export function externalLinks(html) {
  const out = [];
  for (const m of html.matchAll(/<a\s[^>]*href="(https?:\/\/[^"]+)"[^>]*>/gi)) {
    let u;
    try { u = new URL(m[1].replace(/&amp;/g, '&')); } catch { continue; }
    if (u.hostname === 'pickupfinch.com' || u.hostname === 'www.pickupfinch.com') continue;
    out.push({ url: u.href, host: u.hostname, tag: m[0], rel: (m[0].match(/rel="([^"]*)"/i) || [])[1] || '' });
  }
  return out;
}
