// Env-gated, host-agnostic analytics (PostHog).
//
// Enabled ONLY when the deploy pipeline sets PUBLIC_ENABLE_ANALYTICS="true"
// (see .github/workflows/deploy.yml). It is off on localhost and off in a local
// `astro build && astro preview` — so local testing never pollutes production
// metrics. No hostname checks: pointing a custom domain at the site changes nothing.
//
// PUBLIC_* values are baked into the client bundle and readable by anyone, so only
// non-secret values live here. The PostHog *project* key is designed to be public.

import type { PostHog } from 'posthog-js';

const KEY = import.meta.env.PUBLIC_POSTHOG_KEY;
const HOST = import.meta.env.PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';

/** Single source of truth: are we allowed to send analytics? */
export const analyticsEnabled =
  import.meta.env.PUBLIC_ENABLE_ANALYTICS === 'true' && Boolean(KEY);

// Lazy-load posthog-js only when enabled, so the bundle is never fetched otherwise.
let posthogPromise: Promise<PostHog> | null = null;
function loadPostHog(): Promise<PostHog> {
  posthogPromise ??= import('posthog-js').then((m) => m.default);
  return posthogPromise;
}

// A visitor id that resets each calendar day (UTC): the same person returning the
// next day is counted as a NEW unique. We mint a random id, store it in localStorage
// keyed by today's date, and reuse it only while the date matches. PostHog's own
// persistence is kept in memory so it never overrides this daily id.
function dailyDistinctId(): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const STORE = 'ph_daily_id';
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    if (saved.date === today && saved.id) return saved.id as string;
  } catch {
    /* localStorage unavailable (private mode) — fall through to a fresh id */
  }
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${today}-${Math.random().toString(36).slice(2)}`;
  try {
    localStorage.setItem(STORE, JSON.stringify({ id, date: today }));
  } catch {
    /* ignore write failure */
  }
  return id;
}

/** Boot analytics once, on page load. No-op when disabled. */
export async function initAnalytics(): Promise<void> {
  if (!analyticsEnabled || typeof window === 'undefined') return;
  const posthog = await loadPostHog();
  posthog.init(KEY as string, {
    api_host: HOST,
    capture_pageview: true,
    // Daily-rotating identity (see dailyDistinctId): unique visitors are counted
    // per calendar day. Memory persistence so PostHog doesn't keep its own long-lived
    // id; our bootstrapped daily id is the source of truth.
    persistence: 'memory',
    bootstrap: { distinctID: dailyDistinctId() },
    person_profiles: 'identified_only',
  });
}

/**
 * Track a custom event. No-op when disabled.
 * Future use: track('chat_opened'), track('cv_downloaded'), track('project_clicked', { repo }).
 */
export async function track(event: string, props?: Record<string, unknown>): Promise<void> {
  if (!analyticsEnabled) return;
  const posthog = await loadPostHog();
  posthog.capture(event, props);
}
