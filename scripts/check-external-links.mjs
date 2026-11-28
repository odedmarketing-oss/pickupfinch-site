// External link check (skill checks-automation.md, C1). Reads dist/, fetches each unique external link, never edits anything.
// Rules: <= 1 request per second per host, plain identifiable user agent, robots.txt respected, Amazon never fetched,
// blocked/rate-limited/JavaScript-only answers are "unverified" (never PASS). All limits are [Rule of thumb].
//  affiliate link (host in data/affiliate-hosts.json): FAIL on 404/410/5xx/unreachable or more than 1 redirect hop;
//                                                       WARN on a possible soft-404 (homepage landing, search page, "not found" text).
//  other (citation) link: FAIL on 404/410/5xx/dead domain; WARN on more than 1 hop.
// Soft-404 detection is pattern matching [Guessing on accuracy], so it only warns.
// Usage: node scripts/check-external-links.mjs [--dist dist] [--hosts data/affiliate-hosts.json]
// Env: LINKCHECK_DELAY_MS (default 1000), LINKCHECK_TIMEOUT_MS (default 15000)
import { appendFileSync } from 'node:fs';
import { parseArgs, loadSite, loadAffiliateHosts, hostMatches, externalLinks } from './lib/site.mjs';

const args = parseArgs(process.argv.slice(2), { dist: 'dist', hosts: 'data/affiliate-hosts.json' });
const DELAY = Number(process.env.LINKCHECK_DELAY_MS ?? 1000);
const TIMEOUT = Number(process.env.LINKCHECK_TIMEOUT_MS ?? 15000);
const UA = 'PickupFinchLinkCheck/1.0 (+https://github.com/odedmarketing-oss/pickupfinch-site)';
const AMAZON = /(^|\.)amazon\.[a-z.]+$|^amzn\.(to|com|eu|asia)$|^a\.co$/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One reserved time slot per host, shared by every request (including redirect hops and robots.txt).
const nextAt = new Map();
async function slot(host) {
  const now = Date.now();
  const t = Math.max(now, nextAt.get(host) || 0);
  nextAt.set(host, t + DELAY);
  if (t > now) await sleep(t - now);
}

