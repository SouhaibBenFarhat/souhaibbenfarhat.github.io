import { useMutation } from '@tanstack/react-query';

import { API } from '../api';
import { useMinLoadingDuration } from './useMinLoadingDuration';

/**
 * Permanently delete a conversation — `DELETE /chat/conversations/{id}/`, the same URL the
 * restore uses.
 *
 * 204 and 404 both resolve: an already-gone thread lands in the same place the caller wants.
 * Anything else rejects, so the caller keeps the conversation and can retry — the privacy
 * page promises the data is really gone, so a failed request must never look like success.
 *
 * A null id means the thread only ever existed client-side (e.g. the stream died before the
 * backend handed one back), so there's nothing to delete — it still runs through the same
 * floored path, to keep the interaction identical.
 *
 * `isDeleting` is floored: without it the request resolves in tens of milliseconds and the
 * "Deleting…" state is gone before it can be read. Drive the reset off `isDeleting` rather
 * than the mutation's own success, or the floor is skipped.
 */
export function useDeleteConversation() {
  // Deliberately no removeQueries/invalidate on success: the restore query is still enabled
  // while the loading floor runs, so evicting its cache entry makes it refetch and the panel
  // snaps back to the restore skeleton mid-delete. The caller drops the stored id instead,
  // which disables the query outright — nothing left to evict.
  const mutation = useMutation({
    mutationFn: async (id: string | null) => {
      if (!id) return null;
      const res = await fetch(`${API}/chat/conversations/${id}/`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error('delete failed');
      return id;
    },
  });

  const isDeleting = useMinLoadingDuration(mutation.isPending);

  return { ...mutation, isDeleting };
}
