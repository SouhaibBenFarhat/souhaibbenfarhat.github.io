// Shared "internal / owner" mode.
//
// Visiting the site once with `?internal=1` marks THIS browser as internal: the flag
// is stored locally and the param is stripped from the URL, so later visits need no
// param. Used to (a) opt the owner out of analytics and (b) reveal features that aren't
// ready for the public yet — currently the AI chat widget. A single `?internal=1` visit
// does both, and both features read this one flag (no ordering races between them).
// Lasts until the browser's storage is cleared.

const INTERNAL_KEY = 'internal';

/** True if this browser is in internal/owner mode. Enables it when `?internal=1` is present. */
export function isInternal(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('internal') === '1') {
      localStorage.setItem(INTERNAL_KEY, '1');
      // Strip the flag from the address bar so the URL isn't accidentally shared/bookmarked.
      const url = new URL(window.location.href);
      url.searchParams.delete('internal');
      history.replaceState({}, '', url);
      console.info('[internal] Internal/owner mode enabled on this browser.');
    }
    return localStorage.getItem(INTERNAL_KEY) === '1';
  } catch {
    return false;
  }
}