// ---- robots.txt -------------------------------------------------------------------------------
const robotsCache = new Map();
function parseRobots(text) {
  const groups = [];
  let cur = null, lastWasUA = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!lastWasUA || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasUA = true; continue; }
    lastWasUA = false;
    if (cur && (k === 'disallow' || k === 'allow')) cur.rules.push({ allow: k === 'allow', path: v });
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && 'pickupfinchlinkcheck'.includes(a))) || groups.find((g) => g.agents.includes('*'));
  const rules = (mine?.rules || []).filter((r) => r.path);
  const toRe = (p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  return (pathAndQuery) => {
    let best = null;
    for (const r of rules) if (toRe(r.path).test(pathAndQuery) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
    return !best || best.allow;
  };
}
function robotsFor(origin) {
  if (!robotsCache.has(origin)) {
    robotsCache.set(origin, (async () => {
      try {
        await slot(new URL(origin).host);
        const res = await fetch(origin + '/robots.txt', { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
        if (res.status !== 200) { res.body?.cancel(); return () => true; }
        return parseRobots((await readCapped(res, 200_000)) || '');
      } catch { return () => true; }
    })());
  }
  return robotsCache.get(origin);
}

async function readCapped(res, cap) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks = []; let n = 0;
  while (n < cap) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

// ---- one link ---------------------------------------------------------------------------------
const errCode = (e) => (e?.name === 'TimeoutError' ? 'timeout' : e?.cause?.code || e?.code || e?.message || 'error');

async function trace(link) {
  let url = link.url, hops = 0, method = link.affiliate ? 'GET' : 'HEAD';
  for (;;) {
    await slot(new URL(url).host);
    let res;
    try { res = await fetch(url, { method, redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html,*/*' }, signal: AbortSignal.timeout(TIMEOUT) }); }
    catch (e) { return { error: errCode(e), hops, url }; }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location'); res.body?.cancel();
      if (!loc) return { code: res.status, hops, url, noLocation: true };
      if (++hops > 6) return { loop: true, hops, url };
      url = new URL(loc, url).href; continue;
    }
    if (method === 'HEAD' && [400, 403, 405, 501].includes(res.status)) { res.body?.cancel(); method = 'GET'; continue; }
    let body = '';
    if (method === 'GET' && res.status === 200 && link.affiliate) body = await readCapped(res, 200_000); else res.body?.cancel();
    return { code: res.status, hops, url, body };
  }
}

function softSignals(link, r) {
  const sig = [];
  const orig = new URL(link.url), fin = new URL(r.url);
  if (fin.pathname === '/' && orig.pathname !== '/') sig.push('landed on the merchant homepage');
  if (/\/search\b|[?&](s|q|query|keyword)=/i.test(fin.pathname + fin.search) && !/\/search\b|[?&](s|q|query|keyword)=/i.test(orig.pathname + orig.search)) sig.push('landed on a search page');
  const title = (r.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const h1 = (r.body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '';
  if (/not found|no longer available|isn'?t available|does not exist|error 404|^\s*404\b/i.test((title + ' ' + h1).replace(/<[^>]+>/g, ' '))) sig.push('title/heading says not found or unavailable');
  return sig;
}
function jsOnly(r) {
  if (!/<script\b/i.test(r.body)) return false;
  const text = r.body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length < 200;
}

function judge(link, r) {
  const aff = link.affiliate;
  if (r.error) {
    if (['ENOTFOUND', 'ECONNREFUSED'].includes(r.error)) return { state: 'FAIL', detail: `dead domain or refused (${r.error})` };
    return aff ? { state: 'FAIL', detail: `unreachable (${r.error})` } : { state: 'UNVERIFIED', detail: `unreachable (${r.error})` };
  }
  if (r.loop) return { state: 'FAIL', detail: 'redirect loop' };
  if (r.noLocation) return { state: 'WARN', detail: `HTTP ${r.code} without a Location header` };
  if (r.code === 404 || r.code === 410) return { state: 'FAIL', detail: `HTTP ${r.code}` };
  if (r.code >= 500) return { state: 'FAIL', detail: `HTTP ${r.code}` };
  if (r.code >= 400) return { state: 'UNVERIFIED', detail: `blocked or rate limited (HTTP ${r.code})` };
  if (r.code >= 200 && r.code < 300) {
    if (r.hops > 1) return aff ? { state: 'FAIL', detail: `${r.hops} redirect hops (max 1)` } : { state: 'WARN', detail: `${r.hops} redirect hops` };
    if (aff) {
      const sig = softSignals(link, r);
      if (sig.length) return { state: 'WARN', detail: `possible soft-404: ${sig.join('; ')}` };
      if (jsOnly(r)) return { state: 'UNVERIFIED', detail: 'JavaScript-only page: availability cannot be verified' };
    }
    return { state: 'PASS', detail: `HTTP ${r.code}${r.hops ? ', 1 redirect' : ''}` };
  }
  return { state: 'UNVERIFIED', detail: `HTTP ${r.code}` };
}

async function checkOne(link) {
  if (AMAZON.test(link.host)) return { state: 'NOT CHECKED', detail: 'Amazon is never fetched (skill rule); check by hand or via Associates reports' };
  const u = new URL(link.url);
  const allowed = await (await robotsFor(u.origin))(u.pathname + u.search);
  if (!allowed) return { state: 'NOT CHECKED', detail: 'disallowed by robots.txt' };
  let r = await trace(link);
  if (r.error || r.code >= 500) { await sleep(Math.min(2000, DELAY * 2)); r = await trace(link); }
  return judge(link, r);
}

// ---- run ---------------------------------------------------------------------------------------
let pages, hosts;
try { ({ pages } = loadSite(args.dist)); hosts = loadAffiliateHosts(args.hosts); }
catch (e) { console.error(`LINK CHECK FAILED\n - ${e.message}`); process.exit(1); }

const links = new Map();
for (const [path, html] of pages) {
  for (const l of externalLinks(html)) {
    const k = l.url;
    if (!links.has(k)) links.set(k, { url: l.url, host: l.host, affiliate: hostMatches(l.host, hosts), pages: new Set() });
    links.get(k).pages.add(path);
  }
}
const list = [...links.values()];
if (!list.length) { console.log('LINK CHECK: no external links in the built pages, nothing to check.'); process.exit(0); }

const results = new Array(list.length);
let idx = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (idx < list.length) { const i = idx++; results[i] = { link: list[i], ...(await checkOne(list[i])) }; }
}));

const by = (s) => results.filter((r) => r.state === s);
const fails = by('FAIL'), p1 = fails.filter((r) => r.link.affiliate).length, p2 = fails.length - p1;
const nc = by('NOT CHECKED');
const where = (l) => { const p = [...l.pages]; return p[0] + (p.length > 1 ? ` (+${p.length - 1})` : ''); };
const lines = [];
lines.push(`RUN: ${new Date().toISOString().slice(0, 10)}, all pages | CHECKED: ${list.length - nc.length} links (${list.filter((l) => l.affiliate).length} affiliate), ${pages.size} pages | NOT CHECKED: ${nc.length} | UNVERIFIED: ${by('UNVERIFIED').length} | WARN: ${by('WARN').length} | FAILS: ${p1} P1, ${p2} P2`);
if (fails.length) {
  lines.push('| ID | Page | Item | Finding | Severity | Fix | Owner | Due | Status |', '|---|---|---|---|---|---|---|---|---|');
  for (const r of fails) {
    const sev = r.link.affiliate ? 'P1' : 'P2';
    lines.push(`| C1 | ${where(r.link)} | ${r.link.url} | ${r.detail} | ${sev} | ${r.link.affiliate ? 'find the new URL, else backup program or mark pick unavailable' : 'replace or remove the source'} | Oded | ${sev === 'P1' ? '<=7 days' : 'next monthly pass'} | open |`);
  }
}
for (const [label, s] of [['WARN', 'WARN'], ['UNVERIFIED', 'UNVERIFIED'], ['NOT CHECKED', 'NOT CHECKED']]) for (const r of by(s)) lines.push(`${label}: ${r.link.url} (${where(r.link)}): ${r.detail}`);
const text = lines.join('\n');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + text + '\n```\n');
process.exit(fails.length ? 1 : 0);
