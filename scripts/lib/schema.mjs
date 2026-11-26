// JSON-LD rules for one built page. Returns { fails, warns, blocks }. Never edits anything.
// Sources: Plan build rules; skill Rule 12 and Phase 3 Step 5.
//  - FAQPage markup: banned (Google removed the rich result for all sites, S2).
//  - ProsCons / Author as @type: do not exist in Google's docs; use positiveNotes/negativeNotes and Person/Organization (S5, S6).
//  - positiveNotes + negativeNotes: at least 2 statements in total, text must match the visible page (S5).
//  - Self-made aggregateRating: banned (skill Rule 12 / Step 5).
//  - datePublished on a Review: house rule from the skill template, not a Google requirement.
//  - Product/Review markup on list or comparison pages: banned unless each item has a full on-page review (Step 5). Pages declare
//    themselves with data-page-type="list" (see README).
import { SITE } from './site.mjs';

const BANNED_TYPES = new Set(['FAQPage', 'ProsCons', 'Author']);

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
export const norm = (s) => decode(String(s)).replace(/\s+/g, ' ').trim().toLowerCase();
export function visibleText(html) {
  return norm(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '));
}

const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const typesOf = (n) => asArray(n['@type']).map(String);

function collectNodes(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => collectNodes(v, out));
  else if (value && typeof value === 'object') {
    if (value['@type']) out.push(value);
    Object.values(value).forEach((v) => collectNodes(v, out));
  }
  return out;
}
function hasKey(value, key) {
  if (Array.isArray(value)) return value.some((v) => hasKey(v, key));
  if (value && typeof value === 'object') return key in value || Object.values(value).some((v) => hasKey(v, key));
  return false;
}
function noteNames(list) {
  if (list === undefined) return null;
  const items = asArray(list).flatMap((l) => (l && typeof l === 'object' && l['@type'] === 'ItemList' ? asArray(l.itemListElement) : [null]));
  return items.map((i) => (i && typeof i === 'object' && typeof i.name === 'string' ? i.name : null));
}

export function checkSchema(path, html, pages) {
  const fails = [];
  const warns = [];
  const fail = (m) => fails.push(`schema: ${m}`);
  const warn = (m) => warns.push(`schema: ${m}`);
  const blocks = [];
  for (const m of html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { blocks.push(JSON.parse(m[1])); } catch (e) { fail(`invalid JSON-LD (${e.message})`); }
  }
  if (!blocks.length) return { fails, warns, blocks: 0 };

  const text = visibleText(html);
  const isList = /data-page-type="list"/.test(html);

  for (const b of blocks) {
    for (const root of asArray(b)) {
      const ctx = JSON.stringify(root && root['@context'] || '');
      if (!/schema\.org/.test(ctx)) fail('JSON-LD block without a schema.org @context');
    }
    if (hasKey(b, 'aggregateRating')) fail('aggregateRating found: self-made aggregate ratings are not allowed');
    for (const node of collectNodes(b)) {
      const types = typesOf(node);
      for (const t of types) if (BANNED_TYPES.has(t)) fail(`@type ${t} is not allowed (${t === 'FAQPage' ? 'FAQ rich result removed, use a plain-text FAQ' : 'use positiveNotes/negativeNotes in Review, author = Person or Organization'})`);
      if (isList && types.some((t) => t === 'Product' || t === 'Review')) fail(`${types.find((t) => t === 'Product' || t === 'Review')} markup on a page marked data-page-type="list"`);
      if (types.includes('Offer')) warn('Offer present: the price must be kept current (Amazon: only per skill Rule 14)');
      if (!types.includes('Review')) continue;

      const a = node.author;
      if (!a || typeof a !== 'object' || !['Person', 'Organization'].includes(a['@type']) || !a.name) fail('Review author must be an object of @type Person or Organization with a name');
      else if (typeof a.url === 'string' && a.url.startsWith(SITE)) {
        const p = new URL(a.url).pathname;
        if (!pages.has(p)) fail(`Review author url ${a.url} is not a built page`);
      }
      if (!node.datePublished) fail('Review without datePublished (house rule)');
      const rr = node.reviewRating;
      if (rr) {
        const v = Number(rr.ratingValue), lo = Number(rr.worstRating ?? 1), hi = Number(rr.bestRating ?? 5);
        if (!Number.isFinite(v) || v < lo || v > hi) fail(`reviewRating ${rr.ratingValue} outside ${lo}-${hi}`);
      }
      const pos = noteNames(node.positiveNotes), neg = noteNames(node.negativeNotes);
      if (pos === null && neg === null) { warn('Review has no positiveNotes/negativeNotes'); continue; }
      const names = [...(pos || []), ...(neg || [])];
      if (names.some((n) => n === null)) fail('positiveNotes/negativeNotes must be an ItemList of ListItem with a name');
      const good = names.filter(Boolean);
      if (good.length < 2) fail(`pros/cons need at least 2 statements in total (found ${good.length})`);
      for (const n of good) if (!text.includes(norm(n))) fail(`note not found in the visible page text: "${n}"`);
    }
  }
  return { fails, warns, blocks: blocks.length };
}
