// Single source of truth for the site content.
// All phrasings are PUBLIC-SAFE (see evidence/achievements.md "Public-safe?" lines):
// no internal tool/feature codenames, ticket IDs, colleague names, peer-rank numbers, or internal metrics.

export const profile = {
  name: 'Souhaib Ben Farhat',
  title: 'AI Focus — Senior Fullstack Engineer',
  tagline: 'I turn AI capabilities into real products — owned end to end, from agent tooling and APIs up to a refined UI.',
  // Title for search snippets & social cards. Role first, so the positioning leads rather
  // than the name. Separate from `title`, which is the display role the hero, footer, and
  // Person schema render — those read better name-first, on a page already headed by it.
  seoTitle: 'AI Senior Fullstack Engineer — Souhaib Ben Farhat',
  // Keyword-front-loaded description for search snippets & social cards (~150 chars).
  seoDescription:
    'Souhaib Ben Farhat — Senior Fullstack Engineer (AI focus) in München. 8+ years in React, TypeScript & Python, now building AI agent products end to end.',
  location: 'München, Germany',
  availability: 'Open to remote roles across the EU',
  email: 'souhaib.b.farhat@gmail.com',
  phone: '+49 163 214 9290',
  links: {
    linkedin: 'https://www.linkedin.com/in/souhaib-ben-farhat/?locale=en',
    github: 'https://github.com/SouhaibBenFarhat',
  },
  // Keep the CV PDF in /public and update this filename when exported.
  cv: '/Souhaib-Ben-Farhat-CV.pdf',
};

export const intro = [
  `Senior fullstack engineer with 8+ years building SaaS products across React, TypeScript, and
   Python — now focused on AI products: agentic systems and LLM-backed features, shipped from the
   backend up to a refined interface.`,
  `I take fuzzy, under-defined problems and ship the thing that actually matters — designing and
   delivering features end to end, from backend services and agent tool-execution to polished,
   production-grade frontend experiences. I think hard about architecture and trade-offs, care about
   UI and product quality, and try to lift the people and the stack around me.`,
];

// Short, skimmable value props for the home hero.
export const highlights = [
  {
    k: 'AI, end to end',
    v: 'The tool-execution, multi-tenant isolation, and conversation-persistence layers behind parcelLab\'s conversational, AI-built product surfaces — streamed to the UI over SSE.',
  },
  {
    k: 'Direction-setting',
    v: 'Defined the architecture for a new embeddable widget platform — adopted as the team\'s standard server-rendered, AI-buildable approach.',
  },
  {
    k: 'Quality baseline',
    v: 'A WCAG-AA dark theme and a unified design system across a large React application — the bar every later feature starts from.',
  },
  {
    k: 'Team leverage',
    v: 'Among the most active reviewers on the main app — 400+ pull requests reviewed in a year — plus CI roughly halved.',
  },
];

export type Project = {
  slug: string;
  title: string;
  kicker: string;
  summary: string;
  details: string[];
  tags: string[];
  pillars: string[];
};

