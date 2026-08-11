# Puntos de donación

Lugares físicos donde la gente **entrega** donaciones. Son distintos de los reportes:
un reporte lo crea cualquier visitante desde el formulario y vive solo en su navegador;
un punto de esta carpeta es información curada que le decimos a la ciudad que es cierta.

Un dato malo acá manda gente con mercado en el carro a una dirección que no existe.

Hay dos tipos, y el campo `tipo` los separa:

- **`acopio`** — centro de acopio. Recibe insumos, así que lleva `recibe`.
- **`sangre`** — banco de sangre. **No** lleva `recibe`: lo que se dona es sangre.
  Ponerle `recibe` hace fallar el build a propósito.

## Quién puede agregar uno

Solo quien tenga acceso de escritura a este repositorio. **Ese es el único
mecanismo de permisos del proyecto**: el sitio es estático, no hay login ni
servidor, y estos archivos se leen en tiempo de build. Un visitante no tiene
manera de escribir acá.

Si alguien de afuera quiere proponer un centro, que lo reporte por el canal del
equipo y un mantenedor lo verifica y lo agrega.

## Regla

No se agrega un centro sin **confirmarlo directamente**: llamada al teléfono
público, publicación oficial de la organización, o alguien del equipo que estuvo
ahí. Nada de "lo vi en un estado de WhatsApp".

## Cómo agregar uno

1. Copia `_plantilla.yaml` a `<nombre-kebab-case>.yaml`. El nombre del archivo es
   el id de la entrada.
2. Llena los campos y pon `activo: true`.
3. `pnpm build` — si el archivo está mal, el build falla con el error de schema.

> **Trampa de YAML:** el `#` de la nomenclatura colombiana abre un comentario.
> `direccion: Calle 5 # 38-25` se guarda como `"Calle 5"` y el build **no falla**,
> porque el campo sigue siendo un texto válido. Siempre entre comillas:
> `direccion: "Calle 5 # 38-25, San Fernando"`. Lo mismo con el `+` del teléfono.

## Campos

| Campo       | Requerido | Qué es                                                                                      |
| ----------- | --------- | ------------------------------------------------------------------------------------------- |
| `tipo`      | sí        | `acopio` o `sangre`. Sin valor por defecto: hay que declararlo. Decide el marcador y el filtro. |
| `name`      | sí        | Nombre oficial del punto.                                                                     |
| `direccion` | sí        | Dirección completa con barrio, **entre comillas**. Sale en el popup del mapa.                 |
| `lat`       | sí        | Latitud decimal (número, no texto).                                                           |
| `lng`       | sí        | Longitud decimal. En Cali es negativa (≈ -76.5).                                              |
| `horario`   | sí        | Texto libre, tal como se le dice a la gente.                                                  |
| `recibe`    | solo `acopio` | Lista de ids de categoría. Válidos: `herramientas`, `bebes`, `alimentos`, `salud`, `voluntarios`. Definidos en `src/scripts/resources.ts` — el schema los lee de ahí, así que agregar una categoría allá la habilita acá sola. |
| `telefono`  | no        | Entre comillas, para que el `+` no rompa el YAML.                                              |
| `notas`     | no        | Detalle práctico para quien llega.                                                            |
| `activo`    | no        | Por defecto `true`. Un punto que cerró se marca `false`, **no se borra** — así queda el registro. |

## Coordenadas

Abre el punto en [OpenStreetMap](https://www.openstreetmap.org/), clic derecho →
"Mostrar dirección" / "Show address", y copia el par que aparece en la URL
(`#map=19/3.4372/-76.5225` → `lat: 3.4372`, `lng: -76.5225`). Verifica en el mapa
del sitio que el pin caiga en el edificio correcto, no en la esquina.
