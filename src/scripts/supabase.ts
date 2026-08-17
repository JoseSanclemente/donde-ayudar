import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;

export const MISSING_ENV_MESSAGE =
  "Faltan PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_ANON_KEY — los reportes no se pueden cargar.";
