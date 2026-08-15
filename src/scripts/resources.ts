export type ResourceCategory = {
  id: string;
  label: string;
  /**
   * Va delante de la etiqueta, y en todas partes: `categoryTitle` los pega. Va
   * aparte y no dentro de `label` porque el acordeón lo pinta más grande que el
   * texto, y para eso necesita su propio elemento.
   */
  emoji: string;
  items: string[];
  /** Chip en la lista de reportes y los popups del mapa. */
  chip: string;
  /** Chip seleccionado dentro del formulario. */
  chipOn: string;
  /**
   * Subconjunto de `items` que tiene sentido en un punto de donación. Hoy solo
   * lo usa `categoryItemsEnPunto`, al expandir un `recibe` viejo guardado por
   * categoría: es lo que ese punto mostraba antes, y así no empieza a prometer
   * lo que ahí no pasa.
   */
  itemsEnPunto?: string[];
};

// Las clases de Tailwind van escritas completas y literales a propósito: el
// escáner lee estos archivos como texto plano, así que cualquier interpolación
// (`bg-${color}-50`) se quedaría sin compilar y el chip saldría sin fondo.
export const CATEGORIES: ResourceCategory[] = [
  {
    // El id se queda como estaba aunque la etiqueta cambie: es el valor que
    // guardan la `category` de las ofertas y los `recibe` de los puntos que se
    // publicaron antes de que la columna nombrara insumos.
    id: "herramientas",
    label: "Protección personal",
    emoji: "🧤",
    items: ["Guantes de construcción", "Gafas", "Tapabocas N95", "Cascos"],
    chip: "border-amber-800 bg-amber-50 text-amber-800",
    chipOn: "border-amber-500 bg-amber-500 text-white",
  },
  {
    // Herramienta de escombro, separada de la protección: en un rescate son dos
    // pedidos distintos y casi nunca los trae la misma persona.
    id: "rescate",
    label: "Rescate y escombros",
    emoji: "⛏️",
    items: [
      "Baldes",
      "Cinceles",
      "Cintas de seguridad",
      "Costales",
      "Discos de pulidora para varilla",
      "Palas",
      "Percutores",
      "Picas",
      "Porras",
      "Seguetas",
    ],
    chip: "border-orange-800 bg-orange-50 text-orange-800",
    chipOn: "border-orange-600 bg-orange-600 text-white",
  },
  {
    id: "logistica",
    label: "Logística y energía",
    emoji: "🔦",
    items: [
      "ACPM",
      "Bancos de energía (Powerbank)",
      "Baños portátiles",
      "Carpas",
      "Chalecos",
      "Cobijas ",
      "Colchonetas",
      "Extensiones",
      "Hielo",
      "Linternas",
      "Mangueras +10 metros",
      "Megáfonos",
      "Neveras de icopor",
      "Pilas AA",
      "Plantas eléctricas",
    ],
    chip: "border-cyan-800 bg-cyan-50 text-cyan-800",
    chipOn: "border-cyan-600 bg-cyan-600 text-white",
  },
  {
    id: "bebes",
    label: "Insumos para bebés",
    emoji: "🍼",
    items: [
      "Cremas para pañalitis",
      "Leche en polvo",
      "Pañales",
      "Suplementos nutricionales (Ensure)",
      "Toallitas húmedas",
    ],
    chip: "border-pink-800 bg-pink-50 text-pink-800",
    chipOn: "border-pink-500 bg-pink-500 text-white",
  },
  {
    id: "alimentos",
    label: "Alimentos",
    emoji: "🥫",
    items: [
      "Aceite",
      "Agua",
      "Alimentos preparados",
      "Arroz",
      "Bebidas energizantes",
      "Café",
      "Enlatados",
      "Granos",
      "Jugos",
    ],
    chip: "border-emerald-800 bg-emerald-50 text-emerald-800",
    chipOn: "border-emerald-600 bg-emerald-600 text-white",
  },
  {
    id: "primeros-auxilios",
    label: "Primeros auxilios",
    emoji: "🩹",
    items: [
      "Agua oxigenada",
      "Alcohol",
      "Caja de guantes de látex",
      "Esparadrapo",
      "Gasas",
      "Isodine",
      "Micropore",
      "Tijeras",
    ],
    chip: "border-sky-800 bg-sky-50 text-sky-800",
    chipOn: "border-sky-600 bg-sky-600 text-white",
  },
  {
    id: "medicamentos",
    label: "Insumos médicos y medicamentos",
    emoji: "💊",
    items: [
      "Acetaminofén",
      "Ambulancia",
      "Ampollas de dipirona",
      "Balas de oxígeno",
      "Cánulas",
      "Catéter #18 o #24",
      "Catéteres 14G y 20G",
      "Dextrosa al 5% y al 10%",
      "Diclofenaco",
      "Equipo de macrogoteo",
      "Meloxicam",
      "Pañales para adultos",
      "Pastas para la diarrea",
      "Piroxicam",
      "Solución salina",
    ],
    chip: "border-teal-800 bg-teal-50 text-teal-800",
    chipOn: "border-teal-600 bg-teal-600 text-white",
  },
  {
    id: "aseo-personal",
    label: "Aseo personal",
    emoji: "🧼",
    items: [
      "Cepillo de dientes",
      "Crema dental",
      "Jabón de cuerpo",
      "Papel higiénico",
      "Shampoo",
    ],
    chip: "border-blue-800 bg-blue-50 text-blue-800",
    chipOn: "border-blue-600 bg-blue-600 text-white",
  },
  {
    id: "mascotas",
    label: "Mascotas",
    emoji: "🐾",
    items: [
      "Alimento húmedo para mascotas",
      "Alimento seco para mascotas",
      "Arena para gatos",
      "Cánulas de oxígeno",
      "Correas para perros",
      "Fluimucil inyectable",
      "Piperacilina",
      "Propofol",
      "Sondas endotraqueales 3.0 a 10",
      "Sondas urinarias o vesicales rígidas",
      "Suturas absorbibles",
      "Suturas no absorbibles",
      "Tapones heparinizados",
      "Tazobactam",
    ],
    chip: "border-fuchsia-800 bg-fuchsia-50 text-fuchsia-800",
    chipOn: "border-fuchsia-600 bg-fuchsia-600 text-white",
  },
  {
    id: "voluntarios",
    label: "Voluntarios",
    emoji: "🙋",
    items: [
      "Ayuda para organizar donaciones",
      "Cuidado de niños y adultos mayores",
      "Donantes de sangre",
      "Médicos y auxiliares de enfermería",
      "Operadores de máquinas pesadas",
      "Remover escombros",
      "Transporte de insumos",
    ],
    itemsEnPunto: ["Transporte de insumos", "Ayuda para organizar donaciones"],
    chip: "border-violet-800 bg-violet-50 text-violet-800",
    chipOn: "border-violet-600 bg-violet-600 text-white",
  },
];

