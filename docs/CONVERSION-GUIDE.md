# Reference-UI → Next.js Conversion Guide

Working notes from converting the landing page (`/`), captured so the
remaining pages (why-sift, platform/dispute-management,
solutions/trust-fraud-operations, company, investors, contact-us,
services) go faster and don't repeat the same mistakes. Read this
before starting a new page.

## The #1 rule: don't guess, grep the source

Almost every real bug in the landing page came from guessing a value
instead of pulling it from `reference-ui`. Screenshots lie (scaling,
compression, stale renders); the source CSS doesn't. Before styling
any section:

1. Find the section's markup in the relevant `reference-ui/<page>/index.html`.
   These files are near-single-line and huge (~5000 lines, 250-400KB).
   Don't `Read` the whole file — find the target line number first
   (`awk 'NR==N{print length}'` to check size, then `Read` with
   `offset`/`limit` if the line is under ~40KB), or use `Grep` with a
   bounded context pattern: `.{80}search term.{600}` with
   `output_mode: content`. If the match says `[Omitted long matching
   line]`, the line is too long for `-o` context extraction — read it
   directly by line number instead.
2. Find the CSS for the classes you see, in the same file's inline
   `<style id="bricks-frontend-inline-inline-css">` block (page-specific,
   generated per component instance) or in
   `wp-content/themes/bricks/assets/css/frontend-layer.min.css` (framework
   defaults). Pattern: `\.classname\.[a-zA-Z-]*\s*\{[^}]*\}` — the extra
   `\.[a-zA-Z-]*` is needed because Bricks always chains a second class
   (e.g. `.journey__steps.brxe-div{...}`), so a plain `\.journey__steps\s*\{`
   won't match anything.
3. **Per-instance IDs carry real styling too.** Bricks assigns each
   element a random hash ID (`id="brxe-xxxxxx"`) and sometimes puts
   CSS on that ID rather than the shared class — this is where several
   "invisible" style differences hid (e.g. the journey step labels'
   `text-transform:uppercase; font-size:var(--text-xs)` was on 5
   individual IDs, not on `.journey__heading`). If a shared-class
   search comes up empty or the CSS you found doesn't fully explain
   what you see in the screenshot, grep the specific element's `id=`
   value with bounded context and check for an ID-selector rule near
   the top of the inline style block.
4. Trust the grep result over your own visual read of a screenshot,
   but trust the **user's** screenshot of the live site over a stale
   local `reference-ui` mirror if the two genuinely disagree (see
   below) — the local mirror can be out of date relative to production.

## Environment facts that aren't obvious

- **`html { font-size: 62.5% }` is set by the framework CSS**, not the
  page. Every `rem`-based token (spacing, type scale, radii, container
  widths) in `style-manager.min.css` is authored against a 10px root,
  not the browser default 16px. This is already wired up in
  `globals.css` — don't remove it, and don't be surprised that plain......
  Tailwind spacing utilities (`p-4`, `gap-2`, etc.) are also affected
  since they're rem-based too. Prefer the project's own `--spacing-*`
  tokens or literal `px` arbitrary values over raw Tailwind spacing
  numbers when matching a specific source pixel value.
- **Next.js 16 / Tailwind v4** — this is newer than typical training
  data. `AGENTS.md` in the project root says to check
  `node_modules/next/dist/docs/` before assuming API behavior; it was
  right to do so once (breaking changes exist). Tailwind v4 is
  CSS-first config (`@theme` in `globals.css`, no `tailwind.config.ts`).
- **Dynamic Tailwind class strings don't work.** Tailwind's build-time
  scanner does static text matching on source files — it does not
  evaluate JS template literals. `` `group-hover:${variable}` `` will
  not generate the CSS even though the concatenated string is correct
  at runtime. Always store the **full literal class name** (e.g.
  `"group-hover:text-white"`) as a complete string somewhere in the
  source, even inside a lookup object.