// Selected work — case-study style, public-safe.
export const projects: Project[] = [
  {
    slug: 'ai-agents',
    title: 'AI agents — owned from tooling to UI',
    kicker: 'AI · Backend · Frontend',
    summary:
      'Built the tool-execution, multi-tenant isolation, and conversation-persistence layers of parcelLab\'s AI agent platform — and the chat and "build-by-conversation" surfaces on top — owned from agent tooling up to the UI.',
    details: [
      'Progress from long-running agent turns streamed to the UI over SSE, so the interface never freezes during background work.',
      'Hardened multi-tenant correctness — fixed account-isolation bugs that could leak data across accounts.',
      'Built an AI feature that lets users compose UI by chatting with an agent, establishing a reusable "build by conversation" pattern reused across surfaces.',
      'Redesigned the in-product AI chat assistant: session-isolated conversations, streaming UX, and structured suggestions co-designed with the AI team.',
    ],
    tags: ['Python', 'Streaming / SSE', 'React', 'TypeScript', 'LLM agents'],
    pillars: ['AI', 'Backend architecture', 'Fullstack', 'UX'],
  },
  {
    slug: 'embeddable-architecture',
    title: 'A from-scratch product that redirected the architecture',
    kicker: 'Architecture · Frontend infra',
    summary:
      'Solo-architected and built a from-scratch embeddable tracking widget — an exploration that set the platform’s architectural direction: a server-rendered, AI-buildable approach the team adopted.',
    details: [
      'Shadow-DOM style isolation so the widget renders identically on any host site and stops bidirectional CSS conflicts.',
      'A JSON-driven layout and theme system that lets layouts be composed and themed without engineering involvement.',
      'A custom OIDC / PKCE auth flow to replace a library incompatible with the hosting constraints.',
      'Bootstrapped with ~90% test coverage and CI from day one — and a deep build-toolchain fix to prevent cross-bundle scope collisions.',
    ],
    tags: ['TypeScript', 'Shadow DOM', 'OIDC / PKCE', 'Design tokens', 'CI'],
    pillars: ['Critical thinking', 'Architecture', 'Product', 'Frontend'],
  },
  {
    slug: 'design-system',
    title: 'A design-system and quality baseline',
    kicker: 'Design systems · UX · Accessibility',
    summary:
      'Designed a WCAG-AA, system-preference dark theme and unified the design system across a large React admin application — raising the quality bar every later feature starts from.',
    details: [
      'A surface-level design-token system (not a CSS invert): proper contrast, system-preference support, and theme-sync into embedded editors and admin views.',
      'One shared data-table pattern, a shared page-header, and a real skeleton-loading system migrated across the application.',
      'A semantic spacing-and-shape token scale that keeps composition consistent and reduces per-feature reinvention.',
      'Closed-loop WCAG accessibility remediation, gated by an automated accessibility check that fails the build.',
    ],
    tags: ['Design tokens', 'WCAG', 'React', 'CSS architecture'],
    pillars: ['UX / Design', 'Enabling others', 'Frontend'],
  },
  {
    slug: 'fullstack-ownership',
    title: 'Fullstack feature ownership, UI → API → CDN',
    kicker: 'Fullstack',
    summary:
      'Owned features end to end across UI, API, and CDN, reducing cross-team hand-offs — fullstack reach with frontend as the depth.',
    details: [
      'A media-management feature owned across the stack: a React page, a backend model, and CDN delivery in production.',
      'A standardized filtering and saved-views system wired from new backend search endpoints up to a consistent UI.',
      'Backend API work — serializers, filters, and paginated endpoints — added to keep frontend delivery from stalling on another queue.',
    ],
    tags: ['React', 'Python APIs', 'AWS / CloudFront', 'Pagination & search'],
    pillars: ['Fullstack', 'Backend architecture', 'Product'],
  },
  {
    slug: 'developer-experience',
    title: 'Developer experience & enabling others',
    kicker: 'DevEx · Leverage',
    summary:
      'Roughly halved CI runtime on a busy frontend repo and built in-repo guidance so engineers outside the frontend team contribute on-pattern.',
    details: [
      'Cut pipeline time by parallelizing test jobs, deduplicating quality checks, and surfacing failures that had been hiding behind a green check.',
      'Built in-repo automated "skills" that encode design and structure rules so non-frontend contributors produce consistent work.',
      'One of the most active code reviewers on the main application — 400+ pull requests reviewed in a year — with reasoning-first feedback that unblocks colleagues.',
      'Ran internal AI workshops and knowledge-sharing sessions beyond my own team.',
    ],
    tags: ['CI / CD', 'Tooling', 'Code review', 'Mentoring'],
    pillars: ['Enabling others', 'Critical thinking', 'DevEx'],
  },
  {
    slug: 'craft',
    title: 'Craft: testing, performance, and feel',
    kicker: 'Quality · Perceived performance',
    summary:
      'A consistent investment in the parts users feel — fast first paint, instant-feeling navigation, and a codebase that is safe to change.',
    details: [
      'Perceived-performance work: faster initial load, a navigation progress indicator, and app-wide skeleton loading replacing spinners.',
      'A reusable minimum-loading hook that fixed a skeleton-flash bug and smoothed transitions across the app.',
      'Greenfield test discipline — ~90% coverage and CI from the first commit — so the codebase stays handoff-ready.',
    ],
    tags: ['Vitest / Jest / Cypress', 'Perceived perf', 'React Query'],
    pillars: ['Critical thinking', 'UX / Design', 'DevEx'],
  },
];

