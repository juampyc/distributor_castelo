/* ==========================
 *  pricelists.js (FULL FIX)
 *  - Tabs: Listado / Vista por nombre
 *  - Filtro por defecto: Activas + Programadas
 *  - Vista por nombre: pills (nombres) + revisiones + items
 *  - PDF PRO: logo centrado sin deformar, filename correcto, tabla Descripción + Precio
 * ========================== */

const $ = (q)=>document.querySelector(q);
const $$ = (q)=>Array.from(document.querySelectorAll(q));
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const esc = (s)=> String(s ?? '').replace(/[&<>"']/g, m => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[m]));
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

function showSuccessToast(title, text){
  return Swal.fire({ icon:'success', title:title||'OK', text:text||'', toast:true, position:'top',
    showConfirmButton:false, timer:2000, timerProgressBar:true });
}
function showErrorToast(title, text){
  return Swal.fire({ icon:'error', title:title||'Error', text:text||'', toast:true, position:'top',
    showConfirmButton:false, timer:3000, timerProgressBar:true });
}

let priceListsState = {
  page:1,
  pageSize:25,
  totalRows:0,
  search:'',
  filters:{ status:'active_programada' }
};

let lastPriceLists = [];
let priceListProductOptions = [];
let priceListNameOptions = [];
let modalPriceList = null;
let priceListModalReadOnly = false;

// Vista por nombre
let selectedListName = null;
let selectedRevisionRow = null;
let selectedRevisionItemsCache = [];

document.addEventListener('DOMContentLoaded', () => {
  bindUI();
  init().catch(console.error);
});

async function init(){
  while(!window.sb){ await sleep(50); }

  // Filtro default Activas + Programadas
  const stSel = $('#filterPriceListStatus');
  if(stSel){
    if(!Array.from(stSel.options).some(o=>o.value==='active_programada')){
      const opt = document.createElement('option');
      opt.value='active_programada';
      opt.textContent='Activas + Programadas';
      stSel.insertBefore(opt, stSel.firstChild);
    }
    stSel.value = 'active_programada';
    priceListsState.filters.status = 'active_programada';
  }

  await loadProductsOptions();
  await loadNameOptions();
  await listPriceLists();
  renderNamePills();
}

/* ==========================
   UI
   ========================== */
function bindUI(){
  $('#btnRefreshPriceLists')?.addEventListener('click', ()=>{ priceListsState.page=1; listPriceLists(); });

  $('#priceListsSearchInput')?.addEventListener('input', debounce((e)=>{
    priceListsState.search = e.target.value.trim();
    priceListsState.page=1;
    listPriceLists();
  }, 300));

  $('#filterPriceListStatus')?.addEventListener('change', (e)=>{
    priceListsState.filters.status = e.target.value || 'active_programada';
    priceListsState.page=1;
    listPriceLists();
  });

  $('#priceListsPageSize')?.addEventListener('change', (e)=>{
    const v = parseInt(e.target.value,10);
    priceListsState.pageSize = Number.isNaN(v)?25:v;
    priceListsState.page=1;
    listPriceLists();
  });

  $('#priceListsPrevPage')?.addEventListener('click', ()=>{
    if(priceListsState.page>1){ priceListsState.page--; listPriceLists(); }
  });
  $('#priceListsNextPage')?.addEventListener('click', ()=>{
    const maxPage = Math.max(1, Math.ceil((priceListsState.totalRows||0)/priceListsState.pageSize)||1);
    if(priceListsState.page<maxPage){ priceListsState.page++; listPriceLists(); }
  });

  $('#btnAddPriceList')?.addEventListener('click', ()=> openModal(null));
  $('#btnSavePriceList')?.addEventListener('click', ()=>{ if(!priceListModalReadOnly) savePriceList(); });

  $('#btnAddPriceListName')?.addEventListener('click', ()=>{ if(!priceListModalReadOnly) createNameFlow(); });
  $('#btnAddPriceListItem')?.addEventListener('click', ()=>{ if(!priceListModalReadOnly) addItemRow(); });

  $('#btnExportPriceListsCsv')?.addEventListener('click', exportCsv);
  $('#btnExportPriceListsXlsx')?.addEventListener('click', exportXlsx);

  const modalEl = document.getElementById('priceListModal');
  if(modalEl){
    modalPriceList = new bootstrap.Modal(modalEl, { focus:false });
  }

  // Vista por nombre
  $('#btnAddPriceListNameInline')?.addEventListener('click', createNameFlow);
  $('#btnNewRevisionFromName')?.addEventListener('click', ()=> createNewRevisionFromSelectedName());
  $('#itemsByRevisionSearch')?.addEventListener('input', debounce((e)=>{
    renderItemsByRevisionTable(selectedRevisionItemsCache, e.target.value.trim());
  }, 200));
  $('#btnEditSelectedRevision')?.addEventListener('click', ()=>{
    if(!selectedRevisionRow) return;
    openModal(selectedRevisionRow, { readonly:false });
  });
  $('#btnPdfSelectedRevision')?.addEventListener('click', ()=>{
    if(!selectedRevisionRow) return;
    exportSinglePriceListPdf(selectedRevisionRow.id);
  });

  // Bulk
  $('#btnApplyBulk')?.addEventListener('click', ()=> applyBulkToAllRows());
  $('#btnResetBulk')?.addEventListener('click', ()=>{
    $('#bulkPctInput').value = '';
    $('#bulkAddInput').value = '';
  });
}

/* ==========================
   FECHAS / RANGOS
   ========================== */
function parseDateISO(d){
  if(!d) return null;
  const [y,m,dd] = String(d).split('-').map(n=>parseInt(n,10));
  if(!y || !m || !dd) return null;
  return new Date(Date.UTC(y, m-1, dd));
}
function formatISODate(dt){
  if(!(dt instanceof Date)) return '';
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth()+1).padStart(2,'0');
  const d = String(dt.getUTCDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function addDaysISO(iso, days){
  const dt = parseDateISO(iso);
  if(!dt) return null;
  dt.setUTCDate(dt.getUTCDate()+days);
  return formatISODate(dt);
}
function rangesOverlap(aStart, aEnd, bStart, bEnd){
  const aS = parseDateISO(aStart);
  const bS = parseDateISO(bStart);
  if(!aS || !bS) return false;

  const aE = aEnd ? parseDateISO(aEnd) : null;
  const bE = bEnd ? parseDateISO(bEnd) : null;

  const aEts = aE ? aE.getTime() : Number.POSITIVE_INFINITY;
  const bEts = bE ? bE.getTime() : Number.POSITIVE_INFINITY;

  return (aS.getTime() <= bEts) && (bS.getTime() <= aEts);
}
function analyzeCoverage(revs){
  const list = (revs||[])
    .filter(r=>r && r.valid_from)
    .slice()
    .sort((x,y)=>{
      const ax = x.valid_from || '';
      const ay = y.valid_from || '';
      if(ax!==ay) return String(ax).localeCompare(String(ay));
      return (x.revision||0) - (y.revision||0);
    });

  const overlaps = [];
  const gaps = [];

  for(let i=0;i<list.length-1;i++){
    const cur = list[i];
    const next = list[i+1];

    const curFrom = cur.valid_from;
    const curTo = cur.valid_to || null;
    const nextFrom = next.valid_from;
    const nextTo = next.valid_to || null;

    if(rangesOverlap(curFrom, curTo, nextFrom, nextTo)){
      overlaps.push({ a:cur, b:next });
      continue;
    }

    if(curTo){
      const curToPlus1 = addDaysISO(curTo, 1);
      if(curToPlus1 && nextFrom && nextFrom > curToPlus1){
        const gapFrom = curToPlus1;
        const gapTo = addDaysISO(nextFrom, -1);
        const d1 = parseDateISO(gapFrom);
        const d2 = parseDateISO(nextFrom);
        const days = (d1 && d2) ? Math.max(0, Math.round((d2.getTime()-d1.getTime())/86400000)) : null;
        gaps.push({ from:gapFrom, to:gapTo, days });
      }
    }
  }

  return { overlaps, gaps };
}

/* ==========================
   ESTADOS (auto)
   ========================== */
function getStatus(row){
  const today = new Date().toISOString().slice(0,10);
  if(row.deleted_at) return 'inactive';
  const vf = row.valid_from || null;
  const vt = row.valid_to || null;
  if(vt && vt < today) return 'inactive';
  if(vf && vf > today) return 'programada';
  return 'active';
}
function badgeClass(status){
  if(status==='active') return 'bg-success';
  if(status==='programada') return 'bg-warning text-dark';
  return 'bg-secondary';
}

/* ==========================
   OPCIONES
   ========================== */
async function loadProductsOptions(){
  // products_view existe en tu proyecto; si no, fallback a product
  let { data, error } = await sb
    .from('products_view')
    .select('id, code, description')
    .order('code', { ascending:true });

  if(error){
    console.warn('products_view no disponible, uso product', error);
    const res = await sb.from('product').select('id, code, description').order('code', { ascending:true });
    data = res.data; error = res.error;
  }

  if(error){ console.error(error); return; }
  priceListProductOptions = (data||[]).map(p=>({ id:p.id, label:`${p.code??''} · ${p.description??''}`.trim() }));
}

async function loadNameOptions(selectedValue){
  const { data, error } = await sb
    .from('price_list_names')
    .select('name')
    .is('deleted_at', null)
    .eq('is_active', true)
    .order('name', { ascending:true });

  if(error){ console.error(error); return; }

  priceListNameOptions = (data||[]).map(r=>String(r.name));
  const sel = $('#priceListNameSelect');
  if(sel){
    const cur = selectedValue ?? sel.value ?? '';
    sel.innerHTML = '<option value="">Seleccionar...</option>';
    priceListNameOptions.forEach(n=>{
      const opt=document.createElement('option');
      opt.value=n; opt.textContent=n;
      sel.appendChild(opt);
    });
    if(cur) sel.value = cur;
  }
}

async function createNameFlow(){
  const { value } = await Swal.fire({
    title:'Nuevo nombre de lista',
    input:'text',
    inputLabel:'Nombre',
    inputPlaceholder:'Ej: Mayorista',
    showCancelButton:true,
    confirmButtonText:'Crear',
    cancelButtonText:'Cancelar',
    inputValidator:(v)=>{
      const t=(v||'').trim();
      if(!t) return 'Ingresá un nombre';
      if(t.length<2) return 'Muy corto';
      return undefined;
    }
  });
  const name=(value||'').trim();
  if(!name) return;

  const { error } = await sb.from('price_list_names').insert({ name });
  if(error){ console.error(error); await showErrorToast('Error', 'No se pudo crear el nombre'); return; }

  await showSuccessToast('OK', 'Nombre creado');
  await loadNameOptions(name);
  await listPriceLists();
  renderNamePills(name);
}

/* ==========================
   LISTADO
   ========================== */
async function listPriceLists(){
  const tbody = $('#priceListsTable tbody');
  if(tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-center small text-muted py-3">Cargando...</td></tr>';

  const { data, error } = await sb
    .from('price_lists')
    .select('*')
    .order('valid_from', { ascending:false });

  if(error){
    console.error(error);
    if(tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-center small text-danger py-3">Error al cargar.</td></tr>';
    return;
  }

  let rows = data || [];
  lastPriceLists = rows;

  const s = (priceListsState.search||'').toLowerCase();
  if(s){
    rows = rows.filter(r=>{
      const name=(r.name||'').toLowerCase();
      const rev = (r.revision!=null?String(r.revision):'').toLowerCase();
      return name.includes(s) || rev.includes(s);
    });
  }

  const f = priceListsState.filters.status || 'active_programada';
  if(f==='active_programada'){
    rows = rows.filter(r=>{
      const st = getStatus(r);
      return st==='active' || st==='programada';
    });
  } else if(f!=='all'){
    rows = rows.filter(r=>getStatus(r)===f);
  }

  priceListsState.totalRows = rows.length;

  const pageSize = priceListsState.pageSize;
  const total = rows.length;
  const maxPage = Math.max(1, Math.ceil(total/pageSize)||1);
  if(priceListsState.page>maxPage) priceListsState.page=maxPage;
  const page = priceListsState.page;

  const from = total===0?0:(page-1)*pageSize;
  const to = from + pageSize;
  const pageRows = rows.slice(from,to);

  renderTable(pageRows);
  updatePager(total);

  // refrescar vista por nombre
  renderNamePills();
  refreshRevisionsBySelectedName();
}

function renderTable(rows){
  const tbody = $('#priceListsTable tbody');
  if(!tbody) return;
  if(!rows.length){
    tbody.innerHTML = '<tr><td colspan="5" class="text-center small text-muted py-3">Sin listas</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r=>{
    const st = getStatus(r);
    const vf = r.valid_from||'';
    const vt = r.valid_to||'';
    const vig = vf && vt ? `${esc(vf)} a ${esc(vt)}` : (vf?`Desde ${esc(vf)}`:'—');
    const label = st==='active'?'ACTIVA':st==='inactive'?'INACTIVA':'PROGRAMADA';

    return `
      <tr data-id="${esc(r.id)}">
        <td>${esc(r.name??'')}</td>
        <td>${r.revision!=null?esc(r.revision):''}</td>
        <td>${vig}</td>
        <td><span class="badge ${badgeClass(st)}">${label}</span></td>
        <td class="text-end">
          <button type="button" class="btn btn-sm btn-outline-secondary me-1 btn-edit" title="Editar"><i class="bi bi-pencil"></i></button>
          <button type="button" class="btn btn-sm btn-outline-primary me-1 btn-view" title="Ver precios"><i class="bi bi-currency-dollar"></i></button>
          <button type="button" class="btn btn-sm btn-outline-danger btn-pdf" title="PDF"><i class="bi bi-filetype-pdf"></i></button>
        </td>
      </tr>
    `;
  }).join('');

  $$('#priceListsTable .btn-edit').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const tr=e.currentTarget.closest('tr');
      const id=tr?.getAttribute('data-id');
      const row=lastPriceLists.find(x=>String(x.id)===String(id));
      if(row) openModal(row, { readonly:false });
    });
  });
  $$('#priceListsTable .btn-view').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const tr=e.currentTarget.closest('tr');
      const id=tr?.getAttribute('data-id');
      const row=lastPriceLists.find(x=>String(x.id)===String(id));
      if(row) openModal(row, { readonly:true, focusPrices:true });
    });
  });
  $$('#priceListsTable .btn-pdf').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const tr=e.currentTarget.closest('tr');
      const id=tr?.getAttribute('data-id');
      if(id) exportSinglePriceListPdf(id);
    });
  });
}

