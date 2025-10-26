-- migration_v12_m2m_suppliers.sql — relación N:N de proveedores, búsqueda y chips
begin;

-- 1) Tabla puente N:N
create table if not exists public.clients_supplier_types(
  client_id uuid references public.clients(id) on delete cascade,
  supplier_type_id bigint references public.supplier_types(id) on delete cascade,
  created_at timestamp with time zone default now(),
  primary key (client_id, supplier_type_id)
);

-- 2) Vista agregada con arrays y csv
drop view if exists public.clients_view cascade;
create view public.clients_view as
  with st as (
    select cst.client_id,
           array_agg(distinct st.id) filter (where st.id is not null) as supplier_type_ids,
           array_agg(distinct st.name) filter (where st.name is not null) as supplier_names,
           array_to_string(array_agg(distinct st.name) filter (where st.name is not null), ', ') as supplier_names_csv
    from public.clients_supplier_types cst
    left join public.supplier_types st on st.id = cst.supplier_type_id
    group by cst.client_id
  )
  select
    c.id, c.client_number,
    c.is_active, c.is_client, c.is_supplier, c.afip_category,
    c.nombre, c.telefono, c.cuit, c.email, c.contacto, c.horario,
    c.localidad, c.altura, c.direccion,
    c.lat, c.lng,
    c.address_formatted, c.place_id, c.address_admin_l2, c.address_admin_l1, c.address_country, c.address_postal_code,
    c.comercio_type_id, ct.name as comercio_name,
    coalesce(st.supplier_type_ids, '{{}}'::bigint[]) as supplier_type_ids,
    coalesce(st.supplier_names, '{{}}'::text[]) as supplier_names,
    coalesce(st.supplier_names_csv, '') as supplier_names_csv,
    c.created_at, c.updated_at
  from public.clients c
  left join public.commerce_types ct on ct.id = c.comercio_type_id
  left join st on st.client_id = c.id;

commit;
