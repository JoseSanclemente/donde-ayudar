import { createEmitter } from "./emitter";

const errors = createEmitter<string>();

/** Fallo de una escritura puntual, con la caché ya revertida. */
export const reportError = errors.emit;

export const onError = errors.on;

/**
 * `22023` lo levantan nuestras funciones y triggers: los mensajes ya están en
 * español, son cortos y no filtran nada. Mostrarlos tal cual es la diferencia
 * entre «espera un minuto» y un «no se pudo guardar» que invita a reintentar en
 * bucle. Cualquier otro código es ruido de Postgres y se traduce al genérico.
 */
export function errorMessage(
  error: { code?: string; message?: string } | null,
  fallback: string,
): string {
  if (error?.code === "22023" && error.message) return error.message;
  return fallback;
}
