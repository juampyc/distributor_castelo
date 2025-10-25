-- Extensiones
create extension if not exists pgcrypto;

-- Tipos de comercio
create table if not exists public.commerce_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

-- Provincias
create table if not exists public.provinces (
  id bigserial primary key,
  name text not null unique
);

-- Partidos / Departamentos
create table if not exists public.partidos (
  id bigserial primary key,
  province_id bigint not null references public.provinces(id) on delete cascade,
  name text not null,
  unique(province_id, name)
);

-- Clientes (con auditoría y geo)
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid,
  updated_by uuid,
  nombre text not null,
  telefono text,
  comercio_type_id uuid references public.commerce_types(id),
  provincia_id bigint references public.provinces(id),
  partido_id bigint references public.partidos(id),
  localidad text,
  calle text,
  altura text,
  direccion text,
  cuit text,
  email text,
  contacto text,
  horario text,
  lat double precision,
  lng double precision
);

-- Vista clientes para listar con labels resueltos
create or replace view public.clients_view as
select c.*, t.name as comercio_name, p.name as provincia_name, d.name as partido_name
from public.clients c
left join public.commerce_types t on t.id = c.comercio_type_id
left join public.provinces p on p.id = c.provincia_id
left join public.partidos  d on d.id = c.partido_id;

-- Rutas/Visitas
create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  client_id uuid not null references public.clients(id) on delete cascade,
  visited_at timestamptz not null default now(),
  notes text,
  lat double precision,
  lng double precision
);

create or replace view public.visits_view as
select v.*, c.nombre as client_name from public.visits v
join public.clients c on c.id = v.client_id;

-- Función para dashboard: clientes por tipo y provincia
create or replace function public.clients_by_type_province()
returns table(comercio_name text, provincia_name text, cnt bigint)
language sql stable as $$
  select coalesce(t.name,'—') as comercio_name, coalesce(p.name,'—') as provincia_name, count(*) as cnt
  from public.clients c
  left join public.commerce_types t on t.id=c.comercio_type_id
  left join public.provinces p on p.id=c.provincia_id
  group by 1,2
  order by 3 desc;
$$;

-- RLS
alter table public.clients enable row level security;
alter table public.commerce_types enable row level security;
alter table public.provinces enable row level security;
alter table public.partidos enable row level security;
alter table public.visits enable row level security;

-- Políticas (ajustá a tu contexto). Permitir a usuarios autenticados leer/escribir.
create policy if not exists clients_read  on public.clients for select using (auth.role() = 'authenticated');
create policy if not exists clients_write on public.clients for all    using (auth.role() = 'authenticated');

create policy if not exists ct_read on public.commerce_types for select using (true);
create policy if not exists ct_write on public.commerce_types for all using (auth.role() = 'authenticated');

create policy if not exists prov_read on public.provinces for select using (true);
create policy if not exists part_read on public.partidos  for select using (true);

create policy if not exists visits_read  on public.visits for select using (auth.role() = 'authenticated');
create policy if not exists visits_write on public.visits for all    using (auth.role() = 'authenticated');

-- Auditoría automática (created_by/updated_by)
create or replace function public.set_audit_fields()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end;$$;

-- Triggers
drop trigger if exists trg_clients_audit on public.clients;
create trigger trg_clients_audit
before insert or update on public.clients
for each row execute function public.set_audit_fields();

drop trigger if exists trg_visits_audit on public.visits;
create trigger trg_visits_audit
before insert or update on public.visits
for each row execute function public.set_audit_fields();

-- Datos iniciales mínimos
insert into public.commerce_types(name) values ('Almacén'),('Supermercado'),('Bar'),('Restaurante')
on conflict do nothing;

insert into public.provinces(name) values ('Buenos Aires'),('CABA'),('Córdoba'),('Santa Fe')
on conflict do nothing;

-- Ejemplo de partidos
insert into public.partidos(province_id, name)
select p.id, x.name from (values ('La Matanza'),('Lomas de Zamora'),('Quilmes'),('Vicente López'),('San Isidro')) as x(name)
join public.provinces p on p.name='Buenos Aires'
on conflict do nothing;

insert into public.partidos(province_id, name)
select p.id, x.name from (values ('Comuna 1'),('Comuna 2'),('Comuna 3'),('Comuna 4'),('Comuna 5'),('Comuna 6')) as x(name)
join public.provinces p on p.name='CABA'
on conflict do nothing;
