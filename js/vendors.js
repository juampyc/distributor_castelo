// ===== Helpers =====
const $ = (q)=> document.querySelector(q);
const $$ = (q)=> Array.from(document.querySelectorAll(q));
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const esc = (s)=> String(s??'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

// ===== Estado global =====
let gmap, gmarkers = [];
let inlineMap, inlineMarker;
let geocoder;
let placesAutocomplete = null;        // fallback clásico
let paeEl = null;                     // PlaceAutocompleteElement (nuevo)

let state = { page:1, pageSize:25, totalRows:0, search:'', role:'all', active:'all' };
let lastRows = []; // para export

// ===== Inicio =====
document.addEventListener('DOMContentLoaded', () => {
  bindUI();
  initApp();
});

async function initApp(){
  while (!window.sb) { await sleep(50); }
  await loadTypes();
  await listVendors();
}

// ===== UI =====
function bindUI(){
  $('#btnRefreshVendors')?.addEventListener('click', ()=>{ state.page=1; listVendors(); });
  $('#searchInput')?.addEventListener('input', debounce(()=>{ state.page=1; state.search=$('#searchInput').value.trim(); listVendors(); },250));
  $('#btnAddVendor')?.addEventListener('click', ()=> openVendorModal());
  $('#btnSaveVendor')?.addEventListener('click', saveVendor);

  $('#prevPage')?.addEventListener('click', ()=>{ if(state.page>1){ state.page--; listVendors(); } });
  $('#nextPage')?.addEventListener('click', ()=>{ if(state.page*state.pageSize < state.totalRows){ state.page++; listVendors(); } });
  $('#pageSize')?.addEventListener('change', (e)=>{ state.pageSize=Number(e.target.value||25); state.page=1; listVendors(); });
  $('#filterRole')?.addEventListener('change', (e)=>{ state.role=e.target.value; state.page=1; listVendors(); });
  $('#filterActive')?.addEventListener('change', (e)=>{ state.active=e.target.value; state.page=1; listVendors(); });

  // Modal
  $('#btnGeo')?.addEventListener('click', ()=> geoAndReverse('lat','lng'));
  $('#btnCopyChip')?.addEventListener('click', copyAddressChip);
  $('#btnOpenGmaps')?.addEventListener('click', openInGoogleMaps);
  $('#is_supplier')?.addEventListener('change', onRoleChange);
  $('#is_client')?.addEventListener('change', onRoleChange);
  $('#btnAddComercio')?.addEventListener('click', addNewCommerceType);
  $('#btnAddSupplierType')?.addEventListener('click', addNewSupplierType);
  $('#supplier_types_multi')?.addEventListener('change', renderSupplierChips);
  $('#btnClearSupplier')?.addEventListener('click', clearSupplierSelection);

  // Export
  $('#btnExportCsv')?.addEventListener('click', exportCSV);
  $('#btnExportXlsx')?.addEventListener('click', exportXLSX);
}

function debounce(fn,ms){ let t; return (...a)=>{clearTimeout(t); t=setTimeout(()=>fn(...a),ms);} }

// ===== Google Maps / Places =====
window.__initGoogleImpl = async function(){
  try{
    if(google?.maps?.importLibrary){
      await google.maps.importLibrary('places');
    }
    geocoder = new google.maps.Geocoder();
    setupAutocomplete();
    initMainMap();

    const modalEl = $('#vendorModal');
    if(modalEl){
      modalEl.addEventListener('shown.bs.modal', () => {
        setupAutocomplete(true);
        ensureInlineMap();
      });
    }
  }catch(e){
    console.warn('[google] init error', e);
  }
};
window.initGoogle = window.__initGoogleImpl;

function setupAutocomplete(force=false){
  const input = $('#direccion');
  if(!input || !window.google || !google.maps) return;

  // Preferir componente nuevo si está disponible
  if(google.maps.places && google.maps.places.PlaceAutocompleteElement){
    if(paeEl && !force) return;
    if(placesAutocomplete){ placesAutocomplete.unbindAll?.(); placesAutocomplete = null; }
    if(!paeEl){
      paeEl = new google.maps.places.PlaceAutocompleteElement();
      paeEl.id = 'pae';
      paeEl.placeholder = 'Escribí para buscar…';
      paeEl.className = 'form-control mt-2';
      input.insertAdjacentElement('afterend', paeEl);
      input.style.display = 'none';
      paeEl.addEventListener('placechange', onPlaceChangedFromElement);
      paeEl.addEventListener('gmpxplacechange', onPlaceChangedFromElement);
    }
    return;
  }

  // Fallback clásico
  if(placesAutocomplete && !force) return;
  placesAutocomplete = new google.maps.places.Autocomplete(input, {
    componentRestrictions: { country: 'ar' },
    fields: ['address_components','geometry','formatted_address','place_id']
  });
  placesAutocomplete.addListener('place_changed', onPlaceChangedFromAutocomplete);
}

function onPlaceChangedFromElement(){
  const place = paeEl.getPlace ? paeEl.getPlace() : null;
  if(!place || !place.address_components) return;
  applyPlace(place);
}
function onPlaceChangedFromAutocomplete(){
  const place = placesAutocomplete.getPlace();
  if(!place || !place.address_components) return;
  applyPlace(place);
}
function applyPlace(place){
  if(place.place_id) $('#place_id').value = place.place_id;
  if(place.geometry && place.geometry.location){
    const lat = +place.geometry.location.lat().toFixed(6);
    const lng = +place.geometry.location.lng().toFixed(6);
    $('#lat').value = lat; $('#lng').value = lng;
    updateInlineMap(lat,lng); ensureInlineMap();
  }
  setAddressChip(place.formatted_address);
  fillFromAddressComponents(place.address_components, place.formatted_address);
}

function setAddressChip(text){
  const el = $('#addressChip');
  if(!el) return;
  el.innerHTML = text ? `<span class="badge-num"><i class="bi bi-geo-alt"></i> ${esc(text)}</span>` : '';
}
function fillFromAddressComponents(components, formatted){
  const comp = (type)=> (components||[]).find(c=> c.types.includes(type))?.long_name || '';
  const route         = comp('route');
  const streetNumber  = comp('street_number');
  const locality      = comp('locality') || comp('sublocality') || comp('administrative_area_level_3');
  const admin_l2      = comp('administrative_area_level_2');
  const admin_l1      = comp('administrative_area_level_1');
  const country       = comp('country');
  const postal_code   = comp('postal_code');
  if(route)        $('#direccion').value = `${route}`;
  if(streetNumber) $('#altura').value = streetNumber;
  if(locality)     $('#localidad').value = locality;
  if(admin_l2)     $('#admin_l2').value = admin_l2;
  if(admin_l1)     $('#admin_l1').value = admin_l1;
  if(country)      $('#country').value = country;
  if(postal_code)  $('#postal_code').value = postal_code;
  if(formatted)    setAddressChip(formatted);
}

// Mapas
function initMainMap(){
  const el = $('#mapVendors');
  if(!el || !window.google || !google.maps) return;
  gmap = new google.maps.Map(el, { center: { lat:-34.6037, lng:-58.3816 }, zoom: 11, mapTypeControl:false, streetViewControl:false });
  updateMapMarkers([]);
}
function updateMapMarkers(rows){
  if(!gmap || !window.google) return;
  gmarkers.forEach(m=> { try{ m.map = null; }catch(_){ } }); gmarkers = [];
  const bounds = new google.maps.LatLngBounds();
  (rows||[]).forEach(r=>{
    if(typeof r.lat==='number' && typeof r.lng==='number'){
      const pos = { lat:r.lat, lng:r.lng };
      const marker = new google.maps.marker.AdvancedMarkerElement({ map: gmap, position: pos, title: r.nombre||'' });
      const iw = new google.maps.InfoWindow({ content: `<b>${esc(r.nombre||'')}</b><br>${esc(r.address_formatted||'')}` });
      marker.addListener('click', ()=> iw.open({anchor: marker, map:gmap}));
      gmarkers.push(marker); bounds.extend(pos);
    }
  });
  if(gmarkers.length){ gmap.fitBounds(bounds); }
}

function ensureInlineMap(){
  const el = $('#mapVendorInline');
  if(!el || !window.google) return;
  if(!inlineMap){
    inlineMap = new google.maps.Map(el, { center:{lat:-34.6037, lng:-58.3816}, zoom:13, mapTypeControl:false, streetViewControl:false });
  }
  const lat = parseFloat($('#lat').value||'0');
  const lng = parseFloat($('#lng').value||'0');
  if(!isNaN(lat) && !isNaN(lng) && lat && lng){
    const pos = {lat, lng};
    inlineMap.setCenter(pos); inlineMap.setZoom(16);
    if(inlineMarker){ inlineMarker.map = null; inlineMarker = null; }
    inlineMarker = new google.maps.marker.AdvancedMarkerElement({ map:inlineMap, position:pos });
  }
}
function updateInlineMap(lat,lng){
  if(!inlineMap) return;
  const pos = {lat, lng};
  inlineMap.setCenter(pos); inlineMap.setZoom(16);
  if(inlineMarker){ inlineMarker.map = null; inlineMarker = null; }
  inlineMarker = new google.maps.marker.AdvancedMarkerElement({ map:inlineMap, position:pos });
}

// Geolocalización + reverse
async function geoAndReverse(latId,lngId){
  if(!navigator.geolocation) return Swal.fire('Atención','Geolocalización no soportada','info');
  navigator.geolocation.getCurrentPosition((pos)=>{
    const lat = +pos.coords.latitude.toFixed(6);
    const lng = +pos.coords.longitude.toFixed(6);
    $('#'+latId).value = lat; $('#'+lngId).value = lng;
    updateInlineMap(lat,lng); ensureInlineMap();
    if(geocoder){
      geocoder.geocode({ location: { lat, lng } }, (results, status)=>{
        if(status === 'OK' && results && results[0]){
          const best = results[0];
          $('#direccion').value = best.formatted_address;
          setAddressChip(best.formatted_address);
          fillFromAddressComponents(best.address_components, best.formatted_address);
        }else{
          Swal.fire('Atención', 'No pudimos obtener la dirección de Google (status: '+status+').', 'info');
        }
      });
    }
  }, (err)=> Swal.fire('Error','No pudimos leer tu ubicación','error'), { enableHighAccuracy:true, timeout:8000 });
}
async function copyAddressChip(){
  const txt = $('#addressChip')?.innerText?.trim();
  if(!txt){ return Swal.fire('Info','No hay dirección para copiar','info'); }
  try{ await navigator.clipboard.writeText(txt); Swal.fire('OK','Dirección copiada','success'); }
  catch(e){ Swal.fire('Atención','No se pudo copiar','info'); }
}
function openInGoogleMaps(){
  const lat = $('#lat')?.value, lng = $('#lng')?.value, pid = $('#place_id')?.value;
  let url = '';
  if(pid){ url = `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(pid)}`; }
  else if(lat && lng){ url = `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}`; }
  else {
    const q = $('#direccion')?.value || '';
    if(!q){ return Swal.fire('Info','No hay datos de mapa para abrir','info'); }
    url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }
  window.open(url, '_blank');
}

// ===== Supabase =====
async function loadTypes(){
  try{
    const { data: ct } = await sb.from('commerce_types').select('*').order('name');
    const sel = $('#comercio');
    if(sel) sel.innerHTML = '<option value=\"\">—</option>' + (ct||[]).map(t=>`<option value=\"${t.id}\">${esc(t.name)}</option>`).join('');

    const { data: st } = await sb.from('supplier_types').select('*').order('name');
    const sel2 = $('#supplier_types_multi');
    if(sel2) sel2.innerHTML = (st||[]).map(t=>`<option value=\"${t.id}\">${esc(t.name)}</option>`).join('');
  }catch(e){ console.warn('loadTypes err', e); }
}

async function listVendors(){
  const from = (state.page-1)*state.pageSize;
  const to = from + state.pageSize - 1;

  let q = sb.from('clients_view').select('*', { count:'exact' }).order('created_at', { ascending:false }).range(from,to);

  const ors = [];
  if(state.search){
    const s = state.search;
    ors.push(`nombre.ilike.%${s}%`, `localidad.ilike.%${s}%`, `comercio_name.ilike.%${s}%`, `supplier_names_csv.ilike.%${s}%`, `client_number.ilike.%${s}%`, `contacto.ilike.%${s}%`);
  }
  if(ors.length) q = q.or(ors.join(','));

  if(state.active==='active')   q = q.eq('is_active', true);
  if(state.active==='inactive') q = q.eq('is_active', false);

  if(state.role==='clients')    q = q.eq('is_client', true).neq('is_supplier', true);
  if(state.role==='suppliers')  q = q.eq('is_supplier', true).neq('is_client', true);
  if(state.role==='both')       q = q.eq('is_client', true).eq('is_supplier', true);

  const { data, error, count } = await q;
  if(error){ console.error('listVendors error', error); Swal.fire('Error','No se pudo listar','error'); return; }

  state.totalRows = count||0;
  const rows = data||[];
  lastRows = rows;
  $('#rowsInfo').textContent = `${rows.length ? (from+1) : 0}–${Math.min(to+1, state.totalRows)} de ${state.totalRows}`;
  $('#pageIndicator').textContent = state.page;

  $('#vendorsTable tbody').innerHTML = rows.map(renderRow).join('');
  attachRowEvents();
  updateMapMarkers(rows);
}

function roleChips(r){
  const chips = [];
  if(r.is_client)   chips.push(`<span class="chip role"><span class="dot"></span> Cliente</span>`);
  if(r.is_supplier) chips.push(`<span class="chip role"><span class="dot"></span> Proveedor</span>`);
  return chips.join('');
}
function stateBadgeClass(r){ return r.is_active ? 'active' : 'inactive'; }
function stateChip(r){
  const cls = r.is_active ? 'active' : 'inactive';
  const txt = r.is_active ? 'Activo' : 'Inactivo';
  return `<span class="chip state ${cls}"><span class="dot"></span> ${txt}</span>`;
}
function renderRow(r){
  const tipo = r.is_client ? (r.comercio_name || '—') : ((r.supplier_names_csv)||'—');
  const badgeCls = stateBadgeClass(r);
  return `<tr data-id="${r.id}">
    <td><span class="badge-num ${badgeCls}">${esc(r.client_number||'—')}</span></td>
    <td><div class="fw-semibold">${esc(r.nombre||'')}</div><div class="text-secondary small">${esc(r.address_formatted||'')}</div></td>
    <td><div class="chips">${roleChips(r)} ${stateChip(r)}</div></td>
    <td>${esc(tipo)}</td>
    <td>${esc(r.contacto||'')}</td>
    <td>${esc(r.telefono||'')}</td>
    <td class="text-end">
      <div class="btn-group">
        <button class="btn btn-sm btn-outline-primary btn-edit"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger btn-del"><i class="bi bi-trash"></i></button>
      </div>
    </td>
  </tr>`;
}
function attachRowEvents(){
  $$('.btn-edit').forEach(b=> b.addEventListener('click', onEdit));
  $$('.btn-del').forEach(b=> b.addEventListener('click', onDelete));
}

async function onEdit(e){
  const id = e.currentTarget.closest('tr').dataset.id;
  const { data, error } = await sb.from('clients_view').select('*').eq('id', id).single();
  if(error){ console.warn('onEdit error', error); return; }
  openVendorModal(data);
}
async function onDelete(e){
  const id = e.currentTarget.closest('tr').dataset.id;
  const res = await Swal.fire({ title:'Eliminar', text:'No se puede deshacer', icon:'warning', showCancelButton:true, confirmButtonText:'Eliminar' });
  if(!res.isConfirmed) return;
  await sb.from('clients').delete().eq('id', id);
  await sb.from('clients_supplier_types').delete().eq('client_id', id);
  await listVendors(); Swal.fire('OK','Registro eliminado','success');
}

function onRoleChange(){
  const isSup = $('#is_supplier')?.checked;
  const isCli = $('#is_client')?.checked;
  if($('#supplierTypeGroup')) $('#supplierTypeGroup').style.display = isSup ? '' : 'none';
  if($('#clientTypeGroup'))   $('#clientTypeGroup').style.display   = isCli ? '' : 'none';
}

function openVendorModal(row){
  const form = $('#vendorForm');
  if(!form){ console.warn('vendorForm no encontrado'); return; }
  form.reset();
  $('#vendorModalTitle').textContent = 'Clientes/Proveedores';

  $('#vendorId').value = row?.id || '';
  $('#nombre').value   = row?.nombre || '';
  $('#is_active').checked = (row?.is_active ?? true);
  $('#telefono').value = row?.telefono || '';
  $('#cuit').value     = row?.cuit || '';
  $('#email').value    = row?.email || '';
  $('#contacto').value = row?.contacto || '';
  $('#horario').value  = row?.horario || '';

  if($('#is_client'))   $('#is_client').checked   = (row?.is_client ?? true);
  if($('#is_supplier')) $('#is_supplier').checked = (row?.is_supplier ?? false);
  onRoleChange();

  if($('#comercio')) $('#comercio').value = row?.comercio_type_id ?? '';

  const sel = $('#supplier_types_multi');
  if(sel){
    Array.from(sel.options).forEach(o => o.selected = false);
    const ids = row?.supplier_type_ids || [];
    ids.forEach(id => {
      const opt = Array.from(sel.options).find(o=> String(o.value) === String(id));
      if(opt) opt.selected = true;
    });
    renderSupplierChips();
  }

  $('#localidad').value = row?.localidad || '';
  $('#altura').value    = row?.altura || '';
  $('#direccion').value = row?.direccion || '';
  setAddressChip(row?.address_formatted || '');
  $('#place_id').value  = row?.place_id || '';
  $('#admin_l2').value  = row?.address_admin_l2 || '';
  $('#admin_l1').value  = row?.address_admin_l1 || '';
  $('#country').value   = row?.address_country || '';
  $('#postal_code').value = row?.address_postal_code || '';
  $('#lat').value       = row?.lat || '';
  $('#lng').value       = row?.lng || '';

  const b = $('#clientNumberBadge');
  if(b){
    if(row?.client_number){ b.style.display='inline-block'; b.textContent = row.client_number; } else { b.style.display='none'; b.textContent=''; }
  }
  const modal = new bootstrap.Modal('#vendorModal', { focus:false }); modal.show();
  ensureInlineMap();
}

function renderSupplierChips(){
  const sel = $('#supplier_types_multi');
  const cont = $('#supplierChips');
  const cnt = $('#supplierCount');
  if(!sel || !cont) return;
  const selected = Array.from(sel.selectedOptions).map(o=> ({id:o.value, name:o.textContent}));
  cont.innerHTML = selected.map(s=>`<span class="chip" data-id="${s.id}">${esc(s.name)} <i class="bi bi-x"></i></span>`).join('');
  if(cnt) cnt.textContent = String(selected.length);
  cont.querySelectorAll('.bi-x').forEach(x=> x.addEventListener('click', (e)=>{
    const id = e.currentTarget.parentElement.getAttribute('data-id');
    const opt = Array.from(sel.options).find(o=> String(o.value)===String(id));
    if(opt){ opt.selected = false; renderSupplierChips(); }
  }));
}

async function addNewCommerceType(){
  const { value: name } = await Swal.fire({ title:'Nuevo tipo de comercio', input:'text', inputPlaceholder:'Ej: Bar', showCancelButton:true, confirmButtonText:'Guardar' });
  if(!name) return;
  const { data, error } = await sb.from('commerce_types').insert({ name }).select().single();
  if(error){ return Swal.fire('Error','No se pudo crear','error'); }
  await loadTypes();
  if($('#comercio')) $('#comercio').value = data.id;
  Swal.fire('OK','Tipo creado','success');
}
async function addNewSupplierType(){
  const { value: name } = await Swal.fire({ title:'Nuevo tipo de proveedor', input:'text', inputPlaceholder:'Ej: Latas', showCancelButton:true, confirmButtonText:'Guardar' });
  if(!name) return;
  const { data, error } = await sb.from('supplier_types').insert({ name }).select().single();
  if(error){ return Swal.fire('Error','No se pudo crear','error'); }
  await loadTypes();
  const sel = $('#supplier_types_multi');
  if(sel){ const opt = Array.from(sel.options).find(o=> String(o.value)===String(data.id)); if(opt){ opt.selected = true; renderSupplierChips(); } }
  Swal.fire('OK','Tipo creado','success');
}

function clearSupplierSelection(){
  const sel = $('#supplier_types_multi');
  if(!sel) return;
  Array.from(sel.options).forEach(o=> o.selected=false);
  renderSupplierChips();
}

// ===== Guardar =====
async function saveVendor(){
  const form = $('#vendorForm');
  if(!form){ return; }
  if(!form.checkValidity()){ form.classList.add('was-validated'); return; }

  const isClient = $('#is_client')?.checked;
  const isSupplier = $('#is_supplier')?.checked;
  if(!isClient && !isSupplier){
    return Swal.fire('Atención','Debe seleccionar al menos Cliente o Proveedor','info');
  }
  const payload = {
    nombre: v('nombre'),
    is_active: $('#is_active').checked,
    telefono: v('telefono'), cuit: v('cuit'), email: v('email'), contacto: v('contacto'),
    horario: v('horario') || null,
    is_client: isClient,
    is_supplier: isSupplier,
    comercio_type_id: v('comercio') || null,
    localidad: v('localidad') || null, altura: v('altura') || null, direccion: v('direccion') || null,
    lat: v('lat')? parseFloat(v('lat')): null, lng: v('lng')? parseFloat(v('lng')): null,
    address_formatted: $('#addressChip')?.innerText?.trim() || null,
    place_id: v('place_id') || null,
    address_admin_l2: v('admin_l2') || null,
    address_admin_l1: v('admin_l1') || null,
    address_country: v('country') || null,
    address_postal_code: v('postal_code') || null
  };
  const id = v('vendorId');
  let error, data, rowId = id;
  if(id){ ({ error } = await sb.from('clients').update(payload).eq('id', id)); }
  else   { ({ data, error } = await sb.from('clients').insert(payload).select().single()); rowId = data?.id || id; }
  if(error) return Swal.fire('Error','No se pudo guardar','error');

  // supplier types (many-to-many)
  const sel = $('#supplier_types_multi');
  const selectedIds = sel ? Array.from(sel.selectedOptions).map(o=> Number(o.value)) : [];
  if(rowId){
    await sb.from('clients_supplier_types').delete().eq('client_id', rowId);
    if(selectedIds.length){
      const rows = selectedIds.map(tid => ({ client_id: rowId, supplier_type_id: tid }));
      await sb.from('clients_supplier_types').insert(rows);
    }
  }

  bootstrap.Modal.getInstance($('#vendorModal'))?.hide();
  await listVendors(); Swal.fire('OK','Guardado','success');
}
function v(id){ return $('#'+id)?.value?.trim()||''; }

// ===== Export =====
function exportCSV(){
  const rows = lastRows||[];
  const headers = ['Nro','Nombre','Activo','Cliente','Proveedor','Tipo','Contacto','Teléfono','Dirección'];
  const lines = [headers.join(';')];
  rows.forEach(r=>{
    const tipo = r.is_client ? (r.comercio_name||'') : (r.supplier_names_csv||'');
    lines.push([r.client_number||'', r.nombre||'', r.is_active, r.is_client, r.is_supplier, tipo, r.contacto||'', r.telefono||'', r.address_formatted||''].map(v=> String(v).replace(/;/g,',')).join(';'));
  });
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'vendors.csv'; a.click();
  setTimeout(()=> URL.revokeObjectURL(a.href), 1000);
}
function exportXLSX(){
  const rows = (lastRows||[]).map(r=> ({
    Nro: r.client_number||'',
    Nombre: r.nombre||'',
    Activo: r.is_active?'Sí':'No',
    Cliente: r.is_client?'Sí':'No',
    Proveedor: r.is_supplier?'Sí':'No',
    Tipo: r.is_client ? (r.comercio_name||'') : (r.supplier_names_csv||''),
    Contacto: r.contacto||'',
    Teléfono: r.telefono||'',
    Dirección: r.address_formatted||''
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Vendors');
  XLSX.writeFile(wb, 'vendors.xlsx');
}
