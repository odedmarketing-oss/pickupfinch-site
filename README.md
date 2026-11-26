# pickupfinch-site

Public site code for pickupfinch.com (Astro, static, Cloudflare Workers). Operations live in the private pickupfinch-ops repo.

## Checks

| Command | What it does | Blocks merge? |
|---|---|---|
| `npm run ci` | build + `check-dist` (page rules, affiliate rules, JSON-LD schema) + `check-duplicates` (warn-only) + self-test | Yes (required check `build-and-check`) |
| `npm test` | proves every rule fails a bad page and passes a good one (fixtures live in `tests/`, never in the build) | Inside `npm run ci` |
| `npm run check:links` | external link check: workflow `Lab checks`, weekly + on pull requests | No |
| Lighthouse CI (`lighthouserc.json`) | Core Web Vitals lab test, workflow `Lab checks` | No |

Markers a page template can use (all optional, none change what readers see):

- `data-disclosure`: the affiliate disclosure element; must come before the first affiliate link.
- `data-track="tested"`: marks a block where "we tested" phrases are allowed (tested track only).
- `data-page-type="list"`: marks a list/comparison page; Product/Review JSON-LD is then a failure.
- `data-boilerplate`: on template parts repeated across pages (method box, disclosure); ignored by the near-duplicate score.
- `data-vendor="Name"`: on each vendor in a table; pages with an identical vendor set get a warning.
- `data-dup-exempt`: skips a page in the near-duplicate score (trust and legal pages).

Affiliate link hosts live in `data/affiliate-hosts.json`. Add a host in the same PR that adds its first link.
