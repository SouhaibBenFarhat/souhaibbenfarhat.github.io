import { useEffect, useState } from 'react';
import CookieConsent from 'react-cookie-consent';

import {
  CONSENT_COOKIE,
  grantAnalyticsConsent,
  revokeAnalyticsConsent,
  shouldOfferConsent,
} from '../lib/analytics';

// Re-ask for consent every ~6 months (in line with EDPB guidance on consent lifetime).
const EXPIRES_DAYS = 180;

// A compact, token-styled consent card. It only mounts when there is actually something
// to consent to — i.e. a production build with analytics wired up, on a non-owner device
// (see shouldOfferConsent). PostHog never loads until the visitor clicks Accept; declining
// keeps it off entirely. The choice can be changed later via the footer "Cookie settings"
// link, which dispatches `sf-consent:open` to reopen this banner.
export default function CookieBanner() {
  const [active, setActive] = useState(false);
  const [visible, setVisible] = useState<'show' | 'hidden' | 'byCookieValue'>('byCookieValue');

  useEffect(() => {
    if (!shouldOfferConsent()) return; // dev/preview, or the owner's device → no banner
    setActive(true);
    // Reveal the footer "Cookie settings" link now that consent management is live.
    document.documentElement.classList.add('sf-consent-ready');
    const reopen = () => setVisible('show');
    window.addEventListener('sf-consent:open', reopen);
    return () => window.removeEventListener('sf-consent:open', reopen);
  }, []);

  if (!active) return null;

  return (
    <>
      <style>{CSS}</style>
      <CookieConsent
        cookieName={CONSENT_COOKIE}
        location="bottom"
        visible={visible}
        expires={EXPIRES_DAYS}
        sameSite="lax"
        enableDeclineButton
        disableStyles
        containerClasses="sfcc"
        contentClasses="sfcc-content"
        buttonWrapperClasses="sfcc-actions"
        buttonClasses="sfcc-btn sfcc-accept"
        declineButtonClasses="sfcc-btn sfcc-decline"
        buttonText="Accept"
        declineButtonText="Decline"
        ariaAcceptLabel="Accept analytics cookies"
        ariaDeclineLabel="Decline analytics cookies"
        onAccept={() => {
          setVisible('hidden');
          void grantAnalyticsConsent();
        }}
        onDecline={() => {
          setVisible('hidden');
          void revokeAnalyticsConsent();
        }}
      >
        <strong className="sfcc-title">A note on cookies</strong>
        <span className="sfcc-text">
          I use privacy-friendly, EU-hosted analytics (PostHog) to see how this site is used —
          no ads, no third-party sharing, no selling data. Nothing loads unless you accept.{' '}
          <a className="sfcc-link" href="/privacy">
            Learn more
          </a>
          .
        </span>
      </CookieConsent>
    </>
  );
}

const CSS = `
.sfcc {
  position: fixed; z-index: 55;
  left: 16px; bottom: 16px;
  width: min(420px, calc(100vw - 32px));
  display: flex; flex-direction: column; gap: 14px;
  padding: 18px 18px 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  animation: sfcc-rise .42s cubic-bezier(.22,.61,.36,1) both;
}
@keyframes sfcc-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }

.sfcc-content { margin: 0; }
.sfcc-title {
  display: block; margin-bottom: 5px;
  font-family: 'Fraunces Variable', ui-serif, Georgia, serif;
  font-size: 15.5px; font-weight: 500; letter-spacing: -.01em; color: var(--text);
}
.sfcc-text { display: block; font-size: 13px; line-height: 1.55; color: var(--muted); }
.sfcc-link { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.sfcc-link:hover { filter: brightness(1.08); }

.sfcc-actions { display: flex; gap: 10px; }
.sfcc-btn {
  flex: 1; cursor: pointer; font: inherit; font-size: 13.5px; font-weight: 500;
  padding: 9px 14px; border-radius: 10px; border: 1px solid var(--line);
  transition: transform .15s ease, border-color .15s ease, color .15s ease,
              background .15s ease, box-shadow .15s ease, filter .15s ease;
}
.sfcc-accept { background: var(--accent); color: #fff; border-color: var(--accent); }
.sfcc-accept:hover { transform: translateY(-1px); filter: brightness(1.06); box-shadow: var(--shadow-md); }
/* Dark accent is bright; ink text keeps AA contrast on the solid button (mirrors .btn-solid). */
.dark .sfcc-accept { color: #08272a; }
.sfcc-decline { background: transparent; color: var(--text); }
.sfcc-decline:hover { transform: translateY(-1px); border-color: var(--accent); color: var(--accent); }

.sfcc-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .sfcc { animation: none; }
  .sfcc-btn:hover { transform: none; }
}
`;
