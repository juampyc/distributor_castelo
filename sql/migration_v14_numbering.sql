-- migration_v14_numbering.sql — cambia numeración a V-0001 (4 dígitos) para nuevos registros
begin;

-- A) Reemplaza el trigger para nuevos insert
create or replace function public.set_client_number()
returns trigger language plpgsql as $$
begin
  if new.client_number is null or new.client_number = '' then
    new.client_number := 'V-' || to_char(nextval('public.client_number_seq'), 'FM0000');
  end if;
  return new;
end;
$$;

-- B) (Opcional) Reasignar números existentes al nuevo formato.
--    Descomentar si querés regenerar todos a V-0001, V-0002, ...
--    OJO: mantiene el orden actual de la secuencia, podés reiniciarla si querés comenzar desde 0001.
--
-- -- Reiniciar la secuencia (opcional, si querés empezar en 0001):
-- -- alter sequence public.client_number_seq restart with 1;
--
-- with upd as (
--   select id from public.clients
--   order by created_at asc nulls last, id
-- )
-- update public.clients c
-- set client_number = 'V-' || to_char(nextval('public.client_number_seq'), 'FM0000')
-- from upd
-- where c.id = upd.id;

commit;
