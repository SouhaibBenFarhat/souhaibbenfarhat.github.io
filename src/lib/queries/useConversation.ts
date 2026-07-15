import { useQuery } from '@tanstack/react-query';

import { API } from '../api';
import type { paths } from '../api-types';
import { useMinLoadingDuration } from './useMinLoadingDuration';

type ConversationRestore =
  paths['/chat/conversations/{conversation_id}/']['get']['responses'][200]['content']['application/json'];

export type Message = ConversationRestore['messages'][number];

/**
 * The context-gauge figures. The restore payload and the SSE `usage` frame share one schema
 * component upstream, so reading it off the restore type keeps the two from drifting.
 */
export type ChatUsage = ConversationRestore['usage'];

export const conversationKey = (id: string) => ['conversation', id] as const;

/**
 * Restore a stored conversation so it survives a reload.
 *
 * Disabled when there's no stored id (a fresh chat). Any failure — a 404 from an unknown or
 * expired thread, or the backend being unreachable — surfaces as an error, which the caller
 * reads as "nothing to restore, start fresh".
 *
 * `isLoading` is floored (see useMinLoadingDuration) so the restore skeleton is always on
 * screen long enough to read as loading rather than a flicker.
 */
export function useConversation(id: string | null) {
  const query = useQuery({
    queryKey: conversationKey(id ?? 'none'),
    enabled: id != null,
    queryFn: async (): Promise<ConversationRestore> => {
      const res = await fetch(`${API}/chat/conversations/${id}/`);
      if (!res.ok) throw new Error('gone');
      return res.json();
    },
  });

  // A disabled query sits in `pending` forever, so gate on the id too.
  const isLoading = useMinLoadingDuration(id != null && query.isPending);

  return { ...query, isLoading };
}