function updatePager(total){
  const info=$('#priceListsRowsInfo');
  const ind=$('#priceListsPageIndicator');
  const page=priceListsState.page;
  const pageSize=priceListsState.pageSize;
  const from = total===0?0:(page-1)*pageSize+1;
  const to = total===0?0:Math.min(total, page*pageSize);
  if(info) info.textContent = total?`Mostrando ${from}-${to} de ${total}`:'Sin resultados';
  if(ind) ind.textContent = String(page);
}

/* ==========================
   MODAL / ITEMS
   ========================== */
function setReadOnly(ro){
  priceListModalReadOnly = !!ro;
  const form=$('#priceListForm');
  if(!form) return;
  form.querySelectorAll('input, select, textarea').forEach(el=>{
    if(el.id==='priceListId') return;
    el.disabled = ro;
  });
  $('#btnAddPriceListItem')?.classList.toggle('d-none', ro);
  $('#btnSavePriceList')?.classList.toggle('d-none', ro);
  $('#btnAddPriceListName') && ($('#btnAddPriceListName').disabled = ro);
  $$('#priceListItemsBody .btn-remove').forEach(b=>b.disabled=ro);

  $('#bulkPctInput').disabled = ro;
  $('#bulkAddInput').disabled = ro;
  $('#btnApplyBulk').disabled = ro;
  $('#btnResetBulk').disabled = ro;
}

