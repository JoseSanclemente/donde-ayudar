import { useEffect, useState, type FC, type HTMLAttributes } from "react";
import {
  dismissToast,
  showToast,
  subscribeToasts,
  toast,
  type ToastItem,
} from "@/lib/toast";

export { toast, showToast, dismissToast, subscribeToasts, type ToastItem };

export const TOAST_CLASSES =
  "rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg pointer-events-auto transition";

export interface ToastProps extends HTMLAttributes<HTMLParagraphElement> {
  message?: string;
  onDismiss?: () => void;
}

/**
 * Accessible toast notification item.
 */
export const Toast: FC<ToastProps> = ({
  message,
  className = "",
  children,
  onDismiss,
  onClick,
  ...rest
}) => {
  const combinedClass = `${TOAST_CLASSES} ${className}`.trim();

  return (
    <p
      role="status"
      className={combinedClass}
      onClick={(e) => {
        onClick?.(e);
        onDismiss?.();
      }}
      {...rest}
    >
      {children ?? message}
    </p>
  );
};

export interface ToasterProps extends HTMLAttributes<HTMLDivElement> {
  positionClassName?: string;
}

/**
 * Declarative container that subscribes to the toast store and renders active notifications.
 */
export const Toaster: FC<ToasterProps> = ({
  positionClassName = "fixed inset-x-4 bottom-4 z-[1100] flex flex-col gap-2 pointer-events-none lg:inset-x-auto lg:left-5 lg:max-w-sm",
  className = "",
  ...rest
}) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeToasts(setToasts);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className={`${positionClassName} ${className}`.trim()} {...rest}>
      {toasts.map((item) => (
        <Toast
          key={item.id}
          message={item.message}
          onDismiss={() => dismissToast(item.id)}
        />
      ))}
    </div>
  );
};

export default Toaster;
