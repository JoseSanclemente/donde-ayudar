/**
 * Donation points — collection centers, blood banks and shelters. Never
 * editable from the interface, whoever published them.
 *
 * This module is only the shape of one: the types and the narrowing everyone
 * shares. They live in the `centros` table, where a curated point is written by
 * a maintainer with `service_role` and a community one is registered from the
 * form; reading them is `data/centros.ts`, and drawing them is `map.ts`.
 */
import { hoursSince } from "./ui/time";

export type Origen = "curado" | "comunidad";

type Base = {
  id: string;
  name: string;
  direccion: string;
  lat: number;
  lng: number;
  horario: string;
  telefono?: string;
  notas?: string;
  /**
   * Who published it. It is not a fourth kind of point — the map keeps the same
   * shape and only lightens the colour — but the popup does say it, on both
   * origins: «creado por la comunidad» means nothing if the alternative goes
   * unlabelled.
   */
  origen: Origen;
  /**
   * Author of a community point, so they can delete their own. A curated one
   * has none: the table editor publishes it, not a session.
   */
  userId: string | null;
  /**
   * `false` = still open, not taking donations right now. No `?`: the column is
   * `not null default true`, so the store always has a value to hand over.
   *
   * It sits on every type, not only the ones that take supplies: a blood bank
   * that already met its demand stops taking donors the same way, and hiding it
   * from the map would send people who saw it yesterday to a closed door.
   */
  recibiendo: boolean;
  /** Por qué no recibe. Solo se muestra con `recibiendo: false`. */
  nota_estado?: string;
  /**
   * The last time somebody said this point is still open. No `?` either: the
   * column is `not null default now()`.
   *
   * Only a community point is read against it — see `isExpired`.
   */
  confirmedAt: string;
};

/** Lo que comparten los puntos que reciben insumos: `acopio` y `albergue`. */
type Recibidor = {
  /**
   * Nombres de insumo del catálogo de `resources.ts` — los mismos que pide un
   * reporte. Guardar la categoría entera hacía que un punto que solo recibe
   * pañales prometiera también leche en polvo. Las filas viejas sí traen ids de
   * categoría, y `data/centros.ts` los expande al leerlas.
   */
  recibe: string[];
};

export type CentroAcopio = Base & Recibidor & { tipo: "acopio" };

/** Punto de donación de sangre: no recibe insumos, no lleva `recibe`. */
export type BancoSangre = Base & { tipo: "sangre" };

/** Albergue: recibe personas, y también insumos — lleva `recibe` como un acopio. */
export type Albergue = Base & Recibidor & { tipo: "albergue" };

export type Centro = CentroAcopio | BancoSangre | Albergue;

/**
 * Narrowing en un solo sitio: los tipos que reciben insumos son todos menos
 * `sangre`. Repetir `tipo === "acopio"` en cada consumidor es justo lo que se
 * rompe al agregar un cuarto tipo.
 */
export function recibeInsumos(centro: Centro): centro is CentroAcopio | Albergue {
  return centro.tipo !== "sangre";
}

/** Lo registró alguien desde el formulario, no un maintainer. */
export function esComunitario(centro: Centro): boolean {
  return centro.origen === "comunidad";
}

/**
 * A full day, the same a report pin gets (`IDLE_HOURS` in `status.ts`). A
 * warehouse that took donations one afternoon is a different question the next
 * morning and nobody goes back to the site to close it, so the point does have
 * to expire — but a day is what makes the two halves of the map age at the same
 * rate. A need and the place answering it are read side by side, and one of
 * them fading out first only says the map is inconsistent.
 */
export const EXPIRY_HOURS = 24;

/**
 * Nobody has confirmed this point in `EXPIRY_HOURS`, so the map stops showing
 * it as open — grey, like a pause, and one tap away from coming back.
 *
 * Only a community `acopio`. A curated point is a maintainer's, who edits it in
 * the table editor and takes it down when it closes; expiring it would be
 * greying out the points the city actually vouches for. And only a collection
 * center: a shelter has people sleeping in it and a blood bank keeps hospital
 * hours — neither is the improvised thing that opens for an afternoon and is
 * gone by morning, which is the whole reason this exists.
 */
export function isExpired(centro: Centro): boolean {
  return (
    centro.tipo === "acopio" &&
    esComunitario(centro) &&
    hoursSince(centro.confirmedAt) >= EXPIRY_HOURS
  );
}

