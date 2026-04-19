/* ==========================
 *  products.js
 *  Pantalla Productos
 * ========================== */

// -------- Utilidades básicas --------
const $  = (q)=> document.querySelector(q);
const $$ = (q)=> Array.from(document.querySelectorAll(q));
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const esc = (s)=> String(s??'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&#39;'}[m]));
function debounce(fn,ms){ let t; return (...a)=>{clearTimeout(t); t=setTimeout(()=>fn(...a),ms);} }

// -------- SweetAlert helpers --------
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

// -------- Estado global --------
let productsState = {
  page: 1,
  pageSize: 25,
  totalRows: 0,
  search: '',
  filters: {
    productTypeId: '',
    brandId: '',
    active: 'all'
  }
};

let lastProducts = [];
let modalProduct = null;
let containersMeta = {};            // envases (id -> {id,name,is_kit})
let productTypesOptions = [];       // categorías
let productSubcategoryOptions = []; // subcategorías (para combos + kits)

// -------- Arranque --------
document.addEventListener('DOMContentLoaded', () => {
  bindProductsUI();
  initProductsApp().catch(e => {
    console.error('Error al inicializar la pantalla de productos', e);
  });
});

async function initProductsApp(){
  while (!window.sb) { await sleep(50); }

  await loadProductTypes();
  await loadSubcategories();
  await loadBrands();
  await loadContainers();
  await loadSizes();
  await loadUnits();
  setupDropdownPlusProducts();

  await listProducts();

  const modalEl = $('#productModal');
  if (modalEl) modalProduct = new bootstrap.Modal(modalEl, { focus:false });
}

