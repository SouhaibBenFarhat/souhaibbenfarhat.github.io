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
| `src/components/Chat/ChatWidget.tsx` | AI chat island — talks to the backend (see below) |
| `src/lib/api-types.ts` | **Generated** API types — do not edit by hand (see below) |
| `public/Souhaib-Ben-Farhat-CV.pdf` | Downloadable CV |

To edit copy, change `src/data/site.ts` — the pages render from it.

## API types (generated from the backend)

The chat widget talks to [**portfolio-backend**](https://github.com/SouhaibBenFarhat/portfolio-backend)
(Django). Rather than hand-write the request/response shapes, we **generate** them from that
service's OpenAPI spec, so the frontend types can't drift from the real API.

`src/lib/api-types.ts` is produced by [`openapi-typescript`](https://openapi-ts.dev) from the
backend's committed [`openapi.yaml`](https://github.com/SouhaibBenFarhat/portfolio-backend/blob/main/openapi.yaml).
**Never edit it by hand** — regenerate instead:

```bash
npm run gen:api    # openapi-typescript <backend openapi.yaml> -> src/lib/api-types.ts
```

Use the types over `fetch` — the spec carries each endpoint's method, params, and response
shapes (e.g. the SSE `ChatStreamFrame` union and the `ConversationRestore` shape):

```ts
import type { paths, components } from './lib/api-types';

type Restore = paths['/chat/conversations/{conversation_id}/']['get']['responses'][200]['content']['application/json'];
type Frame = components['schemas']['ChatStreamFrame']; // conversation-id | text | tool | error | done
```

### Kept in sync automatically

The two repos stay aligned without anyone remembering to run the command:

```
backend endpoint change → openapi.yaml changes → merge to backend main
        │
        └─(repository_dispatch: openapi-updated)→ this repo's "Sync API types" workflow
                                                     ├─ npm run gen:api
                                                     └─ opens a PR if src/lib/api-types.ts changed
```

So a new/changed backend endpoint arrives here as an **automatic PR** updating the types
(`.github/workflows/sync-api-types.yml`). Review and merge it to adopt the new contract; then
build UI against types that already know the endpoint. The workflow also runs on a manual
dispatch and a weekly safety-net schedule.

> Human-readable API docs (Swagger UI) live on the backend at
> [`/api/docs/`](https://portfolio-backend-2huw.onrender.com/api/docs/).

## Deploy

Auto-deploys to **GitHub Pages** via `.github/workflows/deploy.yml` on every push to `main`
(build with `withastro/action`, publish with `actions/deploy-pages`).

---

© Souhaib Ben Farhat
