/* sales.js v20260221_1 - NO vendor table */
const $ = (q)=>document.querySelector(q);
const $$ = (q)=>Array.from(document.querySelectorAll(q));
function toastOk(text){ return Swal.fire({icon:'success', title:'OK', text:text||'', toast:true, position:'top', showConfirmButton:false, timer:2000}); }
function toastErr(text){ return Swal.fire({icon:'error', title:'Error', text:text||'', toast:true, position:'top', showConfirmButton:false, timer:3000}); }
function esc(s){ return String(s??'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function todayISO(){ return new Date().toISOString().slice(0,10); }

function fmtArNumber(n, decimals=2){
  const v = Number(n || 0);
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(v);
}

function fmtArMoney(n){
  return `$ ${fmtArNumber(n, 2)}`;
}


async function releaseReservedLotsForSale(saleId){
  const sb = window.sb;
  const { data: lots, error } = await sb
    .from('sale_item_lots')
    .select('id, stock_balance_id, quantity')
    .eq('sale_id', saleId);

  if(error){
    console.error('releaseReservedLotsForSale read error', error);
    throw error;
  }

  for(const lot of (lots||[])){
    const { data: bal, error: bErr } = await sb
      .from('stock_balances')
      .select('id, reserved')
      .eq('id', lot.stock_balance_id)
      .single();
    if(bErr){
      console.error('releaseReservedLotsForSale balance error', bErr);
      throw bErr;
    }

    const newReserved = Math.max(0, Number(bal?.reserved || 0) - Number(lot.quantity || 0));
    const { error: uErr } = await sb
      .from('stock_balances')
      .update({ reserved: newReserved, updated_at: new Date().toISOString() })
      .eq('id', lot.stock_balance_id);
    if(uErr){
      console.error('releaseReservedLotsForSale update error', uErr);
      throw uErr;
    }
  }

  if((lots||[]).length){
    const ids = lots.map(x=>x.id);
    const { error: dErr } = await sb.from('sale_item_lots').delete().in('id', ids);
    if(dErr){
      console.error('releaseReservedLotsForSale delete error', dErr);
      throw dErr;
    }
  }
}

async function reserveLotsForSale(saleId){
  const sb = window.sb;
  const { data: items, error: iErr } = await sb
    .from('sale_items')
    .select('id, product_id, quantity')
    .eq('sale_id', saleId)
    .eq('is_active', true)
    .is('deleted_at', null);

  if(iErr){
    console.error('reserveLotsForSale items error', iErr);
    throw iErr;
  }

  const allocations = [];

  for(const it of (items||[])){
    let remaining = Number(it.quantity || 0);
    if(remaining <= 0) continue;

    const { data: lots, error: lErr } = await sb
      .from('stock_balances')
      .select('id, product_id, warehouse_id, lot, expiration_date, quantity, reserved, available')
      .eq('product_id', it.product_id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .gt('quantity', 0)
      .order('expiration_date', { ascending:true, nullsFirst:false })
      .order('id', { ascending:true });

    if(lErr){
      console.error('reserveLotsForSale lots error', lErr);
      throw lErr;
    }

    for(const lot of (lots||[])){
      if(remaining <= 0) break;
      const qty = Number(lot.quantity || 0);
      const res = Number(lot.reserved || 0);
      const av = (lot.available != null) ? Number(lot.available) : (qty - res);
      const take = Math.min(remaining, Math.max(0, av));
      if(take <= 0) continue;
      allocations.push({
        sale_id: saleId,
        sale_item_id: it.id,
        product_id: it.product_id,
        stock_balance_id: lot.id,
        warehouse_id: lot.warehouse_id,
        lot: lot.lot,
        quantity: take
      });
      remaining -= take;
    }

    if(remaining > 0){
      throw new Error('Stock insuficiente para reservar uno o más productos');
    }
  }

  for(const a of allocations){
    const { data: bal, error: bErr } = await sb
      .from('stock_balances')
      .select('id, reserved')
      .eq('id', a.stock_balance_id)
      .single();
    if(bErr){
      console.error('reserveLotsForSale balance error', bErr);
      throw bErr;
    }
    const newReserved = Number(bal?.reserved || 0) + Number(a.quantity || 0);
    const { error: uErr } = await sb
      .from('stock_balances')
      .update({ reserved: newReserved, updated_at: new Date().toISOString() })
      .eq('id', a.stock_balance_id);
    if(uErr){
      console.error('reserveLotsForSale update error', uErr);
      throw uErr;
    }
  }

  if(allocations.length){
    const { error: insErr } = await sb.from('sale_item_lots').insert(allocations);
    if(insErr){
      console.error('reserveLotsForSale insert lots error', insErr);
      throw insErr;
    }
  }
}

let saleModal;
let dispatchModal;
let dispatchSale = null;
let dispatchItems = [];
let stockByProduct = new Map();
let reservedLotsBySaleItem = new Map();

let customers = [];
let products = [];
let priceListNames = [];
let customerDefaultNameIdById = new Map();
let priceListNameTextById = new Map();
let currentPriceListNameId = '';
let currentPriceListId = '';
let salesRows = [];
let salesRowsFiltered = [];


document.addEventListener('DOMContentLoaded', async ()=>{
  console.log('sales.js v20260418_reserved_fix loaded');
  saleModal = new bootstrap.Modal(document.getElementById('saleModal'), { focus:false });
  dispatchModal = new bootstrap.Modal(document.getElementById('dispatchModal'), { focus:false });

  for(let i=0;i<200;i++){
    if(window.sb) break;
    await new Promise(r=>setTimeout(r,25));
  }
  if(!window.sb){
    console.error('No se encontró el cliente de Supabase (sb).');
    toastErr('No se encontró Supabase (sb).');
    return;
  }

  bindUI();
  await loadCustomers();
  await loadPriceListNames();
  await loadProducts();
  await loadSales();
});

function bindUI(){
  $('#btnAddSale')?.addEventListener('click', ()=> openNewSale());
  $('#btnRefreshSales')?.addEventListener('click', ()=> loadSales());
  $('#salesSearchInput')?.addEventListener('input', ()=> renderSalesTable());
  $('#filterSaleStatus')?.addEventListener('change', ()=> renderSalesTable());
  $('#btnConfirmDispatch')?.addEventListener('click', ()=> confirmDispatch());
  $('#btnUndoDispatch')?.addEventListener('click', ()=> undoDispatchCurrentSale());
  $('#saleCustomer')?.addEventListener('change', ()=> onCustomerChanged());
  $('#salePriceListName')?.addEventListener('change', ()=> onHeaderPriceListNameChanged());
  $('#salePriceListRevision')?.addEventListener('change', ()=> onHeaderRevisionChanged());
  $('#btnAddSaleItemRow')?.addEventListener('click', ()=> addItemRow());
  $('#btnSaveSale')?.addEventListener('click', ()=> saveSale('DRAFT'));
  $('#btnConfirmSale')?.addEventListener('click', ()=> saveSale('CONFIRMED'));
}

async function loadCustomers(){
  const sb = window.sb;
  const { data, error } = await sb
    .from('clients_view')
    .select('id, nombre, localidad, is_active, is_client, default_price_list_name_id, default_price_list_name')
    .eq('is_client', true)
    .eq('is_active', true)
    .order('nombre', { ascending:true });

  if(error){
    console.error('No se pudo cargar clientes desde clients_view:', error);
    toastErr('No se pudo cargar clientes');
    return;
  }
  customers = data || [];
  const sel = $('#saleCustomer');
  if(sel){
    sel.innerHTML = '<option value="">Seleccioná cliente</option>' + customers.map(c=>{
      const loc = c.localidad ? ` · ${c.localidad}` : '';
      customerDefaultNameIdById.set(c.id, c.default_price_list_name_id || '');
      return `<option value="${c.id}">${esc(c.nombre)}${esc(loc)}</option>`;
    }).join('');
  }
}


function rebuildPriceListNameOptions(defaultId){
  const sel = document.getElementById('salePriceListName');
  if(!sel) return;
  sel.innerHTML = '<option value="">—</option>' + (priceListNames||[]).map(n=>{
    const isDef = defaultId && n.id === defaultId;
    const base = n.is_active ? n.name : `${n.name} (INACTIVA)`;
    const label = isDef ? `✓ ${base} (cliente)` : base;
    return `<option value="${n.id}">${esc(label)}</option>`;
  }).join('');
}

async function loadPriceListNames(){
  const sb = window.sb;
  const { data, error } = await sb
    .from('price_list_names')
    .select('id, name, is_active')
    .is('deleted_at', null)
    .order('name', { ascending:true });

  if(error){
    console.error('price_list_names error', error);
    toastErr('No se pudieron cargar listas de precios');
    return;
  }
  priceListNames = data || [];
  priceListNameTextById = new Map(priceListNames.map(n=>[n.id, n.name]));
  rebuildPriceListNameOptions('');
}

async function loadProducts(){
  const sb = window.sb;
  let res = await sb.from('products_view').select('id, code, description').order('code', { ascending:true });
  if(res.error){
    res = await sb.from('product').select('id, code, description').order('code', { ascending:true });
  }
  if(res.error){
    console.error('products error', res.error);
    toastErr('No se pudieron cargar productos');
    return;
  }
  products = res.data || [];
}


function applySaleModalMode(status, viewOnly){
  const st = String(status||'').toUpperCase();
  const ro = !!viewOnly || st==='CANCELLED' || st==='DISPATCHED';

  ['saleCustomer','saleDate','saleNumber','saleNotes','salePriceListName','salePriceListRevision'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.disabled = ro;
  });

  const addBtn = document.getElementById('btnAddSaleItemRow');
  if(addBtn){
    addBtn.disabled = ro;
    addBtn.style.display = ro ? 'none' : '';
  }

  const b1=document.getElementById('btnSaveSale'); if(b1) b1.style.display = ro ? 'none' : '';
  const b2=document.getElementById('btnConfirmSale'); if(b2) b2.style.display = ro ? 'none' : '';

  // Si está CONFIRMED (pedido), no mostramos guardar borrador y renombramos el botón principal
  if(!ro && st==='CONFIRMED'){
    if(b1) b1.style.display = 'none';
    if(b2) b2.innerHTML = '<i class="bi bi-pencil me-1"></i> Modificar';
  } else if(!ro){
    if(b2) b2.innerHTML = '<i class="bi bi-check2-circle me-1"></i> Hacer pedido';
  }

  document.querySelectorAll('#saleItemsBody select, #saleItemsBody input').forEach(el=>{ el.disabled = ro; });
  document.querySelectorAll('#saleItemsBody .si-del').forEach(btn=>{
    btn.disabled = ro;
    btn.style.display = ro ? 'none' : '';
  });

  const undo=document.getElementById('btnUndoDispatch');
  if(undo) undo.style.display = (st==='DISPATCHED') ? '' : 'none';
}

function openNewSale(){
  $('#saleForm')?.classList.remove('was-validated');
  $('#saleId').value='';
  $('#saleStatus').value='DRAFT';
  $('#saleNumber').value='';
  $('#saleNotes').value='';
  $('#saleCustomer').value='';
  $('#saleDate').value = todayISO();

  $('#salePriceListName').value='';
  $('#salePriceListRevision').innerHTML='<option value="">—</option>';
  currentPriceListNameId='';
  currentPriceListId='';

  $('#saleItemsBody').innerHTML='';
  addItemRow();
  updateTotal();
  try{ applySaleModalMode('DRAFT', false); }catch(_){ }
  saleModal.show();
}

async function onCustomerChanged(){
  const customerId = $('#saleCustomer')?.value || '';
  if(!customerId) return;

  const defNameId = customerDefaultNameIdById.get(customerId) || '';
  // remarcar en el combo cuál es la lista sugerida del cliente
  rebuildPriceListNameOptions(defNameId);
  if(defNameId){
    $('#salePriceListName').value = defNameId;
    await onHeaderPriceListNameChanged(true);
  }
}

async function onHeaderPriceListNameChanged(){
  const nameId = $('#salePriceListName')?.value || '';
  currentPriceListNameId = nameId;
  const revSel = $('#salePriceListRevision');
  if(!revSel) return;

  revSel.innerHTML = '<option value="">—</option>';
  currentPriceListId = '';

  if(!nameId){
    await recalcAllPricesFromHeader();
    return;
  }

  const nameText = priceListNameTextById.get(nameId) || '';
  if(!nameText){
    await recalcAllPricesFromHeader();
    return;
  }

  const sb = window.sb;
  const { data: revs, error } = await sb
    .from('price_lists')
    .select('id, name, revision, valid_from, valid_to, deleted_at')
    .eq('name', nameText)
    .order('revision', { ascending:false });

  if(error){
    console.error('price_lists error', error);
    toastErr('No se pudieron cargar revisiones');
    return;
  }

  const t = todayISO();
  const status = (r)=>{
    if(r.deleted_at) return 'INACTIVA';
    if(r.valid_to && r.valid_to < t) return 'INACTIVA';
    if(r.valid_from && r.valid_from > t) return 'PROGRAMADA';
    return 'ACTIVA';
  };

  revSel.innerHTML = '<option value="">—</option>' + (revs||[]).map(r=>{
    const st = status(r);
    const vig = r.valid_to ? `${r.valid_from} a ${r.valid_to}` : `Desde ${r.valid_from}`;
    return `<option value="${r.id}">Rev ${r.revision} · ${st} · ${esc(vig)}</option>`;
  }).join('');

  const active = (revs||[]).filter(r=>!r.deleted_at && r.valid_from <= t && (!r.valid_to || r.valid_to >= t));
  const picked = (active[0]) || (revs||[])[0] || null;
  if(picked){
    revSel.value = picked.id;
    currentPriceListId = picked.id;

  // marcar visualmente la vigente elegida (tilde)
  try{
    const opt = revSel.querySelector(`option[value="${picked.id}"]`);
    if(opt && !opt.textContent.trim().startsWith('✓')) opt.textContent = `✓ ${opt.textContent}`;
  }catch(_){}
  }

  await recalcAllPricesFromHeader();
}

async function onHeaderRevisionChanged(){
  currentPriceListId = $('#salePriceListRevision')?.value || '';
  await recalcAllPricesFromHeader();
}

function addItemRow(){
  const body = $('#saleItemsBody');
  if(!body) return;

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <select class="form-select form-select-sm si-product">
        <option value="">Seleccionar...</option>
        ${products.map(p=>`<option value="${p.id}">${esc(p.code)} · ${esc(p.description)}</option>`).join('')}
      </select>
    </td>
    <td class="text-center"><input type="number" min="0" step="1" class="form-control form-control-sm si-qty" value="1"></td>
    <td class="text-center"><input type="number" min="0" step="0.01" class="form-control form-control-sm si-price" value=""></td>
    <td class="text-center"><input type="number" min="0" max="100" step="0.01" class="form-control form-control-sm si-disc" value="0"></td>
    <td class="text-end"><span class="si-subtotal">$ 0</span></td>
    <td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger si-del"><i class="bi bi-x-lg"></i></button></td>
  `;
  body.appendChild(tr);

  const sel = tr.querySelector('.si-product');
  const qty = tr.querySelector('.si-qty');
  const price = tr.querySelector('.si-price');
  const disc = tr.querySelector('.si-disc');
  const del = tr.querySelector('.si-del');

  sel.addEventListener('change', async ()=>{
    await maybeAutoPriceForRow(tr);
    updateRowSubtotal(tr);
    updateTotal();
  });
  qty.addEventListener('input', ()=>{ updateRowSubtotal(tr); updateTotal(); });
  disc.addEventListener('input', ()=>{ updateRowSubtotal(tr); updateTotal(); });
  price.addEventListener('input', ()=>{ tr.dataset.price_source = 'MANUAL'; updateRowSubtotal(tr); updateTotal(); });
  del.addEventListener('click', ()=>{ tr.remove(); updateTotal(); });
}

async function maybeAutoPriceForRow(tr){
  const pid = tr.querySelector('.si-product')?.value || '';
  const priceInp = tr.querySelector('.si-price');
  if(!pid || !priceInp) return;

  const plid = currentPriceListId || '';
  if(!plid) return;

  const source = tr.dataset.price_source || '';
  if(priceInp.value !== '' && source === 'MANUAL') return;

  const sb = window.sb;
  const { data, error } = await sb
    .from('price_list_items')
    .select('price')
    .eq('price_list_id', plid)
    .eq('product_id', pid)
    .limit(1);

  if(error){
    console.error('price_list_items error', error);
    return;
  }
  const row = (data||[])[0];
  if(row && row.price!=null){
    priceInp.value = Number(row.price).toFixed(2);
    tr.dataset.price_source = 'LIST';
    tr.dataset.price_list_id = plid;
  }
}

async function recalcAllPricesFromHeader(){
  const rows = $$('#saleItemsBody tr');
  for(const tr of rows){
    const priceInp = tr.querySelector('.si-price');
    const source = tr.dataset.price_source || '';
    if(priceInp && (priceInp.value==='' || source==='LIST')){
      await maybeAutoPriceForRow(tr);
    }
    updateRowSubtotal(tr);
  }
  updateTotal();
}

function updateRowSubtotal(tr){
  const qty = parseInt(tr.querySelector('.si-qty')?.value || '0', 10) || 0;
  const price = parseFloat(tr.querySelector('.si-price')?.value || '0') || 0;
  const disc = parseFloat(tr.querySelector('.si-disc')?.value || '0') || 0;
  const factor = Math.max(0, Math.min(100, disc));
  const sub = qty * price * (1 - factor/100);
  tr.querySelector('.si-subtotal').textContent = fmtArMoney(sub);
  tr.dataset.subtotal = String(sub);
}

function updateTotal(){
  const total = $$('#saleItemsBody tr').reduce((acc,tr)=> acc + (parseFloat(tr.dataset.subtotal||'0')||0), 0);
  $('#saleTotalText').textContent = fmtArMoney(total);
}


async function loadSales(){
  const sb = window.sb;
  console.log('[loadSales] start');
  try{
    // Traemos ventas (sin join, más robusto)
    const { data, error } = await sb
      .from('sales')
      .select('id, sale_date, sale_number, customer_id, status, total_amount, reference, notes, created_at')
      .order('sale_date', { ascending:false })
      .order('created_at', { ascending:false })
      .limit(500);

    if(error){
      console.error('[loadSales] error', error);
      toastErr('No se pudieron cargar ventas');
      const body = document.getElementById('salesTableBody');
      if(body) body.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">Error al cargar ventas</td></tr>`;
      return;
    }

    const raw = data || [];
    console.log('[loadSales] rows', raw.length);

    // Mapa de clientes para mostrar nombre
    const ids = Array.from(new Set(raw.map(r=>r.customer_id).filter(Boolean)));
    let nameMap = new Map();
    if(ids.length){
      const { data: cdata, error: cerr } = await sb
        .from('clients_view')
        .select('id, nombre')
        .in('id', ids);
      if(cerr){
        console.warn('[loadSales] clients_view error', cerr);
      }else{
        nameMap = new Map((cdata||[]).map(c=>[c.id, c.nombre]));
      }
    }

    salesRows = raw.map(r=>({
      id: r.id,
      sale_date: r.sale_date,
      sale_number: r.sale_number || '',
      customer_id: r.customer_id,
      customer_name: nameMap.get(r.customer_id) || '',
      status: r.status,
      total_amount: Number(r.total_amount||0),
      reference: r.reference || '',
      notes: r.notes || ''
    }));

    renderSalesTable();
  }catch(e){
    console.error('[loadSales] exception', e);
    toastErr('No se pudieron cargar ventas');
  }
}

