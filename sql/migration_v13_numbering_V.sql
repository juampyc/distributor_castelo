-- migration_v13_numbering_V.sql — cambia numeración a 'V-0001' (4 dígitos) y ofrece backfill opcional

begin;

-- 1) Nueva secuencia y trigger para prefijo V- y 4 dígitos
create sequence if not exists public.vendor_number_seq;

create or replace function public.set_vendor_number()
returns trigger language plpgsql as $$
begin
  if new.client_number is null or new.client_number = '' then
    new.client_number := 'V-' || to_char(nextval('public.vendor_number_seq'), 'FM0000');
  end if;
  return new;
end;
$$;

-- 2) Reasignar trigger para usar la nueva función
drop trigger if exists trg_set_client_number on public.clients;
create trigger trg_set_client_number before insert on public.clients for each row execute function public.set_vendor_number();

-- 3) Semilla de la secuencia (opción rápida): usa el máx. numérico actual encontrado
--    Si venías con 'CL-000001', mantendrá la continuidad (aunque sea más de 4 dígitos, el formateo mostrará todos).
select setval('public.vendor_number_seq',
  coalesce( (select max(nullif(regexp_replace(client_number, '\D','','g'), '')::int) from public.clients), 0 )
);

commit;

-- ================== OPCIONAL (EJECUTAR APARTE SI QUERÉS "RENUMERAR" TODO) ==================
-- Esto renumera TODAS las filas con formato V-0001, V-0002, ... según created_at.
-- OJO: si otro sistema referencia client_number, revisá antes.
/*
begin;
with ord as (
  select id, row_number() over(order by created_at, id) as rn
  from public.clients
)
update public.clients c
set client_number = 'V-' || to_char(o.rn, 'FM0000')
from ord o
where o.id = c.id;

-- actualizar secuencia al máximo nuevo
select setval('public.vendor_number_seq', (select max(nullif(regexp_replace(client_number, '\D','','g'), '')::int) from public.clients));
commit;
*/
