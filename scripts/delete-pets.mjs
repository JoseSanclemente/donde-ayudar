/**
 * Takes down a whole batch of pets: the rows and the photos behind them.
 *
 * Nothing in the browser can do this. A pet is deleted by whoever published it
 * (`auth.uid() = user_id`), and a seeded batch is authored by the bot user, whose
 * session nobody holds — so retiring one is a maintainer's job, like putting a
 * `place_name` on a row. What identifies a batch is exactly that `place_name`:
 * one place hands the animals over, and one place takes them back.
 *
 * Rows first and objects second, the same order `removePet` uses in the browser:
 * an object with no row is invisible, while a row pointing at a photo that is
 * gone renders broken for everyone.
 *
 * Run:
 *   node --env-file=.env scripts/delete-pets.mjs "Royi Pets"
 *   node --env-file=.env scripts/delete-pets.mjs "Royi Pets" --apply
 */

import { createClient } from "@supabase/supabase-js";

const BUCKET = "pets";
const TABLE = "pets";

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    fail(`Falta ${name}. Ponelo en .env (sin commitear) y corré con --env-file=.env.`);
  }
  return value;
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const place = args.find((arg) => arg !== "--apply");
if (!place) fail('Falta el lugar. Ejemplo: node scripts/delete-pets.mjs "Royi Pets"');

const admin = createClient(
  required("PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

const { data: pets, error } = await admin
  .from(TABLE)
  .select("id, photo_path")
  .eq("place_name", place);
if (error) fail(error.message);

console.log(`${pets.length} mascotas publicadas en «${place}».`);
if (pets.length === 0) process.exit(0);

// Sin `--apply` no se toca nada: el nombre del lugar se escribe a mano y un
// error de tipeo que no coincide con nada es más barato que uno que sí.
if (!apply) {
  console.log("Prueba en seco. Corré de nuevo con --apply para retirarlas.");
  process.exit(0);
}

const deleted = await admin
  .from(TABLE)
  .delete()
  .in("id", pets.map((pet) => pet.id));
if (deleted.error) fail(deleted.error.message);
console.log(`✓ ${pets.length} filas retiradas.`);

const removed = await admin.storage
  .from(BUCKET)
  .remove(pets.map((pet) => pet.photo_path));
if (removed.error) fail(removed.error.message);
console.log(`✓ ${removed.data.length} fotos borradas del bucket.`);
