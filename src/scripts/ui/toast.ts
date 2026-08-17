export function showToast(message: string): void {
  const toast = document.createElement("p");
  toast.setAttribute("role", "status");
  toast.className =
    "fixed inset-x-4 bottom-4 z-[1100] rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg lg:inset-x-auto lg:left-5 lg:max-w-sm";
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 5000);
}
