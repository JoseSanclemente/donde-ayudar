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
 * Espacia las llamadas de una ráfaga: solo corre la última, y `ms` después de
 * que la ráfaga paró. Vivía en `geocode.ts` —su único uso es espaciar las
 * búsquedas mientras alguien escribe—, pero de ahí obligaba a `location-picker`
 * a importar el geocoder entero en el arranque solo por esta función, y el
 * geocoder no hace falta hasta que hay un formulario abierto.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
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
