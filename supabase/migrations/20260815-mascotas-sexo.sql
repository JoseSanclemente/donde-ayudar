-- El sexo de la mascota.
--
-- Quien busca a su perro sabe si es macho o hembra antes que cualquier otra
-- cosa, así que la ficha lo dice. La pregunta se hace por WhatsApp, donde los
-- botones son tres como máximo y `kind` ya los gasta: la conversación crece un
-- paso en vez de un widget, y `pet_intakes` tiene que recordar el primero.
--
-- Delta idempotente. El snapshot completo está en `supabase/schema.sql`.

-- Nullable, y con dos valores nada más: «No sé» es una respuesta legítima ante
-- un animal en la calle y se guarda como NULL. Las mascotas publicadas antes de
-- esta columna también lo llevan en NULL, y nada las distingue — la ficha
-- simplemente no pinta el chip.
alter table public.pets add column if not exists sex text;
alter table public.pets drop constraint if exists pets_sex_check;
alter table public.pets add constraint pets_sex_check
  check (sex is null or sex in ('male', 'female'));

-- La sala de espera ahora abarca dos toques, así que guarda el primero.
alter table public.pet_intakes add column if not exists kind text;

-- De qué mensaje vino ese `kind`. Meta reenvía un webhook que cree fallido, y
-- la copia del mismo toque no puede mandar los botones de sexo dos veces; un
-- segundo toque de verdad sí, porque es una corrección.
alter table public.pet_intakes add column if not exists wa_kind_message_id text;
