/**
 * usePulse / useFlash — event layer timing.
 *
 * These drive the CSS event effects (purchase bloom, unlock slide, prestige
 * burn). The failure modes are quiet: a class that never clears leaves the
 * animation permanently armed, and one that never fires means the player never
 * sees feedback at all. So both the firing and the clearing are asserted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePulse, useFlash } from '../game/useFlash';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePulse', () => {
  it('does not fire on mount — only on change', () => {
    const { result } = renderHook(() => usePulse('a'));
    expect(result.current).toBe(false);
  });

  it('activates when the tracked value changes', () => {
    const { result, rerender } = renderHook(({ v }) => usePulse(v), {
      initialProps: { v: 1 },
    });
    expect(result.current).toBe(false);

    rerender({ v: 2 });
    expect(result.current).toBe(true);
  });

  it('clears itself after the duration', () => {
    const { result, rerender } = renderHook(({ v }) => usePulse(v, 500), {
      initialProps: { v: 1 },
    });

    rerender({ v: 2 });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(result.current).toBe(false);
  });

  it('re-arms on a second change rather than staying stuck', () => {
    // The bug this guards: a class that latches on never re-triggers, because
    // React will not re-apply an animation to an element that never left the
    // animated state. Clearing is what makes the second purchase visible.
    const { result, rerender } = renderHook(({ v }) => usePulse(v, 400), {
      initialProps: { v: 1 },
    });

    rerender({ v: 2 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe(false);

    rerender({ v: 3 });
    expect(result.current).toBe(true);
  });

  it('does not re-arm when the value is unchanged', () => {
    const { result, rerender } = renderHook(({ v }) => usePulse(v, 400), {
      initialProps: { v: 7 },
    });
    rerender({ v: 7 });
    expect(result.current).toBe(false);
  });

  it('cancels a pending timer on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { rerender, unmount } = renderHook(({ v }) => usePulse(v, 400), {
      initialProps: { v: 1 },
    });
    rerender({ v: 2 });
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe('useFlash', () => {
  it('increments once per change', () => {
    const { result, rerender } = renderHook(({ v }) => useFlash(v), {
      initialProps: { v: 'a' },
    });
    expect(result.current).toBe(0);

    rerender({ v: 'b' });
    expect(result.current).toBe(1);

    rerender({ v: 'c' });
    expect(result.current).toBe(2);
  });

  it('does not increment on an unchanged value', () => {
    const { result, rerender } = renderHook(({ v }) => useFlash(v), {
      initialProps: { v: 'same' },
    });
    rerender({ v: 'same' });
    rerender({ v: 'same' });
    expect(result.current).toBe(0);
  });
});