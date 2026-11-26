// Self-test: every rule must fail a bad page and pass a good one. Run: npm test
// Fixtures are built in a temp folder and never reach dist/ or the live site.
import { html, makeSite, run, expectRun, summary } from './lib.mjs';
import { dist } from './cases/dist.mjs';
import { schema } from './cases/schema.mjs';
import { duplicates } from './cases/duplicates.mjs';

const cases = [dist, schema, duplicates];
const only = process.argv[2];
for (const c of cases) {
  if (only && c.name !== only) continue;
  console.log(c.name);
  await c.run({ html, makeSite, run, expectRun });
}
process.exit(summary() ? 1 : 0);
