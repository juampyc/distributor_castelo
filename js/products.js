/* ==========================
 *  products.js
 *  Pantalla Productos (similar a vendors.js)
 * ========================== */

// -------- Utilidades básicas (copiadas de vendors.js) --------
const $  = (q)=> document.querySelector(q);
const $$ = (q)=> Array.from(document.querySelectorAll(q));
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const esc = (s)=> String(s??'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function debounce(fn,ms){ let t; return (...a)=>{clearTimeout(t); t=setTimeout(()=>fn(...a),ms);} }

// -------- Estado global --------
let productsState = {
  page: 1,
  pageSize: 25,
  totalRows: 0,
  search: '',
  filters: {
    productTypeId: '',
    brandId: '',
    active: 'all' // all | active | inactive
  }
};

let lastProducts = [];      // para export y edición
let modalProduct = null;    // instancia Bootstrap modal
let kitProductOptions = []; // lista de productos para componentes de kit

// -------- Arranque --------
document.addEventListener('DOMContentLoaded', () => {
  bindProductsUI();
  initProductsApp().catch(e => {
    console.error('Error al inicializar la pantalla de productos', e);
  });
});

async function initProductsApp(){
  // Espera a que el cliente Supabase (sb) esté listo
  while (!window.sb) { await sleep(50); }

  await loadProductTypes();
  await loadBrands();
  await loadContainers();
  await loadSizes();
  await loadUnits();
  await loadKitProductOptions();
  setupDropdownPlusProducts();

  await listProducts();

  const modalEl = $('#productModal');
  if (modalEl) modalProduct = new bootstrap.Modal(modalEl, { focus:false });
}

// -------- Enlaces UI --------
function bindProductsUI(){
  // Toolbar
  $('#btnRefreshProducts')?.addEventListener('click', ()=>{
    productsState.page = 1;
    listProducts();
  });

  $('#productsSearchInput')?.addEventListener('input', debounce(()=>{
    productsState.search = $('#productsSearchInput').value.trim();
    productsState.page = 1;
    listProducts();
  },250));

  $('#btnAddProduct')?.addEventListener('click', ()=> openProductModal());

  // usar #pageSize igual que vendors
  $('#pageSize')?.addEventListener('change', (e)=>{
    productsState.pageSize = +e.target.value || 25;
    productsState.page = 1;
    listProducts();
  });

  $('#filterProductType')?.addEventListener('change', (e)=>{
    productsState.filters.productTypeId = e.target.value || '';
    productsState.page = 1;
    listProducts();
  });

  $('#filterProductsActive')?.addEventListener('change', (e)=>{
    productsState.filters.active = e.target.value || 'all';
    productsState.page = 1;
    listProducts();
  });

  // Paginación
  $('#productsPrevPage')?.addEventListener('click', ()=>{
    if (productsState.page > 1) {
      productsState.page--;
      listProducts();
    }
  });

  $('#productsNextPage')?.addEventListener('click', ()=>{
    if (productsState.page * productsState.pageSize < productsState.totalRows) {
      productsState.page++;
      listProducts();
    }
  });

  // Export
  $('#btnExportProductsCsv')?.addEventListener('click', ()=> exportProducts('csv'));
  $('#btnExportProductsXlsx')?.addEventListener('click', ()=> exportProducts('xlsx'));

  // Tabla (acciones)
  $('#productsTable tbody')?.addEventListener('click', onProductsTableClick);

  // Modal
  $('#btnSaveProduct')?.addEventListener('click', saveProduct);

  // Radios de forma de despacho
  $('#dispatchFormSell')?.addEventListener('change', onDispatchFormChange);
  $('#dispatchFormKit')?.addEventListener('change', onDispatchFormChange);

  // Botón agregar componente kit
  $('#btnAddKitComponent')?.addEventListener('click', ()=> addKitComponentRow());
}

// -------- Carga catálogos --------
async function loadProductTypes(selectedId){
  try{
    const filterSel = $('#filterProductType');
    const formSel   = $('#productTypeSelect');
    if (filterSel) filterSel.innerHTML = '<option value="">Todos los tipos</option>';
    if (formSel)   formSel.innerHTML   = '<option value="">—</option>';

    const { data, error } = await sb.from('product_type').select('*').order('name');
    if (error) { console.warn('loadProductTypes err', error); return; }

    (data||[]).forEach(t=>{
      if (filterSel){
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.name;
        filterSel.appendChild(o);
      }
      if (formSel){
        const o2 = document.createElement('option');
        o2.value = t.id;
        o2.textContent = t.name;
        formSel.appendChild(o2);
      }
    });

    if (selectedId){
      if (filterSel) filterSel.value = selectedId;
      if (formSel)   formSel.value   = selectedId;
    }
  }catch(e){ console.warn('loadProductTypes ex', e); }
}

async function loadBrands(selectedId){
  try{
    // sólo modal: no hay filtro de marca
    const formSel   = $('#productBrandSelect');
    if (formSel)   formSel.innerHTML   = '<option value="">—</option>';

    const { data, error } = await sb.from('brand').select('*').order('name');
    if (error) { console.warn('loadBrands err', error); return; }

    (data||[]).forEach(t=>{
      if (formSel){
        const o2 = document.createElement('option');
        o2.value = t.id;
        o2.textContent = t.name;
        formSel.appendChild(o2);
      }
    });

    if (selectedId && formSel)   formSel.value   = selectedId;
  }catch(e){ console.warn('loadBrands ex', e); }
}

async function loadContainers(selectedId){
  try{
    const formSel = $('#productContainerSelect');
    if (formSel) formSel.innerHTML = '<option value="">—</option>';

    const { data, error } = await sb.from('container').select('*').order('name');
    if (error){ console.warn('loadContainers err', error); return; }

    (data||[]).forEach(t=>{
      if (formSel){
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.name;
        formSel.appendChild(o);
      }
    });

    if (selectedId && formSel) formSel.value = selectedId;
  }catch(e){ console.warn('loadContainers ex', e); }
}

async function loadSizes(selectedId){
  try{
    const formSel = $('#productSizeSelect');
    if (formSel) formSel.innerHTML = '<option value="">—</option>';

    const { data, error } = await sb.from('size').select('*').order('name');
    if (error){ console.warn('loadSizes err', error); return; }

    (data||[]).forEach(t=>{
      if (formSel){
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.name;
        formSel.appendChild(o);
      }
    });

    if (selectedId && formSel) formSel.value = selectedId;
  }catch(e){ console.warn('loadSizes ex', e); }
}

async function loadUnits(selectedId){
  try{
    const formSel = $('#productUnitSelect');
    if (formSel) formSel.innerHTML = '<option value="">—</option>';

    const { data, error } = await sb.from('unit').select('*').order('name');
    if (error){ console.warn('loadUnits err', error); return; }

    (data||[]).forEach(t=>{
      if (formSel){
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.symbol ? `${t.name} (${t.symbol})` : t.name;
        formSel.appendChild(o);
      }
    });

    if (selectedId && formSel) formSel.value = selectedId;
  }catch(e){ console.warn('loadUnits ex', e); }
}

async function loadKitProductOptions(){
  try{
    const { data, error } = await sb
      .from('product')
      .select('id, code, description, is_active, deleted_at')
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('code');

    if (error){ console.warn('loadKitProductOptions err', error); return; }
    kitProductOptions = data || [];
  }catch(e){ console.warn('loadKitProductOptions ex', e); }
}

// -------- DropdownPlus para catálogos --------
function setupDropdownPlusProducts(){
  if (!window.registerDropdownPlus) return;

  // Tipo de producto (solo modal)
  if ($('#btnAddProductTypeForm')){
    registerDropdownPlus({
      table: 'product_type',
      labelField: 'name',
      displayName: 'tipo de producto',
      addButton: $('#btnAddProductTypeForm'),
      onCreated: (row)=> loadProductTypes(row.id)
    });
  }

  // Marca (solo modal)
  if ($('#btnAddBrandForm')){
    registerDropdownPlus({
      table: 'brand',
      labelField: 'name',
      displayName: 'marca',
      addButton: $('#btnAddBrandForm'),
      onCreated: (row)=> loadBrands(row.id)
    });
  }

  // Envase
  if ($('#btnAddContainerForm')){
    registerDropdownPlus({
      table: 'container',
      labelField: 'name',
      displayName: 'envase',
      addButton: $('#btnAddContainerForm'),
      onCreated: (row)=> loadContainers(row.id)
    });
  }

  // Tamaño
  if ($('#btnAddSizeForm')){
    registerDropdownPlus({
      table: 'size',
      labelField: 'name',
      displayName: 'tamaño',
      addButton: $('#btnAddSizeForm'),
      onCreated: (row)=> loadSizes(row.id)
    });
  }

  // Unidad
  if ($('#btnAddUnitForm')){
    registerDropdownPlus({
      table: 'unit',
      labelField: 'name',
      displayName: 'unidad',
      addButton: $('#btnAddUnitForm'),
      onCreated: (row)=> loadUnits(row.id)
    });
  }
}

// -------- Listado de productos --------
async function listProducts(){
  try{
    const tbody = $('#productsTable tbody');
    if (tbody){
      tbody.innerHTML = '<tr><td colspan="6" class="text-center small text-muted py-3">Cargando...</td></tr>';
    }

    const from = (productsState.page - 1) * productsState.pageSize;
    const to   = from + productsState.pageSize - 1;

    let q = sb.from('products_view')
      .select('*', { count:'exact' })
      .order('code', { ascending:true })
      .range(from, to);

    const ors = [];
    if (productsState.search){
      const s = productsState.search;
      ors.push(
        `code.ilike.%${s}%`,
        `description.ilike.%${s}%`,
        `brand_name.ilike.%${s}%`,
        `product_type_name.ilike.%${s}%`
      );
    }
    if (ors.length) q = q.or(ors.join(','));

    // Filtros
    if (productsState.filters.productTypeId){
      q = q.eq('product_type_id', productsState.filters.productTypeId);
    }
    if (productsState.filters.active === 'active'){
      q = q.eq('is_active', true);
    } else if (productsState.filters.active === 'inactive'){
      q = q.eq('is_active', false);
    }

    const { data, error, count } = await q;
    if (error){
      console.error('listProducts error', error);
      if (tbody){
        tbody.innerHTML = '<tr><td colspan="6" class="text-center small text-danger py-3">Error al cargar productos.</td></tr>';
      }
      return;
    }

    lastProducts = data || [];
    productsState.totalRows = count || 0;

    renderProductsTable();
    updateProductsPagination(from, to);
  }catch(e){
    console.error('listProducts ex', e);
  }
}

function renderProductsTable(){
  const tbody = $('#productsTable tbody');
  if (!tbody) return;

  if (!lastProducts.length){
    tbody.innerHTML = '<tr><td colspan="6" class="text-center small text-muted py-3">Sin registros para los filtros.</td></tr>';
    return;
  }

  const rowsHtml = lastProducts.map(renderProductRow).join('');
  tbody.innerHTML = rowsHtml;
}

function renderProductRow(r){
  const estadoLabel = r.is_active ? 'Activo' : 'Inactivo';

  return `<tr data-id="${esc(r.id)}">
    <td><span class="badge-num ${r.is_active?'active':'inactive'}">${esc(r.code||'')}</span></td>
    <td>
      <div class="fw-semibold">${esc(r.description||'')}</div>
      <div class="text-secondary small">${esc(r.brand_name||'')}</div>
    </td>
    <td>${esc(r.product_type_name||'')}</td>
    <td>${esc(r.brand_name||'')}</td>
    <td>${esc(estadoLabel)}</td>
    <td class="text-end">
      <div class="btn-group">
        <button class="btn btn-sm btn-outline-primary btn-edit-product"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger btn-del-product"><i class="bi bi-trash"></i></button>
      </div>
    </td>
  </tr>`;
}

function updateProductsPagination(from, to){
  const info = $('#productsRowsInfo');
  const indicator = $('#productsPageIndicator');
  if (!info || !indicator) return;

  if (!productsState.totalRows){
    info.textContent = 'Sin registros para los filtros';
    indicator.textContent = '1';
    return;
  }

  const start = from + 1;
  const end   = Math.min(to + 1, productsState.totalRows);
  info.textContent = `${start}–${end} de ${productsState.totalRows}`;
  indicator.textContent = productsState.page;
}

// -------- Tabla: acciones --------
function onProductsTableClick(e){
  const btnEdit = e.target.closest('.btn-edit-product');
  const btnDel  = e.target.closest('.btn-del-product');
  const tr = e.target.closest('tr');
  if (!tr) return;
  const id = tr.getAttribute('data-id');

  if (btnEdit){
    onEditProduct(id);
  } else if (btnDel){
    onDeleteProduct(id);
  }
}

async function onEditProduct(id){
  if (!id) return;
  const { data, error } = await sb.from('products_view').select('*').eq('id', id).single();
  if (error){ console.warn('onEditProduct error', error); return; }
  openProductModal(data);
}

async function onDeleteProduct(id){
  if (!id) return;
  const row = lastProducts.find(r=> String(r.id) === String(id));
  const code = row?.code || id;

  const res = await Swal.fire({
    title: 'Eliminar producto',
    text: `¿Seguro que querés eliminar el producto ${code}? (borrado lógico)`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Eliminar',
    cancelButtonText: 'Cancelar'
  });
  if (!res.isConfirmed) return;

  const { error } = await sb
    .from('product')
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq('id', id);

  if (error){
    console.error('deleteProduct error', error);
    return Swal.fire('Error', 'No se pudo eliminar el producto', 'error');
  }

  await listProducts();
  await loadKitProductOptions();
  Swal.fire('OK', 'Producto eliminado (borrado lógico)', 'success');
}

// -------- Modal producto --------
function openProductModal(row){
  const form = $('#productForm');
  if (!form) return;

  form.reset();
  form.classList.remove('was-validated');

  $('#productId').value = row?.id || '';
  $('#productCode').value = row?.code || '';
  $('#productDescription').value = row?.description || '';
  $('#productNotes').value = row?.notes || '';

  $('#productTypeSelect').value = row?.product_type_id || '';
  $('#productBrandSelect').value = row?.brand_id || '';
  $('#productContainerSelect').value = row?.container_id || '';
  $('#productSizeSelect').value = row?.size_id || '';
  $('#productUnitSelect').value = row?.unit_id || '';

  $('#productIsActive').checked = (row?.is_active ?? true);

  const df = row?.dispatch_form || 'se_vende';
  if (df === 'kit'){
    $('#dispatchFormKit').checked = true;
    $('#dispatchFormSell').checked = false;
  } else {
    $('#dispatchFormSell').checked = true;
    $('#dispatchFormKit').checked = false;
  }
  onDispatchFormChange();

  // Kit
  resetKitComponentsTable();
  if (row?.is_kit || row?.dispatch_form === 'kit'){
    loadKitComponents(row.id);
  }

  $('#productModalTitle').textContent = row ? 'Editar producto' : 'Nuevo producto';

  if (!modalProduct){
    const el = $('#productModal');
    if (el) modalProduct = new bootstrap.Modal(el, { focus:false });
  }
  modalProduct?.show();
}

function onDispatchFormChange(){
  const isKit = $('#dispatchFormKit')?.checked;
  const section = $('#kitComponentsSection');
  if (!section) return;
  if (isKit){
    section.classList.remove('d-none');
  } else {
    section.classList.add('d-none');
  }
}

function resetKitComponentsTable(){
  const body = $('#kitComponentsBody');
  if (!body) return;
  body.innerHTML = `<tr class="text-muted">
    <td colspan="3" class="small text-center">Sin componentes</td>
  </tr>`;
}

function addKitComponentRow(componentId, qty){
  const body = $('#kitComponentsBody');
  if (!body) return;

  const emptyRow = body.querySelector('.text-muted');
  if (emptyRow) emptyRow.remove();

  const tr = document.createElement('tr');

  tr.innerHTML = `
    <td>
      <select class="form-select form-select-sm kit-component-select">
        <option value="">Seleccionar...</option>
      </select>
    </td>
    <td>
      <input type="number" class="form-control form-control-sm kit-component-qty" min="0" step="0.01" value="${qty ?? ''}">
    </td>
    <td class="text-end">
      <button type="button" class="btn btn-sm btn-outline-danger btn-remove-kit-component">
        <i class="bi bi-x-lg"></i>
      </button>
    </td>
  `;

  const sel = tr.querySelector('.kit-component-select');
  if (sel){
    sel.innerHTML = '<option value="">Seleccionar...</option>';
    const currentId = $('#productId')?.value || null;
    (kitProductOptions||[]).forEach(p=>{
      if (currentId && String(p.id) === String(currentId)) return;
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = `${p.code} - ${p.description}`;
      sel.appendChild(o);
    });
    if (componentId) sel.value = componentId;
  }

  tr.querySelector('.btn-remove-kit-component')?.addEventListener('click', ()=>{
    tr.remove();
    if (!$('#kitComponentsBody tr')) resetKitComponentsTable();
  });

  body.appendChild(tr);
}

async function loadKitComponents(kitId){
  if (!kitId) return;
  try{
    resetKitComponentsTable();
    const { data, error } = await sb
      .from('product_kit_map')
      .select('component_product_id, quantity')
      .eq('kit_id', kitId);
    if (error){ console.warn('loadKitComponents err', error); return; }
    (data||[]).forEach(r=> addKitComponentRow(r.component_product_id, r.quantity));
  }catch(e){ console.warn('loadKitComponents ex', e); }
}

// -------- Guardar producto --------
async function saveProduct(){
  const form = $('#productForm');
  if (!form) return;

  if (!form.checkValidity()){
    form.classList.add('was-validated');
    return;
  }

  const id = $('#productId').value || null;
  const code = $('#productCode').value.trim();
  const description = $('#productDescription').value.trim();
  const notes = $('#productNotes').value.trim() || null;

  const product_type_id = $('#productTypeSelect').value || null;
  const brand_id        = $('#productBrandSelect').value || null;
  const container_id    = $('#productContainerSelect').value || null;
  const size_id         = $('#productSizeSelect').value || null;
  const unit_id         = $('#productUnitSelect').value || null;

  const is_active = $('#productIsActive').checked;

  const dispatchFormRadio = document.querySelector('input[name="dispatchForm"]:checked');
  const dispatch_form = dispatchFormRadio ? dispatchFormRadio.value : 'se_vende';
  const is_kit = dispatch_form === 'kit';

  const payload = {
    code,
    description,
    notes,
    product_type_id,
    brand_id,
    container_id,
    size_id,
    unit_id,
    dispatch_form,
    is_kit,
    is_active,
    updated_at: new Date().toISOString()
  };

  let productId = id;
  let error;

  if (id){
    ({ error } = await sb.from('product').update(payload).eq('id', id));
  } else {
    const { data, error: err } = await sb.from('product').insert(payload).select().single();
    error = err;
    productId = data?.id || null;
  }

  if (error){
    console.error('saveProduct error', error);
    return Swal.fire('Error','No se pudo guardar el producto','error');
  }

  // Componentes de kit
  const okKit = await saveKitComponents(productId, is_kit);
  if (!okKit) return; // adentro muestra mensajes

  modalProduct?.hide();
  await listProducts();
  await loadKitProductOptions();
  Swal.fire('OK','Producto guardado','success');
}

async function saveKitComponents(kitId, isKit){
  if (!kitId) return true; // nada que hacer

  if (!isKit){
    // ya no es kit, borramos cualquier mapa
    try{
      await sb.from('product_kit_map').delete().eq('kit_id', kitId);
    }catch(e){ console.warn('saveKitComponents delete ex', e); }
    return true;
  }

  const rows = $$('#kitComponentsBody tr');
  const components = [];

  rows.forEach(tr=>{
    const sel = tr.querySelector('.kit-component-select');
    const qtyInput = tr.querySelector('.kit-component-qty');
    if (!sel || !qtyInput) return;
    const cid = sel.value;
    const qty = parseFloat(qtyInput.value);
    if (!cid || !Number.isFinite(qty) || qty <= 0) return;
    components.push({
      kit_id: kitId,
      component_product_id: cid,
      quantity: qty
    });
  });

  if (!components.length){
    await Swal.fire('Atención','Un producto tipo kit debe tener al menos un componente válido','warning');
    return false;
  }

  try{
    await sb.from('product_kit_map').delete().eq('kit_id', kitId);
    const { error } = await sb.from('product_kit_map').insert(components);
    if (error){
      console.error('saveKitComponents insert error', error);
      await Swal.fire('Error','No se pudieron guardar los componentes del kit','error');
      return false;
    }
  }catch(e){
    console.error('saveKitComponents ex', e);
    await Swal.fire('Error','No se pudieron guardar los componentes del kit','error');
    return false;
  }

  return true;
}

// -------- Export --------
async function exportProducts(format){
  try{
    const { data, error } = await sb.from('products_view').select('*').order('code');
    if (error){
      console.error('exportProducts error', error);
      return Swal.fire('Error','No se pudo exportar la lista de productos','error');
    }

    const rows = (data||[]).map(p=>({
      Código: p.code,
      Descripción: p.description,
      Tipo: p.product_type_name || '',
      Marca: p.brand_name || '',
      Estado: p.is_active ? 'Activo' : 'Inactivo'
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Productos');

    if (format === 'csv'){
      XLSX.writeFile(wb, 'productos.csv', { bookType:'csv' });
    } else {
      XLSX.writeFile(wb, 'productos.xlsx', { bookType:'xlsx' });
    }
  }catch(e){
    console.error('exportProducts ex', e);
    Swal.fire('Error','No se pudo exportar la lista de productos','error');
  }
}
