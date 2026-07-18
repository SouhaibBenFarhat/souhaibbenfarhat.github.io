import { useMutation } from '@tanstack/react-query';

import { API } from '../api';
import type { paths } from '../api-types';

type RatingResult =
  paths['/chat/conversations/{conversation_id}/messages/{message_id}/rating/']['put']['responses'][200]['content']['application/json'];

/** The thumbs value sent to the backend: up, down, or clear a previous rating. */
export type RatingValue = 1 | -1 | 0;

type RateVars = { conversationId: string; messageId: number; rating: RatingValue };

/**
 * Rate one assistant message — `PUT /chat/conversations/{id}/messages/{messageId}/rating/`.
 *
 * The endpoint is idempotent: it replaces any previous rating, so sending the value again (or a
 * 0 to clear) is safe to fire on every click. A 404 means the conversation or message is gone
 * server-side (e.g. the free DB was reset); like the other calls that treat a vanished thread as
 * a real answer, it rejects so the caller can roll its optimistic thumb back.
 *
 * The rating is reflected optimistically in the message list (the source of truth for what's on
 * screen), so this hook only owns the request — there's no cache to invalidate. One shared
 * mutation across all messages is fine: the visible feedback is the filled thumb, not a spinner,
 * so nothing needs a per-message pending state.
 */
export function useRateMessage() {
  return useMutation({
    mutationFn: async ({ conversationId, messageId, rating }: RateVars): Promise<RatingResult> => {
      const res = await fetch(`${API}/chat/conversations/${conversationId}/messages/${messageId}/rating/`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating }),
      });
      if (!res.ok) throw new Error('rating failed');
      return res.json();
    },
  });
}
