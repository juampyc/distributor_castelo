const routeClient = document.getElementById('routeClient');
const routeDatetime = document.getElementById('routeDatetime');
const routeNotes = document.getElementById('routeNotes');
async function refreshRoutes(){
  const { data } = await sb.from('visits_view').select('*').order('visited_at', { ascending:false }).limit(200);
  const tbody = document.querySelector('#routesTable tbody'); if(!tbody) return;
  tbody.innerHTML = (data||[]).map(r=>`<tr><td>${new Date(r.visited_at).toLocaleString()}</td><td>${$utils.esc(r.client_name||'')}</td><td>${$utils.esc(r.notes||'')}</td><td>${r.lat?.toFixed? r.lat.toFixed(5):''}, ${r.lng?.toFixed? r.lng.toFixed(5):''}</td></tr>`).join('');
}
document.getElementById('btnGeoVisit')?.addEventListener('click', ()=> geoToInputs());
document.getElementById('btnAddVisit')?.addEventListener('click', async ()=>{
  const client_id = routeClient?.value || null;
  if(!client_id) return Swal.fire('Atención','Elegí un cliente','info');
  const payload = { client_id, notes: routeNotes?.value?.trim()||null, visited_at: routeDatetime?.value? new Date(routeDatetime.value).toISOString(): new Date().toISOString(), lat: window._visitLat||null, lng: window._visitLng||null };
  const { error } = await sb.from('visits').insert(payload);
  if(error) return Swal.fire('Error','No se pudo registrar','error');
  if(routeNotes) routeNotes.value=''; window._visitLat=null; window._visitLng=null; await refreshRoutes(); Swal.fire('OK','Visita registrada','success');
});
function geoToInputs(){
  if(!navigator.geolocation) return Swal.fire('Atención','Geolocalización no soportada','info');
  navigator.geolocation.getCurrentPosition((pos)=>{ window._visitLat = +pos.coords.latitude.toFixed(6); window._visitLng = +pos.coords.longitude.toFixed(6); Swal.fire('OK',`Geo: ${window._visitLat}, ${window._visitLng}`,'success'); }, ()=> Swal.fire('Error','No pudimos leer tu ubicación','error'), { enableHighAccuracy:true, timeout:6000 });
}
document.addEventListener('DOMContentLoaded', async ()=>{ await refreshRoutes(); });
window.loadClientsToSelect = async function(selectId){
  const { data } = await sb.from('clients_view').select('id,nombre').order('nombre');
  const sel = document.getElementById(selectId); if(!sel) return;
  sel.innerHTML = '<option value="">Seleccionar…</option>' + (data||[]).map(c=>`<option value="${c.id}">${$utils.esc(c.nombre)}</option>`).join('');
}
