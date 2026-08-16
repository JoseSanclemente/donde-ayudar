-- El consentimiento de quien manda la foto, preguntado una sola vez.
--
-- Publicar la foto publica también la forma de escribirle a quien la mandó — su
-- número, o su usuario cuando el número está escondido detrás de uno. Hasta acá
-- eso se avisaba en el primer mensaje y se daba por aceptado al tocar el último
-- botón. Avisar no es preguntar: ahora hay una cuarta pregunta, con dos botones,
-- y la foto no se publica sin un sí.
--
-- Se pregunta la primera vez y nada más. Quien ya dijo que sí manda la segunda
-- foto y la publica en tres toques, como siempre; para eso está `pet_senders`,
-- que es la memoria que `pet_intakes` no puede ser —esa se borra al publicar—.

-- El sexo pasa a guardarse igual que la especie: entre la tercera pregunta y la
-- cuarta hay una espera, y lo que se contestó tiene que sobrevivirla.
alter table public.pet_intakes add column if not exists sex text
  check (sex is null or sex in ('male', 'female', 'unknown'));

-- Y su mensaje, por lo mismo que `wa_kind_message_id`: un reenvío de Meta del
-- mismo toque no puede volver a mandar los botones, y un toque distinto sí,
-- porque es una corrección.
alter table public.pet_intakes add column if not exists wa_sex_message_id text;

-- Quién ya contestó la pregunta, y qué contestó.
--
-- La llave es la dirección con la que la función ya trabaja: los dígitos, o el
-- user id con alcance de negocio de quien escribe desde un usuario. Es la misma
-- que `pet_intakes.wa_from` y no se lee como teléfono en ninguna parte.
--
-- Se guarda en claro y no como hash a propósito: esto es la constancia de un
-- consentimiento, y una constancia que no se puede leer no prueba nada. Vive con
-- las mismas defensas que `pet_intakes` — RLS encendida y ni una policy, así que
-- solo `service_role` la ve — y fuera de `supabase_realtime`.
--
-- No la barre nadie. Un «ya preguntamos» con fecha de vencimiento es volver a
-- preguntarle a quien ya contestó, que es justo lo que se pidió no hacer.
create table if not exists public.pet_senders (
  wa_from     text primary key,
  consented   boolean not null,
  -- Cuándo lo dijo. Es lo que se muestra si alguna vez hay que responder por
  -- una foto publicada.
  decided_at  timestamptz not null default now()
);

alter table public.pet_senders enable row level security;