function resetItemsBody(){
  const body=$('#priceListItemsBody');
  if(!body) return;
  body.innerHTML = '<tr class="text-muted"><td colspan="3" class="small text-center">Sin productos</td></tr>';
}

function addItemRow(productId, price){
  const body=$('#priceListItemsBody');
  if(!body) return;

  const empty = body.querySelector('.text-muted');
  if(empty) empty.remove();

  const tr=document.createElement('tr');
  tr.innerHTML = `
    <td>
      <select class="form-select form-select-sm sel-product">
        <option value="">Seleccionar...</option>
      </select>
    </td>
    <td>
      <input type="number" class="form-control form-control-sm inp-price" min="0" step="0.01" value="${price ?? ''}">
    </td>
    <td class="text-end">
      <button type="button" class="btn btn-sm btn-outline-danger btn-remove"><i class="bi bi-x-lg"></i></button>
    </td>
  `;

  const sel=tr.querySelector('.sel-product');
  sel.innerHTML = '<option value="">Seleccionar...</option>';
  priceListProductOptions.forEach(p=>{
    const opt=document.createElement('option');
    opt.value=p.id; opt.textContent=p.label;
    sel.appendChild(opt);
  });
  if(productId) sel.value=productId;

  tr.querySelector('.btn-remove').addEventListener('click', ()=>{
    if(priceListModalReadOnly) return;
    tr.remove();
    if(!$('#priceListItemsBody tr')) resetItemsBody();
  });

  body.appendChild(tr);

  if(priceListModalReadOnly){
    sel.disabled = true;
    tr.querySelector('.inp-price').disabled = true;
    tr.querySelector('.btn-remove').disabled = true;
  }
}

