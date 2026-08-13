import { SITE_URL } from "../../consts";
import { getShareCard } from "../map";
import { showToast } from "../ui/toast";

/**
 * El dibujante de la tarjeta se pide al primer toque de «Compartir», no en el
 * arranque: es un renderizador de canvas de 20 kB que la primera pantalla no
 * usa. El `import()` se resuelve una sola vez —el módulo queda en la caché de
 * módulos— y no cambia la forma de la operación: entre el clic y la hoja nativa
 * ya se esperaba a que se bajaran las teselas del recorte.
 */
const loadRenderer = () => import("../share-card");

/**
 * El botón de compartir del detalle de un marcador: dibuja la imagen del punto
 * y la entrega al sistema. En móvil eso es la hoja nativa —WhatsApp, Instagram,
 * Telegram— con el PNG adjunto; en escritorio casi ningún navegador comparte
 * archivos, así que se descarga y se copia el enlace del sitio.
 *
 * Listener delegado en `document`, por lo mismo que `marker-actions.ts`: el
 * popup y el bottom sheet se rehacen enteros en cada emisión del store, y un
 * listener pegado al nodo habría que volver a pegarlo en cada tick.
 */
export function initShare(): void {
  // Entre el clic y la hoja nativa hay que bajar las teselas del recorte, y el
  // navegador solo da cinco segundos de gesto válido para compartir. Acercarse
  // con el cursor o apoyar el dedo ya dice bastante: desde ahí se pide el
  // dibujante y se calientan las teselas, que quedan en la caché del navegador
  // para cuando el clic las necesite. Nada se guarda de este lado: `map.ts`
  // rehace las tarjetas en cada emisión del store y cualquier cosa que se
  // retuviera acá quedaría vieja.
  //
  // `pointerenter` no burbujea: en captura se recibe el de cada elemento por el
  // que pasa el cursor, así que un punto ya calentado no se vuelve a pedir. La
  // caché del navegador lo resolvería igual, pero sin esto cada temblor del
  // pulso crea otra tanda de `Image`.
  const warmed = new Set<string>();
  const warm = (event: Event) => {
    const found = cardOf(event);
    if (!found || warmed.has(found.key)) return;
    warmed.add(found.key);
    void loadRenderer().then(({ prefetchShareTiles }) => prefetchShareTiles(found.card));
  };
  document.addEventListener("pointerenter", warm, true);
  document.addEventListener("pointerdown", warm);

  document.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      "[data-share]",
    );
    if (!button) return;

    const key = button.dataset.share;
    if (!key) return;
    const card = getShareCard(key);
    if (!card) return;

    void share(button, card.name, async () => {
      const { renderShareCard } = await loadRenderer();
      return renderShareCard(card);
    });
  });
}

/** La tarjeta del botón bajo el evento, si el evento cayó sobre un botón. */
function cardOf(event: Event) {
  const button = (event.target as HTMLElement | null)?.closest?.<HTMLButtonElement>(
    "[data-share]",
  );
  const key = button?.dataset.share;
  if (!key) return null;
  const card = getShareCard(key);
  return card ? { key, card } : null;
}

async function share(
  button: HTMLButtonElement,
  name: string,
  render: () => Promise<Blob>,
): Promise<void> {
  // Dos toques seguidos serían dos renders y dos hojas de compartir.
  if (button.disabled) return;
  // El botón es un icono y no tiene texto que cambiar por «Generando…»: el
  // parpadeo y el cursor son todo el aviso de que algo está pasando. Bajar las
  // teselas no es instantáneo.
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.classList.add("animate-pulse");

  try {
    const blob = await render();
    const file = new File([blob], "donde-ayudar.png", { type: "image/png" });
    const text = `«${name}» — ${SITE_URL}`;

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name, text });
        return;
      } catch (error) {
        // Cancelar la hoja nativa lanza AbortError. No es un fallo: quien la
        // cerró sabe perfectamente lo que hizo, y un aviso ahí sobra.
        if (error instanceof DOMException && error.name === "AbortError") return;
        // Cualquier otro rechazo —el gesto del usuario que caducó mientras
        // bajaban las teselas, un sistema que dice que no— no invalida la
        // imagen: ya está dibujada. Sigue por la descarga, que es lo mismo que
        // hace un navegador sin `canShare`.
        console.error("share sheet failed", error);
      }
    }

    download(file);
    // El enlace va aparte del archivo: la imagen no lleva a ninguna parte por sí
    // sola, y el sitio es lo único que se puede pegar en un mensaje.
    let copied = false;
    try {
      await navigator.clipboard.writeText(SITE_URL);
      copied = true;
    } catch {
      // Sin permiso de portapapeles no pasa nada: la imagen ya se descargó.
    }
    showToast(
      copied
        ? "Imagen descargada y enlace copiado."
        : "Imagen descargada.",
    );
  } catch (error) {
    // Acá solo llega lo que impidió dibujar el PNG: compartir y copiar el
    // enlace tienen su propio rescate más arriba. El aviso al visitante no dice
    // qué pasó —no puede—, así que el error va también a la consola, que es lo
    // único que queda para diagnosticarlo en producción.
    console.error("share card failed", error);
    showToast("No se pudo generar la imagen.");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.classList.remove("animate-pulse");
  }
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  // Revocar de una deja la descarga a medias en Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