export type Role = {
  company: string;
  /** Employer's website. Omitted for composite/earlier entries that aren't a single company. */
  url?: string;
  role: string;
  period: string;
  location: string;
  blurb?: string;
  points: string[];
  stack: string[];
};

export const experience: Role[] = [
  {
    company: 'parcelLab',
    url: 'https://parcellab.com',
    role: 'Software Engineer · Fullstack & AI',
    period: 'Feb 2025 — Present',
    location: 'München',
    blurb: 'Enterprise post-purchase platform (order tracking, delivery notifications, returns) for global retail brands.',
    points: [
      'Built the tool-execution and multi-tenant isolation layer of parcelLab\'s AI agent platform — the internal-API tools the agents call, account-isolated multi-tenant threads, and conversation persistence and history — surfaced to the UI over SSE streaming and powering an AI "build-by-conversation" experience where users compose product UI by chatting with an agent.',
      'Led the end-to-end redesign and modernization of the in-product AI assistant (Copilot) — integrating the LLM chat backend and rebuilding the chat experience into a modern, reusable UI/UX component system.',
      'Built a global search and command palette — keyboard-first, application-wide navigation and quick actions that cut everyday navigation friction across the portal.',
      'Defined the architecture for a new embeddable widget platform — Shadow-DOM isolation, JSON-driven layouts and theming, custom OIDC/PKCE auth, and ~90% test coverage — later adopted as the team\'s standard server-rendered, AI-buildable approach.',
      'Led the portal-wide design system — a WCAG-AA, system-preference dark theme and a unified data-table / page-header / skeleton-loading component system across a large React app — raising the visual and accessibility baseline every later feature starts from.',
      'Drove perceived-performance work — faster initial load, a navigation progress bar, and app-wide skeleton loading — that made the app feel instant.',
      'Owned features end to end across UI, API, and CDN, shipping Python / Node backend services to keep delivery unblocked — fullstack breadth, not just frontend.',
      'Ran product-enablement sessions and authored feature documentation — walking product and sales teams through new capabilities end to end so they could confidently position, demo, and sell them.',
      'Reviewed 400+ pull requests in a year — one of the most active reviewers on the main app — helped roughly halve CI runtime, built in-repo "skills" tooling for non-frontend engineers, and ran internal AI workshops across teams.',
    ],
    stack: ['React', 'TypeScript', 'Python', 'AI / LLM agents', 'AWS / CloudFront', 'Shadow DOM', 'CI/CD'],
  },
  {
    company: 'KONUX',
    url: 'https://konux.com',
    role: 'Software Engineer · Frontend & Platform',
    period: 'Jul 2021 — Jan 2025',
    location: 'München',
    blurb: 'Predictive-maintenance SaaS for rail infrastructure — IoT + ML monitoring of railway point machines, surfaced to rail operators through monitoring dashboards.',
    points: [
      'Owned the point-machine monitoring dashboard — KONUX\'s flagship product surface where rail operators monitor point-machine and track health — and built the data-visualization UI and visual language behind it for sensor and time-series data.',
      'Migrated charting from D3.js to Highcharts — standardizing how sensor time-series and point-machine telemetry are rendered across the product for faster delivery and a consistent charting experience.',
      'Architected the move from a monolithic frontend to a modular NX monorepo — a scalable platform foundation that enabled code-sharing across client apps and independent, parallel delivery of each product surface.',
      'Built a shared UI component library and design system spanning multiple client apps — a common UX foundation other apps built on, driving visual and interaction consistency across the product.',
      'Set up internationalization with an automated translation pipeline — i18n tooling that automates translations across the apps — and integrated analytics and monitoring instrumentation, as platform/devex tooling.',
      'Built an in-house feature-flagging solution on AWS AppConfig with serverless Lambdas for safe, decoupled release control, and contributed Spring Boot microservice APIs — reaching across frontend and platform.',
    ],
    stack: ['React', 'TypeScript', 'Redux', 'NX monorepo', 'D3 / Highcharts', 'i18n automation', 'Java / Spring Boot', 'AWS (AppConfig / Lambda)'],
  },
  {
    company: 'Klarx',
    url: 'https://klarx.de',
    role: 'Fullstack Developer (React / Ruby on Rails)',
    period: 'Jan 2019 — Jun 2021',
    location: 'München',
    blurb: 'Construction-project and machine-rental management platform.',
    points: [
      'Built and maintained the management dashboard in React and developed the supporting Ruby on Rails APIs.',
      'Delivered the invoicing module (incoming/outgoing invoices, online payments) and rental-workflow automation; modernized the codebase and UI architecture for scale.',
    ],
    stack: ['React', 'Redux', 'Ruby on Rails', 'PostgreSQL', 'REST'],
  },
  {
    company: 'Earlier roles',
    role: 'Full-stack & mobile engineering',
    period: '2017 — 2018',
    location: 'Munich · Tunis · Cardiff',
    blurb: 'Motius (React / Django), Lynq (Android), and Xedyas (Node.js) — building web and mobile products across early-stage companies.',
    points: [],
    stack: ['React', 'Django', 'Node.js', 'Android'],
  },
];

