/**
 * Utilidades de DOM compartidas por las features. No conocen ni el store ni el
 * mapa: solo hablan con elementos que ya existen en el HTML.
 */

/**
 * Los ids los pone el layout, así que faltar uno es un error de programación,
 * no un caso a manejar. Antes el cast silencioso dejaba pasar el `undefined` y
 * el fallo aparecía diez líneas después, en otra función.
 */
export function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id} en el HTML.`);
  return el as T;
}

/** Para lo que sí puede no estar: tarjetas que solo se renderizan con datos. */
export function maybe$<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function showError(el: HTMLElement, message: string): void {
  el.textContent = message;
  el.classList.remove("hidden");
}

export function clearError(el: HTMLElement): void {
  el.textContent = "";
  el.classList.add("hidden");
}

/**
 * Envuelve un render para que una ráfaga de cambios pinte una sola vez. Cada
 * store emite por su cuenta y realtime los dispara casi a la vez: sin esto, un
 * insert que toca dos tablas rearma la lista dos veces en el mismo frame.
 */
export function scheduleRender(render: () => void): () => void {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      render();
    });
  };
}