const BY_ID = new Map(
  CATEGORIES.map((category) => [category.id, category] as const),
);

/**
 * Ids de categoría que ya no existen, y en qué se convirtieron. Un `recibe`
 * viejo guardado por categoría —no por insumo— sigue diciendo `salud`, y sin
 * esta tabla ese punto de acopio caería a «Otros», en gris, prometiendo menos de
 * lo que recibe. No hay que migrar la fila: se traduce al leer.
 */
const LEGACY_CATEGORY_IDS: Record<string, string[]> = {
  salud: ["primeros-auxilios", "medicamentos", "aseo-personal"],
};

/**
 * El catálogo es texto escrito a mano y alguno trae un espacio de sobra al
 * final, así que la llave va recortada y todo el que pregunta recorta también
 * (`key`). Sin eso, un reporte guardado con el nombre limpio y otro con el
 * espacio serían dos recursos distintos: dos chips, dos colores, y ninguno de
 * los dos se deja marcar como cubierto por el otro.
 */
const BY_RESOURCE = new Map(
  CATEGORIES.flatMap((category) =>
    category.items.map((item) => [item.trim(), category] as const),
  ),
);

function key(resource: string): string {
  return resource.trim();
}

/**
 * El texto del ítem es la llave del catálogo: si un mismo recurso aparece en
 * dos categorías, la última gana en silencio —`BY_RESOURCE` la pisa— y les
 * cambia el color a reportes ya guardados.
 *
 * Only runs in dev (see below). It used to run at build time, from the schema
 * of the content collection that no longer exists; dev is the next-closest
 * place, because it is where this catalog gets edited. In production a throw
 * here would take the whole map down over a chip color.
 */
export function assertUniqueItems(): void {
  const seen = new Map<string, string>();
  for (const category of CATEGORIES) {
    for (const item of category.items.map((name) => name.trim())) {
      const previous = seen.get(item);
      if (previous) {
        throw new Error(
          `El recurso «${item}» está repetido en las categorías «${previous}» y «${category.id}». Déjalo en una sola.`,
        );
      }
      seen.set(item, category.id);
    }
  }
}

if (import.meta.env.DEV) assertUniqueItems();

/** Recursos escritos a mano y reportes viejos con recursos fuera del catálogo. */
export const OTHER_CHIP = "border-slate-700 bg-slate-100 text-slate-700";
const OTHER_CHIP_ON = "border-slate-600 bg-slate-600 text-white";

/** Recurso que la zona ya no necesita: se ve, pero apagado. */
export const COVERED_CHIP =
  "border-slate-400 bg-slate-100 text-slate-400 line-through";

/**
 * Ni los bancos de sangre ni los albergues son categorías del catálogo — no son
 * algo que un edificio afectado pueda pedir — pero sí valores del filtro de
 * puntos curados: filtran por tipo de punto, no por qué se recibe. Cada uno
 * necesita entonces su propio par de clases.
 */