async function loadItems(priceListId){
  resetItemsBody();
  if(!priceListId) return;

  const { data, error } = await sb
    .from('price_list_items')
    .select('product_id, price')
    .eq('price_list_id', priceListId)
    .order('created_at', { ascending:true });

  if(error){ console.error(error); return; }

  (data||[]).forEach(it=> addItemRow(it.product_id, it.price));
  if(priceListModalReadOnly) setReadOnly(true);
}

async function openModal(row, opts={}){
  const form=$('#priceListForm');
  form?.reset();
  form?.classList.remove('was-validated');

  resetItemsBody();
  $('#bulkPctInput').value='';
  $('#bulkAddInput').value='';

  const readonly=!!opts.readonly;

  if(row){
    $('#priceListId').value = row.id||'';
    await loadNameOptions(row.name||'');
    $('#priceListNameSelect').value = row.name||'';
    $('#priceListRevision').value = row.revision ?? '';
    $('#priceListValidFrom').value = row.valid_from || '';
    $('#priceListValidTo').value = row.valid_to || '';
    $('#priceListModalTitle').textContent = readonly?'Lista de precios':'Editar lista de precios';
    setReadOnly(readonly);
    await loadItems(row.id);
  }else{
    $('#priceListId').value='';
    await loadNameOptions('');
    $('#priceListNameSelect').value='';
    $('#priceListRevision').value='1';
    $('#priceListValidFrom').value = new Date().toISOString().slice(0,10);
    $('#priceListValidTo').value='';
    $('#priceListModalTitle').textContent='Nueva lista de precios';
    setReadOnly(false);
  }

  modalPriceList?.show();

  if(opts.focusPrices){
    setTimeout(()=>{
      const btn = document.getElementById('tab-priceList-items');
      if(btn) bootstrap.Tab.getOrCreateInstance(btn).show();
    }, 150);
  }
}

async function savePriceList(){
  const form=$('#priceListForm');
  if(!form) return;

  if(!form.checkValidity()){
    form.classList.add('was-validated');
    const btn = document.getElementById('tab-priceList-data');
    if(btn) bootstrap.Tab.getOrCreateInstance(btn).show();
    return;
  }

  const id = $('#priceListId').value || null;
  const name = ($('#priceListNameSelect').value || '').trim();
  const revision = parseInt($('#priceListRevision').value,10);
  const valid_from = $('#priceListValidFrom').value || null;
  const valid_to = ($('#priceListValidTo').value || '').trim() || null;

  const ok = await precheckCoverageBeforeSave({ id, name, revision, valid_from, valid_to });
  if(!ok) return;

  const payload = { name, revision, valid_from, valid_to, updated_at: new Date().toISOString() };

  let priceListId = id;

  if(id){
    const { error } = await sb.from('price_lists').update(payload).eq('id', id);
    if(error){ console.error(error); await showErrorToast('Error', error.message || 'No se pudo guardar'); return; }
  }else{
    payload.created_at = new Date().toISOString();
    const { data, error } = await sb.from('price_lists').insert(payload).select().single();
    if(error){ console.error(error); await showErrorToast('Error', error.message || 'No se pudo crear'); return; }
    priceListId = data?.id;
  }

  const okItems = await saveItems(priceListId);
  if(!okItems) return;

  await showSuccessToast('OK', 'Lista guardada');
  modalPriceList?.hide();
  await listPriceLists();
}

async function precheckCoverageBeforeSave(newRow){
  const { data, error } = await sb
    .from('price_lists')
    .select('id, name, revision, valid_from, valid_to, deleted_at')
    .eq('name', newRow.name)
    .is('deleted_at', null);

  if(error){
    console.error('precheckCoverageBeforeSave fetch error', error);
    return true;
  }

  const existing = (data||[]).filter(r => !newRow.id || String(r.id)!==String(newRow.id));
  const combined = [
    ...existing,
    { id: newRow.id || 'NEW', name:newRow.name, revision:newRow.revision, valid_from:newRow.valid_from, valid_to:newRow.valid_to, deleted_at:null }
  ].sort((a,b)=> String(a.valid_from||'').localeCompare(String(b.valid_from||'')));

  const { overlaps, gaps } = analyzeCoverage(combined);

  if(overlaps.length){
    await Swal.fire({
      icon:'error',
      title:'Solapamiento de vigencias',
      text:'No se puede guardar porque se solapan fechas para el mismo nombre.'
    });
    return false;
  }

  if(gaps.length){
    const msg = gaps.slice(0,5).map(g=>{
      const daysTxt = (g.days!=null) ? ` (${g.days} día(s))` : '';
      return `• Sin lista vigente: ${g.from} → ${g.to}${daysTxt}`;
    }).join('\n');

    const res = await Swal.fire({
      icon:'warning',
      title:'Hay días sin lista vigente',
      text:'Detectamos un hueco entre revisiones. ¿Querés guardar igual?',
      showCancelButton:true,
      confirmButtonText:'Guardar igual',
      cancelButtonText:'Revisar fechas',
      footer: `<pre style="text-align:left;white-space:pre-wrap;margin:0;">${esc(msg)}</pre>`
    });

    return !!res.isConfirmed;
  }

  return true;
}

