/* ==========================
 *  vendors.js  (versión unificada con PAE robusto)
 * ========================== */

// -------- Utilidades básicas --------
const $  = (q)=> document.querySelector(q);
const $$ = (q)=> Array.from(document.querySelectorAll(q));
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const esc = (s)=> String(s??'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function v(id){ return $('#'+id)?.value?.trim()||''; }
function debounce(fn,ms){ let t; return (...a)=>{clearTimeout(t); t=setTimeout(()=>fn(...a),ms);} }

// -------- Estado global --------
let gmap, gmarkers = [];
let geocoder;
let inlineMap, inlineMarker;
let lastRows = [];
let state = { page:1, pageSize:25, totalRows:0, search:'', role:'all', active:'all' };

// -------- Arranque --------
document.addEventListener('DOMContentLoaded', () => {
  bindUI();
  initApp();
});

async function initApp(){
  // espera supabase client
  while (!window.sb) { await sleep(50); }
  await loadTypes();
  await listVendors();
}

// -------- Enlaces de UI --------
function bindUI(){
  $('#btnRefreshVendors')?.addEventListener('click', ()=>{ state.page=1; listVendors(); });
  $('#searchInput')?.addEventListener('input', debounce(()=>{
    state.search = $('#searchInput').value.trim();
    state.page = 1;
    listVendors();
  },250));
  $('#btnAddVendor')?.addEventListener('click', ()=> openVendorModal());
  $('#btnSaveVendor')?.addEventListener('click', saveVendor);

  $('#prevPage')?.addEventListener('click', ()=>{ if(state.page>1){ state.page--; listVendors(); } });
  $('#nextPage')?.addEventListener('click', ()=>{ if(state.page*state.pageSize < state.totalRows){ state.page++; listVendors(); } });
  $('#pageSize')?.addEventListener('change', (e)=>{ state.pageSize=+e.target.value||25; state.page=1; listVendors(); });
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

  $('#btnExportCsv')?.addEventListener('click', exportCSV);
  $('#btnExportXlsx')?.addEventListener('click', exportXLSX);
}


// ===== Address via #direccion + Places Autocomplete + Geocoder =====
(function injectAddrCSS(){
  try{
    if(document.getElementById('addr-chip-patches')) return;
    const style = document.createElement('style');
    style.id = 'addr-chip-patches';
    style.textContent = '#btnCopyAddress, #btnOpenMaps{display:none !important;}';
    document.head.appendChild(style);
  }catch(_){}
})();

function hideCopyAndMapsButtons(){
  try{
    ['#btnCopyAddress','#btnOpenMaps','#btnCopy','#btnOpenGmaps'].forEach(sel=>{
      const el = document.querySelector(sel); if(el) el.style.display='none';
    });
    document.querySelectorAll('#vendorModal button').forEach(b=>{
      const t=(b.textContent||'').trim().toLowerCase();
      if(t.startsWith('copiar dirección') || t.startsWith('ver en google maps')) b.style.display='none';
    });
  }catch(_){}
}

function debounceAddr(fn, ms){
  let t=null;
  return (...args)=>{
    clearTimeout(t);
    t=setTimeout(()=>fn(...args), ms);
  };
}

async function geocodeAddressText(text){
  if(!text) return null;
  if(!(window.google && google.maps && google.maps.Geocoder)) return null;
  const geocoder = new google.maps.Geocoder();
  return await new Promise((resolve)=>{
    geocoder.geocode({ address: text }, (results)=>{
      if(results && results[0]){
        const r = results[0];
        const ll = r.geometry && r.geometry.location;
        resolve({
          formatted: r.formatted_address || text,
          place_id: r.place_id || '',
          lat: ll ? (typeof ll.lat==='function' ? ll.lat() : ll.lat) : null,
          lng: ll ? (typeof ll.lng==='function' ? ll.lng() : ll.lng) : null,
        });
      }else{
        resolve(null);
      }
    });
  });
}

function applyAddressResult(res){
  const $q = (sel)=> document.querySelector(sel);
  if ($q('#direccion') && res.formatted) $q('#direccion').value = res.formatted;
  if ($q('#place_id'))  $q('#place_id').value  = res.place_id || '';
  if ($q('#lat') && typeof res.lat==='number') $q('#lat').value = String(+res.lat.toFixed(6));
  if ($q('#lng') && typeof res.lng==='number') $q('#lng').value = String(+res.lng.toFixed(6));
  if (typeof setAddressChip === 'function') setAddressChip(res.formatted || '');
  if (typeof res.lat==='number' && typeof res.lng==='number' && typeof ensureInlineMap==='function' && typeof updateInlineMap==='function'){
    ensureInlineMap(); updateInlineMap(+res.lat.toFixed(6), +res.lng.toFixed(6));
  }
}

async function commitAddressFromText(){
  try{
    const input = document.getElementById('direccion');
    const text = (input && input.value && input.value.trim()) ? input.value.trim() : '';
    if(!text) return;
    const res = await geocodeAddressText(text);
    if(!res) return;
    applyAddressResult(res);
  }catch(e){
    console.warn('[commitAddressFromText] error', e);
  }
}

// Manual Lat/Lng listeners
function bindLatLngManualListeners(){
  const latI = document.getElementById('lat');
  const lngI = document.getElementById('lng');
  if(!latI || !lngI) return;
  const onChange = async ()=>{
    const lat = parseFloat(latI.value);
    const lng = parseFloat(lngI.value);
    if (Number.isFinite(lat) && Number.isFinite(lng)){
      try{
        if (typeof ensureInlineMap==='function' && typeof updateInlineMap==='function'){
          ensureInlineMap();
          updateInlineMap(+lat.toFixed(6), +lng.toFixed(6));
        }
        if(window.google && google.maps && google.maps.Geocoder){
          const geocoder = new google.maps.Geocoder();
          await new Promise((resolve)=>{
            geocoder.geocode({ location: {lat, lng}}, (results)=>{
              if(results && results[0]){
                const text = results[0].formatted_address || '';
                const pid = results[0].place_id || '';
                const $q = (sel)=> document.querySelector(sel);
                if ($q('#direccion')) $q('#direccion').value = text;
                if ($q('#place_id'))  $q('#place_id').value  = pid;
                if (typeof setAddressChip==='function') setAddressChip(text);
              }
              resolve();
            });
          });
        }
      }catch(_){}
    }
  };
  ['change','blur'].forEach(ev=>{
    latI.addEventListener(ev, onChange);
    lngI.addEventListener(ev, onChange);
  });
}

function bindAddressTextListeners(){
  const input = document.getElementById('direccion');
  const pae = document.getElementById('pae') || document.querySelector('gmp-place-autocomplete');
  if (!input) return;
  input.style.display = '';
  if (pae) pae.style.display = 'none';

  input.addEventListener('keyup', (e)=>{ if(e.key==='Enter') commitAddressFromText(); });
  input.addEventListener('blur', commitAddressFromText);
  input.addEventListener('input', debounceAddr(()=>commitAddressFromText(), 600));
}

// Google Places Autocomplete bound to #direccion
function initPlacesAutocompleteOnDireccion(){
  try{
    const input = document.getElementById('direccion');
    if(!input) return;
    if(!(window.google && google.maps && google.maps.places && google.maps.places.Autocomplete)) return;

    const ac = new google.maps.places.Autocomplete(input, {
      fields: ['place_id','formatted_address','geometry','name']
    });
    window.__ac_direccion = ac;

    ac.addListener('place_changed', () => {
      const place = ac.getPlace() || {};
      const res = {
        formatted: place.formatted_address || place.name || input.value || '',
        place_id: place.place_id || '',
        lat: null,
        lng: null
      };
      if (place.geometry && place.geometry.location){
        res.lat = (typeof place.geometry.location.lat === 'function' ? place.geometry.location.lat() : place.geometry.location.lat);
        res.lng = (typeof place.geometry.location.lng === 'function' ? place.geometry.location.lng() : place.geometry.location.lng);
      }
      if ((res.lat == null || res.lng == null) && res.formatted){
        geocodeAddressText(res.formatted).then(gres => {
          applyAddressResult(gres || res);
        });
      } else {
        applyAddressResult(res);
      }
    });
  }catch(e){
    console.warn('[initPlacesAutocompleteOnDireccion] error', e);
  }
}

// ===== New Web-Component Autocomplete (gmp/gmpx) mirror into #direccion =====
function extractTextFromWCDetail(ev, pae){
  try{
    const d = ev && ev.detail ? ev.detail : null;
    const v = d && (d.place || d.value || d) || (pae && pae.value) || {};
    const p = v.place || v || {};
    const txt =
      v.formattedAddress ||
      (v.displayName && (v.displayName.text || v.displayName)) ||
      p.formattedAddress ||
      '';
    return String(txt||'').trim();
  }catch(_){ return ''; }
}

function bindNewAutocompleteMirror(){
  const pae = document.getElementById('pae') || document.querySelector('gmpx-place-autocomplete, gmp-place-autocomplete');
  const input = document.getElementById('direccion');
  if(!pae || !input) return;

  const mirror = (ev)=>{
    const txt = extractTextFromWCDetail(ev, pae);
    if (txt){
      input.value = txt;
      commitAddressFromText();
    }
  };

  ['gmpx-placechange','gmpx-valuechange','placechange','change','input','blur'].forEach(ev=>{
    pae.addEventListener(ev, mirror);
  });
}

// =================== Google Maps / Places ===================
window.__initGoogleImpl = async function(){

  try{
    bindNewAutocompleteMirror();
    const modalEl = document.getElementById('vendorModal');
    if(modalEl){
      modalEl.addEventListener('shown.bs.modal', bindNewAutocompleteMirror);
    }
  }catch(_){}

  try{
    bindAddressTextListeners();
    bindLatLngManualListeners();
    initPlacesAutocompleteOnDireccion();
    hideCopyAndMapsButtons();
    const modalEl = document.getElementById('vendorModal');
    if(modalEl){
      modalEl.addEventListener('shown.bs.modal', ()=>{
        bindAddressTextListeners();
        bindLatLngManualListeners();
        initPlacesAutocompleteOnDireccion();
        hideCopyAndMapsButtons();
      });
    }
  }catch(_){}

  try{
    if(google?.maps?.importLibrary){
      await Promise.all([
        google.maps.importLibrary('places'),
        google.maps.importLibrary('marker'),
      ]);
    }
    geocoder = new google.maps.Geocoder();
    initMainMap();

    const modalEl = $('#vendorModal');
    if(modalEl){
      modalEl.addEventListener('shown.bs.modal', () => ensureInlineMap());
    }

    initSingleAutocomplete();
  }catch(e){
    console.warn('[google] init error', e);
  }
};
window.initGoogle = window.__initGoogleImpl;

// -------- Mapa principal --------
function initMainMap(){
  const el = $('#mapVendors');
  if(!el || !window.google) return;
  gmap = new google.maps.Map(el, {
    center: { lat:-34.6037, lng:-58.3816 },
    zoom: 11,
    mapTypeControl:false, streetViewControl:false,
    mapId:"751e0a095bf0a76685476d45"
  });
  // usamos los últimos datos cargados
  updateMapMarkers(lastRows);
}

function updateMapMarkers(rows){
  if(!gmap || !window.google) return;
  const data = rows && rows.length ? rows : (lastRows || []);
  gmarkers.forEach(m=> { try{ m.map = null; }catch(_){ } });
  gmarkers = [];
  const bounds = new google.maps.LatLngBounds();
  (data||[]).forEach(r=>{
    if(typeof r.lat==='number' && typeof r.lng==='number'){
      const pos = { lat:r.lat, lng:r.lng };
      const marker = new google.maps.marker.AdvancedMarkerElement({ map:gmap, position:pos, title:r.nombre||'' });
      const iw = new google.maps.InfoWindow({ content:`<b>${esc(r.nombre||'')}</b><br>${esc(r.address_formatted||'')}` });
      marker.addEventListener?.('gmp-click', ()=> iw.open({anchor: marker, map:gmap}));
      marker.addListener?.('click', ()=> iw.open({anchor: marker, map:gmap}));
      gmarkers.push(marker); bounds.extend(pos);
    }
  });
  if(gmarkers.length){ gmap.fitBounds(bounds); }
}

// -------- Mini-mapa en modal --------
function ensureInlineMap(){
  const el = $('#mapVendorInline');
  if(!el || !window.google) return;
  if(!inlineMap){
    inlineMap = new google.maps.Map(el, {
      center:{lat:-34.6037,lng:-58.3816}, zoom:13,
      mapTypeControl:false, streetViewControl:false,
      mapId:"751e0a095bf0a76685476d45"
    });
  }
  const lat = parseFloat($('#lat').value||'');
  const lng = parseFloat($('#lng').value||'');
  if(!isNaN(lat) && !isNaN(lng)){ updateInlineMap(lat,lng); }
}
function updateInlineMap(lat,lng){
  if(!inlineMap) return;
  const pos = {lat,lng};
  inlineMap.setCenter(pos); inlineMap.setZoom(16);
  if(inlineMarker){ try{ inlineMarker.map=null; }catch(_){ } inlineMarker=null; }
  inlineMarker = new google.maps.marker.AdvancedMarkerElement({ map:inlineMap, position:pos });
}

// -------- Chip + helpers --------
function setAddressChip(text){
  const chip = $('#addressChip');
  if(!chip) return;
  chip.innerHTML = text ? `<span class="badge-num"><i class="bi bi-geo-alt"></i> ${esc(text)}</span>` : '';
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

  if(route)        $('#direccion').value = `${route}${streetNumber? ' ' + streetNumber : ''}`;
  if(streetNumber) $('#altura').value = streetNumber;
  if(locality)     $('#localidad').value = locality;
  if(admin_l2)     $('#admin_l2').value = admin_l2;
  if(admin_l1)     $('#admin_l1').value = admin_l1;
  if(country)      $('#country').value = country;
  if(postal_code)  $('#postal_code').value = postal_code;
  if(formatted)    setAddressChip(formatted);
}

// -------- Geo actual (reverse geocode) --------
async function geoAndReverse(latId,lngId){
  if(!navigator.geolocation) return Swal.fire('Atención','Geolocalización no soportada','info');
  navigator.geolocation.getCurrentPosition((pos)=>{
    const lat = +pos.coords.latitude.toFixed(6);
    const lng = +pos.coords.longitude.toFixed(6);
    $('#'+latId).value = lat; $('#'+lngId).value = lng;
    ensureInlineMap(); updateInlineMap(lat,lng);

    if(geocoder){
      geocoder.geocode({ location: { lat, lng } }, (results, status)=>{
        if(status === 'OK' && results && results[0]){
          const best = results[0];
          $('#direccion').value = best.formatted_address;
          $('#place_id').value  = best.place_id || '';
          setAddressChip(best.formatted_address);
          fillFromAddressComponents(best.address_components, best.formatted_address);
        }else{
          Swal.fire('Atención', 'No pudimos obtener la dirección (status: '+status+').', 'info');
        }
      });
    }
  }, ()=> Swal.fire('Error','No pudimos leer tu ubicación','error'), { enableHighAccuracy:true, timeout:8000 });
}
async function copyAddressChip(){
  const txt = $('#addressChip')?.innerText?.trim();
  if(!txt) return Swal.fire('Info','No hay dirección para copiar','info');
  try{ await navigator.clipboard.writeText(txt); Swal.fire('OK','Dirección copiada','success'); }
  catch{ Swal.fire('Atención','No se pudo copiar','info'); }
}
function openInGoogleMaps(){
  const lat = $('#lat')?.value, lng = $('#lng')?.value, pid = $('#place_id')?.value;
  let url = '';
  if(pid){ url = `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(pid)}`; }
  else if(lat && lng){ url = `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}`; }
  else {
    const q = $('#direccion')?.value || '';
    if(!q) return Swal.fire('Info','No hay datos de mapa para abrir','info');
    url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }
  window.open(url, '_blank');
}

// =================== Autocomplete (ÚNICO) ===================
function initSingleAutocomplete(){
  const btn = $('#confirmAddressBtn'); if (btn) btn.style.display='none';

  let pae = $('#pae');
  if (pae && pae.tagName?.toLowerCase() !== 'gmp-place-autocomplete') { try{ pae.remove(); }catch(_){} pae = null; }

  if (!pae) {
    const raw = $('#direccion');
    pae = document.createElement('gmp-place-autocomplete');
    pae.id = 'pae';
    pae.className = 'form-control mt-2';
    if (raw?.parentNode) {
      raw.parentNode.insertBefore(pae, raw);
      raw.style.display = 'none';
    } else {
      document.body.prepend(pae);
    }
  }

  bindPAEEvents(pae);
  syncFromPAE(pae);
}

function bindPAEEvents(pae){
  ['gmpx-placechange','gmpx-valuechange','placechange','change','input'].forEach(ev=>{
    pae.addEventListener(ev, () => syncFromPAE(pae));
  });
  startPAEWatcher(pae);
}

function startPAEWatcher(pae){
  if (!pae) return;
  if (pae.__watcher){ clearInterval(pae.__watcher); pae.__watcher=null; }
  let lastPid = null, lastAddr = null;

  pae.__watcher = setInterval(()=>{
    const v = pae.value || {};
    const pid = v.placeId || v.id || '';
    const full = v.formattedAddress || (v.displayName && (v.displayName.text || v.displayName)) || '';

    if ((pid && pid !== lastPid) || (full && full !== lastAddr)) {
      lastPid = pid; lastAddr = full;
      syncFromPAE(pae);
    }
  }, 300);
}

function syncFromPAE(pae){
  const v = pae?.value || {};
  const full = v.formattedAddress || (v.displayName && (v.displayName.text || v.displayName)) || '';
  const pid  = v.placeId || v.id || '';
  let lat=null, lng=null;

  if (v.location) {
    lat = typeof v.location.lat === 'function' ? v.location.lat() : v.location.latitude;
    lng = typeof v.location.lng === 'function' ? v.location.lng() : v.location.longitude;
  }

  if ($('#direccion')) $('#direccion').value = full || '';
  if ($('#place_id'))  $('#place_id').value  = pid  || '';
  if ($('#lat') && typeof lat==='number') $('#lat').value = String(+lat.toFixed(6));
  if ($('#lng') && typeof lng==='number') $('#lng').value = String(+lng.toFixed(6));

  setAddressChip(full);
  if (typeof lat==='number' && typeof lng==='number') {
    ensureInlineMap(); updateInlineMap(+lat.toFixed(6), +lng.toFixed(6));
  }
}

// =================== Supabase (consulta y render) ===================
async function loadTypes(){
  try{
    const { data: ct } = await sb.from('commerce_types').select('*').order('name');
    const sel = $('#comercio');
    if(sel) sel.innerHTML = '<option value="">—</option>' + (ct||[]).map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');

    const { data: st } = await sb.from('supplier_types').select('*').order('name');
    const sel2 = $('#supplier_types_multi');
    if(sel2) sel2.innerHTML = (st||[]).map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');
  }catch(e){ console.warn('loadTypes err', e); }
}

async function listVendors(){
  const from = (state.page-1)*state.pageSize;
  const to = from + state.pageSize - 1;
  let q = sb.from('clients_view').select('*', { count:'exact' }).order('created_at', { ascending:false }).range(from,to);

  const ors = [];
  if(state.search){
    const s = state.search;
    // IMPORTANTE: sacamos supplier_names_csv porque esa columna ya no existe en la vista
    ors.push(
      `nombre.ilike.%${s}%`,
      `localidad.ilike.%${s}%`,
      `comercio_name.ilike.%${s}%`,
      `client_number.ilike.%${s}%`,
      `contacto.ilike.%${s}%`
    );
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

  $('#rowsInfo').textContent = rows.length
    ? `${from+1}–${Math.min(to+1, state.totalRows)} de ${state.totalRows}`
    : 'Sin registros para los filtros';

  $('#pageIndicator').textContent = state.page;

  $('#vendorsTable tbody').innerHTML = rows.map(renderRow).join('');
  attachRowEvents();
  updateMapMarkers(rows);
}

// ---- chips de la columna Roles / Estado / Tipo ----
function roleChips(r){
  const chips = [];
  if(r.is_client)   chips.push(`<span class="chip role"><span class="dot"></span> Cliente</span>`);
  if(r.is_supplier) chips.push(`<span class="chip role"><span class="dot"></span> Proveedor</span>`);
  return chips.join('');
}
function stateChip(r){
  const cls = r.is_active ? 'active' : 'inactive';
  const txt = r.is_active ? 'Activo' : 'Inactivo';
  return `<span class="chip state ${cls}"><span class="dot"></span> ${txt}</span>`;
}
function tipoChip(r){
  const tipo = r.is_client ? (r.comercio_name || '') : (r.supplier_names_csv || '');
  if(!tipo) return '';
  return `<span class="chip chip-type"><span class="dot"></span> ${esc(tipo)}</span>`;
}

// ---- render de fila con nuevas columnas ----
function renderRow(r){
  const badgeCls = r.is_active ? 'active' : 'inactive';
  return `<tr data-id="${r.id}">
    <td><span class="badge-num ${badgeCls}">${esc(r.client_number||'—')}</span></td>
    <td>
      <div class="fw-semibold">${esc(r.nombre||'')}</div>
      <div class="text-secondary small">${esc(r.address_formatted||'')}</div>
    </td>
    <td>
      <div class="chips">
        ${roleChips(r)} ${stateChip(r)} ${tipoChip(r)}
      </div>
    </td>
    <td>
      <div class="cell-contact">
        <div class="contact-name">${esc(r.contacto||'')}</div>
        <div class="contact-phone">${esc(r.telefono||'')}</div>
      </div>
    </td>
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
  const form = $('#vendorForm'); if(!form) return;
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

  const modal = new bootstrap.Modal('#vendorModal', { focus:false }); 
  modal.show();
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
    const id = e.target.parentElement.getAttribute('data-id');
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
  if(error){ console.error('[supabase] insert supplier_types error ->', error); return Swal.fire('Error','No se pudo crear','error'); }
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

// -------- Guardar --------
async function saveVendor(){
  const form = $('#vendorForm'); if(!form) return;
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

// -------- Export --------
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
