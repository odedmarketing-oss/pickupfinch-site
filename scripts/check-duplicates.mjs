// Near-duplicate score between built pages. Reads dist/, never edits anything.
// Method: 5-word shingles of each page's main text (template parts marked data-boilerplate are removed),
// Jaccard similarity for every pair of pages. Also flags identical vendor sets (data-vendor attributes).
// Purpose: scaled-content / doorway guard (Plan automation rule 1: each page needs its own vendor set,
// criteria and data, never one table with the industry name swapped).
// THRESHOLDS ARE A GUESS [Guessing]: no Google number exists. Warn-only until pages #3 vs #4 give real scores;
// then Oded sets the line. --strict makes HIGH fail the run.
// Usage: node scripts/check-duplicates.mjs [--dist dist] [--warn 0.35] [--high 0.5] [--strict]
import { parseArgs, loadSite } from './lib/site.mjs';
import { norm } from './lib/schema.mjs';

const args = parseArgs(process.argv.slice(2), { dist: 'dist', warn: '0.35', high: '0.5' });
const WARN = Number(args.warn), HIGH = Number(args.high), SHINGLE = 5, MIN_WORDS = 50;

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

// Remove every element carrying the attribute, including nested same-name children.
export function removeByAttr(html, attr) {
  const open = new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\s${attr}(?:[=\\s>/])[^>]*>`, 'i');
  for (let guard = 0; guard < 10000; guard++) {
    const m = open.exec(html);
    if (!m) break;
    const start = m.index, afterOpen = start + m[0].length, tag = m[1].toLowerCase();
    if (VOID.has(tag) || /\/>$/.test(m[0])) { html = html.slice(0, start) + ' ' + html.slice(afterOpen); continue; }
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    re.lastIndex = afterOpen;
    let depth = 1, end = html.length, t;
    while ((t = re.exec(html))) {
      depth += t[1] ? -1 : /\/>$/.test(t[0]) ? 0 : 1;
      if (depth === 0) { end = t.index + t[0].length; break; }
    }
    html = html.slice(0, start) + ' ' + html.slice(end);
  }
  return html;
}

export function mainWords(html) {
  let h = removeByAttr(html, 'data-boilerplate');
  const m = h.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (m) h = m[1];
  h = h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return norm(h).replace(/[^a-z0-9$%']+/g, ' ').trim().split(' ').filter(Boolean);
}
export function shingles(words) {
  const s = new Set();
  for (let i = 0; i + SHINGLE <= words.length; i++) s.add(words.slice(i, i + SHINGLE).join(' '));
  return s;
}
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
const vendorsOf = (html) => [...new Set([...html.matchAll(/data-vendor="([^"]+)"/gi)].map((m) => m[1].trim().toLowerCase()))].sort();

if (import.meta.url === `file://${process.argv[1]}`) {
  let pages;
  try { ({ pages } = loadSite(args.dist)); } catch (e) { console.error(`DUPLICATE CHECK FAILED\n - ${e.message}`); process.exit(1); }

  const items = [], notChecked = [];
  for (const [path, html] of pages) {
    if (path === '/404.html') continue;
    if (/data-dup-exempt/.test(html)) { notChecked.push(`${path}: marked data-dup-exempt`); continue; }
    const words = mainWords(html);
    if (words.length < MIN_WORDS) { notChecked.push(`${path}: only ${words.length} words of own text (<${MIN_WORDS})`); continue; }
    items.push({ path, sh: shingles(words), vendors: vendorsOf(html), html });
  }
  const noVendors = items.filter((i) => !i.vendors.length).length;

  const pairs = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    pairs.push({ a: items[i].path, b: items[j].path, score: jaccard(items[i].sh, items[j].sh), sameVendors: items[i].vendors.length >= 2 && items[i].vendors.join('|') === items[j].vendors.join('|') });
  }
  pairs.sort((x, y) => y.score - x.score);

  const high = pairs.filter((p) => p.score >= HIGH), warn = pairs.filter((p) => p.score >= WARN && p.score < HIGH), sv = pairs.filter((p) => p.sameVendors);
  console.log(`DUPLICATE CHECK: ${items.length} pages compared, ${pairs.length} pairs | warn >= ${WARN}, high >= ${HIGH} (thresholds are a guess; warn-only unless --strict)`);
  for (const p of pairs.filter((x) => x.score >= 0.2).slice(0, 15)) console.log(`  ${p.score.toFixed(2)}  ${p.a}  vs  ${p.b}${p.score >= HIGH ? '  HIGH' : p.score >= WARN ? '  WARN' : ''}`);
  for (const p of sv) console.log(`  WARN identical vendor set: ${p.a} vs ${p.b}`);
  if (items.length >= 2 && noVendors === items.length) console.log('NOT CHECKED: vendor-set comparison (no page has data-vendor markers yet)');
  for (const n of notChecked) console.log(`NOT CHECKED: ${n}`);
  console.log(`RESULT: ${high.length} HIGH, ${warn.length} WARN, ${sv.length} identical vendor set`);
  process.exit(args.strict && high.length ? 1 : 0);
}
