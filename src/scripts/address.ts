/**
 * Parser de nomenclatura urbana colombiana.
 *
 * Una dirección de Cali no es una etiqueta: es una coordenada en la malla.
 *
 *   Calle 8B # 45-17  =  sobre la Calle 8B, en el cruce con la Carrera 45,
 *                        a 17 m de esa esquina.
 *
 * De ahí que el parser no devuelva un texto para buscar, sino las dos vías que
 * se cruzan y la distancia a la esquina, que es lo que `grid.ts` necesita para
 * calcular el punto.
 */

/** Nombres tal y como los escribe OSM: "Calle 8B", "Avenida 3 Bis Norte". */
export type CaliAddress = {
  /** Candidatos para la vía principal, el más probable primero. */
  via: string[];
  /** Candidatos para la vía que cruza. Vacío si la dirección no trae placa. */
  cross: string[];
  /** Metros desde la esquina. `null` si no venían en la dirección. */
  placa: number | null;
  /** Forma canónica para mostrar: "Calle 8B # 45-17". */
  label: string;
  /**
   * Lo que quedó sin leer después de la vía y la placa, ya normalizado. Casi
   * siempre vacío; cuando trae algo suele ser el municipio ("…, Yumbo").
   */
  rest: string;
};

/**
 * Nominatim y el índice local usan el nombre completo: sin expandir las
 * abreviaturas locales ("Cra. 56") no hay forma de casar la vía.
 */
const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bak\b/g, "avenida carrera"],
  [/\bac\b/g, "avenida calle"],
  [/\b(cra|cr|kra|kr|krra|carr|k)\b/g, "carrera"],
  [/\b(cll|cl|clle|ca)\b/g, "calle"],
  [/\b(av|avda|avd|ave)\b/g, "avenida"],
  [/\b(dg|diag)\b/g, "diagonal"],
  [/\b(tv|tr|trans|transv)\b/g, "transversal"],
  [/\b(autop)\b/g, "autopista"],
];

/** Ruido que la gente arrastra al final y que no ayuda a ubicar. */
const NOISE =
  /\b(barrio|b\/|apto|apartamento|torre|bloque|casa|interior|int|piso|conjunto|urbanizacion|urbanización|edificio|cali|valle del cauca|colombia)\b.*$/;

const CARDINALS: Record<string, string> = {
  n: "Norte",
  s: "Sur",
  e: "Este",
  o: "Oeste",
  w: "Oeste",
  norte: "Norte",
  sur: "Sur",
  este: "Este",
  oeste: "Oeste",
};

const VIA_TYPES = [
  "avenida carrera",
  "avenida calle",
  "carrera",
  "calle",
  "avenida",
  "diagonal",
  "transversal",
] as const;

/**
 * Las calles corren este-oeste y las carreras norte-sur, así que una dirección
 * siempre cruza con la familia contraria. Diagonales y transversales son la
 * misma malla girada; la avenida sin apellido, en el norte de Cali, se comporta
 * como carrera ("Avenida 6 Norte").
 */
const CROSS_TYPES: Record<string, string[]> = {
  calle: ["Carrera", "Avenida Carrera", "Transversal", "Avenida"],
  "avenida calle": ["Carrera", "Avenida Carrera", "Transversal", "Avenida"],
  diagonal: ["Transversal", "Carrera", "Avenida Carrera"],
  carrera: ["Calle", "Avenida Calle", "Diagonal"],
  "avenida carrera": ["Calle", "Avenida Calle", "Diagonal"],
  transversal: ["Diagonal", "Calle", "Avenida Calle"],
  avenida: ["Calle", "Avenida Calle", "Diagonal"],
};

const titleCase = (value: string) =>
  value.replace(/\b\w/g, (character) => character.toUpperCase());