- **Tailwind utility override order is not attribute order.** Putting
  a later class in the `className` string does not guarantee it wins
  over an earlier one with equal specificity — CSS cascade order
  depends on where Tailwind emitted the rule in its generated
  stylesheet, not where you wrote the class name. To force an
  override reliably, use the `!` important-prefix (`!px-7 !py-3.5`),
  or better, avoid the conflict by giving the component a variant/prop
  instead of fighting it via `className`.
- Fonts and local images ARE working correctly when they seem broken —
  verify with `curl` against the actual `/_next/static/...` paths
  before assuming a font/image pipeline bug (see Verification below).
  Every time this was suspected in this build, it turned out fine.

## Design tokens (already in `globals.css` / `tailwind theme`)

- Colors: `primary` (#2e69ff), `secondary` (#FF3B84, "pink"), `base`
  (#00124D, "navy" — visually reads as near-black but is NOT the same
  as `black`), `accent` (#79F7C6, mint), `neutral` (#FFCA36, yellow),
  plus `-l-1/-l-2/-d-1/-d-2` tint/shade variants for primary/secondary/base.
- Fonts: `font-sans` (Inter, body default), `font-heading` (Titillium
  Web, used by `h1-h6` automatically), `font-marker` (Permanent
  Marker, accent spans like `Grow` / `Difference` — **always pair with
  `font-weight: 400`**, it's baked into the `.font-marker` utility
  already; don't let it inherit the parent heading's bold or the
  single-weight font gets browser-synthesized fake-bold and looks
  thick/ugly).
- Breakpoints are the site's own, not Tailwind defaults: `sm:478px`,
  `md:767px`, `lg:992px`, `xl:1320px`.
- Spacing scale (`--spacing-xs..xxl`) and section spacing
  (`--section-space-xs..xxl`) are both fluid `clamp()` — use them via
  arbitrary values (`gap-[var(--spacing-m)]`) rather than reinventing
  fixed px gaps, *except* when the source has a literal hardcoded
  value (e.g. journey cards use hardcoded `20px`/`24px` gaps, not a
  token) — check the actual CSS rule for whether it references a
  `var(--space-*)` or a literal number, and match whichever it is.
- `Section` component (`components/ui/Section.tsx`) supports
  `spaceBottom` as an override independent of `space` (top) for
  asymmetric section padding — added mid-build when a symmetric
  `space="xxl"` was overcorrecting both directions at once.

## Component library reference

All in `src/components/`. Reuse these rather than rebuilding similar
patterns per-page:

- `ui/Button.tsx` — the shared CTA button. `variant`: solid/outline/plain.
  `tone`: primary/secondary/white/black. **Solid+secondary has a
  special-cased hover "sweep"** (black fill slides in left-to-right via
  an absolutely-positioned `group-hover:scale-x-100` span) — this is the
  confirmed real hover mechanic used site-wide for filled pink buttons.
  Outline buttons (pink border) sweep **pink**, not black, matching the
  footer/resource-grid pattern — see "Hover mechanics" below.
- `ui/Section.tsx` / `Container` — page-section wrapper with the
  gutter padding and fluid section spacing baked in. Any hand-rolled
  `<section>` that bypasses this **must** add `px-[var(--gutter)]`
  itself or text touches the viewport edge on mobile (missed once).
- `ui/Reveal.tsx` — scroll-in fade wrapper (IntersectionObserver),
  replaces the source's `data-interactions` enterView→fadeInUp.
- `sections/ZigZagBlock.tsx`, `StatBand.tsx` (`StatGrid`/`StatCallout`),
  `LogoMarquee.tsx` (`LogoMarquee`/`AwardMarquee`), `ResourceGrid.tsx`,
  `IconCardGrid.tsx`, `Tabs.tsx`, `TestimonialCard.tsx` — generic
  reusable marketing sections confirmed to repeat across pages per the
  original research. Check these first before writing new markup for
  what looks like a familiar pattern (stat band, card grid, testimonial,
  logo strip, tabs).
- `components/icons/index.tsx` — hand-rolled SVGs for the small fixed
  icon set actually used (arrow, chevron, close, menu, user, socials,
  send/external-link, check-circle). No icon library dependency.

## Hover mechanics (confirmed, don't re-derive)

- **Solid pink buttons** (Demo Sift, See Customer Stories): resting
  bg pink / text black. On hover: bg→black, text→white, both via the
  sweep-span mechanic with `duration-300`. This is baked into
  `Button` for `solid`+`secondary` — use the component, don't
  hand-roll.
- **Outline pink buttons** (View all resources, Explore the Sift
  platform, footer Contact us): resting = transparent bg, pink
  border, **white** text (not pink text — confirmed via direct user
  correction after initially guessing pink text). On hover: sweep
  **pink** fill in from the left, text stays white throughout (no
  color change on the text span). These three were hand-rolled
  per-instance rather than going through `Button`, so if you add a
  fourth instance of this exact style, copy the JSX structure
  verbatim from `Footer.tsx`'s "Contact us" link rather than
  reinventing it.
- The sweep span is always: `absolute inset-0 -z-10 origin-left
  scale-x-0 bg-{color} transition-transform duration-300 ease-out
  group-hover:scale-x-100`, sibling to a `relative z-10` text span,
  inside a `group relative isolate overflow-hidden` parent. `isolate`
  matters — it scopes the `-z-10` to the button's own local stacking
  context instead of the page.
- Cards (`IconCardGrid`, `ResourceGrid`) get a lift/border-color/image-zoom
  hover, not the sweep — that's specific to pill buttons.
- The original site's actual CSS has **no transition at all** on most
  buttons (instant color swap) — the sweep animation is a deliberate
  UX upgrade the user asked for, not something literally in the
  source. Don't "fix" it back to instant based on source archaeology;
  it's an intentional deviation.

## Mistakes made this build (so they aren't repeated)

- **Assumed values instead of measuring real image files.** Several
  images were given guessed `width`/`height` props that didn't match
  the actual file's aspect ratio, causing visible stretching (logo
  marquee, decorative blobs, hero graphics). Fix: a small Node script
  reading PNG/JPEG/SVG headers directly (see git history around the
  "audit image dimensions" commit) beats guessing every time. When in
  doubt, get the real pixel dimensions before writing the `<Image>` call.
- **Assumed a static layout technique when the source used absolute
  positioning.** The CTA banner's side image is `position: absolute;
  bottom:0; left:0; width:52%; height:auto` in the source — deliberately
  bleeding above its own section into the section above. A simple
  flexbox two-column guess looked "close enough" but was structurally
  wrong and took several rounds to correct. When a section's image
  looks like it's overlapping/bleeding past its container in the
  reference, check for `position: absolute` in the source before
  reaching for flexbox/grid.
- **Missed a whole section.** The QKS Group SPARK Matrix report promo
  card (between "The Sift Difference" and "Deliver Trust Across the
  Consumer Journey") was skipped entirely during the initial pass and
  only caught because the user flagged it directly by screenshot. When
  starting a new page, walk the *entire* section list from the research
  notes/outline before writing code, and check it off section-by-section
  against the live rendered page afterward — don't assume the outline
  from initial research was exhaustive.
- **Font weight on single-weight display fonts.** `.font-marker`
  (Permanent Marker) needs an explicit `font-weight: 400` because it
  inherits `bold` from the parent heading rule otherwise, and the
  browser fake-bolds a font that has no real bold weight, which reads
  as "thick/ugly" rather than a genuine style choice.
- **Text case/size assumptions.** Assumed the journey step labels
  ("Signup", "Login" etc.) were title-case body text because that's
  what looked "normal" — the actual spec is `uppercase` + `text-xs`
  (small!) via per-instance ID rules, not a shared class. This was
  also the real cause of cards looking "cramped" — the label text was
  rendering ~40% larger than spec, not a box-width problem. Don't
  patch the box when the actual bug is the type scale.
- **Mobile-only bugs from desktop-only fixes.** A layout that's
  visually correct on desktop via `lg:absolute` positioning can still
  render in the wrong DOM order on mobile if the JSX source order
  doesn't match the intended mobile stacking order — `position` only
  changes paint order, not flow order below the breakpoint where it's
  active. Put elements in DOM order matching the *mobile* reading
  order first, then use responsive classes to reposition for desktop.
- **A single `<br>` can't serve two breakpoints.** A heading that
  wraps to 2 lines on desktop and 3 lines on mobile (with a different
  break point) needs a responsive break — `<br
  className="lg:hidden" />` plus a `<span className="hidden
  lg:inline">` for the desktop-only joining space — not one hardcoded
  `<br>` plus hoping natural reflow handles the rest. A forced
  non-breaking space (`&nbsp;`) between two words to keep them
  glued together on desktop will actively break the mobile layout by
  preventing the wrap point mobile needs.
- **Conflating two unrelated fixes in one edit.** When a single `Edit`
  call changed both an unrelated heading and the button the user
  actually asked about, it read as introducing a new problem instead
  of fixing the requested one. Keep edits scoped to exactly what was
  asked; if two things genuinely need fixing in the same block, say so
  explicitly before doing both.
- **Re-verify before re-arguing.** More than once, a reported "bug"
  (button not sweeping, background showing wrong color) turned out to
  already be correct in the source file on disk — the discrepancy was
  a stale browser view, not a code regression. Before making another
  speculative change, do a fresh `curl` against the dev server and
  grep the actual served HTML/class list. If it matches what was
  intended, say so with the evidence instead of guessing at another change.

## CSS gotchas that cost real time (read before building overlays/nav)

- **`position: fixed` is trapped by any transformed ancestor.** The
  mobile menu panel "didn't work at all" (rendered as a broken sliver
  instead of a full-screen overlay) because it lived inside `<header>`,
  and the header always carries a `transform` class (`translate-y-0` /
  `-translate-y-full` for its hide-on-scroll behavior). Per spec, an
  ancestor with `transform` (also `filter`, `perspective`,
  `will-change: transform`, `contain: paint`) becomes the **containing
  block** for `position: fixed` descendants — so `fixed inset-0` sizes
  against that ancestor's box, not the viewport. Fix: render the
  overlay through a **React portal to `document.body`**
  (`createPortal(panel, document.body)`), guarded by a `mounted` state
  so SSR doesn't touch `document`. Any full-screen overlay/modal/drawer
  that will live under the header or any animated wrapper must be
  portaled. This is the single highest-value lesson from the mobile
  menu work — check for a transformed ancestor *first* when a `fixed`
  element is mysteriously mis-sized.
- **Conditional rendering kills enter/exit transitions.** `{open &&
  <Panel/>}` mounts/unmounts the node, so there's no "from" state for a
  CSS transition to animate — the panel just pops in/out. Keep the
  element permanently mounted and toggle a class
  (`translate-x-0` ↔ `-translate-x-full`) so the transition has both
  states to interpolate between. This mirrors how the source does it
  (`.mm__nav-items-wrapper` is always present, sitting at
  `translateX(-100%)` when closed).
- **The reference is responsive via `@container`, not just `@media`.**
  The live site wraps everything in `container-type: inline-size` with
  `container-name: q-docked-container` (from the Qualified live-chat
  dock) and keys its breakpoints to a `--qdvw` var
  (`calc(100dvw - dock-width)`). When you paste computed styles from
  devtools you'll see `@container q-docked-container (max-width: 767px)`
  — treat these exactly like the `max-width` media queries they'd be
  without the chat widget; our build just uses normal `@media`
  breakpoints (478/767/992/1320) and that's correct. Don't try to
  replicate the container-query plumbing.
- **Mobile-first DOM order + `order-*` base class.** `ZigZagBlock`
  reordered image/text only at `lg:` (`lg:order-1/2`), so every block
  fell back to raw DOM order on mobile (text-first) — but the reference
  always shows the image first on mobile regardless of desktop side
  (one source block even uses `flex-direction: column-reverse` on
  mobile purely to force that). Fix: set an unconditional base
  `order-1` (image) / `order-2` (text), then let `lg:order-*` drive the
  desktop left/right alternation. Always define the mobile order
  explicitly instead of relying on source JSX order.

## Content is source-of-truth too, not just styling

- **Body copy and testimonials were pulled from the wrong DOM nodes.**
  The three "Sift Difference" blocks initially had body text and
  image sides that didn't match the source — the copy had been taken
  from adjacent paragraphs and the image/text sides were all inverted.
  A Bricks container class named `left_content-right_image` does **not**
  reliably describe its own child order — two of three instances put
  the image figure first in the DOM. Verify the actual element sequence
  and the actual paragraph text against the source, don't infer layout
  from a class name or fill in plausible-sounding marketing copy.
- **"Decorative" assets are often real, named files.** The blue quote
  icon, the Harry's / Skillshare / Turo testimonial logos, and the
  `blue-large-pill.svg` glow behind the stats console were all real
  assets referenced by `data-src` in the source (lazy-loaded, so easy
  to miss), not things to approximate with a CSS blur or omit. When a
  screenshot shows a shape/logo/graphic you didn't add, grep the source
  for a `data-src`/`src` near that element before deciding it's
  decorative-and-skippable. Download the real file (`curl` from the
  live CDN URL in the `data-src`) and read its real dimensions.
- **Match the site's actual icon set.** The hamburger/close icons are
  Font Awesome 6 solid (`fa-bars` / `fa-times`); using thin hand-drawn
  stroke icons read as "off / not modern." When the source uses a known
  icon font, use that library's exact path data (FA6 solid paths are
  public) rather than approximating the glyph.

