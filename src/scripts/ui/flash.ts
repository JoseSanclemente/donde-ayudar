import gsap from "gsap";

/**
 * A field that changed on its own — filled from somewhere else on the page, not
 * typed. The pulse says which one, in slate: red is «urgent» and «submit» in
 * this same form, and every other hue belongs to a resource category — amber to
 * «Protección personal» right below the field.
 *
 * The ring is drawn once on a throwaway overlay and only its opacity is
 * animated: tweening `box-shadow` on the input itself repaints it on every
 * frame, and the pulse lands exactly when the sheet tween and the map redraw
 * are already holding the main thread.
 */

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

export function flashField(el: HTMLElement): void {
  if (reduceMotion) return;

  const parent = el.parentElement;
  if (!parent) return;
  if (getComputedStyle(parent).position === "static")
    parent.style.position = "relative";

  const previous = parent.querySelector<HTMLElement>(
    `[data-flash-for="${el.id}"]`,
  );
  if (previous) {
    gsap.killTweensOf(previous);
    previous.remove();
  }

  const ring = document.createElement("div");
  ring.dataset.flashFor = el.id;
  ring.setAttribute("aria-hidden", "true");
  Object.assign(ring.style, {
    position: "absolute",
    left: `${el.offsetLeft}px`,
    top: `${el.offsetTop}px`,
    width: `${el.offsetWidth}px`,
    height: `${el.offsetHeight}px`,
    borderRadius: getComputedStyle(el).borderRadius,
    boxShadow: "0 0 0 1px rgba(30,41,59,0.55)",
    backgroundColor: "rgba(30,41,59,0.10)",
    pointerEvents: "none",
    zIndex: "10",
    opacity: "0",
    willChange: "opacity",
  });
  parent.append(ring);

  gsap.to(ring, {
    keyframes: [
      { opacity: 1, duration: 0.18, ease: "power2.out" },
      { opacity: 0, duration: 0.7, ease: "power2.in" },
    ],
    onComplete: () => ring.remove(),
  });
}
