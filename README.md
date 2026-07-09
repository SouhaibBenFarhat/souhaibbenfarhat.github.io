# souhaibbenfarhat.github.io

Personal website & web CV of **Souhaib Ben Farhat** — Senior Fullstack Engineer (AI focus).

🔗 **Live:** https://souhaibbenfarhat.github.io

Built with **[Astro](https://astro.build) + [Tailwind CSS](https://tailwindcss.com)** — static output,
light + dark themes, single-page scroll layout with scroll-spy navigation. All content is data-driven
from a single file (`src/data/site.ts`).

## Develop

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # -> dist/  (static)
npm run preview    # serve the built dist/
```

## Structure

| Path | What |
|------|------|
| `src/pages/index.astro` | Composes the page from section components |
| `src/components/sections/*` | Hero · About · Work · Experience · Skills · Contact |
| `src/data/site.ts` | **All content** — profile, experience, skills, projects, etc. |
| `src/styles/global.css` | Design tokens (CSS variables, light + dark) |
| `public/Souhaib-Ben-Farhat-CV.pdf` | Downloadable CV |

To edit copy, change `src/data/site.ts` — the pages render from it.

## Deploy

Auto-deploys to **GitHub Pages** via `.github/workflows/deploy.yml` on every push to `main`
(build with `withastro/action`, publish with `actions/deploy-pages`).

---

© Souhaib Ben Farhat
