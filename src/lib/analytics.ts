// Env-gated, host-agnostic analytics (PostHog) — behind explicit cookie consent.
//
// Enabled ONLY when the deploy pipeline sets PUBLIC_ENABLE_ANALYTICS="true"
// (see .github/workflows/deploy.yml). It is off on localhost and off in a local
// `astro build && astro preview` — so local testing never pollutes production
// metrics. No hostname checks: pointing a custom domain at the site changes nothing.
//
// On top of that, PostHog only ever loads AFTER the visitor accepts in the consent
// banner (src/components/CookieBanner.tsx). No analytics cookie is set before consent —
// GDPR / ePrivacy require prior opt-in for non-essential (analytics) cookies.
//
// PUBLIC_* values are baked into the client bundle and readable by anyone, so only
// non-secret values live here. The PostHog *project* key is designed to be public.

import type { PostHog } from 'posthog-js';

import { isInternal } from './internal';

const KEY = import.meta.env.PUBLIC_POSTHOG_KEY;
const HOST = import.meta.env.PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';

/** Analytics is wired up at all (a production build with a key). Consent is separate. */
export const analyticsEnabled =
  import.meta.env.PUBLIC_ENABLE_ANALYTICS === 'true' && Boolean(KEY);

// ---- Consent ----------------------------------------------------------------
// The choice is stored in this cookie by the banner (react-cookie-consent):
// "true" = accepted, "false" = declined, absent = not decided yet. This cookie is
// "strictly necessary" (it records a privacy choice), so it needs no prior consent.
export const CONSENT_COOKIE = 'sf_cookie_consent';

function readConsentCookie(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const m = document.cookie.match(new RegExp('(?:^|; )' + CONSENT_COOKIE + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : undefined;
}

/** The visitor's stored analytics choice, or null if they haven't decided yet. */
export function consentDecision(): 'accepted' | 'declined' | null {
  const v = readConsentCookie();
  if (v === 'true') return 'accepted';
  if (v === 'false') return 'declined';
  return null;
}

/** Whether to offer the banner at all: only when analytics is live (production) and
 *  this isn't the owner's own device (internal mode is excluded from analytics). */
export function shouldOfferConsent(): boolean {
  return analyticsEnabled && typeof window !== 'undefined' && !isInternal();
}

// ---- PostHog boot -----------------------------------------------------------

// Lazy-load posthog-js only when needed, so the bundle is never fetched otherwise.
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

let booted = false;

/** Initialise PostHog once. Idempotent; re-enables capture if opted out earlier. */
async function boot(): Promise<void> {
  if (!analyticsEnabled || typeof window === 'undefined' || isInternal()) return;
  const posthog = await loadPostHog();
  if (booted) {
    posthog.opt_in_capturing(); // e.g. declined earlier this session, now accepting
    return;
  }
  booted = true;
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

/** Boot analytics on page load — but ONLY if the visitor already accepted. */
export async function initAnalytics(): Promise<void> {
  if (consentDecision() !== 'accepted') return; // not decided, or declined → stay off
  await boot();
}

/** Called when the visitor accepts cookies — start analytics right away, no reload. */
export async function grantAnalyticsConsent(): Promise<void> {
  await boot();
}

/** Called when the visitor declines or withdraws — stop and clear any analytics. */
export async function revokeAnalyticsConsent(): Promise<void> {
  if (!posthogPromise) return; // never loaded this session → nothing to stop
  try {
    const posthog = await loadPostHog();
    posthog.opt_out_capturing(); // stop all future capture
    posthog.reset(); // drop the current distinct_id / session
  } catch {
    /* ignore */
  }
}

/**
 * Track a custom event. No-op unless analytics is enabled AND consent was given.
 * Future use: track('chat_opened'), track('cv_downloaded'), track('project_clicked').
 */
export async function track(event: string, props?: Record<string, unknown>): Promise<void> {
  if (!analyticsEnabled || typeof window === 'undefined' || isInternal()) return;
  if (consentDecision() !== 'accepted') return;
  const posthog = await loadPostHog();
  posthog.capture(event, props);
}