// -------- Enlaces UI --------
function bindProductsUI(){
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

  $('#btnExportProductsCsv')?.addEventListener('click', ()=> exportProducts('csv'));
  $('#btnExportProductsXlsx')?.addEventListener('click', ()=> exportProducts('xlsx'));

  $('#productsTable tbody')?.addEventListener('click', onProductsTableClick);

  $('#btnSaveProduct')?.addEventListener('click', saveProduct);

  // Cambio de envase (controla kit / producto y visibilidad de campos)
  $('#productContainerSelect')?.addEventListener('change', onContainerChange);

  // Componentes de kit
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

    productTypesOptions = data || [];

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

async function loadSubcategories(selectedId){
  try{
    const formSel = $('#productSubcategorySelect');
    if (formSel) formSel.innerHTML = '<option value="">—</option>';

    const { data, error } = await sb.from('product_subcategory').select('*').order('name');
    if (error){
      console.warn('loadSubcategories err', error);
      return;
    }

    productSubcategoryOptions = data || [];

    (data || []).forEach(sc => {
      if (formSel){
        const o = document.createElement('option');
        o.value = sc.id;
        o.textContent = sc.name;
        formSel.appendChild(o);
      }
    });

    if (selectedId && formSel) formSel.value = selectedId;
  }catch(e){
    console.warn('loadSubcategories ex', e);
  }
}

async function loadBrands(selectedId){
  try{
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

    const { data, error } = await sb
      .from('container')
      .select('id, name, is_kit')
      .order('name');

    if (error){
      console.warn('loadContainers err', error);
      return;
    }

    containersMeta = {};
    (data||[]).forEach(t=>{
      containersMeta[t.id] = {
        id: t.id,
        name: t.name,
        is_kit: !!t.is_kit
      };
      if (formSel){
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.name;
        formSel.appendChild(o);
      }
    });

    if (selectedId && formSel) formSel.value = selectedId;
  }catch(e){
    console.warn('loadContainers ex', e);
  }
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

// -------- DropdownPlus --------
function setupDropdownPlusProducts(){
  if (!window.registerDropdownPlus) return;

  if ($('#btnAddProductTypeForm')){
    registerDropdownPlus({
      table: 'product_type',
      labelField: 'name',
      displayName: 'tipo de producto',
      addButton: $('#btnAddProductTypeForm'),
      onCreated: (row)=> loadProductTypes(row.id)
    });
  }

  if ($('#btnAddSubcategoryForm')){
    registerDropdownPlus({
      table: 'product_subcategory',
      labelField: 'name',
      displayName: 'sub categoría',
      addButton: $('#btnAddSubcategoryForm'),
      onCreated: (row)=> loadSubcategories(row.id)
    });
  }

  if ($('#btnAddBrandForm')){
    registerDropdownPlus({
      table: 'brand',
      labelField: 'name',
      displayName: 'marca',
      addButton: $('#btnAddBrandForm'),
      onCreated: (row)=> loadBrands(row.id)
    });
  }

  if ($('#btnAddContainerForm')){
    registerDropdownPlus({
      table: 'container',
      labelField: 'name',
      displayName: 'envase',
      addButton: $('#btnAddContainerForm'),
      // recarga envases y actualiza UI (producto/kit)
      onCreated: async (row)=>{
        await loadContainers(row.id);
        onContainerChange();
      }
    });
  }

  if ($('#btnAddSizeForm')){
    registerDropdownPlus({
      table: 'size',
      labelField: 'name',
      displayName: 'tamaño',
      addButton: $('#btnAddSizeForm'),
      onCreated: (row)=> loadSizes(row.id)
    });
  }

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

// -------- Listado --------
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
    showErrorToast('Error','No se pudo eliminar el producto');
    return;
  }

  await listProducts();
  showSuccessToast('OK','Producto eliminado (borrado lógico)');
}

// -------- Modal producto --------
function openProductModal(row){
  const form = $('#productForm');
  if (!form) return;

  form.reset();
  form.classList.remove('was-validated');

  $('#productId').value = row?.id || '';
  $('#productCode').value = row?.code || '';
  $('#productSku').value = row?.sku || '';
  $('#productDescription').value = row?.description || '';
  $('#productNotes').value = row?.notes || '';

  $('#productTypeSelect').value = row?.product_type_id || '';
  $('#productSubcategorySelect').value = row?.product_subcategory_id || '';
  $('#productBrandSelect').value = row?.brand_id || '';
  $('#productContainerSelect').value = row?.container_id || '';
  $('#productSizeSelect').value = row?.size_id || '';
  $('#productUnitSelect').value = row?.unit_id || '';

  $('#productIsActive').checked = (row?.is_active ?? true);

  resetKitComponentsTable();
  if (row?.id && (row.is_kit || row.dispatch_form === 'kit')){
    loadKitComponents(row.id);
  }

  // Ajustar visibilidad según envase
  onContainerChange();

  $('#productModalTitle').textContent = row ? 'Editar producto' : 'Nuevo producto';

  if (!modalProduct){
    const el = $('#productModal');
    if (el) modalProduct = new bootstrap.Modal(el, { focus:false });
  }
  modalProduct?.show();
}

// -------- Envase: controla kit / producto y campos --------
function onContainerChange(){
  const sel = $('#productContainerSelect');
  const section = $('#kitComponentsSection');
  const sizeUnitFields = $$('.size-unit-field');
  if (!sel){
    return;
  }

  const id = sel.value || '';

  if (!id){
    if (section) section.classList.add('d-none');
    sizeUnitFields.forEach(el=> el && el.classList.add('d-none'));
    return;
  }

  const meta = containersMeta[id];
  const isKit = meta?.is_kit === true;

  if (section){
    if (isKit) section.classList.remove('d-none');
    else section.classList.add('d-none');
  }

  sizeUnitFields.forEach(el=>{
    if (!el) return;
    if (isKit) el.classList.add('d-none');
    else el.classList.remove('d-none');
  });
}

// -------- Kit helpers --------
function resetKitComponentsTable(){
  const body = $('#kitComponentsBody');
  if (!body) return;
  body.innerHTML = `<tr class="text-muted">
    <td colspan="5" class="small text-center">Sin componentes</td>
  </tr>`;
}

function makeKitChip(label){
  const span = document.createElement('span');
  span.className = 'badge bg-light text-secondary border rounded-pill kit-chip';
  span.textContent = label;
  return span;
}

/**
 * Actualiza los chips visibles en una fila de kit
 */
function updateKitRowChips(tr){
  const chipList   = tr.querySelector('.kit-chip-list');
  const requiredSel= tr.querySelector('.kit-component-required');
  const fixedSel   = tr.querySelector('.kit-component-fixed');
  const altSel     = tr.querySelector('.kit-component-alt');
  if (!chipList || !requiredSel || !fixedSel || !altSel) return;

  chipList.innerHTML = '';

  const isOptional = requiredSel.value === 'optional';

  if (!isOptional){
    const opt = fixedSel.selectedOptions?.[0];
    if (opt && opt.value){
      chipList.appendChild(makeKitChip(opt.textContent));
    }
  } else {
    const selected = Array.from(altSel.selectedOptions || []);
    selected.forEach(o=>{
      if (o.value){
        chipList.appendChild(makeKitChip(o.textContent));
      }
    });
  }
}

/**
 * Carga productos activos por subcategoría y llena los selects de una fila de kit
 */
async function populateRowProductsForSubcat(tr, subcatId, opts = {}){
  const fixedSel = tr.querySelector('.kit-component-fixed');
  const altSel   = tr.querySelector('.kit-component-alt');
  if (!fixedSel || !altSel) return;

  fixedSel.innerHTML = '<option value="">Seleccionar producto...</option>';
  altSel.innerHTML   = '';
  altSel.size = 3;

  if (!subcatId){
    updateKitRowChips(tr);
    return;
  }

  try{
    const { data, error } = await sb
      .from('product')
      .select('id, code, description')
      .eq('product_subcategory_id', subcatId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('code');

    if (error){
      console.warn('populateRowProductsForSubcat error', error);
      return;
    }

    (data || []).forEach(p => {
      const label = `${p.code || ''} - ${p.description || ''}`.trim();

      // opción para producto fijo
      const opt1 = document.createElement('option');
      opt1.value = p.id;
      opt1.textContent = label;
      fixedSel.appendChild(opt1);

      // opción para productos alternativos
      const opt2 = document.createElement('option');
      opt2.value = p.id;
      opt2.textContent = label;
      altSel.appendChild(opt2);
    });

    // aplicar selección previa (si viene de BD)
    if (opts.fixedProductId){
      fixedSel.value = opts.fixedProductId;
    }

    if (Array.isArray(opts.altIds) && opts.altIds.length){
      const idsSet = new Set(opts.altIds.map(String));
      Array.from(altSel.options).forEach(o=>{
        if (idsSet.has(String(o.value))) o.selected = true;
      });
    }

    updateKitRowChips(tr);
  }catch(e){
    console.warn('populateRowProductsForSubcat ex', e);
  }
}

/**
 * Actualiza la visibilidad de selects según obligatorio/opcional
 */
function updateRowRequiredOptional(tr){
  const requiredSel = tr.querySelector('.kit-component-required');
  const fixedSel    = tr.querySelector('.kit-component-fixed');
  const altSel      = tr.querySelector('.kit-component-alt');
  if (!requiredSel || !fixedSel || !altSel) return;

  const isOptional = requiredSel.value === 'optional';
  if (isOptional){
    fixedSel.classList.add('d-none');
    altSel.classList.remove('d-none');
  } else {
    fixedSel.classList.remove('d-none');
    altSel.classList.add('d-none');
  }

  updateKitRowChips(tr);
}

function addKitComponentRow(componentSubcatId, qty, isOptional, fixedProductId, altIds){
  const body = $('#kitComponentsBody');
  if (!body) return;

  const emptyRow = body.querySelector('.text-muted');
  if (emptyRow) emptyRow.remove();

  const tr = document.createElement('tr');
  const optValue = isOptional ? 'optional' : 'required';

  tr.innerHTML = `
    <td>
      <select class="form-select form-select-sm kit-component-select">
        <option value="">Seleccionar sub categoría...</option>
      </select>
    </td>
    <td>
      <input type="number" class="form-control form-control-sm kit-component-qty" min="0" step="0.01" value="${qty ?? ''}">
    </td>
    <td>
      <select class="form-select form-select-sm kit-component-required">
        <option value="required">Obligatorio</option>
        <option value="optional">Opcional</option>
      </select>
    </td>
    <td>
      <select class="form-select form-select-sm kit-component-fixed mb-1">
        <option value="">Seleccionar producto...</option>
      </select>
      <select multiple class="form-select form-select-sm kit-component-alt d-none" size="3">
      </select>
      <div class="kit-chip-list mt-1 d-flex flex-wrap gap-1 small"></div>
    </td>
    <td class="text-end">
      <button type="button" class="btn btn-sm btn-outline-danger btn-remove-kit-component">
        <i class="bi bi-x-lg"></i>
      </button>
    </td>
  `;

  // llenar subcategorías
  const subcatSel = tr.querySelector('.kit-component-select');
  if (subcatSel){
    subcatSel.innerHTML = '<option value="">Seleccionar sub categoría...</option>';
    (productSubcategoryOptions || []).forEach(sc=>{
      const o = document.createElement('option');
      o.value = sc.id;
      o.textContent = sc.name;
      subcatSel.appendChild(o);
    });
    if (componentSubcatId) subcatSel.value = componentSubcatId;
  }

  const requiredSel = tr.querySelector('.kit-component-required');
  const fixedSel    = tr.querySelector('.kit-component-fixed');
  const altSel      = tr.querySelector('.kit-component-alt');

  if (requiredSel){
    requiredSel.value = optValue;
  }

  // listeners de fila
  subcatSel?.addEventListener('change', ()=>{
    const sid = subcatSel.value || '';
    populateRowProductsForSubcat(tr, sid, {});
  });

  requiredSel?.addEventListener('change', ()=>{
    updateRowRequiredOptional(tr);
  });

  fixedSel?.addEventListener('change', ()=>{
    updateKitRowChips(tr);
  });

  altSel?.addEventListener('change', ()=>{
    updateKitRowChips(tr);
  });

  tr.querySelector('.btn-remove-kit-component')?.addEventListener('click', ()=>{
    tr.remove();
    const hasRows = !!$('#kitComponentsBody tr');
    if (!hasRows){
      resetKitComponentsTable();
    }
  });

  body.appendChild(tr);

  // setear modo obligatorio/opcional inicial
  updateRowRequiredOptional(tr);

  // si ya viene con subcategoría y productos (modo edición), los cargamos
  if (componentSubcatId){
    const opts = {
      fixedProductId: fixedProductId || null,
      altIds: Array.isArray(altIds) ? altIds : (altIds ? altIds : [])
    };
    populateRowProductsForSubcat(tr, componentSubcatId, opts);
  }
}

async function loadKitComponents(kitId){
  if (!kitId) return;
  try{
    resetKitComponentsTable();
    const { data, error } = await sb
      .from('product_kit_map')
      .select('component_subcategory_id, quantity, is_optional, fixed_product_id, alternative_product_ids')
      .eq('kit_id', kitId);
    if (error){ console.warn('loadKitComponents err', error); return; }

    (data||[]).forEach(r=> {
      const altIds = Array.isArray(r.alternative_product_ids)
        ? r.alternative_product_ids
        : (r.alternative_product_ids || []);
      addKitComponentRow(
        r.component_subcategory_id,
        r.quantity,
        !!r.is_optional,
        r.fixed_product_id,
        altIds
      );
    });
  }catch(e){
    console.warn('loadKitComponents ex', e);
  }
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
  const sku  = $('#productSku').value.trim() || null;
  const description = $('#productDescription').value.trim();
  const notes = $('#productNotes').value.trim() || null;

  const product_type_id        = $('#productTypeSelect').value || null;
  const product_subcategory_id = $('#productSubcategorySelect').value || null;
  const brand_id               = $('#productBrandSelect').value || null;
  const container_id           = $('#productContainerSelect').value || null;
  const size_id                = $('#productSizeSelect').value || null;
  const unit_id                = $('#productUnitSelect').value || null;

  const is_active = $('#productIsActive').checked;

  const meta = container_id ? containersMeta[container_id] : null;
  const is_kit = meta?.is_kit === true;
  const dispatch_form = is_kit ? 'kit' : 'producto';

  const payload = {
    code,
    sku,
    description,
    notes,
    product_type_id,
    product_subcategory_id,
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
    showErrorToast('Error','No se pudo guardar el producto');
    return;
  }

  const okKit = await saveKitComponents(productId, is_kit);
  if (!okKit) return;

  modalProduct?.hide();
  await listProducts();
  showSuccessToast('OK','Producto guardado');
}

async function saveKitComponents(kitId, isKit){
  if (!kitId) return true;

  if (!isKit){
    try{
      await sb.from('product_kit_map').delete().eq('kit_id', kitId);
    }catch(e){ console.warn('saveKitComponents delete ex', e); }
    return true;
  }

  const rows = $$('#kitComponentsBody tr');
  const components = [];
  let hasError = false;
  let errorMsg = '';

  rows.forEach(tr=>{
    const subcatSel   = tr.querySelector('.kit-component-select');
    const qtyInput    = tr.querySelector('.kit-component-qty');
    const requiredSel = tr.querySelector('.kit-component-required');
    const fixedSel    = tr.querySelector('.kit-component-fixed');
    const altSel      = tr.querySelector('.kit-component-alt');

    if (!subcatSel || !qtyInput || !requiredSel || !fixedSel || !altSel) return;

    const subcatId = subcatSel.value;
    const qty = parseFloat(qtyInput.value);
    const is_optional = requiredSel.value === 'optional';

    if (!subcatId || !Number.isFinite(qty) || qty <= 0){
      hasError = true;
      errorMsg = 'Completá sub categoría y cantidad en todos los componentes del kit.';
      return;
    }

    if (!is_optional){
      // Obligatorio → debe tener un producto fijo
      const fixedId = fixedSel.value;
      if (!fixedId){
        hasError = true;
        errorMsg = 'Los componentes obligatorios deben tener un producto seleccionado.';
        return;
      }
      components.push({
        kit_id: kitId,
        component_subcategory_id: subcatId,
        quantity: qty,
        is_optional: false,
        fixed_product_id: fixedId,
        alternative_product_ids: null
      });
    } else {
      // Opcional → debe tener uno o más productos alternativos
      const altIds = Array.from(altSel.selectedOptions || []).map(o=>o.value).filter(Boolean);
      if (!altIds.length){
        hasError = true;
        errorMsg = 'Los componentes opcionales deben tener al menos un producto alternativo.';
        return;
      }
      components.push({
        kit_id: kitId,
        component_subcategory_id: subcatId,
        quantity: qty,
        is_optional: true,
        fixed_product_id: null,
        alternative_product_ids: altIds
      });
    }
  });

  if (hasError){
    await Swal.fire('Atención', errorMsg || 'Revisá los datos de los componentes del kit.', 'warning');
    return false;
  }

  if (!components.length){
    await Swal.fire('Atención','Un producto tipo kit debe tener al menos un componente válido','warning');
    return false;
  }

  try{
    await sb.from('product_kit_map').delete().eq('kit_id', kitId);
    const { error } = await sb.from('product_kit_map').insert(components);
    if (error){
      console.error('saveKitComponents insert error', error);
      await showErrorToast('Error','No se pudieron guardar los componentes del kit');
      return false;
    }
  }catch(e){
    console.error('saveKitComponents ex', e);
    await showErrorToast('Error','No se pudieron guardar los componentes del kit');
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
      showErrorToast('Error','No se pudo exportar la lista de productos');
      return;
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
    showErrorToast('Error','No se pudo exportar la lista de productos');
  }
}