async function saveItems(priceListId){
  const rows = $$('#priceListItemsBody tr');
  const items = [];
  rows.forEach(tr=>{
    if(tr.classList.contains('text-muted')) return;
    const pid = tr.querySelector('.sel-product')?.value || '';
    const val = tr.querySelector('.inp-price')?.value;
    if(!pid) return;
    const price = parseFloat(val);
    if(Number.isNaN(price) || price<0) return;
    items.push({ price_list_id: priceListId, product_id: pid, price });
  });

  const { error: delErr } = await sb.from('price_list_items').delete().eq('price_list_id', priceListId);
  if(delErr){ console.error(delErr); await showErrorToast('Error', 'No se pudo guardar items'); return false; }

  if(items.length){
    const { error } = await sb.from('price_list_items').insert(items);
    if(error){ console.error(error); await showErrorToast('Error', 'No se pudieron guardar precios'); return false; }
  }
  return true;
}

/* ==========================
   BULK
   ========================== */
function applyBulkToAllRows(){
  const pctRaw = ($('#bulkPctInput').value || '').trim();
  const addRaw = ($('#bulkAddInput').value || '').trim();
  const pct = pctRaw==='' ? 0 : parseFloat(pctRaw);
  const add = addRaw==='' ? 0 : parseFloat(addRaw);

  if(Number.isNaN(pct) || Number.isNaN(add)){
    showErrorToast('Error', 'Valores inválidos');
    return;
  }
  if(pct===0 && add===0){
    showErrorToast('Atención', 'Ingresá % o $ para aplicar');
    return;
  }

  $$('#priceListItemsBody tr').forEach(tr=>{
    if(tr.classList.contains('text-muted')) return;
    const inp = tr.querySelector('.inp-price');
    if(!inp) return;
    const base = parseFloat(inp.value);
    if(Number.isNaN(base)) return;

    let n = base;
    if(pct!==0) n = n * (1 + pct/100);
    if(add!==0) n = n + add;
    if(n < 0) n = 0;

    inp.value = (Math.round(n*100)/100).toFixed(2);
  });

  showSuccessToast('OK', 'Cambios aplicados');
}

/* ==========================
   VISTA POR NOMBRE
   ========================== */
function getUniqueNamesFromLists(){
  const set = new Set(
    (lastPriceLists || [])
      .filter(r => {
        const st = getStatus(r);
        return st === 'active' || st === 'programada';
      })
      .map(r => r.name)
      .filter(Boolean)
  );
  return Array.from(set).sort((a,b)=>String(a).localeCompare(String(b),'es'));
}

function renderNamePills(forceSelectName){
  const pills = $('#priceListNamesPills');
  if(!pills) return;

  const names = getUniqueNamesFromLists();

  if(forceSelectName) selectedListName = forceSelectName;
  if(!selectedListName && names.length) selectedListName = names[0];
  if(selectedListName && !names.includes(selectedListName) && names.length) selectedListName = names[0];

  if(!names.length){
    pills.innerHTML = `<li class="nav-item"><span class="small text-muted">Sin nombres activos/programados</span></li>`;
    $('#selectedNameLabel') && ($('#selectedNameLabel').textContent = '—');
    clearCoverageAlert();
    return;
  }

  pills.innerHTML = names.map(n=>{
    const active = n===selectedListName ? 'active' : '';
    return `<li class="nav-item">
      <button type="button" class="nav-link ${active} py-1 px-2" data-name="${esc(n)}" style="border-radius:999px;">${esc(n)}</button>
    </li>`;
  }).join('');

  pills.querySelectorAll('button[data-name]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      selectedListName = btn.getAttribute('data-name');
      selectedRevisionRow = null;
      selectedRevisionItemsCache = [];
      $('#itemsByRevisionSearch') && ($('#itemsByRevisionSearch').value = '');
      refreshRevisionsBySelectedName();
      renderNamePills();
    });
  });

  $('#selectedNameLabel') && ($('#selectedNameLabel').textContent = selectedListName || '—');
}

function clearCoverageAlert(){
  const a = $('#coverageAlert');
  if(!a) return;
  a.classList.add('d-none');
  a.classList.remove('alert-warning','alert-danger');
  a.innerHTML = '';
}
function setCoverageAlert({ overlaps, gaps }){
  const a = $('#coverageAlert');
  if(!a) return;

  if(overlaps?.length){
    a.classList.remove('d-none','alert-warning');
    a.classList.add('alert-danger');
    const lines = overlaps.slice(0,3).map(o=>{
      const aR = `${o.a.valid_from}${o.a.valid_to?` → ${o.a.valid_to}`:' → ∞'} (rev ${o.a.revision})`;
      const bR = `${o.b.valid_from}${o.b.valid_to?` → ${o.b.valid_to}`:' → ∞'} (rev ${o.b.revision})`;
      return `• ${aR} solapa con ${bR}`;
    }).join('<br>');
    a.innerHTML = `<strong>Solapamiento detectado:</strong><br>${lines}`;
    return;
  }

  if(gaps?.length){
    a.classList.remove('d-none','alert-danger');
    a.classList.add('alert-warning');
    const lines = gaps.slice(0,3).map(g=>{
      const daysTxt = (g.days!=null) ? ` (${g.days} día(s))` : '';
      return `• Sin lista vigente: ${g.from} → ${g.to}${daysTxt}`;
    }).join('<br>');
    a.innerHTML = `<strong>Atención:</strong> hay días sin lista vigente.<br>${lines}`;
    return;
  }

  clearCoverageAlert();
}

