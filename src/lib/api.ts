/**
 * Base URL of the chat backend (portfolio-backend, Django on Render).
 *
 * Override with PUBLIC_CHAT_API to point at a local stand-in — the deployed backend's CORS
 * allowlist only accepts the production origin, so the chat cannot reach it from localhost.
 */
export const API = import.meta.env.PUBLIC_CHAT_API ?? 'https://portfolio-backend-2huw.onrender.com';
