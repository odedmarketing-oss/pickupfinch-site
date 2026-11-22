// Fail-safe build wrapper. A build is "production" only when explicitly marked, or when Cloudflare
// Workers Builds reports the main branch. Everything else (previews, local) is noindex.
import { spawnSync } from 'node:child_process';

if (!process.env.PUBLIC_ENV && process.env.WORKERS_CI === '1' && process.env.WORKERS_CI_BRANCH === 'main') {
  process.env.PUBLIC_ENV = 'production';
}
console.log(`build mode: ${process.env.PUBLIC_ENV === 'production' ? 'production (indexable)' : 'preview (noindex)'}`);
const r = spawnSync('npx', ['astro', 'build'], { stdio: 'inherit', env: process.env });
process.exit(r.status ?? 1);