function refreshRevisionsBySelectedName(){
  const tbody = $('#revisionsByNameTbody');
  const itemsBody = $('#itemsByRevisionTbody');

  if(!tbody || !itemsBody) return;

  if(!selectedListName){
    tbody.innerHTML = `<tr class="text-muted"><td colspan="4" class="small text-center">Seleccioná un nombre</td></tr>`;
    itemsBody.innerHTML = `<tr class="text-muted"><td colspan="3" class="small text-center">Seleccioná una revisión</td></tr>`;
    clearCoverageAlert();
    setSelectedRevisionButtons(false);
    return;
  }

  $('#selectedNameLabel') && ($('#selectedNameLabel').textContent = selectedListName);

  const list = (lastPriceLists||[])
    .filter(r=>r.name===selectedListName)
    .sort((a,b)=> (b.revision||0)-(a.revision||0) || String(b.valid_from||'').localeCompare(String(a.valid_from||'')));

  const orderedByFrom = (lastPriceLists||[])
    .filter(r=>r.name===selectedListName && !r.deleted_at)
    .sort((x,y)=> String(x.valid_from||'').localeCompare(String(y.valid_from||'')));

  const coverage = analyzeCoverage(orderedByFrom);
  setCoverageAlert(coverage);

  if(!list.length){
    tbody.innerHTML = `<tr class="text-muted"><td colspan="4" class="small text-center">Sin revisiones</td></tr>`;
    itemsBody.innerHTML = `<tr class="text-muted"><td colspan="3" class="small text-center">Seleccioná una revisión</td></tr>`;
    setSelectedRevisionButtons(false);
    return;
  }

  tbody.innerHTML = list.map(r=>{
    const st=getStatus(r);
    const label = st==='active'?'ACTIVA':st==='inactive'?'INACTIVA':'PROGRAMADA';
    const vf=r.valid_from||'';
    const vt=r.valid_to||'';
    const vig = vf && vt ? `${esc(vf)} a ${esc(vt)}` : (vf?`Desde ${esc(vf)}`:'—');

    return `
      <tr data-id="${esc(r.id)}">
        <td>${esc(r.revision ?? '')}</td>
        <td>${vig}</td>
        <td><span class="badge ${badgeClass(st)}">${label}</span></td>
        <td class="text-end">
          <button type="button" class="btn btn-sm btn-outline-primary btn-select-rev" title="Ver">
            <i class="bi bi-eye"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-select-rev').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const tr=e.currentTarget.closest('tr');
      const id=tr?.getAttribute('data-id');
      const rev = (lastPriceLists||[]).find(x=>String(x.id)===String(id));
      if(!rev) return;
      selectedRevisionRow = rev;
      $('#itemsByRevisionSearch') && ($('#itemsByRevisionSearch').value = '');
      await loadItemsForPanel(rev.id);
    });
  });

  if(!selectedRevisionRow){
    selectedRevisionRow = list[0];
    loadItemsForPanel(selectedRevisionRow.id);
  }
}

function setSelectedRevisionButtons(enabled){
  $('#btnEditSelectedRevision') && ($('#btnEditSelectedRevision').disabled = !enabled);
  $('#btnPdfSelectedRevision') && ($('#btnPdfSelectedRevision').disabled = !enabled);
}

async function loadItemsForPanel(priceListId){
  const itemsBody = $('#itemsByRevisionTbody');
  if(!itemsBody) return;

  itemsBody.innerHTML = `<tr class="text-muted"><td colspan="3" class="small text-center">Cargando...</td></tr>`;

  const { data, error } = await sb
    .from('price_list_items')
    .select('product_id, price')
    .eq('price_list_id', priceListId);

  if(error){
    console.error(error);
    itemsBody.innerHTML = `<tr class="text-muted"><td colspan="3" class="small text-center">Error al cargar</td></tr>`;
    return;
  }

  // Armamos mapa producto -> {label, brand}
  const baseLabelMap = new Map(priceListProductOptions.map(p=>[p.id, p.label]));
  let brandMap = new Map();
  try{
    let resP = await sb.from('products_view').select('id, brand_name');
    if(resP?.data?.length){
      brandMap = new Map(resP.data.map(p=>[p.id, p.brand_name||'']));
    } else if(resP.error){
      const res2 = await sb.from('product').select('id, brand:brand_id(name)');
      if(!res2.error && res2.data?.length){
        brandMap = new Map(res2.data.map(p=>[p.id, (p.brand?.name||'')]));
      }
    }
  }catch(_){}

  const items = (data||[]).map(it=>({
    product_id: it.product_id,
    brand: brandMap.get(it.product_id) || '',
    product_label: baseLabelMap.get(it.product_id) || String(it.product_id),
    price: it.price
  })).sort((a,b)=>String(a.product_label).localeCompare(String(b.product_label),'es'));

  selectedRevisionItemsCache = items;

  const name = selectedRevisionRow?.name || '';
  const rev = selectedRevisionRow?.revision ?? '';
  $('#selectedRevisionLabel') && ($('#selectedRevisionLabel').textContent = name && rev ? `${name} · Rev ${rev}` : '—');

  renderItemsByRevisionTable(items, '');
  setSelectedRevisionButtons(true);
}

function renderItemsByRevisionTable(items, search){
  const body = $('#itemsByRevisionTbody');
  if(!body) return;

  const s = (search||'').toLowerCase();
  const filtered = s
    ? (items||[]).filter(it=>String(it.product_label||'').toLowerCase().includes(s))
    : (items||[]);

  if(!filtered.length){
    body.innerHTML = `<tr class="text-muted"><td colspan="3" class="small text-center">Sin items</td></tr>`;
    return;
  }

  body.innerHTML = filtered.map(it=>`
    <tr>
      <td>${esc(it.brand || '')}</td>
      <td>${esc(it.product_label)}</td>
      <td class="text-end">${it.price!=null ? esc(Number(it.price).toFixed(2)) : ''}</td>
    </tr>
  `).join('');
}

async function createNewRevisionFromSelectedName(){
  if(!selectedListName){
    showErrorToast('Atención', 'Seleccioná un nombre');
    return;
  }

  const list = (lastPriceLists||[])
    .filter(r=>r.name===selectedListName)
    .sort((a,b)=> (b.revision||0)-(a.revision||0));

  const latest = list[0] || null;

  await openModal(null, { readonly:false });

  $('#priceListNameSelect').value = selectedListName;

  if(latest){
    $('#priceListRevision').value = (parseInt(latest.revision||0,10)+1).toString();
    $('#priceListValidFrom').value = new Date().toISOString().slice(0,10);
    $('#priceListValidTo').value = '';

    const { data, error } = await sb
      .from('price_list_items')
      .select('product_id, price')
      .eq('price_list_id', latest.id);

    if(!error){
      resetItemsBody();
      (data||[]).forEach(it=> addItemRow(it.product_id, it.price));
    }
  }else{
    $('#priceListRevision').value = '1';
  }

  setTimeout(()=>{
    const btn = document.getElementById('tab-priceList-items');
    if(btn) bootstrap.Tab.getOrCreateInstance(btn).show();
  }, 150);
}

/* ==========================
   EXPORTS
   ========================== */
function exportCsv(){
  if(!lastPriceLists?.length){ Swal.fire('Atención','No hay datos para exportar','info'); return; }
  const rows = lastPriceLists.map(r=>{
    const st=getStatus(r);
    const label = st==='active'?'ACTIVA':st==='inactive'?'INACTIVA':'PROGRAMADA';
    return { nombre:r.name??'', revision:r.revision??'', vigente_desde:r.valid_from??'', vigente_hasta:r.valid_to??'', estado:label };
  });
  const header = Object.keys(rows[0]);
  let csv = header.join(';')+'\n';
  rows.forEach(row=>{ csv += header.map(k=> `"${String(row[k]??'').replace(/"/g,'""')}"`).join(';')+'\n'; });

  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download='listas_precios.csv'; a.click();
  URL.revokeObjectURL(url);
}

