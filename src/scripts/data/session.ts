import { supabase } from "../supabase";

let userId: string | null = null;

/** `null` mientras no haya sesión anónima. */
export function getUserId(): string | null {
  return userId;
}

/**
 * Espejo de la policy de RLS: solo el autor puede borrar lo suyo.
 *
 * El autor admite `null` por los puntos curados, que no lo tienen: los publica
 * el editor de tablas y no una sesión, así que no son de nadie y la respuesta
 * es que no.
 */
export function isMine(row: { userId: string | null }): boolean {
  return userId !== null && row.userId === userId;
}

/**
 * La sesión que ya existe en este navegador, si existe. Es una lectura local
 * —`getSession()` no sale a la red—, y por eso va sola: quien vuelve tiene su
 * `uid` puesto antes de que llegue la primera fila, que es lo que `isMine()`
 * necesita para no dibujar como ajeno lo que es propio.
 */
export async function restoreSession(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  userId = data.session?.user.id ?? null;
  return userId;
}

let signUp: Promise<string | null> | null = null;

/**
 * Una sesión anónima por navegador: da el `uid` que las policies usan para
 * decidir quién puede borrar qué. No pide correo ni contraseña. Lanza si la
 * sesión no se puede abrir — sin ella no se puede escribir nada.
 *
 * Separada de `restoreSession()` porque esta mitad sí es una llamada de red, y
 * es la que se pagaba por delante de las cuatro consultas del arranque. Va
 * memoizada: quien la pide dos veces espera el mismo registro.
 */
export function ensureSession(): Promise<string | null> {
  if (!supabase) return Promise.resolve(null);
  if (userId) return Promise.resolve(userId);
  signUp ??= supabase.auth.signInAnonymously().then(({ data, error }) => {
    if (error) throw error;
    userId = data.user?.id ?? null;
    return userId;
  });
  return signUp;
}
