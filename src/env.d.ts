/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  /** "true" only in the CI/production build — turns analytics on. Absent/false everywhere else. */
  readonly PUBLIC_ENABLE_ANALYTICS?: string;
  /** PostHog project API key (public — safe to expose in the client bundle). */
  readonly PUBLIC_POSTHOG_KEY?: string;
  /** PostHog ingestion host. Defaults to EU cloud when unset. */
  readonly PUBLIC_POSTHOG_HOST?: string;
  /** Base URL of the AI chat backend. Defaults to the Render deployment. */
  readonly PUBLIC_CHAT_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
