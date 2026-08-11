export type ResourceCategory = {
  id: string;
  label: string;
  items: string[];
  /** Chip en la lista de reportes y los popups del mapa. */
  chip: string;
  /** Chip seleccionado dentro del formulario. */
  chipOn: string;
};

// Las clases de Tailwind van escritas completas y literales a propósito: el
// escáner lee estos archivos como texto plano, así que cualquier interpolación
// (`bg-${color}-50`) se quedaría sin compilar y el chip saldría sin fondo.
export const CATEGORIES: ResourceCategory[] = [
  {
    id: "herramientas",
    label: "Herramientas y protección",
    items: [
      "Guantes",
      "Gafas",
      "Linternas",
      "Cinceles",
      "Picas",
      "Tapabocas N95",
    ],
    chip: "bg-amber-50 text-amber-800",
    chipOn: "border-amber-500 bg-amber-500 text-white",
  },
  {
    id: "bebes",
    label: "Insumos para bebés",
    items: [
      "Pañales",
      "Leche en polvo",
      "Suplementos nutricionales (Ensure)",
      "Toallitas húmedas",
      "Cremas para pañalitis",
    ],
    chip: "bg-pink-50 text-pink-800",
    chipOn: "border-pink-500 bg-pink-500 text-white",
  },
  {
    id: "alimentos",
    label: "Alimentos",
    items: ["Enlatados", "Granos", "Arroz", "Aceite", "Agua", "Jugos"],
    chip: "bg-emerald-50 text-emerald-800",
    chipOn: "border-emerald-600 bg-emerald-600 text-white",
  },
  {
    id: "salud",
    label: "Primeros auxilios y aseo",
    items: [
      "Gasas",
      "Alcohol",
      "Jabón de cuerpo",
      "Papel higiénico",
      "Crema dental",
      "Cepillo de dientes",
      "Esparadrapo",
    ],
    chip: "bg-sky-50 text-sky-800",
    chipOn: "border-sky-600 bg-sky-600 text-white",
  },
  {
    id: "voluntarios",
    label: "Voluntarios",
    items: [
      "Remover escombros",
      "Transporte de insumos",
      "Operadores de máquinas pesadas",
      "Donantes de sangre",
      "Ayuda en centros de acopio",
    ],
    chip: "bg-violet-50 text-violet-800",
    chipOn: "border-violet-600 bg-violet-600 text-white",
  },
];

const BY_ID = new Map(
  CATEGORIES.map((category) => [category.id, category] as const),
);

const BY_RESOURCE = new Map(
  CATEGORIES.flatMap((category) =>
    category.items.map((item) => [item, category] as const),
  ),
);

/** Recursos escritos a mano y reportes viejos con recursos fuera del catálogo. */
export const OTHER_CHIP = "bg-slate-100 text-slate-700";
const OTHER_CHIP_ON = "border-slate-600 bg-slate-600 text-white";

/** Recurso que la zona ya no necesita: se ve, pero apagado. */
export const COVERED_CHIP = "bg-slate-100 text-slate-400 line-through";

/**
 * Los bancos de sangre no son una categoría del catálogo — no son algo que un
 * edificio afectado pueda pedir — pero sí un valor del filtro de puntos curados,
 * así que necesitan su propio par de clases.
 */
export const SANGRE_FILTER = "sangre";
export const SANGRE_CHIP = "bg-rose-50 text-rose-800";
const SANGRE_CHIP_ON = "border-rose-600 bg-rose-600 text-white";

export const CHIP_BASE =
  "chip rounded-full border px-3 py-1 text-xs font-medium transition";
export const CHIP_OFF = `${CHIP_BASE} border-slate-300 bg-white text-slate-700 hover:border-slate-400`;

export function chipClass(resource: string): string {
  return BY_RESOURCE.get(resource)?.chip ?? OTHER_CHIP;
}

/** Como `chipClass`, pero la llave es el id de categoría (centros de acopio). */
export function categoryChip(categoryId: string): string {
  return BY_ID.get(categoryId)?.chip ?? OTHER_CHIP;
}

export function categoryLabel(categoryId: string): string {
  return BY_ID.get(categoryId)?.label ?? categoryId;
}

export function chipOnClass(categoryId: string | undefined): string {
  if (categoryId === SANGRE_FILTER) return `${CHIP_BASE} ${SANGRE_CHIP_ON}`;
  const category = categoryId ? BY_ID.get(categoryId) : undefined;
  return `${CHIP_BASE} ${category?.chipOn ?? OTHER_CHIP_ON}`;
}