function statusBadge(st){
  const s = String(st||'').toUpperCase();
  const map = {
    'DRAFT':  { cls:'bg-light text-dark border', label:'Borrador' },
    'CONFIRMED': { cls:'bg-primary', label:'Confirmada' },
    'DELIVERED': { cls:'bg-success', label:'Entregada' },
    'CANCELLED': { cls:'bg-secondary', label:'Cancelada' }
  };
  const m = map[s] || { cls:'bg-light text-dark border', label:s||'—' };
  return `<span class="badge ${m.cls}">${m.label}</span>`;
}

function fmtMoney(n){
  return fmtArMoney(n);
}

function renderSalesTable(){
  const q = ($('#salesSearchInput')?.value || '').trim().toLowerCase();
  const stFilter = ($('#filterSaleStatus')?.value || '').trim().toUpperCase();
  salesRowsFiltered = salesRows.filter(r=>{
    if(stFilter && String(r.status||'').toUpperCase() !== stFilter) return false;
    if(!q) return true;
    return (
      (r.customer_name||'').toLowerCase().includes(q) ||
      (r.sale_number||'').toLowerCase().includes(q) ||
      (r.notes||'').toLowerCase().includes(q) || (r.reference||'').toLowerCase().includes(q)
    );
  });

  const body = document.getElementById('salesTableBody');
  if(!body) return;

  if(!salesRowsFiltered.length){
    body.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Sin ventas</td></tr>`;
    return;
  }

  body.innerHTML = salesRowsFiltered.map(r=>`
    <tr>
      <td>${esc(r.sale_date||'')}</td>
      <td>${esc(r.sale_number||'')}</td>
      <td>${esc(r.customer_name||'')}</td>
      <td>${statusBadge(r.status)}</td>
      <td class="text-end">${fmtMoney(r.total_amount)}</td>
      <td>${esc([r.reference, r.notes].filter(Boolean).join(' | '))}</td>
      <td class="text-end">
        ${(() => {
          const st = String(r.status||'').toUpperCase();
          const isCancelled = st==='CANCELLED';
          const isDispatched = st==='DISPATCHED';
          const isConfirmed = st==='CONFIRMED';
          const btnView = `<button class="btn btn-sm btn-outline-secondary me-1" data-action="view" data-id="${r.id}" title="Ver"><i class="bi bi-eye"></i></button>`;
          const btnEdit = `<button class="btn btn-sm btn-outline-secondary me-1" data-action="edit" data-id="${r.id}" title="Editar"><i class="bi bi-pencil"></i></button>`;
          const btnCancel = `<button class="btn btn-sm btn-outline-danger me-1" data-action="cancel" data-id="${r.id}" title="Cancelar"><i class="bi bi-x-circle"></i></button>`;
          const btnDispatch = `<button class="btn btn-sm btn-outline-primary" data-action="dispatch" data-id="${r.id}" title="Despachar"><i class="bi bi-truck"></i></button>`;
          if(isCancelled || isDispatched) return btnView;
          if(isConfirmed) return btnEdit + btnCancel + btnDispatch;
          return btnEdit + btnCancel;
        })()}
      </td>
    </tr>
  `).join('');

  body.querySelectorAll('button[data-action="edit"]').forEach(btn=>{
    btn.addEventListener('click', ()=> openSaleForEdit(btn.dataset.id, false));
  });
  body.querySelectorAll('button[data-action="view"]').forEach(btn=>{
    btn.addEventListener('click', ()=> openSaleForEdit(btn.dataset.id, true));
  });
  body.querySelectorAll('button[data-action="cancel"]').forEach(btn=>{
    btn.addEventListener('click', ()=> cancelSale(btn.dataset.id));
  });
  body.querySelectorAll('button[data-action="dispatch"]').forEach(btn=>{
    btn.addEventListener('click', ()=> openDispatch(btn.dataset.id));
  });
}

async function openSaleForEdit(id, viewOnly){
  const sb = window.sb;

  const { data: sale, error: saleErr } = await sb
    .from('sales')
    .select('id, customer_id, sale_date, sale_number, reference, notes, status')
    .eq('id', id)
    .single();

  if(saleErr){
    console.error('sales single error', saleErr);
    toastErr('No se pudo abrir la venta');
    return;
  }

  const { data: items, error } = await sb
    .from('sale_items')
    .select('id, product_id, quantity, unit_price, discount, subtotal, price_list_id, price_source')
    .eq('sale_id', id)
    .eq('is_active', true)
    .is('deleted_at', null);

  if(error){
    console.error('sale_items load error', error);
    toastErr('No se pudieron cargar ítems');
    return;
  }

  $('#saleForm')?.classList.remove('was-validated');
  $('#saleId').value = sale.id;
  $('#saleStatus').value = sale.status || 'DRAFT';
  $('#saleNumber').value = sale.reference || '';
  $('#saleNotes').value = sale.notes || '';
  $('#saleCustomer').value = sale.customer_id || '';
  $('#saleDate').value = sale.sale_date || todayISO();

  await onCustomerChanged();

  const firstPl = (items||[]).find(it=>it.price_list_id)?.price_list_id || '';
  if(firstPl){
    // si existe el select lo setea; si no, lo ignora (no rompe modal)
    const revSel = document.getElementById('salePriceListRevision');
    if(revSel) revSel.value = firstPl;
    currentPriceListId = firstPl;
  }

  const body = $('#saleItemsBody');
  body.innerHTML='';
  (items||[]).forEach(it=>{
    const tr = document.createElement('tr');
    tr.dataset.price_source = it.price_source || 'MANUAL';
    tr.dataset.price_list_id = it.price_list_id || '';
    tr.innerHTML = `
      <td>
        <select class="form-select form-select-sm si-product">
          <option value="">Seleccionar...</option>
          ${products.map(p=>`<option value="${p.id}" ${p.id===it.product_id?'selected':''}>${esc(p.code)} · ${esc(p.description)}</option>`).join('')}
        </select>
      </td>
      <td class="text-center"><input type="number" min="0" step="1" class="form-control form-control-sm si-qty" value="${Number(it.quantity||0)}"></td>
      <td class="text-center"><input type="number" min="0" step="0.01" class="form-control form-control-sm si-price" value="${Number(it.unit_price||0).toFixed(2)}"></td>
      <td class="text-center"><input type="number" min="0" max="100" step="0.01" class="form-control form-control-sm si-disc" value="${Number(it.discount||0)}"></td>
      <td class="text-end"><span class="si-subtotal">$ 0</span></td>
      <td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger si-del"><i class="bi bi-x-lg"></i></button></td>
    `;
    body.appendChild(tr);

    tr.querySelector('.si-product')?.addEventListener('change', async ()=>{
      await maybeAutoPriceForRow(tr);
      updateRowSubtotal(tr); updateTotal();
    });
    tr.querySelector('.si-qty')?.addEventListener('input', ()=>{ updateRowSubtotal(tr); updateTotal(); });
    tr.querySelector('.si-disc')?.addEventListener('input', ()=>{ updateRowSubtotal(tr); updateTotal(); });
    tr.querySelector('.si-price')?.addEventListener('input', ()=>{ tr.dataset.price_source='MANUAL'; updateRowSubtotal(tr); updateTotal(); });
    tr.querySelector('.si-del')?.addEventListener('click', ()=>{ 
      const st=String(sale.status||'').toUpperCase();
      const ro=!!viewOnly || st==='CANCELLED' || st==='DISPATCHED';
      if(ro) return;
      tr.remove(); updateTotal(); 
    });

    updateRowSubtotal(tr);
  });

  updateTotal();
  try{ applySaleModalMode(sale.status, viewOnly); }catch(_){ }
  saleModal.show();
}


async function openDispatch(saleId){
  const sb = window.sb;

  // traer venta + items
  const { data: sale, error: saleErr } = await sb
    .from('sales')
    .select('id, sale_number, sale_date, customer_id, status, total_amount, clients:customer_id(nombre)')
    .eq('id', saleId)
    .single();
  if(saleErr){ console.error(saleErr); toastErr('No se pudo abrir despacho'); return; }

  const { data: items, error: itErr } = await sb
    .from('sale_items')
    .select('id, product_id, quantity, unit_price, discount, subtotal')
    .eq('sale_id', saleId)
    .eq('is_active', true)
    .is('deleted_at', null);
  if(itErr){ console.error(itErr); toastErr('No se pudieron cargar ítems'); return; }

  dispatchSale = sale;
  dispatchItems = items || [];
  stockByProduct = new Map();
  reservedLotsBySaleItem = new Map();

  const { data: reservedRows, error: reservedErr } = await sb
    .from('sale_item_lots')
    .select('sale_item_id, stock_balance_id, quantity')
    .eq('sale_id', saleId);
  if(reservedErr){ console.error(reservedErr); toastErr('No se pudieron cargar reservas'); return; }

  for(const rr of (reservedRows||[])){
    const key = `${rr.sale_item_id}::${rr.stock_balance_id}`;
    reservedLotsBySaleItem.set(key, Number(rr.quantity || 0));
  }

  // cargar stock balances para cada producto
  for(const it of dispatchItems){
    const { data: sbal, error: sErr } = await sb
      .from('vw_stock_current')
      .select('id, product_id, warehouse_id, lot, expiration_date, available, quantity, reserved')
      .eq('product_id', it.product_id)
      .order('expiration_date', { ascending:true, nullsFirst:false })
      .order('id', { ascending:true });

    if(sErr){ console.error(sErr); toastErr('Error stock'); return; }

    const arr = (sbal||[]).map(r=>{
      const qty = Number(r.quantity||0);
      const res = Number(r.reserved||0);
      const av = (r.available!=null) ? Number(r.available) : (qty-res);
      const reservedForSale = Number(reservedLotsBySaleItem.get(`${it.id}::${r.id}`) || 0);
      return { ...r, _available: Math.max(0,av), _reserved_total: Math.max(0,res), _reserved_for_sale: Math.max(0,reservedForSale) };
    }).filter(r=> (Number(r.quantity||0) > 0) || r._reserved_for_sale > 0);

    arr.sort((a,b)=>{
      const ar = a._reserved_for_sale > 0 ? 0 : 1;
      const br = b._reserved_for_sale > 0 ? 0 : 1;
      if(ar !== br) return ar - br;
      const ae = a.expiration_date || '9999-12-31';
      const be = b.expiration_date || '9999-12-31';
      if(ae < be) return -1;
      if(ae > be) return 1;
      return Number(a.id||0) - Number(b.id||0);
    });

    stockByProduct.set(it.product_id, arr);
  }

  // render modal
  const info = document.getElementById('dispatchSaleInfo');
  if(info){
    info.textContent = `Venta ${sale.sale_number||''} · ${sale.clients?.nombre||''} · ${sale.sale_date||''}`;
  }

  renderDispatchTable();
  dispatchModal.show();
}

function renderDispatchTable(){
  const body = document.getElementById('dispatchBody');
  if(!body) return;
  body.innerHTML = '';

  dispatchItems.forEach(it=>{
    const prod = products.find(p=>p.id===it.product_id);
    const prodLabel = prod ? `${prod.code} · ${prod.description}` : it.product_id;
    const need = parseInt(it.quantity||0,10) || 0;

    // FIFO allocation priorizando la reserva de esta venta
    const lots = stockByProduct.get(it.product_id) || [];
    let remaining = need;
    const allocs = [];
    for(const l of lots){
      if(remaining<=0) break;
      const preferred = Math.max(0, Math.floor(l._reserved_for_sale || 0));
      const fallback = Math.max(0, Math.floor(l._available || 0));
      const baseQty = preferred > 0 ? preferred : fallback;
      const take = Math.min(remaining, baseQty);
      if(take <= 0) continue;
      allocs.push({
        stock_balance_id:l.id,
        lot:l.lot||'',
        warehouse_id:l.warehouse_id,
        qty:take,
        available:Math.floor(l._available),
        reserved_for_sale:Math.floor(l._reserved_for_sale || 0)
      });
      remaining -= take;
    }
    if(!allocs.length){
      allocs.push({ stock_balance_id:'', lot:'', warehouse_id:'', qty:0, available:0 });
    }

    allocs.forEach((a, idx)=>{
      const tr = document.createElement('tr');
      tr.dataset.sale_item_id = it.id;
      tr.dataset.product_id = it.product_id;
      tr.dataset.need = String(need);
      tr.innerHTML = `
        <td>${idx===0 ? `<strong>${esc(prodLabel)}</strong><div class="small text-muted">Pedido: ${need}</div>` : `<div class="small text-muted">↳ ${esc(prodLabel)}</div>`}</td>
        <td>
          <select class="form-select form-select-sm dm-lot"></select>
        </td>
        <td class="text-center"><span class="dm-av">${a.available!=null ? fmtArNumber(a.available, 0) : ''}</span></td>
        <td class="text-center"><span class="dm-rsv">${a.reserved_for_sale!=null ? fmtArNumber(a.reserved_for_sale, 0) : '0'}</span></td>
        <td class="text-center">
          <input class="form-control form-control-sm dm-qty" type="number" min="0" step="1" value="${Number(a.qty||0)}">
        </td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-primary dm-split" type="button" title="Split"><i class="bi bi-node-plus"></i></button>
          
        </td>
      `;
      body.appendChild(tr);

      const sel = tr.querySelector('.dm-lot');
      const lotsFor = stockByProduct.get(it.product_id) || [];
      sel.innerHTML = '<option value="">—</option>' + lotsFor.map(l=>{
        const label = `${l.lot||'(sin lote)'} · disp ${fmtArNumber(l._available||0, 0)} · reservado ${fmtArNumber(l._reserved_for_sale||0, 0)}`;
        return `<option value="${l.id}" ${String(l.id)===String(a.stock_balance_id)?'selected':''}>${esc(label)}</option>`;
      }).join('');

      const updateAv = ()=>{
        const chosen = lotsFor.find(x=>String(x.id)===String(sel.value));
        tr.querySelector('.dm-av').textContent = chosen ? fmtArNumber(chosen._available||0, 0) : '';
        tr.querySelector('.dm-rsv').textContent = chosen ? fmtArNumber(chosen._reserved_for_sale||0, 0) : '0';
      };
      sel.addEventListener('change', updateAv);
      updateAv();

      tr.querySelector('.dm-split').addEventListener('click', ()=>{
        const newTr = tr.cloneNode(true);

        // Formato consistente para filas split (igual que automático)
        const td0 = newTr.querySelector('td');
        if(td0){
          td0.innerHTML = `<div class="small text-muted">↳ ${esc(prodLabel)}</div>`;
        }

        // limpiar cantidad y selección de lote
        const qtyInput = newTr.querySelector('.dm-qty');
        if(qtyInput) qtyInput.value = '0';
        const sel2 = newTr.querySelector('.dm-lot');
        if(sel2) sel2.value = '';

        // actualizar disponible en base a selección
        const updateAv2 = ()=>{
          const chosen = lotsFor.find(x=>String(x.id)===String(sel2.value));
          newTr.querySelector('.dm-av').textContent = chosen ? fmtArNumber(chosen._available||0, 0) : '';
        };
        if(sel2){
          sel2.addEventListener('change', updateAv2);
          updateAv2();
        }

        // el split también funciona en la nueva fila
        newTr.querySelector('.dm-split')?.addEventListener('click', ()=>{ tr.querySelector('.dm-split').click(); });

        body.insertBefore(newTr, tr.nextSibling);
      });
    });
  });
}

async function confirmDispatch(){
  let pendingItemsToCreate = null;

  if(!dispatchSale) return;

  // armar allocations desde tabla
  const rows = Array.from(document.querySelectorAll('#dispatchBody tr'));
  const allocs = [];
  for(const tr of rows){
    const sale_item_id = tr.dataset.sale_item_id;
    const product_id = tr.dataset.product_id;
    const stock_balance_id = tr.querySelector('.dm-lot')?.value || '';
    const qty = parseInt(tr.querySelector('.dm-qty')?.value || '0', 10) || 0;
    if(!stock_balance_id || qty<=0) continue;
    allocs.push({ sale_item_id, product_id, stock_balance_id: Number(stock_balance_id), qty });
  }

  try{ await releaseReservedLotsForSale(dispatchSale.id); }catch(e){ console.warn('No se pudieron liberar reservas previas antes del despacho', e); }

  // validar por item (permite parcial con decisión del usuario)
  const needByItem = new Map(dispatchItems.map(it=>[it.id, parseInt(it.quantity||0,10)||0]));
  const sumByItem = new Map();
  allocs.forEach(a=> sumByItem.set(a.sale_item_id, (sumByItem.get(a.sale_item_id)||0)+a.qty ));

  // 1) Si hay despacho mayor al pedido -> pedir confirmación para ajustar el pedido
  for(const [sid, need] of needByItem.entries()){
    const sum = parseInt(sumByItem.get(sid)||0,10)||0;
    if(sum > need){
      const res = await Swal.fire({
        icon:'warning',
        title:'Despacho mayor al pedido',
        text:`Este ítem tiene pedido ${need} y despacho ${sum}. ¿Querés ajustar el pedido a ${sum} para continuar?`,
        showCancelButton:true,
        confirmButtonText:'Ajustar pedido',
        cancelButtonText:'Volver'
      });
      if(!res.isConfirmed) return;
      needByItem.set(sid, sum);
    }
  }

  // 2) Detectar pendientes (despacho menor)
  const pendingByItem = new Map();
  let hasPending = false;
  for(const [sid, need] of needByItem.entries()){
    const sum = parseInt(sumByItem.get(sid)||0,10)||0;
    const pend = Math.max(need - sum, 0);
    if(pend>0){
      hasPending = true;
      pendingByItem.set(sid, pend);
    }
  }

  // 3) Si hay pendientes, elegir acción
  if(hasPending){
    const choice = await Swal.fire({
      icon:'question',
      title:'Despacho parcial detectado',
      html:'Hay cantidades pendientes. ¿Qué querés hacer?',
      showCancelButton:true,
      showDenyButton:true,
      confirmButtonText:'Cerrar pedido con lo despachado',
      denyButtonText:'Generar nueva venta con pendientes',
      cancelButtonText:'Volver'
    });
    if(choice.isDismissed) return;

    if(choice.isDenied){
      // Crear nueva venta con pendientes (se completa más abajo cuando ajustamos items)
      window.__createPendingSale = true;

      // preparar ítems pendientes ANTES de ajustar el pedido original
      pendingItemsToCreate = [];
      for(const it of (dispatchItems||[])){
        const need = parseInt(needByItem.get(it.id)||0,10)||0;
        const sum = parseInt(sumByItem.get(it.id)||0,10)||0;
        const pend = Math.max(need - sum, 0);
        if(pend<=0) continue;
        const unit = Number(it.unit_price||0);
        const disc = Number(it.discount||0);
        const subtotal = pend * unit * (1 - Math.max(0,Math.min(100,disc))/100);
        pendingItemsToCreate.push({
          product_id: it.product_id,
          quantity: pend,
          unit_price: unit,
          discount: disc,
          subtotal,
          price_list_id: currentPriceListId || null,
          price_source: 'LIST'
        });
      }
    }else{
      window.__createPendingSale = false;
    }
  }else{
    window.__createPendingSale = false;
  }

  // 4) Aplicar ajustes de pedido: la venta original se ajusta a lo realmente despachado
  //    - items con sum=0 se eliminan (por CHECK quantity>0)
  for(const it of dispatchItems){
    const sum = parseInt(sumByItem.get(it.id)||0,10)||0;
    const origNeed = parseInt(it.quantity||0,10)||0;

    if(sum <= 0){
      const { error: delErr } = await sb.from('sale_items').delete().eq('id', it.id);
      if(delErr){ console.error(delErr); toastErr('No se pudo ajustar el pedido'); return; }
      it._deleted = true;
      continue;
    }

    if(sum !== origNeed){
      const unit = Number(it.unit_price||0);
      const disc = Number(it.discount||0);
      const subtotal = sum * unit * (1 - Math.max(0,Math.min(100,disc))/100);
      const { error: upErr } = await sb.from('sale_items').update({ quantity: sum, subtotal }).eq('id', it.id);
      if(upErr){ console.error(upErr); toastErr('No se pudo ajustar el pedido'); return; }
      it.quantity = sum;
      it.subtotal = subtotal;
    }
  }

  // actualizar total de la venta original
  try{
    const kept = (dispatchItems||[]).filter(x=>!x._deleted);
    const newTotal = kept.reduce((a,it)=> a + Number(it.subtotal || 0), 0);
    await sb.from('sales').update({ total_amount: newTotal }).eq('id', dispatchSale.id);
  }catch(_){}
// validar disponibilidad// validar disponibilidad y ejecutar descuentos
  for(const a of allocs){
    const { data: bal, error: bErr } = await sb
      .from('stock_balances')
      .select('id, quantity, reserved, available, warehouse_id, lot')
      .eq('id', a.stock_balance_id)
      .single();
    if(bErr){ console.error(bErr); toastErr('Error stock'); return; }
    const qty = Number(bal.quantity||0);
    const res = Number(bal.reserved||0);
    const av = (bal.available!=null) ? Number(bal.available) : (qty-res);
    if(av < a.qty - 1e-9){
      toastErr(`Stock insuficiente en lote ${bal.lot||''}`);
      return;
    }
  }

  // aplicar: update stock_balances, insert stock_movements, insert sale_item_lots
  for(const a of allocs){
    const { data: bal } = await sb
      .from('stock_balances')
      .select('id, quantity, reserved, available, warehouse_id, lot')
      .eq('id', a.stock_balance_id)
      .single();

    const newQty = Number(bal.quantity||0) - a.qty;

    const { error: uErr } = await sb
      .from('stock_balances')
      .update({ quantity: newQty })
      .eq('id', a.stock_balance_id);
    if(uErr){ console.error(uErr); toastErr('No se pudo descontar stock'); return; }

    const { error: mErr } = await sb
      .from('stock_movements')
      .insert({
        stock_balance_id: a.stock_balance_id,
        product_id: a.product_id,
        warehouse_id: bal.warehouse_id,
        lot: bal.lot,
        movement_type: 'OUT_SALE',
        quantity: a.qty,
        reference: dispatchSale.id
      });
    if(mErr){ console.error(mErr); toastErr('No se pudo registrar movimiento'); return; }

    const { error: lErr } = await sb
      .from('sale_item_lots')
      .insert({
        sale_id: dispatchSale.id,
        sale_item_id: a.sale_item_id,
        product_id: a.product_id,
        stock_balance_id: a.stock_balance_id,
        warehouse_id: bal.warehouse_id,
        lot: bal.lot,
        quantity: a.qty
      });
    if(lErr){ console.error(lErr); toastErr('No se pudo registrar lotes'); return; }
  }

  
  // Si el usuario eligió generar nueva venta con pendientes, la creamos ahora
  
  // Si el usuario eligió generar nueva venta con pendientes, la creamos ahora
  if(window.__createPendingSale){
    try{
      const items = pendingItemsToCreate || [];
      if(items.length){
        const newNum = await nextSaleNumber();
        const noteExtra = `Pendiente de venta ${dispatchSale.sale_number || dispatchSale.id}`;
        const { data: newSale, error: nsErr } = await sb
          .from('sales')
          .insert({
            customer_id: dispatchSale.customer_id,
            sale_date: todayISO(),
            sale_number: newNum,
            reference: null,
            reference: `Parcial despacho de ${dispatchSale.sale_number || dispatchSale.id}`,
            notes: null,
            status: 'CONFIRMED',
            total_amount: items.reduce((a,it)=>a+Number(it.subtotal||0),0)
          })
          .select()
          .single();
        if(nsErr) throw nsErr;

        const payload = items.map(it=>({ ...it, sale_id: newSale.id }));
        const { error: piErr } = await sb.from('sale_items').insert(payload);
        if(piErr) throw piErr;
      }
    }catch(e){
      console.error(e);
      toastErr('No se pudo crear la venta pendiente');
      return;
    }finally{
      window.__createPendingSale = false;
      pendingItemsToCreate = null;
    }
  }

// update sale status
  const { error: sErr } = await sb
    .from('sales')
    .update({ status:'DISPATCHED', delivered_at: new Date().toISOString() })
    .eq('id', dispatchSale.id);
  if(sErr){ console.error(sErr); toastErr('No se pudo actualizar estado'); return; }

  toastOk('Despacho confirmado');
  dispatchModal.hide();
  await loadSales();
}


async function undoDispatchCurrentSale(){
  const saleId = document.getElementById('saleId')?.value || '';
  if(!saleId) return;

  const ok = await Swal.fire({
    icon:'warning',
    title:'Cancelar despacho',
    text:'Esto devolverá el stock y la venta volverá a CONFIRMED. ¿Continuar?',
    showCancelButton:true,
    confirmButtonText:'Sí, cancelar despacho',
    cancelButtonText:'No'
  });
  if(!ok.isConfirmed) return;

  const sb = window.sb;

  // traer lotes despachados
  const { data: lots, error: lErr } = await sb
    .from('sale_item_lots')
    .select('id, sale_item_id, product_id, stock_balance_id, warehouse_id, lot, quantity')
    .eq('sale_id', saleId);

  if(lErr){
    console.error(lErr);
    toastErr('No se pudieron leer lotes despachados');
    return;
  }

  // devolver stock
  for(const r of (lots||[])){
    // sumar quantity al stock_balance
    const { data: bal, error: bErr } = await sb
      .from('stock_balances')
      .select('id, quantity, warehouse_id, lot')
      .eq('id', r.stock_balance_id)
      .single();

    if(bErr){
      console.error(bErr);
      toastErr('Error al devolver stock');
      return;
    }

    const newQty = Number(bal.quantity||0) + Number(r.quantity||0);

    const { error: uErr } = await sb
      .from('stock_balances')
      .update({ quantity: newQty })
      .eq('id', r.stock_balance_id);

    if(uErr){
      console.error(uErr);
      toastErr('No se pudo devolver stock');
      return;
    }

    // registrar movimiento de ajuste (vuelta)
    const { error: mErr } = await sb
      .from('stock_movements')
      .insert({
        stock_balance_id: r.stock_balance_id,
        product_id: r.product_id,
        warehouse_id: r.warehouse_id,
        lot: r.lot,
        movement_type: 'ADJUST',
        quantity: Number(r.quantity||0),
        reference: `UNDO_DISPATCH:${saleId}`
      });

    if(mErr){
      console.error(mErr);
      toastErr('No se pudo registrar movimiento');
      return;
    }
  }

  // borrar asignaciones de lotes (si querés conservar historial lo cambiamos a soft delete, pero hoy no hay)
  if((lots||[]).length){
    const ids = lots.map(x=>x.id);
    const { error: dErr } = await sb.from('sale_item_lots').delete().in('id', ids);
    if(dErr){
      console.error(dErr);
      toastErr('No se pudieron borrar lotes');
      return;
    }
  }

  // volver estado
  const { error: sErr } = await sb
    .from('sales')
    .update({ status:'CONFIRMED', delivered_at: null })
    .eq('id', saleId);

  if(sErr){
    console.error(sErr);
    toastErr('No se pudo actualizar venta');
    return;
  }

  try{ await reserveLotsForSale(saleId); }catch(e){ console.warn('No se pudo recrear la reserva tras anular despacho', e); }

  toastOk('Despacho cancelado');
  saleModal.hide();
  await loadSales();
}

async function cancelSale(id){
  const ok = await Swal.fire({
    icon:'warning',
    title:'Cancelar venta',
    text:'¿Querés cancelar esta venta?',
    showCancelButton:true,
    confirmButtonText:'Sí, cancelar',
    cancelButtonText:'No'
  });
  if(!ok.isConfirmed) return;

  const sb = window.sb;
  try{ await releaseReservedLotsForSale(id); }catch(e){ console.warn('No se pudieron liberar reservas al cancelar', e); }
  const { error } = await sb.from('sales').update({ status:'CANCELLED' }).eq('id', id);
  if(error){
    console.error('cancel sale error', error);
    toastErr('No se pudo cancelar');
    return;
  }
  toastOk('Venta cancelada');
  await loadSales();
}


async function nextSaleNumber(){
  const sb = window.sb;
  // Tomamos el último sale_number con formato V-000001
  const { data, error } = await sb
    .from('sales')
    .select('sale_number')
    .order('created_at', { ascending:false })
    .limit(50);

  if(error){
    console.warn('nextSaleNumber error', error);
    // fallback timestamp
    const t = new Date();
    return `V-${String(t.getFullYear()).slice(-2)}${String(t.getMonth()+1).padStart(2,'0')}${String(t.getDate()).padStart(2,'0')}${String(t.getHours()).padStart(2,'0')}${String(t.getMinutes()).padStart(2,'0')}`;
  }

  let maxN = 0;
  (data||[]).forEach(r=>{
    const m = String(r.sale_number||'').match(/^V-(\d{6})$/);
    if(m){
      const n = parseInt(m[1],10);
      if(!isNaN(n)) maxN = Math.max(maxN, n);
    }
  });
  const next = maxN + 1;
  return `V-${String(next).padStart(6,'0')}`;
}

async function saveSale(status){
  const form = $('#saleForm');
  if(!form) return;

  if(!form.checkValidity()){
    form.classList.add('was-validated');
    return;
  }

  const sb = window.sb;
  const saleId = $('#saleId').value || null;
  const previousStatus = ($('#saleStatus')?.value || '').toUpperCase();
  const customer_id = $('#saleCustomer').value;
  const sale_date = $('#saleDate').value || todayISO();
  const reference = ($('#saleNumber').value||'').trim() || null;
  let sale_number = null;
  if(!saleId){ sale_number = await nextSaleNumber(); }
  const notes = ($('#saleNotes').value||'').trim() || null;

  const items = [];
  for(const tr of $$('#saleItemsBody tr')){
    const product_id = tr.querySelector('.si-product')?.value || '';
    if(!product_id) continue;
    const quantity = parseInt(tr.querySelector('.si-qty')?.value || '0', 10) || 0;
    const unit_price = parseFloat(tr.querySelector('.si-price')?.value || '0') || 0;
    const discount = parseFloat(tr.querySelector('.si-disc')?.value || '0') || 0;
    if(quantity <= 0){ toastErr('La cantidad debe ser mayor a 0'); return; }
    if(unit_price <= 0){ toastErr('Todos los ítems deben tener precio unitario mayor a 0'); return; }
    const subtotal = quantity * unit_price * (1 - Math.max(0,Math.min(100,discount))/100);
    items.push({
      product_id, quantity, unit_price, discount, subtotal,
      price_list_id: currentPriceListId || null,
      price_source: (tr.dataset.price_source==='LIST') ? 'LIST' : 'MANUAL'
    });
  }

  if(!items.length){
    toastErr('Agregá al menos un ítem');
    return;
  }

  const total_amount = items.reduce((a,it)=>a+(it.subtotal||0),0);

  let saved;
  if(!saleId){
    const { data, error } = await sb.from('sales')
      .insert({ customer_id, sale_date, sale_number, reference, notes, status, total_amount })
      .select()
      .single();
    if(error){ console.error(error); toastErr('No se pudo guardar la venta'); return; }
    saved = data;
  }else{
    const { data, error } = await sb.from('sales')
      .update({ customer_id, sale_date, reference, notes, status, total_amount, updated_at: new Date().toISOString() })
      .eq('id', saleId)
      .select()
      .single();
    if(error){ console.error(error); toastErr('No se pudo actualizar la venta'); return; }
    saved = data;
  }

  try{
    if(saleId && (previousStatus==='CONFIRMED' || previousStatus==='DISPATCHED')){
      await releaseReservedLotsForSale(saved.id);
    }

    await sb.from('sale_items').delete().eq('sale_id', saved.id);
    if(items.length){
      const payload = items.map(it=> ({ ...it, sale_id: saved.id }));
      const { error } = await sb.from('sale_items').insert(payload);
      if(error){ console.error(error); toastErr('No se pudieron guardar items'); return; }
    }

    if(status === 'CONFIRMED'){
      await reserveLotsForSale(saved.id);
    }
  }catch(err){
    console.error(err);
    toastErr(err?.message || 'No se pudo reservar stock para la venta');
    return;
  }

  toastOk(status==='DRAFT' ? 'Borrador guardado' : 'Pedido generado');
  saleModal.hide();
  await loadSales();
}
