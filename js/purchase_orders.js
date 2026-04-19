// js/purchase_orders.js

// ---------- Utilidades básicas ----------
const $  = (q) => document.querySelector(q);
const $$ = (q) => Array.from(document.querySelectorAll(q));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[m]));

function num(v){
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function debounce(fn, ms){
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function fmtDate(d){
  if(!d) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  if(Number.isNaN(dt.getTime())) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,'0');
  const day = String(dt.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function fmtDateDisplay(d){
  if(!d) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  if(Number.isNaN(dt.getTime())) return '';
  const dd = String(dt.getDate()).padStart(2,'0');
  const mm = String(dt.getMonth()+1).padStart(2,'0');
  const yy = dt.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

// Toasts SweetAlert2
function showSuccessToast(title, text){
  return Swal.fire({
    icon: 'success',
    title: title || 'OK',
    text: text || '',
    toast: true,
    position: 'top',
    showConfirmButton: false,
    timer: 2000,
    timerProgressBar: true
  });
}
function showErrorToast(title, text){
  return Swal.fire({
    icon: 'error',
    title: title || 'Error',
    text: text || '',
    toast: true,
    position: 'top',
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true
  });
}

// ---------- Estado global ----------
const poState = {
  page: 1,
  pageSize: 25,
  total: 0,
  search: '',
  filters: {
    status: '',
    vendor_id: '',
    date_from: '',
    date_to: ''
  },
  orders: [],
  pending: [],
  vendors: [],
  products: [],
  warehouses: []
};

// Logo (normalizamos y probamos rutas)
const PO_LOGO_RAW = "\\distributor_castelo\\img\\logo_distribuidora.png";

// ---------- Arranque ----------
document.addEventListener('DOMContentLoaded', () => {
  initPurchaseOrdersPage();
});

async function initPurchaseOrdersPage(){
  while (!window.sb && !window.supabaseClient) {
    await sleep(50);
  }
  window.sb = window.sb || window.supabaseClient;

  bindToolbarEvents();
  bindOrderModalEvents();
  bindReceiveModalEvents();

  await loadVendorsForFiltersAndModal();
  await loadProductsCache();
  await loadWarehouses();

  await reloadPurchaseOrdersData();
}

// ---------- Carga de combos ----------
async function loadVendorsForFiltersAndModal(){
  try {
    const { data, error } = await sb
      .from('clients')
      .select('id, nombre')
      .eq('is_supplier', true)
      .order('nombre', { ascending: true });

    if (error) {
      console.error('[loadVendorsForFiltersAndModal] error', error);
      showErrorToast('Error', 'No se pudo cargar la lista de proveedores');
      return;
    }

    poState.vendors = data || [];
    const filterSel = $('#filterVendor');
    const modalSel  = $('#poVendor');

    if (filterSel) {
      filterSel.innerHTML =
        `<option value="">Proveedor: Todos</option>` +
        poState.vendors.map(v => `<option value="${v.id}">${esc(v.nombre || '')}</option>`).join('');
    }

    if (modalSel) {
      modalSel.innerHTML =
        `<option value="">Seleccioná un proveedor</option>` +
        poState.vendors.map(v => `<option value="${v.id}">${esc(v.nombre || '')}</option>`).join('');
    }
  } catch (e) {
    console.error('[loadVendorsForFiltersAndModal] ex', e);
    showErrorToast('Error', 'No se pudo cargar proveedores');
  }
}

async function loadProductsCache(){
  try {
    const { data, error } = await sb
      .from('product')
      .select('id, code, description, unit_id')
      .eq('is_active', true)
      .order('description', { ascending: true });

    if (error) {
      console.error('[loadProductsCache] error', error);
      showErrorToast('Error', 'No se pudo cargar productos');
      return;
    }

    poState.products = data || [];
  } catch (e) {
    console.error('[loadProductsCache] ex', e);
    showErrorToast('Error', 'No se pudo cargar productos');
  }
}

async function loadWarehouses(){
  try {
    const { data, error } = await sb
      .from('warehouses')
      .select('id, code, name')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('[loadWarehouses] error', error);
      showErrorToast('Error', 'No se pudieron cargar depósitos');
      return;
    }

    poState.warehouses = data || [];
    const sel = $('#receiveWarehouse');
    if (sel) {
      sel.innerHTML =
        `<option value="">Seleccioná depósito</option>` +
        poState.warehouses.map(w =>
          `<option value="${w.id}">${esc(w.code || '')} - ${esc(w.name || '')}</option>`
        ).join('');
    }
  } catch (e) {
    console.error('[loadWarehouses] ex', e);
    showErrorToast('Error', 'No se pudieron cargar depósitos');
  }
}

// ---------- Eventos toolbar, filtros y paginación ----------
function bindToolbarEvents(){
  $('#btnRefreshOrders')?.addEventListener('click', () => {
    poState.page = 1;
    reloadPurchaseOrdersData();
  });

  $('#btnAddOrder')?.addEventListener('click', () => openOrderModal());

  $('#poSearchInput')?.addEventListener('input', debounce((ev) => {
    poState.search = ev.target.value.trim();
    poState.page = 1;
    reloadPurchaseOrdersData();
  }, 300));

  $('#filterStatus')?.addEventListener('change', (ev) => {
    poState.filters.status = ev.target.value || '';
    poState.page = 1;
    reloadPurchaseOrdersData();
  });

  $('#filterVendor')?.addEventListener('change', (ev) => {
    poState.filters.vendor_id = ev.target.value || '';
    poState.page = 1;
    reloadPurchaseOrdersData();
  });

  $('#filterDateFrom')?.addEventListener('change', (ev) => {
    poState.filters.date_from = ev.target.value || '';
    poState.page = 1;
    reloadPurchaseOrdersData();
  });

  $('#filterDateTo')?.addEventListener('change', (ev) => {
    poState.filters.date_to = ev.target.value || '';
    poState.page = 1;
    reloadPurchaseOrdersData();
  });

  $('#poPageSize')?.addEventListener('change', (ev) => {
    poState.pageSize = Number(ev.target.value) || 25;
    poState.page = 1;
    reloadPurchaseOrdersData();
  });

  $('#poPrevPage')?.addEventListener('click', () => {
    if (poState.page > 1) {
      poState.page--;
      reloadPurchaseOrdersData();
    }
  });

  $('#poNextPage')?.addEventListener('click', () => {
    if (poState.page * poState.pageSize < poState.total) {
      poState.page++;
      reloadPurchaseOrdersData();
    }
  });

  $('#btnExportPoCsv')?.addEventListener('click', exportOrdersCsv);
  $('#btnExportPoXlsx')?.addEventListener('click', exportOrdersXlsx);
}

// ---------- Carga de datos (órdenes y pendientes) ----------
async function reloadPurchaseOrdersData(){
  await Promise.all([
    listPurchaseOrders(),
    listPendingLines()
  ]);
}

// Órdenes (vista vw_purchase_orders_with_totals)
async function listPurchaseOrders(){
  const from = (poState.page - 1) * poState.pageSize;
  const to   = from + poState.pageSize - 1;

  let q = sb
    .from('vw_purchase_orders_with_totals')
    .select('*', { count: 'exact' })
    .order('order_date', { ascending: false });

  const f = poState.filters;

  // Default al entrar: PLANIFICADA + PARCIAL (si no elegís estado)
  if (f.status) q = q.eq('status', f.status);
  else q = q.in('status', ['PLANIFICADA', 'PARCIAL']);

  if (f.vendor_id) q = q.eq('vendor_id', f.vendor_id);
  if (f.date_from) q = q.gte('order_date', f.date_from);
  if (f.date_to)   q = q.lte('order_date', f.date_to);

  if (poState.search) {
    const s = poState.search;
    q = q.or([
      `vendor_name.ilike.%${s}%`,
      `reference.ilike.%${s}%`,
      `external_number.ilike.%${s}%`,
      `products_summary.ilike.%${s}%`
    ].join(','));
  }

  q = q.range(from, to);

  const { data, error, count } = await q;
  if (error) {
    console.error('[listPurchaseOrders] error', error);
    showErrorToast('Error', 'No se pudieron listar las órdenes');
    return;
  }

  poState.orders = data || [];
  poState.total = count || 0;

  renderPurchaseOrdersTable();
  updateOrdersPaginationInfo();
}

function renderPurchaseOrdersTable(){
  const tbody = $('#purchaseOrdersTable tbody');
  if (!tbody) return;

  if (!poState.orders.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-3">Sin órdenes para los filtros seleccionados.</td></tr>`;
    return;
  }

  tbody.innerHTML = poState.orders.map((r) => {
    const fecha = fmtDateDisplay(r.order_date);
    const estado = String(r.status || '');
    const vendor = esc(r.vendor_name || '');
    const ref    = esc(r.reference || '');
    const ext    = esc(r.external_number || '');
    const items  = num(r.items_count || 0);
    const qOrd   = num(r.total_qty_ordered || 0);
    const qRec   = num(r.total_qty_received || 0);

    let stateBadgeClass = 'secondary';
    if (estado === 'PLANIFICADA') stateBadgeClass = 'warning';
    if (estado === 'PARCIAL')     stateBadgeClass = 'info';
    if (estado === 'COMPLETA')    stateBadgeClass = 'success';
    if (estado === 'CANCELADA')   stateBadgeClass = 'secondary';

    const canEdit = (estado === 'PLANIFICADA' || estado === 'PARCIAL');

    return `
      <tr data-id="${r.id}">
        <td>${fecha || '—'}</td>
        <td>
          <div class="fw-semibold">${ref || '—'}</div>
          <div class="text-secondary small">${ext || ''}</div>
        </td>
        <td>${vendor || '—'}</td>
        <td class="text-center">${items}</td>
        <td class="text-center">${qOrd}</td>
        <td class="text-center">${qRec}</td>
        <td>
          <span class="badge bg-${stateBadgeClass}">${esc(estado)}</span>
        </td>
        <td class="text-end">
          <div class="btn-group">
            <button class="btn btn-sm btn-outline-primary btn-edit-order" title="Editar orden" ${canEdit ? '' : 'disabled'}>
              <i class="bi bi-pencil"></i>
            </button>
            <button class="btn btn-sm btn-outline-secondary btn-view-order" title="Ver detalle">
              <i class="bi bi-eye"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger btn-pdf-order" title="Descargar PDF">
              <i class="bi bi-file-earmark-pdf"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  $$('#purchaseOrdersTable .btn-edit-order').forEach(btn => btn.addEventListener('click', onEditOrderClick));
  $$('#purchaseOrdersTable .btn-view-order').forEach(btn => btn.addEventListener('click', onViewOrderClick));
  $$('#purchaseOrdersTable .btn-pdf-order').forEach(btn => btn.addEventListener('click', onPdfOrderClick));
}

function updateOrdersPaginationInfo(){
  const info = $('#poRowsInfo');
  const pageInd = $('#poPageIndicator');
  if (!info || !pageInd) return;

  if (!poState.total) {
    info.textContent = 'Sin registros para los filtros';
    pageInd.textContent = '1';
    return;
  }

  const from = (poState.page - 1) * poState.pageSize + 1;
  const to   = Math.min(from + poState.pageSize - 1, poState.total);
  info.textContent = `${from}–${to} de ${poState.total}`;
  pageInd.textContent = String(poState.page);
}

// ---------- Pendientes de recepción (estado por ítem) ----------
async function listPendingLines(){
  try {
    const { data, error } = await sb
      .from('purchase_order_items')
      .select(`
        id,
        purchase_order_id,
        product_id,
        quantity_ordered,
        quantity_received,
        planned_date,
        purchase_orders!inner (
          id,
          order_date,
          status,
          vendor_id,
          reference,
          external_number,
          clients ( nombre )
        ),
        product ( code, description )
      `)
      .is('deleted_at', null);

    if (error) {
      console.error('[listPendingLines] error', error);
      showErrorToast('Error', 'No se pudieron listar los pendientes');
      return;
    }

    const rows = data || [];

    let pending = rows.map(r => {
      const po = r.purchase_orders || {};
      const cli = po.clients || {};
      const prod = r.product || {};

      const qOrd = num(r.quantity_ordered);
      const qRec = num(r.quantity_received);
      const qPend = qOrd - qRec;

      if (qPend <= 0) return null;

      let itemStatus = 'PLANIFICADA';
      if (qRec <= 0) itemStatus = 'PLANIFICADA';
      else if (qRec >= qOrd) itemStatus = 'COMPLETA';
      else itemStatus = 'PARCIAL';

      return {
        purchase_order_id: r.purchase_order_id,
        order_date: po.order_date,
        status: po.status,
        item_status: itemStatus,
        vendor_id: po.vendor_id,
        vendor_name: cli.nombre,
        purchase_order_item_id: r.id,
        product_id: r.product_id,
        product_code: prod.code,
        product_description: prod.description,
        quantity_ordered: qOrd,
        quantity_received: qRec,
        quantity_pending: qPend,
        order_reference: po.reference,
        order_external_number: po.external_number,
        planned_date: r.planned_date
      };
    }).filter(Boolean);

    const f = poState.filters;
    const search = (poState.search || '').toLowerCase();

    if (f.status) pending = pending.filter(p => (p.status || '') === f.status);
    if (f.vendor_id) pending = pending.filter(p => String(p.vendor_id) === String(f.vendor_id));
    if (f.date_from) pending = pending.filter(p => p.order_date && p.order_date >= f.date_from);
    if (f.date_to)   pending = pending.filter(p => p.order_date && p.order_date <= f.date_to);

    if (search) {
      pending = pending.filter(p => {
        const v = (p.vendor_name || '').toLowerCase();
        const c = (p.product_code || '').toLowerCase();
        const d = (p.product_description || '').toLowerCase();
        const o = (p.order_reference || '').toLowerCase();
        const e = (p.order_external_number || '').toLowerCase();
        return v.includes(search) || c.includes(search) || d.includes(search) || o.includes(search) || e.includes(search);
      });
    }

    pending.sort((a, b) => {
      const da = a.order_date || '';
      const db = b.order_date || '';
      if (da < db) return 1;
      if (da > db) return -1;
      return 0;
    });

    poState.pending = pending;
    renderPendingLinesTable();
  } catch (e) {
    console.error('[listPendingLines] ex', e);
    showErrorToast('Error', 'No se pudieron listar los pendientes');
  }
}

function renderPendingLinesTable(){
  const tbody = $('#pendingLinesTable tbody');
  if (!tbody) return;

  if (!poState.pending.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-3">Sin líneas pendientes de recepción.</td></tr>`;
    return;
  }

  tbody.innerHTML = poState.pending.map((r) => {
    const fecha = fmtDateDisplay(r.order_date);
    const prod = `${r.product_code || ''} - ${r.product_description || ''}`;
    const qOrd = num(r.quantity_ordered);
    const qRec = num(r.quantity_received);
    const qPend = num(r.quantity_pending);
    const plannedDisp = fmtDateDisplay(r.planned_date);

    const orderNumberRaw =
      r.order_reference ||
      r.order_external_number ||
      (r.purchase_order_id ? String(r.purchase_order_id).slice(0, 8) + '…' : '');

    const orderNumber = esc(orderNumberRaw || '');

    const estado = String(r.item_status || 'PLANIFICADA');

    let stateBadgeClass = 'secondary';
    if (estado === 'PLANIFICADA') stateBadgeClass = 'warning';
    if (estado === 'PARCIAL')     stateBadgeClass = 'info';
    if (estado === 'COMPLETA')    stateBadgeClass = 'success';

    return `
      <tr data-order-id="${r.purchase_order_id}" data-item-id="${r.purchase_order_item_id}">
        <td>${fecha || '—'}</td>
        <td>${orderNumber || '—'}</td>
        <td>${esc(prod || '')}</td>
        <td>${plannedDisp || '—'}</td>
        <td class="text-center">${qOrd}</td>
        <td class="text-center">${qRec}</td>
        <td class="text-center">${qPend}</td>
        <td><span class="badge bg-${stateBadgeClass}">${esc(estado)}</span></td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-primary btn-receive-line">
            <i class="bi bi-box-arrow-in-down"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  $$('#pendingLinesTable .btn-receive-line').forEach(btn => btn.addEventListener('click', onReceiveLineClick));
}

// ---------- Modal orden (crear / editar) ----------
function bindOrderModalEvents(){
  $('#btnAddItemRow')?.addEventListener('click', () => addOrderItemRow());
  $('#btnSaveOrder')?.addEventListener('click', saveOrder);
}

function openOrderModal(order){
  const form = $('#orderForm');
  if (!form) return;

  form.reset();
  form.classList.remove('was-validated');

  $('#orderItemsBody').innerHTML = '';

  if (order) {
    $('#orderModalTitle').textContent = 'Editar orden de compra';
    $('#orderId').value = order.id;
    $('#poVendor').value = order.vendor_id || '';
    $('#poOrderDate').value = order.order_date ? fmtDate(order.order_date) : fmtDate(new Date());
    $('#poReference').value = order.reference || '';
    $('#poExternalNumber').value = order.external_number || '';
    $('#poNotes').value = order.notes || '';
    $('#poStatus').value = order.status || 'PLANIFICADA';

    loadOrderItems(order.id);
  } else {
    $('#orderModalTitle').textContent = 'Nueva orden de compra';
    $('#orderId').value = '';
    $('#poVendor').value = '';
    $('#poOrderDate').value = fmtDate(new Date());
    $('#poReference').value = '';
    $('#poExternalNumber').value = '';
    $('#poNotes').value = '';
    $('#poStatus').value = 'PLANIFICADA';

    addOrderItemRow();
  }

  const modalEl = document.getElementById('orderModal');
  const modal = new bootstrap.Modal(modalEl, { focus: false });
  modal.show();
}

async function loadOrderItems(orderId){
  try {
    const { data, error } = await sb
      .from('purchase_order_items')
      .select('id, product_id, quantity_ordered, quantity_received, unit_id, planned_date')
      .eq('purchase_order_id', orderId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[loadOrderItems] error', error);
      showErrorToast('Error', 'No se pudieron cargar las líneas de la orden');
      addOrderItemRow();
      return;
    }

    const rows = data || [];
    if (!rows.length) {
      addOrderItemRow();
      return;
    }

    rows.forEach(item => addOrderItemRow(item));
  } catch (e) {
    console.error('[loadOrderItems] ex', e);
    showErrorToast('Error', 'No se pudieron cargar las líneas de la orden');
    addOrderItemRow();
  }
}

// 🔒 Reglas:
// - Recibido completo: bloqueado (no editar ni borrar)
// - Recibido parcial: se puede editar qty, pero min = recibido (no bajar)
function addOrderItemRow(item){
  const tbody = $('#orderItemsBody');
  if (!tbody) return;

  const received = num(item?.quantity_received);
  const ordered  = num(item?.quantity_ordered);
  const isComplete = !!item && ordered > 0 && received >= ordered;
  const isPartial  = !!item && received > 0 && received < ordered;

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <input type="hidden" class="po-item-id" value="${esc(item?.id || '')}">
      <input type="hidden" class="po-item-received" value="${received}">
      <select class="form-select po-item-product">
        <option value="">Seleccioná producto</option>
        ${
          (poState.products || []).map(p =>
            `<option value="${p.id}">${esc(p.code || '')} - ${esc(p.description || '')}</option>`
          ).join('')
        }
      </select>
      ${isComplete ? `<div class="small text-muted mt-1"><i class="bi bi-lock-fill"></i> Ítem recibido completo (bloqueado)</div>` : ''}
      ${isPartial  ? `<div class="small text-muted mt-1">Recibido: <strong>${received}</strong> (mín. pedida)</div>` : ''}
    </td>
    <td class="text-center">
      <input type="number"
             class="form-control text-end po-item-qty"
             min="${Math.max(0.001, received)}"
             step="0.001"
             placeholder="0.000"
             ${isComplete ? 'disabled' : ''}>
    </td>
    <td>
      <input type="text" class="form-control po-item-unit" placeholder="Unidad" disabled>
    </td>
    <td>
      <input type="date" class="form-control po-item-planned-date" ${isComplete ? 'disabled' : ''}>
    </td>
    <td class="text-end">
      <button type="button"
              class="btn btn-sm btn-outline-danger po-item-remove"
              ${isComplete || received > 0 ? 'disabled' : ''}
              title="${(isComplete || received > 0) ? 'No se puede borrar: ya tiene recepción' : 'Eliminar'}">
        <i class="bi bi-trash"></i>
      </button>
    </td>
  `;

  tbody.appendChild(tr);

  const sel = tr.querySelector('.po-item-product');
  const qty = tr.querySelector('.po-item-qty');
  const planned = tr.querySelector('.po-item-planned-date');

  if (item) {
    if (sel) sel.value = item.product_id || '';
    if (qty) qty.value = item.quantity_ordered || '';
    if (planned && item.planned_date) planned.value = fmtDate(item.planned_date);
  }

  // Si tiene recibido (parcial o completo) no permitir cambiar producto
  if (sel && received > 0) sel.disabled = true;

  // clamp mínimo por recibido
  qty?.addEventListener('change', () => {
    const min = Math.max(0.001, received);
    const val = num(qty.value);
    if (val < min) qty.value = String(min);
  });

  tr.querySelector('.po-item-remove')?.addEventListener('click', () => {
    if (received > 0) return;
    tr.remove();
    if (!$('#orderItemsBody').children.length) addOrderItemRow();
  });
}

async function saveOrder(){
  const form = $('#orderForm');
  if (!form) return;

  if (!form.checkValidity()) {
    form.classList.add('was-validated');
    return;
  }

  const vendorId = $('#poVendor').value;
  const orderDate = $('#poOrderDate').value;
  const reference = $('#poReference').value.trim() || null;
  const extNumber = $('#poExternalNumber').value.trim() || null;
  const notes     = $('#poNotes').value.trim() || null;
  const orderId   = $('#orderId').value || null;

  const rows = Array.from($('#orderItemsBody')?.querySelectorAll('tr') || []);
  const draft = [];

  for (const tr of rows) {
    const itemId   = tr.querySelector('.po-item-id')?.value || '';
    const received = num(tr.querySelector('.po-item-received')?.value || 0);

    const productId = tr.querySelector('.po-item-product')?.value || '';
    const qty       = num(tr.querySelector('.po-item-qty')?.value || 0);
    const planned   = tr.querySelector('.po-item-planned-date')?.value || '';

    if (!productId && !qty && !planned) continue;

    if (!productId || qty <= 0) {
      return Swal.fire('Atención', 'Completá producto y cantidad (> 0) en todas las filas con datos.', 'info');
    }

    if (received > 0 && qty < received) {
      return Swal.fire('Atención', `No podés bajar la cantidad pedida por debajo de lo recibido (${received}).`, 'info');
    }

    draft.push({
      id: itemId || null,
      product_id: productId,
      quantity_ordered: qty,
      planned_date: planned || null,
      quantity_received: received
    });
  }

  if (!draft.length) {
    return Swal.fire('Atención', 'La orden debe tener al menos un producto.', 'info');
  }

  const nowIso = new Date().toISOString();

  try {
    let finalOrderId = orderId;

    // 1) Cabecera
    if (orderId) {
      const { error } = await sb
        .from('purchase_orders')
        .update({
          vendor_id: vendorId,
          order_date: orderDate,
          reference: reference,
          external_number: extNumber,
          notes: notes,
          updated_at: nowIso
        })
        .eq('id', orderId)
        .is('deleted_at', null);

      if (error) {
        console.error('[saveOrder] update error', error);
        showErrorToast('Error', 'No se pudo guardar la orden');
        return;
      }
    } else {
      const { data, error } = await sb
        .from('purchase_orders')
        .insert({
          vendor_id: vendorId,
          order_date: orderDate,
          status: 'PLANIFICADA',
          reference: reference,
          external_number: extNumber,
          notes: notes
        })
        .select()
        .single();

      if (error) {
        console.error('[saveOrder] insert error', error);
        showErrorToast('Error', 'No se pudo crear la orden');
        return;
      }
      finalOrderId = data.id;
    }

    // 2) Líneas
    if (!orderId) {
      const payload = draft.map(it => ({
        purchase_order_id: finalOrderId,
        product_id: it.product_id,
        quantity_ordered: it.quantity_ordered,
        quantity_received: 0,
        planned_date: it.planned_date,
        created_at: nowIso,
        updated_at: nowIso
      }));

      const { error: errItems } = await sb.from('purchase_order_items').insert(payload);
      if (errItems) {
        console.error('[saveOrder] insert items error', errItems);
        showErrorToast('Error', 'La cabecera se guardó, pero hubo error en las líneas');
        return;
      }
    } else {
      const { data: existing, error: exErr } = await sb
        .from('purchase_order_items')
        .select('id, quantity_received')
        .eq('purchase_order_id', finalOrderId)
        .is('deleted_at', null);

      if (exErr) {
        console.error('[saveOrder] existing items error', exErr);
        showErrorToast('Error', 'No se pudieron leer las líneas existentes');
        return;
      }

      const existingMap = new Map((existing || []).map(e => [String(e.id), num(e.quantity_received)]));
      const keepIds = new Set(draft.filter(d => d.id).map(d => String(d.id)));

      const deletableIds = (existing || [])
        .filter(e => !keepIds.has(String(e.id)) && num(e.quantity_received) <= 0)
        .map(e => e.id);

      if (deletableIds.length) {
        const { error: delErr } = await sb.from('purchase_order_items').delete().in('id', deletableIds);
        if (delErr) {
          console.error('[saveOrder] delete items error', delErr);
          showErrorToast('Error', 'No se pudieron eliminar algunas líneas');
          return;
        }
      }

      const updates = [];
      for (const it of draft.filter(d => d.id)) {
        const recDb = existingMap.get(String(it.id)) ?? 0;

        if (recDb > 0 && it.quantity_ordered < recDb) {
          return Swal.fire('Atención', `No podés bajar la cantidad pedida por debajo de lo recibido (${recDb}).`, 'info');
        }

        if (recDb > 0 && recDb >= it.quantity_ordered) continue;

        updates.push({
          id: it.id,
          purchase_order_id: finalOrderId,
          product_id: it.product_id,
          quantity_ordered: it.quantity_ordered,
          planned_date: it.planned_date,
          updated_at: nowIso
        });
      }

      if (updates.length) {
        const { error: upErr } = await sb
          .from('purchase_order_items')
          .upsert(updates, { onConflict: 'id' });

        if (upErr) {
          console.error('[saveOrder] upsert updates error', upErr);
          showErrorToast('Error', 'No se pudieron actualizar algunas líneas');
          return;
        }
      }

      const inserts = draft
        .filter(d => !d.id)
        .map(d => ({
          purchase_order_id: finalOrderId,
          product_id: d.product_id,
          quantity_ordered: d.quantity_ordered,
          quantity_received: 0,
          planned_date: d.planned_date,
          created_at: nowIso,
          updated_at: nowIso
        }));

      if (inserts.length) {
        const { error: insErr } = await sb.from('purchase_order_items').insert(inserts);
        if (insErr) {
          console.error('[saveOrder] insert new lines error', insErr);
          showErrorToast('Error', 'No se pudieron agregar algunas líneas nuevas');
          return;
        }
      }
    }

    const modalEl = document.getElementById('orderModal');
    bootstrap.Modal.getInstance(modalEl)?.hide();
    showSuccessToast('OK', 'Orden guardada');
    await reloadPurchaseOrdersData();
  } catch (e) {
    console.error('[saveOrder] ex', e);
    showErrorToast('Error', 'No se pudo guardar la orden');
  }
}

// ---------- Eventos de tabla órdenes ----------
async function onEditOrderClick(ev){
  const tr = ev.currentTarget.closest('tr');
  if (!tr) return;
  const id = tr.getAttribute('data-id');
  if (!id) return;

  try {
    const { data, error } = await sb
      .from('purchase_orders')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('[onEditOrderClick] error', error);
      showErrorToast('Error', 'No se pudo leer la orden');
      return;
    }

    openOrderModal(data);
  } catch (e) {
    console.error('[onEditOrderClick] ex', e);
    showErrorToast('Error', 'No se pudo leer la orden');
  }
}

async function onViewOrderClick(ev){
  const tr = ev.currentTarget.closest('tr');
  if (!tr) return;
  const id = tr.getAttribute('data-id');
  if (!id) return;

  try {
    const { data, error } = await sb
      .from('purchase_orders')
      .select('*, clients!purchase_orders_vendor_id_fkey(nombre)')
      .eq('id', id)
      .single();

    if (error) {
      console.error('[onViewOrderClick] error', error);
      showErrorToast('Error', 'No se pudo leer la orden');
      return;
    }

    Swal.fire({
      title: 'Detalle de orden',
      html: `
        <div class="text-start">
          <div><strong>Proveedor:</strong> ${esc(data.clients?.nombre || '')}</div>
          <div><strong>Fecha:</strong> ${fmtDateDisplay(data.order_date)}</div>
          <div><strong>Referencia:</strong> ${esc(data.reference || '')}</div>
          <div><strong>Nº externo:</strong> ${esc(data.external_number || '')}</div>
        </div>
      `,
      icon: 'info'
    });
  } catch (e) {
    console.error('[onViewOrderClick] ex', e);
    showErrorToast('Error', 'No se pudo leer la orden');
  }
}

async function onPdfOrderClick(ev){
  const tr = ev.currentTarget.closest('tr');
  if (!tr) return;
  const id = tr.getAttribute('data-id');
  if (!id) return;

  await downloadPurchaseOrderPdf(id);
}

// ---------- PDF (descarga directa, A4 horizontal, con estilo) ----------
function normalizePath(p){
  if (!p) return '';
  let s = String(p).trim();
  s = s.replace(/\\/g, '/');
  s = s.replace(/^\/+/, '');
  return s;
}

function loadScript(url){
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function ensureJsPdf(){
  const hasJsPdf = !!(window.jspdf && window.jspdf.jsPDF);
  const hasAutoTable = hasJsPdf && (typeof window.jspdf.jsPDF.prototype.autoTable === 'function');

  if (hasJsPdf && hasAutoTable) return;

  try {
    if (!hasJsPdf) {
      await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
    }
    const hasAutoTable2 = window.jspdf && window.jspdf.jsPDF && (typeof window.jspdf.jsPDF.prototype.autoTable === 'function');
    if (!hasAutoTable2) {
      await loadScript('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.3/dist/jspdf.plugin.autotable.min.js');
    }
  } catch (e) {
    console.error('[ensureJsPdf] error', e);
    throw new Error('No se pudo cargar librería PDF (jsPDF).');
  }
}

async function fetchAsDataUrl(url){
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`No se pudo cargar imagen: ${url}`);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

async function getImageNaturalSize(dataUrl){
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function tryLoadLogoDataUrl(){
  const rawNorm = normalizePath(PO_LOGO_RAW);
  const candidates = [
    rawNorm,
    `./${rawNorm}`,
    `/` + rawNorm,
    'img/logo_distribuidora.png',
    './img/logo_distribuidora.png',
    'distributor_castelo/img/logo_distribuidora.png',
    './distributor_castelo/img/logo_distribuidora.png'
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      const dataUrl = await fetchAsDataUrl(c);
      return dataUrl;
    } catch (_) {}
  }
  return null;
}

function buildOrderNumberText(po){
  if (po.external_number) return `OC: # ${po.external_number}`;
  if (po.reference) return `OC: ${po.reference}`;
  return `OC: ${po.id}`;
}

function statusStyle(status){
  const s = String(status || '');
  if (s === 'COMPLETA')  return { label: 'COMPLETA',  bar: [60, 180, 75] };
  if (s === 'PARCIAL')   return { label: 'PARCIAL',   bar: [70, 140, 220] };
  if (s === 'PLANIFICADA') return { label: 'PLANIFICADA', bar: [220, 160, 60] };
  if (s === 'CANCELADA') return { label: 'CANCELADA', bar: [150, 150, 150] };
  return { label: s || '-', bar: [150, 150, 150] };
}

function drawStatBox(doc, x, y, w, h, title, value){
  doc.setFillColor(250, 250, 250);
  doc.setDrawColor(230);
  doc.setLineWidth(0.2);
  doc.roundedRect(x, y, w, h, 2, 2, 'FD');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(title, x + w/2, y + 4.3, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(30);
  doc.text(String(value ?? 0), x + w/2, y + 11.8, { align: 'center' });

  doc.setTextColor(0);
}

async function downloadPurchaseOrderPdf(orderId){
  try {
    await ensureJsPdf();
    const { jsPDF } = window.jspdf;

    // Cabecera + proveedor
    const { data: po, error: poErr } = await sb
      .from('purchase_orders')
      .select('id, order_date, status, reference, external_number, notes, vendor_id, clients!purchase_orders_vendor_id_fkey(nombre, direccion, telefono, email)')
      .eq('id', orderId)
      .single();

    if (poErr || !po) {
      console.error('[downloadPurchaseOrderPdf] poErr', poErr);
      showErrorToast('Error', 'No se pudo leer la orden');
      return;
    }

    // Líneas
    const { data: items, error: itErr } = await sb
      .from('purchase_order_items')
      .select('id, product_id, quantity_ordered, quantity_received, planned_date, product(code, description)')
      .eq('purchase_order_id', orderId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (itErr) {
      console.error('[downloadPurchaseOrderPdf] itErr', itErr);
      showErrorToast('Error', 'No se pudieron leer los ítems');
      return;
    }

    const st = statusStyle(po.status);

    const totals = (items || []).reduce((acc, it) => {
      const o = num(it.quantity_ordered);
      const r = num(it.quantity_received);
      acc.ordered += o;
      acc.received += r;
      acc.pending += Math.max(0, o - r);
      return acc;
    }, { ordered: 0, received: 0, pending: 0 });

    // ✅ A4 horizontal
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const pageW = doc.internal.pageSize.getWidth();   // ~297
    const pageH = doc.internal.pageSize.getHeight();  // ~210
    const margin = 14;

    // Header container
    let y = 12;
    const headerH = 38;
    const headerW = pageW - margin*2;

    // Fondo header
    doc.setFillColor(250, 250, 250);
    doc.roundedRect(margin, y, headerW, headerH, 2.5, 2.5, 'F');

    // Barra estado (izq)
    doc.setFillColor(...st.bar);
    doc.roundedRect(margin, y, 5, headerH, 2.5, 2.5, 'F');

    // Logo centrado (sin deformar) dentro del header
    const logoDataUrl = await tryLoadLogoDataUrl();
    if (logoDataUrl) {
      try {
        const { w: iw, h: ih } = await getImageNaturalSize(logoDataUrl);
        const maxW = 60;
        const maxH = 18;

        let drawW = maxW;
        let drawH = (ih && iw) ? (maxW * (ih / iw)) : 16;

        if (drawH > maxH) {
          drawH = maxH;
          drawW = (ih && iw) ? (maxH * (iw / ih)) : maxW;
        }

        const xLogo = margin + (headerW - drawW) / 2;    // ✅ centrado
        const yLogo = y + 6;
        doc.addImage(logoDataUrl, 'PNG', xLogo, yLogo, drawW, drawH, undefined, 'FAST');
      } catch (_) {}
    }

    // Título + OC (debajo del logo, a la izquierda)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(20);
    doc.text('Orden de compra', margin + 10, y + 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(70);
    doc.text(buildOrderNumberText(po), margin + 10, y + 19);
    doc.setTextColor(0);

    // Datos proveedor (izq, abajo)
    const vendorName = po.clients?.nombre || '';
    const vendorAddr = po.clients?.direccion || '';
    const vendorTel  = po.clients?.telefono || '';
    const vendorMail = po.clients?.email || '';

    doc.setFontSize(9.5);
    doc.setTextColor(50);
    doc.text(`Proveedor: ${vendorName || '-'}`, margin + 10, y + 27);
    doc.text(`Fecha orden: ${fmtDateDisplay(po.order_date) || '-'}`, margin + 10, y + 33);
    if (vendorAddr) doc.text(`Dirección: ${vendorAddr}`, margin + 10, y + 38);
    doc.setTextColor(0);

    // Estado (derecha arriba)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(40);
    doc.text(`Estado: ${st.label}`, pageW - margin - 10, y + 14, { align: 'right' });

    // Cajas de totales (mismo tamaño, alineadas)
    const boxW = 34;
    const boxH = 14;
    const gap = 3;
    const totalBoxesW = boxW*3 + gap*2;
    const xBoxes = pageW - margin - totalBoxesW;
    const yBoxes = y + 18.5;

    drawStatBox(doc, xBoxes + (boxW + gap)*0, yBoxes, boxW, boxH, 'Pedido', totals.ordered);
    drawStatBox(doc, xBoxes + (boxW + gap)*1, yBoxes, boxW, boxH, 'Recep.', totals.received);
    drawStatBox(doc, xBoxes + (boxW + gap)*2, yBoxes, boxW, boxH, 'Pend.', totals.pending);

    // Contacto proveedor (derecha abajo, chiquito)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(90);
    const contactLines = [vendorTel ? `Tel: ${vendorTel}` : '', vendorMail ? `Email: ${vendorMail}` : ''].filter(Boolean);
    let yContact = y + 35;
    contactLines.forEach((ln) => {
      doc.text(ln, pageW - margin - 10, yContact, { align: 'right' });
      yContact += 4.5;
    });
    doc.setTextColor(0);

    y += headerH + 8;

    // Notas (si hay)
    if (po.notes) {
      doc.setFontSize(10);
      doc.setTextColor(90);
      doc.text('Notas:', margin, y);
      y += 5;
      doc.setTextColor(0);
      const noteLines = doc.splitTextToSize(String(po.notes), pageW - margin*2);
      doc.text(noteLines, margin, y);
      y += (noteLines.length * 4.5) + 4;
    }

    // Tabla SIN columna OK/PEND. (eliminada)
    // Columnas Pedida / Recep / Pend => mismo tamaño
    const body = (items || []).map((it) => {
      const ordered = num(it.quantity_ordered);
      const received = num(it.quantity_received);
      const pending = Math.max(0, ordered - received);

      return [
        it.product?.code || '',
        it.product?.description || '',
        fmtDateDisplay(it.planned_date) || '',
        String(ordered),
        String(received),
        String(pending)
      ];
    });

    // Landscape usable width: 297 - 28 = 269
    // code 55 + prod 118 + plan 30 + (22+22+22) = 269 ✅
    const colW = { code:55, prod:118, plan:30, ord:22, rec:22, pend:22 };

    doc.autoTable({
      startY: y,
      head: [[ 'Código', 'Producto', 'Planif.', 'Pedida', 'Recep.', 'Pend.' ]],
      body,
      styles: {
        font: 'helvetica',
        fontSize: 9,
        cellPadding: 2.1,
        lineColor: [230,230,230],
        lineWidth: 0.1,
        overflow: 'linebreak',
        valign: 'middle'
      },
      headStyles: {
        fillColor: [245,245,245],
        textColor: 20,
        fontStyle: 'bold',
        lineColor: [220,220,220],
        lineWidth: 0.2
      },
      columnStyles: {
        0: { cellWidth: colW.code, fontStyle: 'bold' },
        1: { cellWidth: colW.prod },
        2: { cellWidth: colW.plan, halign: 'center' },
        3: { cellWidth: colW.ord, halign: 'right' },
        4: { cellWidth: colW.rec, halign: 'right' },
        5: { cellWidth: colW.pend, halign: 'right' }
      },
      theme: 'grid',

      // 🎨 fondo suave por estado de línea (según pendiente/recibido)
      didParseCell: (data) => {
        if (data.section !== 'body') return;
        const row = data.row?.raw || [];
        const rec = num(row[4]);   // Recep.
        const pend = num(row[5]);  // Pend.

        if (pend === 0) data.cell.styles.fillColor = [235, 250, 238];
        else if (rec > 0 && pend > 0) data.cell.styles.fillColor = [238, 246, 255];
      },

      // Barra color a la izquierda por fila (verde completa / celeste parcial / gris planificada)
      didDrawCell: (data) => {
        if (data.section !== 'body') return;
        if (data.column.index !== 0) return;

        const row = data.row?.raw || [];
        const rec = num(row[4]);
        const pend = num(row[5]);

        let color = [160, 160, 160];
        if (pend === 0) color = [60, 180, 75];
        else if (rec > 0) color = [70, 140, 220];

        doc.setFillColor(...color);
        doc.rect(data.cell.x, data.cell.y, 1.2, data.cell.height, 'F');
      }
    });

    // Footer
    const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY : y;
    const footerY = Math.min(finalY + 8, pageH - 8);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text('Programa Distribuidora 2', margin, footerY);
    doc.setTextColor(0);

    const fileKey = po.external_number || po.reference || String(po.id).slice(0, 8);
    const fileName = `OC_${String(fileKey).replace(/[^\w\-]+/g,'_')}.pdf`;
    doc.save(fileName);
  } catch (e) {
    console.error('[downloadPurchaseOrderPdf] ex', e);
    showErrorToast('Error', e?.message || 'No se pudo generar el PDF');
  }
}

// ---------- Recepción ----------
function bindReceiveModalEvents(){
  $('#btnConfirmReception')?.addEventListener('click', saveReception);
}

function onReceiveLineClick(ev){
  const tr = ev.currentTarget.closest('tr');
  if (!tr) return;
  const orderId = tr.getAttribute('data-order-id');
  const itemId  = tr.getAttribute('data-item-id');
  if (!orderId || !itemId) return;

  const line = poState.pending.find(p =>
    String(p.purchase_order_id) === String(orderId) &&
    String(p.purchase_order_item_id) === String(itemId)
  );

  if (!line) {
    showErrorToast('Error', 'No se encontró la línea seleccionada');
    return;
  }

  openReceiveModal(line);
}

function openReceiveModal(line){
  $('#receiveOrderId').value = line.purchase_order_id;
  $('#receiveItemId').value  = line.purchase_order_item_id;
  $('#receiveProductId').value = line.product_id;

  $('#receiveVendorName').textContent = line.vendor_name || '';
  const orderNumberRaw =
    line.order_reference ||
    line.order_external_number ||
    (line.purchase_order_id ? String(line.purchase_order_id).slice(0,8) + '…' : '');
  $('#receiveOrderNumber').textContent = orderNumberRaw || '';
  $('#receiveProduct').textContent = `${line.product_code || ''} - ${line.product_description || ''}`;
  $('#receivePlannedDate').textContent = fmtDateDisplay(line.planned_date) || '—';

  $('#receiveQtyOrdered').value  = line.quantity_ordered;
  $('#receiveQtyReceived').value = line.quantity_received;
  $('#receiveQtyPending').value  = line.quantity_pending;

  $('#receiveWarehouse').value = '';
  $('#receiveLot').value = '';
  $('#receiveExpiration').value = '';
  $('#receiveQty').value = line.quantity_pending;
  $('#receiveDate').value = fmtDate(new Date());

  const form = $('#receiveForm');
  form?.classList.remove('was-validated');

  const modalEl = document.getElementById('receiveModal');
  const modal = new bootstrap.Modal(modalEl, { focus: false });
  modal.show();
}

async function saveReception(){
  const form = $('#receiveForm');
  if (!form) return;

  if (!form.checkValidity()) {
    form.classList.add('was-validated');
    return;
  }

  const orderId   = $('#receiveOrderId').value;
  const itemId    = $('#receiveItemId').value;
  const warehouseId = $('#receiveWarehouse').value;
  const receiveDate = $('#receiveDate').value;
  const lot       = $('#receiveLot').value.trim() || null;
  const expiration = $('#receiveExpiration').value || null;
  const qty       = num($('#receiveQty').value || 0);
  const maxPending = num($('#receiveQtyPending').value || 0);

  if (!warehouseId || !receiveDate || qty <= 0 || qty > maxPending) {
    form.classList.add('was-validated');
    showErrorToast('Error', 'Revisá depósito, fecha y cantidad (no puede superar el pendiente).');
    return;
  }

  try {
    const { data: item, error: itemErr } = await sb
      .from('purchase_order_items')
      .select('id, purchase_order_id, product_id, quantity_ordered, quantity_received')
      .eq('id', itemId)
      .single();

    if (itemErr || !item) {
      console.error('[saveReception] itemErr', itemErr);
      showErrorToast('Error', 'No se pudo leer la línea de la orden');
      return;
    }

    const pendingReal = num(item.quantity_ordered) - num(item.quantity_received);
    if (qty > pendingReal) {
      showErrorToast('Error', 'La cantidad a recibir supera el pendiente actual.');
      return;
    }

    const { data: order, error: orderErr } = await sb
      .from('purchase_orders')
      .select('id, status, reference, external_number')
      .eq('id', orderId)
      .single();

    if (orderErr || !order) {
      console.error('[saveReception] orderErr', orderErr);
      showErrorToast('Error', 'No se pudo leer la orden');
      return;
    }

    const nowIso = new Date().toISOString();
    let existingRow = null;

    let sbQuery = sb
      .from('stock_balances')
      .select('id, quantity, reserved')
      .eq('product_id', item.product_id)
      .eq('warehouse_id', Number(warehouseId));

    if (lot) sbQuery = sbQuery.eq('lot', lot);
    else sbQuery = sbQuery.is('lot', null);

    if (expiration) sbQuery = sbQuery.eq('expiration_date', expiration);
    else sbQuery = sbQuery.is('expiration_date', null);

    const { data: existingRows, error: existingErr } = await sbQuery.limit(1);
    if (existingErr) {
      console.warn('[saveReception] error buscando balance existente', existingErr);
    } else if (existingRows && existingRows.length > 0) {
      existingRow = existingRows[0];
    }

    let balanceId;

    if (existingRow) {
      const newQty = num(existingRow.quantity) + qty;

      const { error: updBalErr } = await sb
        .from('stock_balances')
        .update({
          quantity: newQty,
          is_active: newQty > 0,
          deleted_at: newQty > 0 ? null : nowIso,
          updated_at: nowIso
        })
        .eq('id', existingRow.id);

      if (updBalErr) {
        console.error('[saveReception] stock_balances update error', updBalErr);
        showErrorToast('Error', 'No se pudo actualizar el stock');
        return;
      }
      balanceId = existingRow.id;
    } else {
      const insertPayload = {
        product_id: item.product_id,
        warehouse_id: Number(warehouseId),
        quantity: qty,
        reserved: 0,
        lot: lot,
        expiration_date: expiration,
        is_active: true,
        created_at: nowIso,
        updated_at: nowIso
      };

      const { error: insErr } = await sb.from('stock_balances').insert(insertPayload);
      if (insErr) {
        console.error('[saveReception] stock_balances insert error', insErr);
        showErrorToast('Error', insErr.message || 'No se pudo crear el stock');
        return;
      }

      let sbQuery2 = sb
        .from('stock_balances')
        .select('id')
        .eq('product_id', item.product_id)
        .eq('warehouse_id', Number(warehouseId));

      if (lot) sbQuery2 = sbQuery2.eq('lot', lot);
      else sbQuery2 = sbQuery2.is('lot', null);

      if (expiration) sbQuery2 = sbQuery2.eq('expiration_date', expiration);
      else sbQuery2 = sbQuery2.is('expiration_date', null);

      const { data: rows2, error: rows2Err } = await sbQuery2.order('id', { ascending: false }).limit(1);
      if (rows2Err || !rows2 || !rows2.length) {
        console.error('[saveReception] stock_balances select after insert error', rows2Err);
        showErrorToast('Error', 'No se pudo leer el stock recién creado');
        return;
      }
      balanceId = rows2[0].id;
    }

    let refText;
    if (order.external_number) refText = `OC: # ${order.external_number}`;
    else if (order.reference)  refText = `OC: ${order.reference}`;
    else                       refText = `OC: ${order.id}`;

    const movementDateIso = new Date(receiveDate).toISOString();

    const { error: movErr } = await sb
      .from('stock_movements')
      .insert({
        stock_balance_id: balanceId,
        product_id: item.product_id,
        warehouse_id: Number(warehouseId),
        lot: lot,
        movement_type: 'IN',
        quantity: qty,
        movement_date: movementDateIso,
        reference: refText
      });

    if (movErr) {
      console.error('[saveReception] stock_movements insert error', movErr);
      showErrorToast('Error', 'No se pudo registrar el movimiento de stock');
      return;
    }

    const newReceived = num(item.quantity_received) + qty;
    const { error: updItemErr } = await sb
      .from('purchase_order_items')
      .update({ quantity_received: newReceived, updated_at: nowIso })
      .eq('id', itemId);

    if (updItemErr) {
      console.error('[saveReception] purchase_order_items update error', updItemErr);
      showErrorToast('Error', 'No se pudo actualizar la línea de la orden');
      return;
    }

    const { data: allItems, error: allErr } = await sb
      .from('purchase_order_items')
      .select('quantity_ordered, quantity_received')
      .eq('purchase_order_id', orderId)
      .is('deleted_at', null);

    if (allErr) {
      console.error('[saveReception] purchase_order_items list error', allErr);
      showErrorToast('Error', 'No se pudo recalcular el estado de la orden');
      return;
    }

    let newStatus = order.status;
    if (order.status !== 'CANCELADA') {
      let allComplete = true;
      let noneReceived = true;
      for (const it of allItems || []) {
        const qO = num(it.quantity_ordered);
        const qR = num(it.quantity_received);
        if (qR < qO) allComplete = false;
        if (qR > 0) noneReceived = false;
      }
      if (allComplete) newStatus = 'COMPLETA';
      else if (!noneReceived) newStatus = 'PARCIAL';
      else newStatus = 'PLANIFICADA';
    }

    if (newStatus !== order.status) {
      const { error: updOrderErr } = await sb
        .from('purchase_orders')
        .update({ status: newStatus, updated_at: nowIso })
        .eq('id', orderId);

      if (updOrderErr) console.error('[saveReception] purchase_orders update error', updOrderErr);
    }

    const modalEl = document.getElementById('receiveModal');
    bootstrap.Modal.getInstance(modalEl)?.hide();
    showSuccessToast('OK', 'Recepción registrada y stock actualizado');
    await reloadPurchaseOrdersData();
  } catch (e) {
    console.error('[saveReception] ex', e);
    showErrorToast('Error', 'No se pudo completar la recepción');
  }
}

// ---------- Exports ----------
function exportOrdersCsv(){
  const rows = poState.orders || [];
  if (!rows.length) return Swal.fire('Info', 'No hay datos para exportar', 'info');

  const headers = ['Fecha orden','Referencia','Nº externo','Proveedor','Estado','Ítems','Cant pedida','Cant recibida','Productos'];
  const lines = [headers.join(';')];

  rows.forEach(r => {
    lines.push([
      fmtDateDisplay(r.order_date),
      r.reference || '',
      r.external_number || '',
      r.vendor_name || '',
      r.status || '',
      r.items_count || 0,
      r.total_qty_ordered || 0,
      r.total_qty_received || 0,
      r.products_summary || ''
    ].map(v => String(v).replace(/;/g, ',')).join(';'));
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'purchase_orders.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportOrdersXlsx(){
  const rows = (poState.orders || []).map(r => ({
    'Fecha orden': fmtDateDisplay(r.order_date),
    'Referencia': r.reference || '',
    'Nº externo': r.external_number || '',
    'Proveedor': r.vendor_name || '',
    'Estado': r.status || '',
    'Ítems': r.items_count || 0,
    'Cant pedida': r.total_qty_ordered || 0,
    'Cant recibida': r.total_qty_received || 0,
    'Productos': r.products_summary || ''
  }));

  if (!rows.length) return Swal.fire('Info', 'No hay datos para exportar', 'info');

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Órdenes');
  XLSX.writeFile(wb, 'purchase_orders.xlsx');
}
