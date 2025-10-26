-- Ejecutar en Supabase (Query editor)
begin;
drop view if exists public.clients_view cascade;
alter table public.clients
  add column if not exists address_formatted text,
  add column if not exists place_id text,
  add column if not exists address_admin_l2 text,
  add column if not exists address_admin_l1 text,
  add column if not exists address_country text,
  add column if not exists address_postal_code text;
do $$ begin
  if exists (select 1 from information_schema.columns where table_name='clients' and column_name='provincia_id') then
    execute 'alter table public.clients alter column provincia_id drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_name='clients' and column_name='partido_id') then
    execute 'alter table public.clients alter column partido_id drop not null';
  end if;
end $$;
do $$ begin
  if exists (select 1 from information_schema.columns where table_name='clients' and column_name='provincia_id') then
    alter table public.clients drop column provincia_id;
  end if;
  if exists (select 1 from information_schema.columns where table_name='clients' and column_name='partido_id') then
    alter table public.clients drop column partido_id;
  end if;
end $$;
do $$ begin
  if exists (select 1 from information_schema.tables where table_name='partidos') then
    drop table public.partidos cascade;
  end if;
  if exists (select 1 from information_schema.tables where table_name='provinces') then
    drop table public.provinces cascade;
  end if;
end $$;
create or replace view public.clients_view as
  select
    c.id, c.nombre, c.telefono, c.cuit, c.email, c.contacto,
    c.localidad, c.altura, c.direccion,
    c.lat, c.lng,
    c.address_formatted, c.place_id, c.address_admin_l2, c.address_admin_l1, c.address_country, c.address_postal_code,
    c.comercio_type_id, ct.name as comercio_name,
    c.created_at, c.updated_at
  from public.clients c
  left join public.commerce_types ct on ct.id = c.comercio_type_id;
commit;