## Verification workflow (do this after every change)

1. `npx tsc --noEmit` — must be silent. This project has caught real
   bugs this way (typos in prop values like `space="2"`, missing
   imports).
2. `curl -s http://localhost:3000/<path> -o /tmp/check.html -w "HTTP
   %{http_code}\n"` then `grep -io "Application error\|Unhandled
   Runtime Error"` — confirms no runtime crash, not just a clean build.
3. For a specific fix, `grep -o` the relevant element's rendered
   `class="..."` out of the fetched HTML and eyeball it against what
   you intended — this is how several "is it actually broken"
   questions got resolved definitively instead of by more guessing.
4. Font/image pipeline doubts: `curl` the actual `/_next/static/...`
   or `/_next/image?...` URL directly and check the HTTP status before
   suspecting next/font or next/image of misbehaving.
5. Commit in reviewable batches (see below) — don't let a long session
   of small fixes go uncommitted; it becomes impossible to know what
   changed or to roll back a specific regression.

## Process notes

- No AI attribution in commit messages (project-wide rule, already in
  the global CLAUDE.md).
- Commit after each meaningfully-complete round of fixes, not just at
  the end of a whole page — this build went ~15 commits deep on the
  landing page alone across many small rounds of visual feedback, and
  having those checkpoints made "what did you just change" answerable
  in seconds instead of guesswork.
- When the user sends a `c` (correct/reference) vs `v` (ours) screenshot
  pair, or a single screenshot with red circles, treat that as the
  primary spec for that round — but cross-check against the actual
  source HTML/CSS before implementing when the visual read is
  ambiguous (spacing amounts, exact colors). Screenshots are best for
  "yes/no, does this match" and for catching things like missing
  sections or obviously wrong colors; the source is authoritative for
  exact pixel/rem values.
- This site has no visual/screenshot tool available on the assistant
  side in this environment — all verification is via `curl` + `grep`
  + `tsc`. Structural/content bugs (missing sections, wrong text,
  wrong links, wrong classes) are fully catchable this way. Purely
  visual spacing/proportion judgment calls are not, and need the
  user's screenshots to close the loop.