export const SANGRE_FILTER = "sangre";
export const SANGRE_CHIP = "border-rose-800 bg-rose-50 text-rose-800";
const SANGRE_CHIP_ON = "border-rose-600 bg-rose-600 text-white";

export const ALBERGUE_FILTER = "albergue";
const ALBERGUE_CHIP_ON = "border-amber-600 bg-amber-600 text-white";

/** Filtros por tipo de punto, en un mapa: un cuarto tipo es una entrada más. */
const RESERVED_CHIP_ON: Record<string, string> = {
  [SANGRE_FILTER]: SANGRE_CHIP_ON,
  [ALBERGUE_FILTER]: ALBERGUE_CHIP_ON,
};

export const CHIP_BASE =
  "chip rounded-full border px-3 py-1 text-xs font-medium transition";
export const CHIP_OFF = `${CHIP_BASE} border-slate-300 bg-white text-slate-700 hover:border-slate-400`;

export function chipClass(resource: string): string {
  return BY_RESOURCE.get(key(resource))?.chip ?? OTHER_CHIP;
}

/** Como `chipClass`, pero la llave es el id de categoría (centros de acopio). */
export function categoryChip(categoryId: string): string {
  return BY_ID.get(categoryId)?.chip ?? OTHER_CHIP;
}

/**
 * El nombre de la categoría con su emoji delante, para donde el encabezado es
 * una sola línea de texto y no puede darle al emoji su propio tamaño: el
 * `<option>` de las ofertas, el chip de una oferta, el bloque de un popup. El
 * acordeón no llama acá — pinta las dos partes por separado.
 */
export function categoryTitle(categoryId: string): string {
  const category = BY_ID.get(categoryId);
  return category ? `${category.emoji} ${category.label}` : categoryId;
}

/**
 * La categoría a la que pertenece un insumo. `byCategory` responde lo mismo,
 * pero reparte una lista entera: el filtro del mapa pregunta por uno solo.
 */
export function categoryIdOf(resource: string): string | undefined {
  return BY_RESOURCE.get(key(resource))?.id;
}

/** Si el texto es un id del catálogo y no el nombre de un insumo. */
export function isCategoryId(value: string): boolean {
  return BY_ID.has(value) || value in LEGACY_CATEGORY_IDS;
}

/**
 * Qué entra en una categoría, visto desde un punto de donación. Es la traducción
 * de un `recibe` viejo, guardado por categoría y no por insumo: si la categoría
 * declaró un `itemsEnPunto`, ese manda — un acopio sigue recibiendo
 * «Voluntarios», solo que la lista no promete lo que ahí no pasa. Los nombres se
 * recortan: el catálogo es texto escrito a mano y alguno trae un espacio de
 * sobra al final.
 *
 * Una categoría que se partió responde por sus herederas, unidas: es lo mismo
 * que ese punto venía mostrando antes de la partición.
 */
export function categoryItemsEnPunto(categoryId: string): string[] {
  const heirs = LEGACY_CATEGORY_IDS[categoryId];
  if (heirs) return heirs.flatMap((id) => categoryItemsEnPunto(id));

  const category = BY_ID.get(categoryId);
  return (category?.itemsEnPunto ?? category?.items ?? []).map((item) =>
    item.trim(),
  );
}

export type CategoryBucket<T> = { id: string; label: string; items: T[] };

/** Categoría de lo que alguien escribió a mano o quedó fuera del catálogo. */
const OTHER_BUCKET = { id: "otros", label: "Otros" };

/**
 * Reparte recursos en sus categorías, en el orden de `CATEGORIES`, y deja al
 * final lo que no está en el catálogo. Solo devuelve categorías con ítems: una
 * zona pide cinco cosas, no las siete familias.
 *
 * Genérica a propósito — la llaman tanto con `string[]` como con los recursos
 * agregados de una zona, que traen su propio estado de cubierto.
 */
export function byCategory<T>(
  items: T[],
  nameOf: (item: T) => string,
): CategoryBucket<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const id = BY_RESOURCE.get(key(nameOf(item)))?.id ?? OTHER_BUCKET.id;
    const bucket = buckets.get(id) ?? [];
    bucket.push(item);
    buckets.set(id, bucket);
  }

  const ordered = [...CATEGORIES, OTHER_BUCKET];
  return ordered
    .filter((category) => buckets.has(category.id))
    .map((category) => ({
      id: category.id,
      // «Otros» no está en el catálogo y no tiene emoji: se queda con su texto.
      label: BY_ID.has(category.id)
        ? categoryTitle(category.id)
        : category.label,
      items: buckets.get(category.id) as T[],
    }));
}

export function chipOnClass(categoryId: string | undefined): string {
  const reserved = categoryId ? RESERVED_CHIP_ON[categoryId] : undefined;
  if (reserved) return `${CHIP_BASE} ${reserved}`;
  const category = categoryId ? BY_ID.get(categoryId) : undefined;
  return `${CHIP_BASE} ${category?.chipOn ?? OTHER_CHIP_ON}`;
}
