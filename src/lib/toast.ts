export interface ToastItem {
  id: string;
  message: string;
  duration?: number;
}

type ToastListener = (toasts: ToastItem[]) => void;

let activeToasts: ToastItem[] = [];
const listeners = new Set<ToastListener>();

function notify(): void {
  for (const listener of listeners) {
    listener(activeToasts);
  }
}

/**
 * Dispatches a new toast notification.
 */
export function toast(message: string, durationMs = 5000): string {
  const id = Math.random().toString(36).slice(2, 10);
  const item: ToastItem = { id, message, duration: durationMs };
  activeToasts = [...activeToasts, item];
  notify();

  if (durationMs > 0) {
    setTimeout(() => {
      dismissToast(id);
    }, durationMs);
  }

  return id;
}

export const showToast = toast;

/**
 * Dismisses an active toast by its identifier.
 */
export function dismissToast(id: string): void {
  activeToasts = activeToasts.filter((t) => t.id !== id);
  notify();
}

/**
 * Subscribes to updates in the active toast queue.
 */
export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  listener(activeToasts);
  return () => {
    listeners.delete(listener);
  };
}
