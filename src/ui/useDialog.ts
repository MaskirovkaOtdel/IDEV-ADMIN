/**
 * useDialog — the keyboard and focus behaviour every modal needs.
 *
 * WHY THIS EXISTS
 * ---------------
 * Three modals had three different levels of support:
 *
 *   OfflineReportModal   role  aria-modal  Escape  focus trap
 *   ConfirmResetModal    role  aria-modal  -       -
 *   SaveManager          role  aria-modal  -       -
 *
 * The first was hand-rolled last release and the logic did not exist in the other
 * two. Writing it a fourth time for Settings would have left the same divergence
 * one modal wider, so it is extracted here and applied to all of them.
 *
 * What it guarantees, when `open` is true:
 *
 *   - focus moves to `initialFocus` (or the first focusable control)
 *   - Tab and Shift+Tab cycle inside the dialog, and the keystroke that would
 *     escape it is prevented so the browser cannot move focus behind the overlay
 *   - Escape calls `onClose`
 *   - focus returns to whatever had it before the dialog opened
 *
 * A modal that steals focus and never gives it back is worse than no modal: the
 * player has to hunt for where they were.
 */
import { useEffect } from 'react';

/** Controls the trap will cycle through. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface UseDialogOptions {
  open: boolean;
  onClose: () => void;
  /** Receives the dialog window so the hook can scope the trap to it. */
  windowRef: React.RefObject<HTMLElement | null>;
  /** Focused on open. Defaults to the first focusable control inside. */
  initialFocus?: React.RefObject<HTMLElement | null>;
  /**
   * Set false for dialogs that must not be dismissed by Escape.
   *
   * The reset confirmation is the obvious case: it asks before destroying eight
   * hours of progress, and a stray Escape should not answer that question.
   */
  closeOnEscape?: boolean;
  /** Set false when the backdrop should not dismiss — e.g. while typing. */
  closeOnBackdrop?: boolean;
}

export function useDialog({
  open,
  onClose,
  windowRef,
  initialFocus,
  closeOnEscape = true,
}: UseDialogOptions): void {
  // Move focus in on open, hand it back on close.
  useEffect(() => {
    if (!open) return;
    // Copied into locals rather than read from refs inside the cleanup. By the time
    // cleanup runs the refs point at the *next* render's nodes, so restoring from
    // them would focus the wrong element.
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = windowRef.current;

    const target = initialFocus?.current ?? focusables(root)[0] ?? null;
    // Deferred one frame: on first mount the dialog may not be laid out yet, and
    // focusing an element that is still display:none silently does nothing.
    const raf = requestAnimationFrame(() => target?.focus());

    return () => {
      cancelAnimationFrame(raf);
      if (!previous?.isConnected) return;
      // Only restore if focus is still inside the dialog. If the player already
      // moved on, yanking focus back would be worse than leaving it.
      const active = document.activeElement;
      const stillInside = active instanceof Node && root?.contains(active);
      if (stillInside || active === document.body) previous.focus();
    };
  }, [initialFocus, open, windowRef]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEscape) {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = focusables(windowRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeOnEscape, onClose, open, windowRef]);
}

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true'
  );
}
