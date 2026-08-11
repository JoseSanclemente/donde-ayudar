import { supabase } from "../supabase";

let userId: string | null = null;

/** `null` mientras no haya sesión anónima. */
export function getUserId(): string | null {
  return userId;
}

/** Espejo de la policy de RLS: solo el autor puede borrar lo suyo. */
export function isMine(row: { userId: string }): boolean {
  return userId !== null && row.userId === userId;
}

/**
 * Una sesión anónima por navegador: da el `uid` que las policies usan para
 * decidir quién puede borrar qué. No pide correo ni contraseña. Lanza si la
 * sesión no se puede abrir — sin ella no se puede escribir nada.
 */
export async function initSession(): Promise<string | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  userId = sessionData.session?.user.id ?? null;
  if (!userId) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    userId = data.user?.id ?? null;
  }
  return userId;
}
