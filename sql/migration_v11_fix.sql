-- migration_v11_fix.sql — Clientes/Proveedores (personas) + numeración + roles + tipos proveedor
begin;

-- 0) Numeración automática
create sequence if not exists public.client_number_seq;
create or replace function public.set_client_number()
returns trigger language plpgsql as $$
begin
  if new.client_number is null or new.client_number = '' then
    new.client_number := 'CL-' || to_char(nextval('public.client_number_seq'), 'FM000000');
  end if;
  return new;
end;
$$;
alter table public.clients add column if not exists client_number text unique;
drop trigger if exists trg_set_client_number on public.clients;
create trigger trg_set_client_number before insert on public.clients for each row execute function public.set_client_number();

-- 1) Campos en clients
alter table public.clients
  add column if not exists is_active boolean not null default true,
  add column if not exists is_client boolean not null default true,
  add column if not exists is_supplier boolean not null default false,
  add column if not exists afip_category text check (afip_category in ('RI','Mono')),
  add column if not exists supplier_type_id bigint;

-- 2) Tabla supplier_types
create table if not exists public.supplier_types(
  id bigserial primary key,
  name text not null,
  created_at timestamp with time zone default now()
);

-- 3) FK segura (sin IF NOT EXISTS directo)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_supplier_type_fk'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_supplier_type_fk
      foreign key (supplier_type_id)
      references public.supplier_types(id)
      on delete set null;
  end if;
end $$;

-- 4) Vista actualizada
drop view if exists public.clients_view cascade;
create view public.clients_view as
  select
    c.id, c.client_number,
    c.is_active, c.is_client, c.is_supplier, c.afip_category,
    c.nombre, c.telefono, c.cuit, c.email, c.contacto, c.horario,
    c.localidad, c.altura, c.direccion,
    c.lat, c.lng,
    c.address_formatted, c.place_id, c.address_admin_l2, c.address_admin_l1, c.address_country, c.address_postal_code,
    c.comercio_type_id, ct.name as comercio_name,
    c.supplier_type_id, st.name as supplier_name,
    c.created_at, c.updated_at
  from public.clients c
  left join public.commerce_types ct on ct.id = c.comercio_type_id
  left join public.supplier_types st on st.id = c.supplier_type_id;

commit;
