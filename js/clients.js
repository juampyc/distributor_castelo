const tbody = document.querySelector('#clientsTable tbody');
const rowsInfo = document.getElementById('rowsInfo');
const pageIndicator = document.getElementById('pageIndicator');
const searchInput = document.getElementById('searchInput');

let state = { page:1, pageSize:10, totalRows:0, search:'', fProv:null, fPart:null, provinces:[], partidos:[], types:[] };

// Filtros toolbar
const fProvincia = document.getElementById('fProvincia');
const fPartido   = document.getElementById('fPartido');

// Controles paginación
['prevPage','nextPage'].forEach(id=>{
  document.getElementById(id).addEventListener('click', ()=>{
    if(id==='prevPage' && state.page>1){ state.page--; listClients(); }
    if(id==='nextPage' && state.page*state.pageSize < state.totalRows){ state.page++; listClients(); }
  });
});

document.getElementById('btnRefreshClients').addEventListener('click', listClients);
searchInput.addEventListener('input', $utils.debounce(()=>{ state.page=1; state.search=searchInput.value.trim(); listClients(); },300));

document.getElementById('btnClearFilters').addEventListener('click', ()=>{
  fProvincia.value=''; fPartido.innerHTML='<option value="">Partido</option>'; state.fProv=null; state.fPart=null; state.page=1; listClients();
});

// Modal cliente
const clientModalEl = document.getElementById('clientModal');
const clientModal = new bootstrap.Modal(clientModalEl);

// Botones
 document.getElementById('btnAddClient').addEventListener('click', ()=> openClientModal());
 document.getElementById('btnSaveClient').addEventListener('click', saveClient);
 document.getElementById('btnAddType').addEventListener('click', ()=>{ new bootstrap.Modal('#typeModal').show(); document.getElementById('typeName').value=''; setTimeout(()=>document.getElementById('typeName').focus(),150);});
 document.getElementById('btnSaveType').addEventListener('click', saveType);
 document.getElementById('btnGeo').addEventListener('click', ()=> geoToInputs('lat','lng'));

// Load inicial
(async function init(){
  await Promise.all([loadTypes(), loadProvinces()]);
  await listClients();
  await loadClientsToSelect('routeClient'); // para rutas/visitas
})();

async function loadTypes(){
  const { data } = await sb.from('commerce_types').select('*').order('name');
  state.types = data||[];
  const sel = document.getElementById('comercio');
  sel.innerHTML = '<option value="">Seleccioná…</option>' + state.types.map(t=>`<option value="${t.id}">${$utils.esc(t.name)}</option>`).join('');
}

async function saveType(){
  const name = document.getElementById('typeName').value?.trim();
  if(!name) return;
  const { error } = await sb.from('commerce_types').insert({ name });
  if(error) return Swal.fire('Error','No se pudo guardar el tipo','error');
  await loadTypes();
  bootstrap.Modal.getInstance(document.getElementById('typeModal')).hide();
  Swal.fire('OK','Tipo agregado','success');
}

async function loadProvinces(){
  const { data } = await sb.from('provinces').select('*').order('name');
  state.provinces = data||[];
  const sel = document.getElementById('provincia');
  const fSel = fProvincia;
  const opts = '<option value="">Provincia</option>' + state.provinces.map(p=>`<option value="${p.id}">${$utils.esc(p.name)}</option>`).join('');
  sel.innerHTML = '<option value="">Seleccioná…</option>' + state.provinces.map(p=>`<option value="${p.id}">${$utils.esc(p.name)}</option>`).join('');
  fSel.innerHTML = opts;
  sel.addEventListener('change', ()=> loadPartidos(sel.value, 'partido'));
  fProvincia.addEventListener('change', ()=>{ state.fProv=fProvincia.value||null; loadPartidos(state.fProv,'fPartido'); state.fPart=null; state.page=1; listClients(); });
}

async function loadPartidos(provinceId, targetId){
  const target = document.getElementById(targetId);
  if(!provinceId){ target.innerHTML = '<option value="">Partido</option>'; return; }
  const { data } = await sb.from('partidos').select('*').eq('province_id', provinceId).order('name');
  state.partidos = data||[];
  const opts = '<option value="">Partido</option>' + state.partidos.map(p=>`<option value="${p.id}">${$utils.esc(p.name)}</option>`).join('');
  target.innerHTML = opts;
  if(targetId==='partido'){ target.addEventListener('change', ()=>{}); }
  if(targetId==='fPartido'){
    target.addEventListener('change', ()=>{ state.fPart = target.value||null; state.page=1; listClients(); }, { once:true });
  }
}

async function listClients(){
  const from = (state.page-1)*state.pageSize, to = from+state.pageSize-1;
  let q = sb.from('clients_view').select('*', { count:'exact' }).order('created_at', { ascending:false }).range(from,to);
  const ors = [];
  if(state.search){ ors.push(`nombre.ilike.%${state.search}%`, `localidad.ilike.%${state.search}%`, `comercio_name.ilike.%${state.search}%`); }
  if(ors.length) q = q.or(ors.join(','));
  if(state.fProv) q = q.eq('provincia_id', state.fProv);
  if(state.fPart) q = q.eq('partido_id', state.fPart);
  const { data, error, count } = await q;
  if(error){ console.error(error); return Swal.fire('Error','No se pudo listar clientes','error'); }
  state.totalRows = count||0; pageIndicator.textContent = state.page; rowsInfo.textContent = `${count??0} resultado${(count||0)===1?'':'s'}`;
  tbody.innerHTML = (data||[]).map(renderRow).join('');
  attachRowEvents();
}