function exportXlsx(){
  if(!lastPriceLists?.length){ Swal.fire('Atención','No hay datos para exportar','info'); return; }
  const rows = lastPriceLists.map(r=>{
    const st=getStatus(r);
    const label = st==='active'?'ACTIVA':st==='inactive'?'INACTIVA':'PROGRAMADA';
    return { Nombre:r.name??'', Revisión:r.revision??'', Vigente_desde:r.valid_from??'', Vigente_hasta:r.valid_to??'', Estado:label };
  });
  const ws=XLSX.utils.json_to_sheet(rows);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ListasPrecios');
  XLSX.writeFile(wb, 'listas_precios.xlsx');
}

/* ==========================
   PDF PRO (nuevo layout)
   - Nombre: NOMBRE - Revisión: X - Vigencia: Desde ...
   - Tabla: Descripción + Precio (precio última columna)
   - Filas con alto consistente (mínimo) y centrado vertical
   - Líneas suaves
   ========================== */
function fmtMoney(n){
  const v = Number(n ?? 0);
  const nf = new Intl.NumberFormat('es-AR', { minimumFractionDigits:2, maximumFractionDigits:2 });
  return nf.format(Number.isFinite(v) ? v : 0);
}
function safeFileName(s){
  return String(s||'').trim().replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,'_').trim();
}
function wrapText(doc, text, maxWidth){
  return doc.splitTextToSize(String(text ?? ''), maxWidth);
}

