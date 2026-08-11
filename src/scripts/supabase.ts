import { createClient } from "@supabase/supabase-js";

// La anon key es pública por diseño: viaja en el bundle del navegador. Lo que
// protege los datos son las policies de RLS (ver supabase/schema.sql), no el
// secreto de esta llave. La `service_role` NUNCA debe llegar acá.
const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

/** `null` cuando faltan las variables: el sitio sigue en pie, sin reportes. */
export const supabase = url && anonKey ? createClient(url, anonKey) : null;

export const MISSING_ENV_MESSAGE =
  "Faltan PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_ANON_KEY — los reportes no se pueden cargar.";
