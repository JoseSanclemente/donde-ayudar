import { SITE_URL } from "../../consts";
import { getShareCard } from "../map";
import { showToast } from "@/lib/toast";

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
  const warmed = new Set<string>();
  const warm = (event: Event) => {
    const found = cardOf(event);
    if (!found || warmed.has(found.key)) return;
    warmed.add(found.key);
    void loadRenderer().then(({ prefetchShareTiles }) =>
      prefetchShareTiles(found.card),
    );
  };
  document.addEventListener("pointerenter", warm, true);
  document.addEventListener("pointerdown", warm);

  document.addEventListener("click", (event) => {
    const button = (
      event.target as HTMLElement | null
    )?.closest<HTMLButtonElement>("[data-share]");
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

function cardOf(event: Event) {
  const button = (
    event.target as HTMLElement | null
  )?.closest?.<HTMLButtonElement>("[data-share]");
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
  if (button.disabled) return;

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
        if (error instanceof DOMException && error.name === "AbortError")
          return;

        console.error("share sheet failed", error);
      }
    }

    download(file);

    let copied = false;
    try {
      await navigator.clipboard.writeText(SITE_URL);
      copied = true;
    } catch {}
    showToast(
      copied ? "Imagen descargada y enlace copiado." : "Imagen descargada.",
    );
  } catch (error) {
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

  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