export type SkillGroup = { group: string; items: { name: string; level: 'Strong' | 'Working' | 'Familiar' }[] };

export const skills: SkillGroup[] = [
  {
    group: 'Frontend',
    items: [
      { name: 'React', level: 'Strong' },
      { name: 'TypeScript', level: 'Strong' },
      { name: 'Design systems & tokens', level: 'Strong' },
      { name: 'Redux / RxJS', level: 'Strong' },
      { name: 'Shadow DOM / embeddable UI', level: 'Strong' },
      { name: 'Data-viz (D3 / Highcharts)', level: 'Working' },
      { name: 'Accessibility (WCAG)', level: 'Working' },
      { name: 'Angular', level: 'Familiar' },
    ],
  },
  {
    group: 'AI / LLM',
    items: [
      { name: 'Anthropic / OpenAI APIs', level: 'Working' },
      { name: 'Agent tool-execution', level: 'Strong' },
      { name: 'Tool-calling', level: 'Strong' },
      { name: 'SSE streaming', level: 'Strong' },
      { name: 'Multi-tenant isolation', level: 'Working' },
      { name: 'Conversation persistence', level: 'Working' },
      { name: 'LLM product features', level: 'Strong' },
    ],
  },
  {
    group: 'Backend',
    items: [
      { name: 'Python (Django-style REST)', level: 'Working' },
      { name: 'REST / API design', level: 'Working' },
      { name: 'PostgreSQL', level: 'Working' },
      { name: 'Auth & tenancy (OIDC / PKCE)', level: 'Working' },
      { name: 'Node.js', level: 'Familiar' },
      { name: 'Ruby on Rails', level: 'Familiar' },
      { name: 'Java / Spring Boot', level: 'Familiar' },
      { name: 'GraphQL', level: 'Familiar' },
    ],
  },
  {
    group: 'Cloud & DevEx',
    items: [
      { name: 'AWS (Lambda, CloudFront)', level: 'Working' },
      { name: 'CI/CD optimization', level: 'Strong' },
      { name: 'Testing (Vitest / Jest / Cypress)', level: 'Strong' },
      { name: 'NX monorepo', level: 'Working' },
    ],
  },
  {
    group: 'Leadership',
    items: [
      { name: 'Architecture & technical direction', level: 'Strong' },
      { name: 'Code review at scale', level: 'Strong' },
      { name: 'Mentoring', level: 'Working' },
      { name: 'Internal tooling & enablement', level: 'Strong' },
      { name: 'Workshops & documentation', level: 'Working' },
      { name: 'Cross-team initiatives', level: 'Working' },
    ],
  },
];

export const education = [
  { school: 'ESPRIT — School of Engineering', detail: "Engineer's Degree / M.Sc., Software Engineering", years: '2015 — 2018', place: 'Tunis' },
  { school: 'ESC Tunis', detail: "Bachelor's, Software Development", years: '2011 — 2014', place: 'Tunis' },
];

export const languages = [
  { name: 'English', level: 'Fluent' },
  { name: 'French', level: 'Fluent' },
  { name: 'Arabic', level: 'Native' },
  { name: 'German', level: 'Basic' },
];

// Single-page scroll: nav items are in-page section anchors (scroll-spy highlights the active one).
export const nav = [
  { href: '#about', label: 'About' },
  { href: '#experience', label: 'Experience' },
  { href: '#work', label: 'Work' },
  { href: '#skills', label: 'Skills' },
  { href: '#contact', label: 'Contact' },
];
