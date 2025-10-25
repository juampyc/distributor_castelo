# distributor_castelo
Software to manage a distributor

# Castelo Distribuidora (Bootstrap + Supabase)

App web mobile-first para gestionar clientes, rutas/visitas y catálogo base.

## Stack
- Bootstrap 5, Vanilla JS
- Supabase (Postgres + RLS)
- GitHub Pages

## Estructura
- `index.html`
- `css/styles.css`
- `js/config.js` (SUPABASE_URL, ANON_KEY)
- `js/supabase_client.js`
- `js/app.js`, `js/dashboard.js`, `js/clients.js`, `js/routes.js`, `js/imports.js`
- `sql/schema.sql`

## Configuración
1. Ejecutar `sql/schema.sql` en Supabase.
2. Editar `js/config.js` con tus credenciales.
3. Levantar local con Live Server o publicar con GitHub Pages.

## Funcionalidades
- CRUD Clientes (+ CUIT, Email, Contacto, Horario, Lat/Lng)
- Filtros por Provincia/Partido + búsqueda
- Rutas/Visitas con geolocalización
- Importación CSV de provincias/partidos
- Dashboard con KPIs y tabla por tipo/provincia

