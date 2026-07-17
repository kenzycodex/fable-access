# Fable: Remaining Work Plan

Status snapshot and full implementation plan for finishing the Sift-to-Fable
rebrand, then building the Demo Bank and Institution Dashboard as part of
this same Next.js App Router project.

---

## Part A: Finish the marketing site rebrand

The foundation (colors, logo, fonts, metadata, routing, cookie consent,
footer) is done. `/why-fable` is fully rewritten and verified at zero Sift
mentions. Everything below is what's left, in priority order.

### A1. Fix internal CTA links that still act like external links

`dashboardCta` and `demoCta` now point to internal routes (`/dashboard/login`,
`/demo`), not external subdomains. But several places still render them with
`target="_blank" rel="noopener noreferrer"` and the `external` prop, which is
wrong for an internal route (it would pointlessly pop a new tab and skip
Next.js client-side navigation). Every one of these needs `external` removed
and, where the component supports it, switched to `next/link`:

- `src/app/page.tsx:47` and `:224` (Button `external`)
- `src/app/platform/page.tsx:62`, `:192`, `:236` (Button `external`)
- `src/app/platform/page.tsx:251` (ZigZagBlock cta `external: true`)
- `src/app/why-fable/page.tsx:129`, `:168` (ZigZagBlock cta `external: true`)
- `src/components/layout/Header.tsx` and `MobileMenu.tsx` (header CTA, check
  for hardcoded `target="_blank"` around `headerCta.demo`)
- `src/components/layout/Footer.tsx` (contact/dashboard button)
- `src/components/sections/IndustryTabs.tsx` (already fixed to a plain `<a>`
  without `target="_blank"` for the demo link, but not yet using `next/link`)

`Button.tsx`'s `external` prop is what decides `<a target="_blank">` vs
`<Link>`. Passing `external={false}` (or omitting it) is enough for most of
these once the hrefs are correct, since `Button` already branches on it.

### A2. Remove "What's New at Fable" (ResourceGrid) everywhere

Still present on `src/app/platform/page.tsx`. Already removed from `/` and
`/why-fable`. The underlying cards (`homeResourceCards` in `data/home.ts`)
are Sift's real report thumbnails (with the Sift logo baked into the images)
so removing the section is correct until there's real Fable content to put
there, not just a copy-fix. Once removed everywhere, `ResourceGrid.tsx` and
`homeResourceCards` become dead code, worth deleting rather than leaving
unused, unless a future content refresh wants to revive the component.

### A3. Remove "Take the Next Step" (CtaBanner) everywhere

Still present on `src/app/platform/page.tsx`. Already removed from
`/why-fable`. Same as above: `CtaBanner.tsx` becomes dead code once the last
usage is gone. Note `src/app/page.tsx` never used the shared `CtaBanner`
component, it has its own hand-rolled "Dare to grow differently" full-bleed
section instead. That section needs a full content rewrite (see A5), not
removal, since it has its own distinct layout and image.

### A4. Kill every remaining "Sift" mention

Current counts (rendered HTML, `grep -io sift`):

| Page | Count |
|---|---|
| `/` | 26 |
| `/why-fable` | 0 (done) |
| `/platform` | 36 |
| `/pricing` | 10 |

These come from `src/app/page.tsx`, `src/data/home.ts`,
`src/app/platform/page.tsx`, `src/data/trust-fraud-operations.ts`,
`src/app/pricing/page.tsx`, `src/data/services.ts`. All of it is copy that
needs the same treatment `/why-fable` already got: real Fable positioning,
grounded in the HackX docs, not a find-and-replace of the word "Sift".

### A5. Rewrite the landing page (`/`)

Full pass, section by section, same standard as `/why-fable`:

- **Hero**: currently "Stop Fraud Fast. Grow Revenue Faster." with Sift's G2
  badge and "hundreds of global brands" copy. Replace with Fable's actual
  tagline framing (the "security that disappears" idea, already used on
  `/why-fable`, needs a *different* angle here so the two pages don't repeat
  each other) plus a real CTA into the demo.
- **Stats section**: "~1T annual events, 700+ global brands" is Sift's real
  scale. Fable is pre-launch. Replace with the real NIBSS/FITC market
  numbers (₦25.85bn, 603%, 37% underreporting) already used on `/why-fable`,
  or pull different ones from the brief's stats table so the two pages don't
  duplicate the exact same three numbers.
- **Award marquee**: G2 badges are Sift's real awards. Remove entirely
  (`AwardMarquee` + `awardBadges` become unused on this page).
