-- migration_v12_suppliers_m2m.sql
begin;

-- 1) Join table for many-to-many
create table if not exists public.supplier_types_map(
  client_id uuid not null references public.clients(id) on delete cascade,
  supplier_type_id bigint not null references public.supplier_types(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (client_id, supplier_type_id)
);

-- 2) Migrate existing single values (if any)
insert into public.supplier_types_map (client_id, supplier_type_id)
select id, supplier_type_id from public.clients
where supplier_type_id is not null
on conflict do nothing;

-- 3) Drop old single column
do $$ begin
  if exists (select 1 from information_schema.columns where table_name='clients' and column_name='supplier_type_id') then
    alter table public.clients drop column supplier_type_id;
  end if;
end $$;

-- 4) Recreate view with aggregated supplier names
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
    -- Aggregate supplier type names
    string_agg(distinct st.name, ', ' order by st.name) as supplier_names,
    c.created_at, c.updated_at
  from public.clients c
  left join public.commerce_types ct on ct.id = c.comercio_type_id
  left join public.supplier_types_map stm on stm.client_id = c.id
  left join public.supplier_types st on st.id = stm.supplier_type_id
  group by c.id, ct.name;

commit;
