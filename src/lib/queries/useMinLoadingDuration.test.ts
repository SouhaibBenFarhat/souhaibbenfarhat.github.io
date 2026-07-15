import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMinLoadingDuration } from './useMinLoadingDuration';

const MS = 1000;
const render = (loading: boolean) =>
  renderHook(({ isLoading }) => useMinLoadingDuration(isLoading, MS), {
    initialProps: { isLoading: loading },
  });

describe('useMinLoadingDuration', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is false when nothing is loading', () => {
    expect(render(false).result.current).toBe(false);
  });

  it('holds the flag for the full duration when the data arrives instantly', () => {
    const { result, rerender } = render(true);
    expect(result.current).toBe(true);

    rerender({ isLoading: false }); // data arrived on the very next tick
    expect(result.current).toBe(true); // ...but the flag is floored

    act(() => void vi.advanceTimersByTime(MS - 1));
    expect(result.current).toBe(true);

    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it('stays true for as long as a slow load runs, then releases at once', () => {
    const { result, rerender } = render(true);

    act(() => void vi.advanceTimersByTime(MS * 5));
    expect(result.current).toBe(true); // floor long elapsed, but still loading

    rerender({ isLoading: false });
    expect(result.current).toBe(false); // no extra delay — the floor was already served
  });

  it('restarts the floor when a new load begins', () => {
    const { result, rerender } = render(true);
    rerender({ isLoading: false });

    act(() => void vi.advanceTimersByTime(MS));
    expect(result.current).toBe(false);

    rerender({ isLoading: true }); // second load
    rerender({ isLoading: false });
    expect(result.current).toBe(true);

    act(() => void vi.advanceTimersByTime(MS));
    expect(result.current).toBe(false);
  });
});