- **"The Sift Difference" zig-zag blocks**: rename and rewrite around
  Copilot/Shield/Ghost, reusing the three-block zig-zag pattern already
  proven on this page (image + testimonial slot). The testimonials
  (Turo/Harry's/Skillshare quotes with real logos) must go, Fable has no
  customers yet, do not invent quotes or logos. Either drop the testimonial
  slot from `ZigZagBlock` for these three instances or replace it with
  something honest (e.g. a stat callout instead of a fabricated quote).
- **QKS Group award card**: Sift's real Gartner/QKS analyst recognition.
  Remove, Fable has no analyst coverage yet.
- **"Deliver Trust Across the Consumer Journey" journey diagram**: this
  section's underlying idea (steps in a user journey) could map to a
  Copilot/Shield/Ghost decision flow (Signup → Login → Transaction → Flag →
  Ghost), but the current icons/labels are Sift's e-commerce journey steps.
  Needs new icons or a simplified version using existing icon assets.
- **"Dare to grow differently" full-bleed CTA**: rewrite copy, swap
  `action.png` (Sift's product illustration) for something Fable-appropriate
  or remove the image entirely and simplify the layout.
- **Brand logo marquee** ("Protecting 700+ Global Brands" + `brandLogos`):
  these are Sift's real customers (LinkMoney, Patreon, Hertz, etc.). Remove
  the whole strip, Fable has no customers to show yet.

### A6. Rewrite `/platform`

Currently still titled "Trust & Fraud Operations" (Sift's product page) with
36 Sift mentions across hero, testimonials, stats, and CTAs. This page
should become the technical/architecture deep-dive that complements
`/why-fable`'s pitch-level framing: the agent pipeline in more detail
(Copilot baseline engine, Shield's six signal layers, Ghost's cooling
window, Watch's passive monitoring), the API shape, and latency/reliability
claims that are real per the docs (sub-200ms Shield budget, NIP's 10-second
clearing window). Drop the "Legacy Solutions" zig-zag (Sift-specific
positioning against Sift's own old product) and the "10x increase in team
efficiency / Universe case study" stat (fabricated for Fable). The circular
"Start Your Digital Risk Assessment" CTA card can stay structurally, rewrite
copy to something like "Start Your Fraud Risk Assessment" pointing at the
demo.

### A7. Rewrite `/pricing`

Currently `data/services.ts` still describes Sift's Model
Training/Premium/Premier managed-services tiers with G2/Yelp/Turo/Harry's/
Patreon/Zillow client logos in the closing marquee (10 Sift mentions, plus
real customer logos that must go). The three-tier colored-card layout maps
well to the docs' actual pricing model: **Copilot** (base, always on),
**Shield** (add-on, per-transaction), **Ghost** (add-on, per-transaction),
possibly with the real target price point mentioned in the go-to-market
plan (₦100,000/month flat for Copilot + Shield up to 50,000 transactions)
if a concrete number is wanted, otherwise keep it qualitative ("Talk to us
for pricing") since Fable has no public price list yet. Remove the client
logo marquee entirely.

### A8. Sitewide sweep before calling the rebrand done

- Zero "Sift" mentions anywhere (rendered HTML, all 4 pages)
- Zero double-dashes (`--`) in any copy string (data files and inline JSX
  text), already clean on `/why-fable`
- Zero Claude/Anthropic model-family analogies in copy
- Zero HackX/Union Bank/hackathon references anywhere
- Zero fabricated customer names, quotes, logos, or award badges
- Every CTA button routes to either `/dashboard/login` or `/demo`, using
  internal `Link` navigation, not `target="_blank"`
- `npx tsc --noEmit` clean, all four routes return 200 with no runtime
  error strings

---

## Part B: Build the Demo Bank (`/demo/*`)

Per the HackX brief, this is the actual judged deliverable, a mobile-first
interactive prototype. Building it as routes inside this same app (not a
separate project) per your direction. It's a genuinely different kind of UI
(app-shell, not marketing page), so the plan below deliberately introduces a
separate layout rather than trying to force it through the marketing
`Header`/`Footer`.

### B1. Route structure

```
src/app/demo/
├── layout.tsx           # app-shell layout: no marketing Header/Footer,
│                         # own status-bar-style top bar, bottom tab nav
├── page.tsx              # Home/Dashboard screen
├── transfer/
│   └── page.tsx          # Transfer input screen
├── result/
│   └── page.tsx           # PASS / FLAG / BLOCK result (reads a query param
│                           # or client state for which state to render)
├── ghost/
│   └── page.tsx           # Ghost cooling-window screen
└── transparency/
    └── page.tsx           # "What Fable Knows" panel
```

### B2. What each screen needs (from the brief's UX spec)

1. **Home**: account balance card (purple gradient per the brief's palette),
   "Secured by Fable" badge, Send/Receive/Fable quick actions, a 2-up stats
   row (threats blocked, latency), recent transactions list with a
   `✓ Fable` badge per row.
2. **Transfer**: recipient picker (3 seeded contacts, one deliberately
   "Unknown"), a verify-account animation, amount field with quick-amount
   chips, narration field with a visible hint ("try ‘urgent help abeg’"),
   channel selector (App/USSD/Web), submit button with a fake 1.4s loading
   state.
3. **Result**: three states behind one screen. PASS = green flash + shield
   icon + low risk score. FLAG/BLOCK = animated risk score counter (0 to
   final value over ~800ms, this is the component worth the most build
   effort), staggered signal cards, a plain-language explanation box, a
   primary "Cancel" action and a secondary "Send Anyway → Ghost" link.
4. **Ghost**: real-time countdown timer (color shifts cyan → amber → red as
   time runs out), a progress bar in sync, Cancel (green, primary) and
   Confirm (quiet text link) actions.
5. **Transparency**: toggle list (typical range, active hours, trusted
   recipients, known devices, channel) where each toggle updates a
   client-side "risk preview" score live, plus a "what we never store"
   list.

### B3. Data layer for the demo

No real backend is required for this to be a working demo, the brief
explicitly says the risk-preview math is "client-side, not a real API call."
A `src/app/demo/lib/` module with:

- A seeded synthetic user (the "90 days of history" the brief describes,
  hardcoded, not generated at runtime)
- A pure function `scoreTransaction(input)` implementing the six-signal
  scoring logic from the brief (amount anomaly, new recipient, time
  anomaly, channel risk, narration keyword match, NIP code) entirely
  client-side
- If a real backend does get built later (the FastAPI service described in
  the docs), this module is exactly what gets swapped for a `fetch()` call,
  the screen components shouldn't need to change

### B4. Design system reuse

This should NOT reuse the marketing `Header`/`Footer`/`Section`/`Container`
components, they're built for a scrolling marketing page, not an app shell.
Reuse instead:

- Color tokens from `globals.css` (already Fable's palette)
- `Button.tsx`'s sweep-hover mechanic and pill shape for the primary actions
- The `Reveal` component for staggered signal-card entrances
- A new small set of demo-only components (`RiskScoreCounter`,
  `SignalCard`, `GhostTimer`, `FableStatusBadge`, `TransparencyToggle`)
  living in `src/components/demo/`, styled consistently with the existing
  design tokens but laid out for a 375px-first app shell, not a responsive
  marketing page

---

## Part C: Build the Institution Dashboard (`/dashboard/*`)

Lower priority than the demo bank per the brief's own phasing (the demo is
what judges test live; the dashboard is the B2B admin surface). Still worth
scaffolding now that `/dashboard/login` is a real link pointing at it.

### C1. Route structure

```
src/app/dashboard/
├── layout.tsx            # authenticated app-shell: sidebar nav, differs
│                          # from both the marketing layout and the demo's
│                          # mobile-first shell (this one is desktop-first)
├── login/
│   └── page.tsx           # the actual /dashboard/login every CTA points to
├── page.tsx                # Overview screen
├── transactions/
│   └── page.tsx            # Transaction Explorer
├── alerts/
│   └── page.tsx             # Watch Alerts
├── intelligence/
│   └── page.tsx             # Intelligence screen (scam pattern library,
│                             # fraud signal graph, channel breakdown)
├── compliance/
│   └── page.tsx              # Compliance screen (CSAT data, board report,
│                              # incident log, audit trail)
└── settings/
    └── page.tsx               # Institution profile, agent toggles, API
                                 # keys, webhooks, billing
```

### C2. Sequencing recommendation

Build `/dashboard/login` first and nothing else, since it's the literal
target of every "Dashboard" button sitewide right now, a working login
screen (even against a stub/demo institution, as you mentioned) closes the
loop on every CTA before anything else in the dashboard needs to exist. The
other six screens can follow in the order the brief's own phase table lists
them: Overview → Transaction Explorer → Watch Alerts → Intelligence →
Compliance → Settings.

### C3. One demo institution end-to-end

Per your direction: for now, `/dashboard/login` authenticates against a
single seeded demo institution (not a real multi-tenant auth system), and
that same institution's data is what the demo bank's transactions actually
populate, so a judge can complete a transfer in `/demo`, then log into
`/dashboard` and see that exact transaction in the Transaction Explorer.
That link (demo bank writes, dashboard reads) is worth building deliberately
rather than having the two be disconnected mock surfaces, it's the detail
that makes the "banks plug in once" pitch feel real instead of staged.

---

## Suggested order of operations

1. Finish Part A (A1 through A8), the marketing site should be fully
   Fable-branded and internally consistent before building net-new surfaces
   on top of it
2. Part B (Demo Bank), this is what's actually judged
3. `/dashboard/login` only, to close the loop on every CTA
4. Remaining Part C dashboard screens, in the phase order above, time
   permitting