function renderRow(r){
  const addr = [r.calle && `Calle ${$utils.esc(r.calle)}`, r.altura && `#${$utils.esc(r.altura)}`, r.direccion].filter(Boolean).join(' · ');
  return `<tr data-id="${r.id}">
    <td><div class="fw-semibold">${$utils.esc(r.nombre||'')}</div>${addr?`<div class="text-secondary small">${addr}</div>`:''}</td>
    <td>${$utils.esc(r.comercio_name||'')}</td>
    <td>${$utils.esc(r.provincia_name||'')}</td>
    <td>${$utils.esc(r.partido_name||'')}</td>
    <td>${$utils.esc(r.localidad||'')}</td>
    <td>${$utils.esc(r.telefono||'')}</td>
    <td class="text-end">
      <div class="btn-group">
        <button class="btn btn-sm btn-outline-primary btn-edit"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger btn-del"><i class="bi bi-trash"></i></button>
      </div>
    </td>
  </tr>`;
}

function attachRowEvents(){
  document.querySelectorAll('.btn-edit').forEach(b=> b.addEventListener('click', onEdit));
  document.querySelectorAll('.btn-del').forEach(b=> b.addEventListener('click', onDelete));
}

async function onEdit(e){
  const id = e.currentTarget.closest('tr').dataset.id;
  const { data, error } = await sb.from('clients').select('*').eq('id', id).single();
  if(error) return;
  openClientModal(data);
}

async function onDelete(e){
  const id = e.currentTarget.closest('tr').dataset.id;
  const res = await Swal.fire({ title:'Eliminar', text:'No se puede deshacer', icon:'warning', showCancelButton:true, confirmButtonText:'Eliminar' });
  if(!res.isConfirmed) return;
  const { error } = await sb.from('clients').delete().eq('id', id);
  if(error) return Swal.fire('Error','No se pudo eliminar','error');
  await listClients();
  Swal.fire('OK','Cliente eliminado','success');
}

function openClientModal(row){
  document.getElementById('clientForm').reset();
  document.getElementById('clientModalTitle').textContent = row? 'Editar cliente' : 'Nuevo cliente';
  setVal('clientId', row?.id||'');
  setVal('nombre', row?.nombre||'');
  setVal('telefono', row?.telefono||'');
  setVal('cuit', row?.cuit||'');
  setVal('email', row?.email||'');
  setVal('contacto', row?.contacto||'');
  setVal('localidad', row?.localidad||'');
  setVal('calle', row?.calle||'');
  setVal('altura', row?.altura||'');
  setVal('direccion', row?.direccion||'');
  setVal('horario', row?.horario||'');
  setVal('lat', row?.lat||'');
  setVal('lng', row?.lng||'');
  setSelect('comercio', row?.comercio_type_id);
  setSelect('provincia', row?.provincia_id);
  if(row?.provincia_id){ loadPartidos(row.provincia_id, 'partido').then(()=> setSelect('partido', row?.partido_id)); }
  clientModal.show();
}

function setVal(id,val){ document.getElementById(id).value = val==null?'':val; }
function setSelect(id,val){ const sel=document.getElementById(id); sel.value = val??''; }

async function saveClient(){
  const form = document.getElementById('clientForm');
  if(!form.checkValidity()){ form.classList.add('was-validated'); return; }
  const payload = {
    nombre:   v('nombre'), telefono: v('telefono'),
    comercio_type_id: v('comercio')||null,
    provincia_id: v('provincia')||null, partido_id: v('partido')||null,
    localidad: v('localidad'), calle: v('calle'), altura: v('altura'), direccion: v('direccion'),
    cuit: v('cuit'), email: v('email'), contacto: v('contacto'), horario: v('horario'),
    lat: v('lat')? parseFloat(v('lat')): null, lng: v('lng')? parseFloat(v('lng')): null
  };
  const id = v('clientId');
  let error;
  if(id){ ({ error } = await sb.from('clients').update(payload).eq('id', id)); }
  else   { ({ error } = await sb.from('clients').insert(payload)); }
  if(error) return Swal.fire('Error','No se pudo guardar','error');
  clientModal.hide(); await listClients(); Swal.fire('OK','Cliente guardado','success');
}

function v(id){ return document.getElementById(id).value?.trim(); }

async function geoToInputs(latId,lngId){
  if(!navigator.geolocation) return Swal.fire('Atención','Geolocalización no soportada','info');
  navigator.geolocation.getCurrentPosition((pos)=>{
    document.getElementById(latId).value = pos.coords.latitude.toFixed(6);
    document.getElementById(lngId).value = pos.coords.longitude.toFixed(6);
  }, ()=> Swal.fire('Error','No pudimos leer tu ubicación','error'), { enableHighAccuracy:true, timeout:6000 });
}

// helper para otras vistas
window.loadClientsToSelect = async function(selectId){
  const { data } = await sb.from('clients_view').select('id,nombre').order('nombre');
  const sel = document.getElementById(selectId);
  sel.innerHTML = '<option value="">Seleccionar…</option>' + (data||[]).map(c=>`<option value="${c.id}">${$utils.esc(c.nombre)}</option>`).join('');
}