async function fetchImageAsDataURL(url){
  const res = await fetch(url, { cache:'no-store' });
  if(!res.ok) throw new Error(`No se pudo cargar imagen: ${url}`);
  const blob = await res.blob();
  return await new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=> resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function getImageDimensionsFromDataURL(dataUrl){
  return await new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=> resolve({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function exportSinglePriceListPdf(priceListId){
  try{
    if(!window.jspdf?.jsPDF){
      await Swal.fire('Error', 'No se cargó jsPDF', 'error');
      return;
    }

    const { data: pl, error: plErr } = await sb
      .from('price_lists')
      .select('id, name, revision, valid_from, valid_to')
      .eq('id', priceListId)
      .single();

    if(plErr){ console.error(plErr); await showErrorToast('Error', 'No se pudo cargar la lista'); return; }

    const { data: items, error: itErr } = await sb
      .from('price_list_items')
      .select('product_id, price')
      .eq('price_list_id', priceListId);

    if(itErr){ console.error(itErr); await showErrorToast('Error', 'No se pudieron cargar los items'); return; }

    // Productos (intentamos traer marca)
    let prodMap = new Map();
    try{
      // 1) Si existe products_view con brand_name
      let res = await sb.from('products_view').select('id, code, description, brand_name');
      if(res?.data?.length){
        prodMap = new Map(res.data.map(p=>[p.id, {
          code: p.code||'',
          description: p.description||'',
          brand: p.brand_name||''
        }]));
      } else if(res.error){
        // 2) Fallback a product + brand FK
        const res2 = await sb.from('product').select('id, code, description, brand:brand_id(name)');
        if(!res2.error && res2.data?.length){
          prodMap = new Map(res2.data.map(p=>[p.id, {
            code: p.code||'',
            description: p.description||'',
            brand: p.brand?.name || ''
          }]));
        }
      }
    }catch(e){
      console.warn('No se pudo cargar productos/marca', e);
    }

    const rows = (items||[]).map(it=>{
      const p = prodMap.get(it.product_id) || { description: String(it.product_id), brand:'' };
      // Marca separada; descripción SIN centrado raro; incluimos código dentro de descripción para identificación
      const desc = (p.code ? `${p.code} · ${p.description||''}` : (p.description||'')).trim();
      return { brand: (p.brand||'').trim(), description: desc, price: Number(it.price ?? 0) };
    }).sort((a,b)=> String(a.description).localeCompare(String(b.description),'es'));

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'pt', format:'a4' });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    const margin = 48;
    const headerTop = 112;   // línea base del header (bajado para que no pise el logo)
    const bottom = 52;

    const upperName = String(pl.name||'').toUpperCase();
    const title = 'LISTA DE PRECIOS';

    const vf = pl.valid_from || '—';
    const vt = pl.valid_to || '';
    const vigTxt = vt ? `Vigencia: ${vf} a ${vt}` : `Vigencia: Desde ${vf}`;
    const metaLine = `Nombre: ${upperName} - Revisión: ${pl.revision ?? ''} - ${vigTxt}`;

    // Columnas PDF: Marca | Descripción | Precio
    const colPriceW = 110;
    const colBrandW = 120;
    const gutter = 10;
    const usableW = (pageW - margin*2);
    const colDescW = usableW - colBrandW - colPriceW - gutter*2;

    const xBrand = margin;
    const xDesc = margin + colBrandW + gutter;
    const xPriceRight = pageW - margin;

    const fontBody = 10;
    const fontHead = 10;
    const lineH = 14;

    const padTop = 8;
    const padBottom = 10;
    const minRowH = 36; // un poco más aire

    // Logo centrado y sin deformar
    let logoDataUrl = null;
    let logoDim = null;
    try{
      logoDataUrl = await fetchImageAsDataURL('img/logo_distribuidora.png');
      logoDim = await getImageDimensionsFromDataURL(logoDataUrl);
    }catch(err){
      console.warn('Logo no disponible:', err?.message || err);
      logoDataUrl = null;
      logoDim = null;
    }

    const footerRightText = (() => {
      const now = new Date();
      return `Generado: ${new Intl.DateTimeFormat('es-AR', { dateStyle:'short', timeStyle:'short' }).format(now)}`;
    })();

    const drawHeader = (pageNum) => {
      // Título arriba a la derecha
      doc.setFont('helvetica','bold');
      doc.setFontSize(14);
      doc.text(title, pageW - margin, 34, { align:'right' });

      // Logo centrado (más grande)
      if(logoDataUrl && logoDim?.w && logoDim?.h){
        const maxW = 220; // ↑ más grande
        const maxH = 64;  // ↑ más grande
        const scale = Math.min(maxW / logoDim.w, maxH / logoDim.h);
        const w = logoDim.w * scale;
        const h = logoDim.h * scale;
        const xLogo = (pageW - w) / 2;
        const yLogo = 16;
        const isPng = String(logoDataUrl).startsWith('data:image/png');
        doc.addImage(logoDataUrl, isPng ? 'PNG' : 'JPEG', xLogo, yLogo, w, h);
      }

      // Meta debajo del logo, alineado a la izquierda
      doc.setFont('helvetica','normal');
      doc.setFontSize(10);
      doc.text(metaLine, margin, headerTop-8);

      // Separador
      doc.setDrawColor(220);
      doc.setLineWidth(1);
      doc.line(margin, headerTop, pageW-margin, headerTop);

      // Encabezado tabla
      // Fondo gris claro para encabezados
      doc.setFillColor(245,245,245);
      doc.roundedRect(margin, headerTop+1, pageW - margin*2, 33, 6, 6, 'F');

      doc.setFont('helvetica','bold');
      doc.setFontSize(fontHead);
      doc.text('Marca', xBrand, headerTop+20);
      doc.text('Descripción', xDesc, headerTop+20);
      doc.text('Precio', xPriceRight, headerTop+20, { align:'right' });

      doc.setDrawColor(230);
      doc.line(margin, headerTop+34, pageW-margin, headerTop+34);

      // Footer: página + generado
      doc.setFont('helvetica','normal');
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(`Página ${pageNum}`, margin, pageH - 22);
      doc.text(footerRightText, xPriceRight, pageH - 22, { align:'right' });
      doc.setTextColor(0);
    };

    // helper wrap
    const wrap = (t, w)=> doc.splitTextToSize(String(t ?? ''), w);

    let pageNum = 1;
    drawHeader(pageNum);

    doc.setFont('helvetica','normal');
    doc.setFontSize(fontBody);

    let y = headerTop + 44;

    for(const r of rows){
      const brandLines = wrap(r.brand || '', colBrandW);
      const descLines  = wrap(r.description || '', colDescW);

      const brandBlockH = Math.max(1, brandLines.length) * lineH;
      const descBlockH  = Math.max(1, descLines.length) * lineH;

      const blockH = Math.max(brandBlockH, descBlockH);

      let rowH = padTop + blockH + padBottom;
      if(rowH < minRowH) rowH = minRowH;

      if(y + rowH > pageH - bottom){
        doc.addPage();
        pageNum++;
        drawHeader(pageNum);
        doc.setFont('helvetica','normal');
        doc.setFontSize(fontBody);
        y = headerTop + 44;
      }

      // Centro vertical de bloques (marca y descripción)
      const centerY = y + (rowH/2);
      const blockStartY = centerY - (blockH/2) + (lineH/2) - 2;

      // Marca centrada verticalmente como bloque
      let by = blockStartY;
      brandLines.forEach(ln=>{
        doc.text(String(ln), xBrand, by);
        by += lineH;
      });

      // Descripción centrada verticalmente como bloque
      let dy = blockStartY;
      descLines.forEach(ln=>{
        doc.text(String(ln), xDesc, dy);
        dy += lineH;
      });

      // Precio centrado verticalmente (igual criterio)
      const priceY = centerY + (fontBody/2) - 6;
      doc.text(`$ ${fmtMoney(r.price)}`, xPriceRight, priceY, { align:'right' });

      // Líneas suaves
      doc.setDrawColor(245);
      doc.setLineWidth(1);
      doc.line(margin, y + rowH - 6, pageW - margin, y + rowH - 6);

      y += rowH;
    }

    const file = `Lista_${safeFileName(upperName)}_Rev${pl.revision ?? ''}.pdf`;
    doc.save(file);

    showSuccessToast('OK', 'PDF generado');
  } catch(err){
    console.error(err);
    showErrorToast('Error', 'No se pudo generar el PDF');
  }
}
