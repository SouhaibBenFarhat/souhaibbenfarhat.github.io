import { QueryClient } from '@tanstack/react-query';

/**
 * One client per island mount (see ChatWidget) rather than a module singleton, so nothing
 * is shared between mounts — including between tests.
 *
 * Retries are off by design. The only query here is the conversation restore, where a 404
 * is a real answer ("the thread is gone, greet as a fresh chat"), not a blip worth retrying;
 * retrying would just stall the greeting behind three failed round-trips. The chat stream
 * keeps its own cold-start retry loop — it's an SSE fetch, not a query.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}
