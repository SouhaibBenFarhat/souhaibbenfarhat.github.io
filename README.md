# Personal website — Souhaib Ben Farhat

A modern, multi-page personal site / web CV. **Astro + Tailwind**, static output, light + dark themes.
Tone: classy, refined, quietly confident. All public-facing copy is **conservative** (impact + skills;
no employer internals, ticket IDs, colleague names, or internal metrics).

## Architecture
**Single-page scroll** — `src/pages/index.astro` composes `src/components/sections/*` (Hero · About ·
Work · Experience · Skills · Contact). Everything is reachable by **scrolling**, not clicking; the nav is
a **scroll-spy** (in-page `#anchor` links that highlight the active section via IntersectionObserver),
with a scroll-progress bar and a back-to-top button (in `Base.astro`). Smooth scrolling + `scroll-mt-24`
offsets land sections below the sticky header. Content/data still come from `src/data/site.ts`.
(Rationale: recruiters skim by scrolling — a multi-page IA made reaching content a click, which most
never take. If Work grows large, split it back out to a dedicated `/work` page as a hybrid.)

## Develop
```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # -> dist/  (static, deploy this)
npm run preview    # serve the built dist/
```

## Edit content
All copy lives in **`src/data/site.ts`** (profile, highlights, projects, experience, skills, education,
languages, nav). Edit there — pages render from it. Keep phrasings public-safe (see
`../evidence/achievements.md` "Public-safe?" lines and `../docs/positioning.md`).

Design tokens (colors, fonts, shadows) are in `src/styles/global.css` (CSS variables, light + `.dark`).

## Design principles (hold these when editing)
- **One primary action:** the only solid (filled-accent) button is **Download CV** — repeated in the nav,
  hero, closing CTA band, About, Experience, and Contact. Everything else is outline (`.btn`) or a text
  link. Don't add a second solid button to a view.
- **Contrast:** keep text ≥ 4.5:1 (normal) / 3:1 (large/UI), in **both** themes. Note: the dark accent is
  bright — solid buttons use ink text in dark mode (`.dark .btn-solid { color:#08272a }`), not white.
- **Elevation = priority/interactivity,** not decoration: `--shadow-sm` resting cards → `--shadow-md` on
  hover (with a 2px lift); `--shadow-lg` only on the closing CTA band; the sticky header gains a shadow on
  scroll. The editorial `gap-px` grids (home "In short", About "How I work") stay intentionally flat.
- **Nav:** links are `font-medium` at `text-ink/75`, active = accent text **+** `bg-accent/10` pill (two
  cues), ≥44px tap targets; the mobile menu toggles `aria-expanded`.
- **Keyboard:** every interactive element has a visible `:focus-visible` ring.

## CV PDF
The downloadable CV is `public/Souhaib-Ben-Farhat-CV.pdf`, rendered from `../cv/cv.html`.
Regenerate after edits: `bash ../cv/build-pdf.sh` (uses headless Chrome). Source of truth for CV
*content* is `../cv/cv.md`; `cv.html` is the print-styled version.

## Deploy
Static site — host anywhere. Recommended **Vercel** (free, custom domain, fast):
1. Push this repo to GitHub (or `vercel` CLI from this folder).
2. On vercel.com → New Project → import → Framework preset **Astro** (build `npm run build`, output `dist`).
3. Add your custom domain in Vercel → Settings → Domains.
4. Set the final domain in `astro.config.mjs` (`site:`) before the production build (canonical URLs).

Alternatives: Netlify (build `npm run build`, publish `dist`) or GitHub Pages (set `site` + `base`).

> Note: deployment needs **your** hosting account — it can't be done for you. The site is build-ready.
