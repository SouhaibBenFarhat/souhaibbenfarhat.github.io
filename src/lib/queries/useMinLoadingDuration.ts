import { useEffect, useRef, useState } from 'react';

/** Every loading state is held for at least this long. */
export const MIN_LOADING_MS = 1000;

/**
 * Floor a loading flag so it can never flash.
 *
 * Once `isLoading` goes true the returned flag stays true for at least `ms`, even when the
 * data arrives sooner. A skeleton or spinner that appears and vanishes within a few frames
 * reads as a glitch — worse than showing nothing at all — and the faster the backend gets,
 * the worse it looks. Flooring the state trades a little latency for a steady interface.
 *
 * Pair it with the flag that gates the *result*, not just the indicator: releasing the UI
 * the moment the request resolves would skip the floor entirely (see useDeleteConversation).
 */
export function useMinLoadingDuration(isLoading: boolean, ms: number = MIN_LOADING_MS): boolean {
  const [flooring, setFlooring] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!isLoading) return;
    setFlooring(true);
    if (timer.current != null) window.clearTimeout(timer.current);
    // Deliberately not cleared when `isLoading` flips back to false — the timer has to
    // outlive the load, since releasing the floor early is the bug this hook exists to fix.
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setFlooring(false);
    }, ms);
  }, [isLoading, ms]);

  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );

  return isLoading || flooring;
}