function normalize(input: string): string {
  let value = input.toLowerCase();
  // "Cra." y "Cra" son la misma vía: el punto solo estorba al matcher.
  value = value.replace(/[.,]/g, " ");
  // "No. 45-17" es la almohadilla escrita en letra. El lookahead es lo que
  // evita que se coma el "no" de "norte".
  value = value.replace(/\bn(o|ro)\b\s*(?=[\d#])/g, "#");
  for (const [pattern, replacement] of ABBREVIATIONS) {
    value = value.replace(pattern, replacement);
  }
  value = value.replace(NOISE, " ");
  return value.replace(/\s+/g, " ").trim();
}

function buildName(
  type: string,
  number: string,
  letter: string,
  bis: boolean,
  cardinal: string,
): string {
  // OSM Colombia: letra pegada al número y en mayúscula, Bis antes del cardinal.
  const parts = [type, ` ${number}${letter.toUpperCase()}`];
  if (bis) parts.push(" Bis");
  if (cardinal) parts.push(` ${cardinal}`);
  return parts.join("");
}

/** Une los candidatos sin repetir y conservando el orden de preferencia. */
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

type Token = { number: string; letter: string; bis: boolean; cardinal: string };

/**
 * Todas las formas en que ese tramo puede estar escrito en OSM, de la más
 * literal a la más laxa. Resuelve la primera que exista en el índice.
 */
function candidates(types: string[], token: Token, inherited: string): string[] {
  const names: string[] = [];

  for (const type of types) {
    const cardinal = token.cardinal || inherited;
    names.push(buildName(type, token.number, token.letter, token.bis, cardinal));
    // "6N" es ambiguo: puede ser la letra N o el cardinal ("Avenida 6 Norte").
    const asCardinal = CARDINALS[token.letter.toLowerCase()];
    if (asCardinal) {
      names.push(buildName(type, token.number, "", token.bis, asCardinal));
    }
    // Último recurso: "Calle 3D" no está mapeada pero "Calle 3" sí, y para
    // ubicar la esquina la manzana es la misma.
    if (token.letter || token.bis) {
      names.push(buildName(type, token.number, "", false, cardinal));
    }
    // Un cardinal escrito jamás se descarta: el norte de Cali numera aparte, y
    // una "Calle 5 Norte" resuelta como "Calle 5" cae a diez kilómetros. El
    // cardinal heredado de la otra vía sí es una conjetura, y admite descarte.
    if (!token.cardinal) {
      names.push(buildName(type, token.number, token.letter, token.bis, ""));
      if (token.letter || token.bis) {
        names.push(buildName(type, token.number, "", false, ""));
      }
    }
  }

  return unique(names);
}

/** Una letra suelta: "8b" sí, la "o" de "oeste" no. */
const LETTER = "([a-z](?![a-z]))?";
const CARDINAL = "(norte|sur|este|oeste)?";

const VIA_PATTERN = new RegExp(
  `^(${VIA_TYPES.join("|")})\\s*` + // tipo de vía
    `(\\d+)\\s*${LETTER}\\s*` + //    número y letra
    `(bis)?\\s*` + //                 bis
    `${CARDINAL}`, //                 cardinal
);

/**
 * "# 45-17", "#45 - 17", "# 45 17" e incluso "# Carrera 45": lo que va tras la
 * almohadilla es la vía que cruza, y lo que va tras el guion son los metros.
 * En Cali se escribe de todas estas formas.
 */
const PLACA_PATTERN = new RegExp(
  `#\\s*(?:(?:${VIA_TYPES.join("|")})\\s*)?` + // tipo del cruce, casi siempre implícito
    `(\\d+)\\s*${LETTER}\\s*(bis)?\\s*${CARDINAL}` + // el cruce
    `(?:\\s*[-–]\\s*|\\s+)(\\d+)`, //                 los metros hasta la esquina
);

/** Sin almohadilla: "Calle 8B 45-17". El guion es lo único que lo delata. */
const BARE_PLACA_PATTERN = new RegExp(`^\\s*(\\d+)\\s*${LETTER}\\s*[-–]\\s*(\\d+)`);

/** Solo el cruce, sin metros: "Calle 6A # 31" ubica la esquina y nada más. */
const CORNER_PATTERN = new RegExp(
  `#\\s*(?:(?:${VIA_TYPES.join("|")})\\s*)?(\\d+)\\s*${LETTER}\\s*(bis)?\\s*${CARDINAL}`,
);

/** `end` es dónde termina la placa dentro del tramo, para poder cortar la cola. */
type Placa = { token: Token; metres: number; end: number };

function parsePlaca(rest: string): Placa | null {
  const full = PLACA_PATTERN.exec(rest);
  if (full) {
    const [, number, letter, bis, cardinal, metres] = full;
    return {
      token: { number, letter: letter ?? "", bis: Boolean(bis), cardinal: cardinal ? CARDINALS[cardinal] : "" },
      metres: Number(metres),
      end: full.index + full[0].length,
    };
  }

  const bare = BARE_PLACA_PATTERN.exec(rest);
  if (bare) {
    const [, number, letter, metres] = bare;
    return {
      token: { number, letter: letter ?? "", bis: false, cardinal: "" },
      metres: Number(metres),
      end: bare.index + bare[0].length,
    };
  }

  const corner = CORNER_PATTERN.exec(rest);
  if (corner) {
    const [, number, letter, bis, cardinal] = corner;
    return {
      token: { number, letter: letter ?? "", bis: Boolean(bis), cardinal: cardinal ? CARDINALS[cardinal] : "" },
      metres: 0,
      end: corner.index + corner[0].length,
    };
  }

  return null;
}

/**
 * Palabras que sobran sin nombrar un lugar: la forma larga de escribir una
 * esquina —"Calle 5 con Carrera 100"— no lleva placa, así que el cruce entero
 * cae en `rest` y hay que descontarlo antes de mirar si quedó un municipio.
 */
const CONNECTORS = /\b(con|esquina|esq|cruce|entre|y|sector|via|vía|frente|al?)\b/g;

/**
 * Una palabra de tres letras o más entre lo que sobró. El umbral es lo que
 * separa un municipio de la basura que deja el recorte del ruido: "2do piso"
 * pierde el "piso" con `NOISE` y deja un "2do" que no nombra a nadie.
 */
const CITY_WORD = /[a-záéíóúñü]{3,}/;

/** Queda algo que nombre un lugar, descontadas las vías y los conectores. */
function hasCityWord(leftovers: string): boolean {
  const words = leftovers
    .replace(new RegExp(`\\b(${VIA_TYPES.join("|")})\\b`, "g"), " ")
    .replace(CONNECTORS, " ");
  return CITY_WORD.test(words);
}

/**
 * Si la dirección nombra un municipio que los índices locales no pueden servir.
 * `NOISE` ya se comió "cali", "valle del cauca", "colombia" y los complementos
 * ("barrio", "apto", "torre"), así que lo que sobra tras leer la nomenclatura
 * es, en la práctica, otro municipio.
 *
 * No es una conjetura sobre comas: es lo que el parser no logró consumir de una
 * dirección bien formada, y por eso "Calle 15 # 31-20 Yumbo" cuenta igual que
 * "Calle 15 # 31-20, Yumbo".
 *
 * Hace falta porque los índices son de Cali y solo de Cali, y resolver la
 * placa de Yumbo contra ellos no falla: devuelve un punto de Cali, con cara de
 * exacto. Un lugar escrito por nombre —"Lomitas, La Cumbre"— no pasa por acá:
 * ese no toca los índices y lo resuelve el segundo intento en `geocode()`.
 */
export function namesAnotherCity(address: CaliAddress): boolean {
  return hasCityWord(address.rest);
}

export function parseAddress(input: string): CaliAddress | null {
  const value = normalize(input);
  const via = VIA_PATTERN.exec(value);
  if (!via) return null;

  const [matched, type, number, letter = "", bis, cardinalToken] = via;
  const cardinal = cardinalToken ? CARDINALS[cardinalToken] : "";
  const viaToken: Token = { number, letter, bis: Boolean(bis), cardinal };
  const viaCandidates = candidates([titleCase(type)], viaToken, "");
  const viaName = viaCandidates[0];

  const tail = value.slice(matched.length);
  const placa = parsePlaca(tail);
  if (!placa) {
    return {
      via: viaCandidates,
      cross: [],
      placa: null,
      label: viaName,
      rest: tail.replace(/^[\s,-]+/, "").trim(),
    };
  }

  const crossTypes = CROSS_TYPES[type] ?? CROSS_TYPES.calle;
  const { token, metres, end } = placa;

  return {
    via: viaCandidates,
    cross: candidates(crossTypes, token, cardinal),
    placa: metres,
    label: `${viaName} # ${token.number}${token.letter.toUpperCase()}-${metres}`,
    rest: tail.slice(end).replace(/^[\s,-]+/, "").trim(),
  };
}
