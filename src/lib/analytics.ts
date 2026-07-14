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

import { isInternal } from './internal';

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

// Daily-unique identity: reset to a fresh anonymous id whenever the calendar day
// changes, so a visitor returning the next day is counted as a NEW unique.
// NOTE: we use localStorage+cookie persistence (not 'memory') because Session Replay
// silently does not record under memory persistence. This daily reset preserves the
// per-day unique counting on top of persistent storage.
const DAY_KEY = 'ph_day';
function resetIfNewDay(posthog: PostHog): void {
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    if (localStorage.getItem(DAY_KEY) !== today) {
      posthog.reset(); // fresh anonymous distinct_id + session
      localStorage.setItem(DAY_KEY, today);
    }
  } catch {
    /* localStorage unavailable (private mode) — skip the daily reset */
  }
}

// Owner opt-out: a browser in internal/owner mode (visited once with `?internal=1`)
// is excluded from analytics. The flag lives in the shared `isInternal()` helper, so
// the same visit that reveals internal features also opts the owner out of tracking.

/** Boot analytics once, on page load. No-op when disabled or opted out. */
export async function initAnalytics(): Promise<void> {
  if (!analyticsEnabled || typeof window === 'undefined') return;
  if (isInternal()) return; // owner's own device — never track
  const posthog = await loadPostHog();
  posthog.init(KEY as string, {
    // api_host points at our first-party reverse proxy (PUBLIC_POSTHOG_HOST) so
    // ad-blockers don't drop events; ui_host keeps dashboard/toolbar links on PostHog.
    api_host: HOST,
    ui_host: 'https://eu.posthog.com',
    // localStorage+cookie is REQUIRED for Session Replay to record (memory persistence
    // silently disables it). Daily-unique counting is preserved by resetIfNewDay below.
    persistence: 'localStorage+cookie',
    capture_pageview: false, // captured in `loaded`, after the daily-reset check
    person_profiles: 'identified_only',
    loaded: (ph) => {
      resetIfNewDay(ph);
      ph.capture('$pageview');
    },
  });
}

/**
 * Track a custom event. No-op when disabled.
 * Future use: track('chat_opened'), track('cv_downloaded'), track('project_clicked', { repo }).
 */
export async function track(event: string, props?: Record<string, unknown>): Promise<void> {
  if (!analyticsEnabled || typeof window === 'undefined' || isInternal()) return;
  const posthog = await loadPostHog();
  posthog.capture(event, props);
}
