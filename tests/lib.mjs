// Test helpers: build a throw-away dist/ tree from strings, run a script on it, assert on exit code and output.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';

export const ROOT = new URL('..', import.meta.url).pathname;

export function html({ path = '/', title = 'Test page', desc = 'A test page for the checker.', body = '<h1>Heading</h1><p>Text.</p>', head = '', robots = 'index, follow', canonical } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
    `<meta name="description" content="${desc}"><meta name="robots" content="${robots}">` +
    `<link rel="canonical" href="${canonical ?? 'https://pickupfinch.com' + path}">${head}</head><body><main>${body}</main></body></html>`;
}

const BASE = {
  '404.html': html({ path: '/404/', body: '<h1>Not found</h1>', canonical: 'https://pickupfinch.com/' }),
  'robots.txt': 'User-agent: *\nAllow: /\nSitemap: https://pickupfinch.com/sitemap-index.xml\n',
  'sitemap-index.xml': '<sitemapindex/>',
};

export function makeSite(files, { base = true, hosts: affHosts = ['partner.example'] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pf-test-'));
  const dist = join(dir, 'dist');
  for (const [name, content] of Object.entries({ ...(base ? BASE : {}), ...files })) {
    const p = join(dist, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  const hosts = join(dir, 'affiliate-hosts.json');
  writeFileSync(hosts, JSON.stringify({ hosts: affHosts }));
  return { dir, dist, hosts };
}

export function run(script, args, env = {}) {
  const r = spawnSync('node', [join(ROOT, script), ...args], { encoding: 'utf8', cwd: ROOT, env: { ...process.env, PUBLIC_ENV: 'production', ...env } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

export function runAsync(script, args, env = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn('node', [join(ROOT, script), ...args], { cwd: ROOT, env: { ...process.env, PUBLIC_ENV: 'production', ...env } });
    let out = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out, ms: Date.now() - t0 }));
  });
}

let passed = 0, failed = 0;
export function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? '\n' + detail : ''}`); }
}
export function expectRun(name, res, { code, includes = [], excludes = [] }) {
  const bad = [];
  if (res.code !== code) bad.push(`exit ${res.code}, expected ${code}`);
  for (const s of includes) if (!res.out.includes(s)) bad.push(`output lacks: ${s}`);
  for (const s of excludes) if (res.out.includes(s)) bad.push(`output should not contain: ${s}`);
  check(name, bad.length === 0, bad.length ? bad.join('\n') + '\n--- output ---\n' + res.out : '');
}
export const summary = () => { console.log(`\n${passed} passed, ${failed} failed`); return failed; };
