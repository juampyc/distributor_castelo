// js/stock.js
// Módulo de STOCK - Programa Distribuidora 2

// ======================================================
// HELPERS BÁSICOS
// ======================================================

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const esc = (value) => {
  if (value === null || value === undefined) return "";
  return String(value);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const debounce = (fn, delay = 300) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

const formatDate = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return esc(value);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

// Mostrar cantidades: enteros sin decimales, otros con hasta 3 decimales sin ceros basura
function formatQtyDisplay(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0";
  const rounded = Math.round(num);
  if (Math.abs(num - rounded) < 1e-6) {
    return String(rounded);
  }
  return num.toFixed(3).replace(/\.?0+$/, "");
}

// ---- Helpers específicos para labels de componentes de kit ----

function extractLabelField(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (typeof value.name === "string") return value.name;
    if (typeof value.label === "string") return value.label;
  }
  return null;
}

/**
 * Devuelve el texto que se mostrará como título del grupo de componente de kit.
 * Prioriza:
 *   0) Cualquier columna del registro que contenga 'subcat' / 'sub_cat' / 'subcategoria' (sin ser *_id)
 *   1) Nombre de subcategoría obtenido por ID (component_subcategory_id / subcategory_id / sub_category_id)
 *   2) Campos de texto tipo subcategory_name explícitos
 *   3) Label del primer producto candidato
 */
function getKitComponentGroupLabel(row, productOptionsForCp, subcategoryNameById) {
  row = row || {};
  subcategoryNameById = subcategoryNameById || {};

  // 0) Búsqueda dinámica de una columna de texto tipo subcategoría (sin depender del nombre exacto)
  try {
    const keys = Object.keys(row);
    for (const key of keys) {
      const lower = key.toLowerCase();
      if (
        (lower.includes("subcat") ||
          lower.includes("sub_cat") ||
          lower.includes("subcategoria")) &&
        !lower.endsWith("_id")
      ) {
        const val = extractLabelField(row[key]);
        if (val) return val;
      }
    }
  } catch (_) {
    // seguimos igual
  }

  // 1) Subcategoría por ID usando mapa (prioriza component_subcategory_id)
  const sid =
    row.component_subcategory_id ||
    row.subcategory_id ||
    row.sub_category_id;
  if (sid && subcategoryNameById[sid]) {
    return subcategoryNameById[sid];
  }

  // 2) Campos de texto explícitos (sin *_id)
  const preferredSubKeys = [
    "subcategory_name",
    "sub_category_name",
    "subcategory_label",
    "subcategory",
    "sub_category",
    "component_group",
    "component_group_label",
  ];

  for (const key of preferredSubKeys) {
    if (row[key] !== undefined && row[key] !== null) {
      const val = extractLabelField(row[key]);
      if (val) return val;
    }
  }

  // 3) Fallback: primer producto
  if (productOptionsForCp && productOptionsForCp.length) {
    return productOptionsForCp[0].label || "Componente de kit";
  }

  return "Componente de kit";
}

// ======================================================
// SWEETALERT2 - TOASTS
// ======================================================

const Toast = Swal.mixin({
  toast: true,
  position: "top",
  showConfirmButton: false,
  timerProgressBar: true,
  didOpen: (toast) => {
    toast.addEventListener("mouseenter", Swal.stopTimer);
    toast.addEventListener("mouseleave", Swal.resumeTimer);
  },
});

function showSuccessToast(message) {
  Toast.fire({
    icon: "success",
    title: message || "Operación exitosa",
    timer: 2000,
  });
}

function showErrorToast(message) {
  Toast.fire({
    icon: "error",
    title: message || "Ocurrió un error",
    timer: 3000,
  });
}

// ======================================================
// ESTADO GLOBAL
// ======================================================

const stockState = {
  page: 1,
  pageSize: 25,
  total: 0,
  search: "",
  filters: {
    brand: "",
    type: "",
    warehouse: "",
    productCode: "", // <-- nuevo filtro por código de producto (card clickeada)
  },
  loading: false,
};

let supabaseClient = null;
let allStockRows = [];
let lastFilteredRows = [];

// catálogos para modal / resumen
let productOptions = [];
let warehouseOptions = [];
let brandOptions = [];

// ======================================================
// INICIALIZACIÓN
// ======================================================

document.addEventListener("DOMContentLoaded", () => {
  try {
    supabaseClient = window.sb || window.supabase || null;
    if (!supabaseClient) {
      console.error("No se encontró el cliente de Supabase (sb).");
      showErrorToast("Error de configuración: Supabase no inicializado.");
      return;
    }

    initSidebarBindings();
    initStockPage();
  } catch (err) {
    console.error("Error al inicializar stock.js:", err);
    showErrorToast("Error al cargar la pantalla de stock.");
  }
});

function initSidebarBindings() {
  const sidebar = $(".app-sidebar");
  const backdrop = $("#sidebarBackdrop");
  const toggle = $("#sidebarToggle");
  const collapse = $("#sidebarCollapse");

  if (toggle && sidebar && backdrop) {
    toggle.addEventListener("click", () => {
      sidebar.classList.add("open");
      backdrop.classList.add("show");
    });
  }

  if (backdrop && sidebar) {
    backdrop.addEventListener("click", () => {
      sidebar.classList.remove("open");
      backdrop.classList.remove("show");
    });
  }

  if (collapse && sidebar) {
    collapse.addEventListener("click", () => {
      sidebar.classList.toggle("collapsed");
    });
  }
}

async function initStockPage() {
  bindToolbarEvents();
  bindTableEvents();
  bindModalEvents();

  await loadBrandsForSummary();
  await loadProductsForModal();
  await loadWarehousesForModal();
  await reloadStockData();
}

// ======================================================
// BINDINGS UI
// ======================================================

function bindToolbarEvents() {
  const searchInput = $("#searchInput");
  const filterBrand = $("#filterBrand");
  const filterType = $("#filterType");
  const filterWarehouse = $("#filterWarehouse");
  const btnNewStock = $("#btnNewStock");
  const btnRefreshStock = $("#btnRefreshStock");
  const btnExportCsv = $("#btnExportCsv");
  const btnExportXlsx = $("#btnExportXlsx");
  const btnPrev = $("#paginationPrev");
  const btnNext = $("#paginationNext");
  const pageSizeSelect = $("#pageSizeStock");

  if (searchInput) {
    searchInput.addEventListener(
      "input",
      debounce((e) => {
        stockState.search = e.target.value || "";
        stockState.page = 1;
        applyFiltersAndRender();
      }, 250)
    );
  }

  if (filterBrand) {
    filterBrand.addEventListener("change", (e) => {
      stockState.filters.brand = e.target.value || "";
      stockState.page = 1;
      applyFiltersAndRender();
    });
  }

  if (filterType) {
    filterType.addEventListener("change", (e) => {
      stockState.filters.type = e.target.value || "";
      stockState.page = 1;
      applyFiltersAndRender();
    });
  }

  if (filterWarehouse) {
    filterWarehouse.addEventListener("change", (e) => {
      stockState.filters.warehouse = e.target.value || "";
      stockState.page = 1;
      applyFiltersAndRender();
    });
  }

  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", (e) => {
      const value = parseInt(e.target.value, 10);
      stockState.pageSize = Number.isFinite(value) ? value : 25;
      stockState.page = 1;
      applyFiltersAndRender();
    });
  }

  if (btnNewStock) {
    btnNewStock.addEventListener("click", () => openStockModal(null));
  }

  if (btnRefreshStock) {
    btnRefreshStock.addEventListener("click", () => reloadStockData());
  }

  if (btnExportCsv) {
    btnExportCsv.addEventListener("click", () => exportStockCsv());
  }

  if (btnExportXlsx) {
    btnExportXlsx.addEventListener("click", () => exportStockXlsx());
  }

  if (btnPrev) {
    btnPrev.addEventListener("click", () => {
      if (stockState.page > 1) {
        stockState.page -= 1;
        applyFiltersAndRender();
      }
    });
  }

  if (btnNext) {
    btnNext.addEventListener("click", () => {
      const totalPages = Math.max(
        1,
        Math.ceil(stockState.total / stockState.pageSize)
      );
      if (stockState.page < totalPages) {
        stockState.page += 1;
        applyFiltersAndRender();
      }
    });
  }
}

function bindTableEvents() {
  const tbody = $("#stockTableBody");
  if (!tbody) return;

  tbody.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;

    const action = btn.getAttribute("data-action");
    const id = btn.getAttribute("data-id");
    if (!id) return;

    const row = allStockRows.find((r) => String(r.id) === String(id));
    if (!row) return;

    if (action === "edit") {
      openStockModal(row);
    } else if (action === "delete") {
      confirmDeleteStock(row);
    }
  });
}

function bindModalEvents() {
  const form = $("#stockForm");
  const btnAddWarehouse = $("#btnAddWarehouse");

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (!form.checkValidity()) {
        form.classList.add("was-validated");
        return;
      }

      await saveStock();
    });
  }

  if (btnAddWarehouse) {
    btnAddWarehouse.addEventListener("click", handleAddWarehouse);
  }
}

// ======================================================
// CARGA DE DATOS (Supabase)
// ======================================================

async function reloadStockData() {
  stockState.loading = true;
  updateLoadingState(true);

  try {
    const { data, error } = await supabaseClient
      .from("vw_stock_current")
      .select("*")
      .order("product_name", { ascending: true });

    if (error) {
      console.error("Error al listar stock:", error);
      showErrorToast("No se pudo obtener el stock.");
      return;
    }

    allStockRows = (data || []).filter((row) => {
      const qty = Number(row.quantity || 0);
      const res = Number(row.reserved || 0);
      const avail = row.available !== undefined && row.available !== null ? Number(row.available || 0) : (qty - res);
      return qty > 0 && avail > 0;
    });
    buildFiltersFromData();
    stockState.page = 1;
    applyFiltersAndRender();
    showSuccessToast("Stock actualizado.");
  } catch (err) {
    console.error("Error inesperado al cargar stock:", err);
    showErrorToast("Error inesperado al cargar stock.");
  } finally {
    stockState.loading = false;
    updateLoadingState(false);
  }
}

function updateLoadingState(isLoading) {
  const tableBody = $("#stockTableBody");
  const summaryText = $("#stockSummaryText");

  if (isLoading) {
    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center py-3">
            <div class="spinner-border spinner-border-sm me-2" role="status"></div>
            Cargando stock...
          </td>
        </tr>
      `;
    }
    if (summaryText) summaryText.textContent = "Cargando...";
  }
}

function buildFiltersFromData() {
  const brandSelect = $("#filterBrand");
  const typeSelect = $("#filterType");
  const warehouseSelect = $("#filterWarehouse");

  const brands = new Set();
  const types = new Set();
  const warehouses = new Set();

  allStockRows.forEach((row) => {
    if (row.brand_name) brands.add(row.brand_name);
    if (row.type_name) types.add(row.type_name);
    if (row.warehouse_name) warehouses.add(row.warehouse_name);
  });

  if (brandSelect) {
    const current = stockState.filters.brand || "";
    brandSelect.innerHTML = `<option value="">Todas las marcas</option>`;
    Array.from(brands)
      .sort((a, b) => a.localeCompare(b))
      .forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        brandSelect.appendChild(opt);
      });
    brandSelect.value = current;
  }

  if (typeSelect) {
    const current = stockState.filters.type || "";
    typeSelect.innerHTML = `<option value="">Todos los tipos</option>`;
    Array.from(types)
      .sort((a, b) => a.localeCompare(b))
      .forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        typeSelect.appendChild(opt);
      });
    typeSelect.value = current;
  }

  if (warehouseSelect) {
    const current = stockState.filters.warehouse || "";
    warehouseSelect.innerHTML = `<option value="">Todos los depósitos</option>`;
    Array.from(warehouses)
      .sort((a, b) => a.localeCompare(b))
      .forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        warehouseSelect.appendChild(opt);
      });
    warehouseSelect.value = current;
  }
}

// ======================================================
// FILTROS + PAGINACIÓN
// ======================================================

function applyFiltersAndRender() {
  const search = stockState.search.trim().toLowerCase();
  const { brand, type, warehouse, productCode } = stockState.filters;

  let filtered = allStockRows.slice();

  if (search) {
    filtered = filtered.filter((row) => {
      const haystack = [
        row.product_name,
        row.brand_name,
        row.type_name,
        row.product_sku,
        row.warehouse_name,
        row.warehouse_code,
        row.lot,
      ]
        .map((v) => (v ? String(v).toLowerCase() : ""))
        .join(" ");
      return haystack.includes(search);
    });
  }

  if (brand) {
    filtered = filtered.filter((row) => row.brand_name === brand);
  }

  if (type) {
    filtered = filtered.filter((row) => row.type_name === type);
  }

  if (warehouse) {
    filtered = filtered.filter((row) => row.warehouse_name === warehouse);
  }

  if (productCode) {
    filtered = filtered.filter((row) => row.product_sku === productCode);
  }

  lastFilteredRows = filtered;
  stockState.total = filtered.length;

  const totalPages = Math.max(1, Math.ceil(stockState.total / stockState.pageSize));
  if (stockState.page > totalPages) {
    stockState.page = totalPages;
  }

  const startIndex = (stockState.page - 1) * stockState.pageSize;
  const endIndex = startIndex + stockState.pageSize;
  const pageRows = filtered.slice(startIndex, endIndex);

  renderBrandProductSummaryCards();
  renderStockTable(pageRows);
  updatePaginationInfo(filtered.length, stockState.page, stockState.pageSize);
}

// ======================================================
// CATÁLOGOS: MARCAS / PRODUCTOS / DEPÓSITOS
// ======================================================

async function loadBrandsForSummary() {
  try {
    const { data, error } = await supabaseClient
      .from("brand")
      .select("id, name")
      .order("name", { ascending: true });

    if (error) {
      console.warn("No se pudo cargar brand:", error);
      brandOptions = [];
      return;
    }
    brandOptions = data || [];
  } catch (err) {
    console.error("Error inesperado al cargar brand:", err);
    brandOptions = [];
  }
}

function getBrandNameFromId(brandId) {
  if (!brandId) return "Sin marca";
  const found = brandOptions.find((b) => b.id === brandId);
  return found?.name || "Sin marca";
}

async function loadProductsForModal() {
  try {
    const { data, error } = await supabaseClient
      .from("product")
      .select(
        "id, code, description, brand_id, is_active, deleted_at, is_kit, dispatch_form"
      )
      .order("description", { ascending: true });

    if (error) {
      console.error("Error al cargar productos:", error);
      showErrorToast("No se pudieron cargar los productos.");
      return;
    }

    productOptions = data || [];

    const activeProducts = productOptions.filter(
      (p) => p.is_active && !p.deleted_at
    );

    const select = $("#stockProduct");
    if (select) {
      select.innerHTML = `<option value="">Seleccionar producto...</option>`;
      activeProducts.forEach((p) => {
        const labelParts = [];
        if (p.description) labelParts.push(p.description);
        if (p.code) labelParts.push(`(${p.code})`);
        const label = labelParts.join(" ");
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = label;
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.error("Error inesperado al cargar productos:", err);
    showErrorToast("Error inesperado al cargar productos.");
  }
}

async function loadWarehousesForModal() {
  try {
    const { data, error } = await supabaseClient
      .from("warehouses")
      .select("id, name, code, is_active, deleted_at")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      console.error("Error al cargar depósitos:", error);
      showErrorToast("No se pudieron cargar los depósitos.");
      return;
    }

    warehouseOptions = data || [];
    const select = $("#stockWarehouse");
    if (select) {
      select.innerHTML = `<option value="">Seleccionar depósito...</option>`;
      warehouseOptions.forEach((w) => {
        const labelParts = [w.name];
        if (w.code) labelParts.push(w.code);
        const label = labelParts.join(" · ");
        const opt = document.createElement("option");
        opt.value = w.id;
        opt.textContent = label;
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.error("Error inesperado al cargar depósitos:", err);
    showErrorToast("Error inesperado al cargar depósitos.");
  }
}

function getProductById(id) {
  if (!id || !productOptions) return null;
  return productOptions.find((p) => String(p.id) === String(id)) || null;
}

function isKitProduct(productId) {
  const p = getProductById(productId);
  return !!(p && (p.is_kit || p.dispatch_form === "kit"));
}

// ======================================================
// RESUMEN CARDS
// ======================================================

function renderBrandProductSummaryCards() {
  const container = $("#stockSummaryCards");
  if (!container) return;

  if (!productOptions || productOptions.length === 0) {
    container.innerHTML = `
      <div class="col-12">
        <div class="small text-muted">Sin productos cargados para mostrar resumen.</div>
      </div>
    `;
    return;
  }

  const stockMap = new Map();

  allStockRows.forEach((row) => {
    const pid = row.product_id;
    if (!pid) return;

    const qty = Number(row.quantity || 0);
    const res = Number(row.reserved || 0);
    const avail = Number(
      row.available !== undefined && row.available !== null
        ? row.available
        : qty - res
    );

    if (!stockMap.has(pid)) {
      stockMap.set(pid, { available: 0, lotes: 0 });
    }
    const agg = stockMap.get(pid);
    agg.available += avail;
    agg.lotes += 1;
  });

  const activeProducts = productOptions.filter(
    (p) => p.is_active && !p.deleted_at
  );

  if (activeProducts.length === 0) {
    container.innerHTML = `
      <div class="col-12">
        <div class="small text-muted">Sin productos activos para mostrar resumen.</div>
      </div>
    `;
    return;
  }

  const byCodeMap = new Map();

  activeProducts.forEach((p) => {
    const codeKey = p.code || `id-${p.id}`;
    const productStock = stockMap.get(p.id) || { available: 0, lotes: 0 };
    const brandName = getBrandNameFromId(p.brand_id);
    const productName = p.description || p.code || "Sin descripción";

    if (!byCodeMap.has(codeKey)) {
      byCodeMap.set(codeKey, {
        productCode: p.code || null,
        brandName,
        productName,
        available: 0,
        lotes: 0,
      });
    }

    const entry = byCodeMap.get(codeKey);
    entry.available += productStock.available;
    entry.lotes += productStock.lotes;
  });

  const summary = Array.from(byCodeMap.values()).sort((a, b) => {
    const byBrand = a.brandName.localeCompare(b.brandName);
    if (byBrand !== 0) return byBrand;
    return a.productName.localeCompare(b.productName);
  });

  if (summary.length === 0) {
    container.innerHTML = `
      <div class="col-12">
        <div class="small text-muted">Sin productos activos para mostrar resumen.</div>
      </div>
    `;
    return;
  }

  const selectedCode = stockState.filters.productCode || "";

  const html = summary
    .map((item) => {
      const isSelected =
        selectedCode && item.productCode && item.productCode === selectedCode;

      const cardExtraClasses = isSelected ? "border-primary bg-light" : "";
      const productCodeAttr = item.productCode ? ` data-product-code="${esc(item.productCode)}"` : "";

      return `
        <div class="col-6 col-md-4 col-lg-3">
          <div class="card h-100 shadow-sm border stock-summary-card ${cardExtraClasses}"${productCodeAttr} style="cursor: pointer;">
            <div class="card-body py-2 px-3">
              <div class="small text-muted mb-1 text-truncate" title="${esc(
                item.brandName
              )}">
                ${esc(item.brandName)}
              </div>
              <div class="fw-semibold text-truncate" title="${esc(
                item.productName
              )}">
                ${esc(item.productName)}
              </div>
              <div class="mt-1 d-flex justify-content-between align-items-baseline">
                <span class="small text-muted">Stock total</span>
                <span class="fw-semibold">${formatQtyDisplay(
                  item.available
                )}</span>
              </div>
              <div class="small text-muted mt-1">
                ${item.lotes} lote${item.lotes !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  container.innerHTML = html;

  // Bind de click en cards para filtrar por producto (código)
  const searchInput = $("#searchInput");

  $$(".stock-summary-card", container).forEach((card) => {
    const code = card.getAttribute("data-product-code");
    if (!code) return;

    card.addEventListener("click", () => {
      // Toggle: si hago click en la misma card, limpio el filtro
      if (stockState.filters.productCode === code) {
        stockState.filters.productCode = "";
      } else {
        stockState.filters.productCode = code;
      }

      // Limpio el buscador para que no interfiera
      stockState.search = "";
      if (searchInput) searchInput.value = "";

      stockState.page = 1;
      applyFiltersAndRender();
    });
  });
}

// ======================================================
// TABLA + PAGINACIÓN
// ======================================================

function renderStockTable(rows) {
  const tbody = $("#stockTableBody");
  if (!tbody) return;

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-3 text-muted">
          No hay lotes de stock para los filtros seleccionados.
        </td>
      </tr>
    `;
    return;
  }

  const html = rows
    .map((row) => {
      const qty = Number(row.quantity || 0);
      const res = Number(row.reserved || 0);
      const avail = Number(
        row.available !== undefined && row.available !== null
          ? row.available
          : qty - res
      );

      const lotInfo = row.lot ? `Lote: ${esc(row.lot)}` : "";
      const expInfo = row.expiration_date ? `Vence: ${formatDate(row.expiration_date)}` : "";
      const extraInfo =
        lotInfo || expInfo
          ? `<div class="small text-muted">${[lotInfo, expInfo].filter(Boolean).join(" · ")}</div>`
          : "";

      return `
        <tr>
          <td>
            <div class="fw-semibold">${esc(row.product_name)}</div>
            ${
              row.product_sku
                ? `<div class="small text-muted">Código: ${esc(row.product_sku)}</div>`
                : ""
            }
            ${extraInfo}
          </td>
          <td>${esc(row.brand_name)}</td>
          <td>${esc(row.type_name)}</td>
          <td>
            <div>${esc(row.warehouse_name)}</div>
            ${
              row.warehouse_code
                ? `<div class="small text-muted">${esc(row.warehouse_code)}</div>`
                : ""
            }
          </td>
          <td class="text-end">${formatQtyDisplay(qty)}</td>
          <td class="text-end">${formatQtyDisplay(res)}</td>
          <td class="text-end">${formatQtyDisplay(avail)}</td>
          <td class="text-end text-nowrap">
            <div class="btn-group btn-group-sm" role="group">
              <button
                type="button"
                class="btn btn-outline-primary"
                data-action="edit"
                data-id="${row.id}"
                title="Editar"
              >
                <i class="bi bi-pencil"></i>
              </button>
              <button
                type="button"
                class="btn btn-outline-danger"
                data-action="delete"
                data-id="${row.id}"
                title="Eliminar"
              >
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.innerHTML = html;
}

function updatePaginationInfo(totalFiltered, page, pageSize) {
  const info = $("#paginationInfo");
  const summaryText = $("#stockSummaryText");
  const btnPrev = $("#paginationPrev");
  const btnNext = $("#paginationNext");
  const pageIndicator = $("#stockPageIndicator");

  const total = totalFiltered;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  if (info) {
    info.textContent = total
      ? `Mostrando ${from}–${to} de ${total} lote${total !== 1 ? "s" : ""}`
      : "Sin lotes para los filtros";
  }

  if (summaryText) {
    summaryText.textContent = `Total de lotes en stock: ${allStockRows.length}`;
  }

  if (btnPrev) btnPrev.disabled = page <= 1;
  if (btnNext) btnNext.disabled = page >= totalPages;
  if (pageIndicator) pageIndicator.textContent = page;
}

// ======================================================
// MODAL STOCK
// ======================================================

let stockModalInstance = null;

function getStockModalInstance() {
  if (!stockModalInstance) {
    const modalEl = $("#stockModal");
    if (modalEl) {
      stockModalInstance = new bootstrap.Modal(modalEl);
    }
  }
  return stockModalInstance;
}

function resetStockForm() {
  const form = $("#stockForm");
  if (!form) return;
  form.reset();
  form.classList.remove("was-validated");

  const idInput = $("#stockId");
  if (idInput) idInput.value = "";
}

function openStockModal(row) {
  resetStockForm();

  const titleEl = $("#stockModalLabel");
  const productSelect = $("#stockProduct");
  const warehouseSelect = $("#stockWarehouse");
  const quantityInput = $("#stockQuantity");
  const lotInput = $("#stockLot");
  const expInput = $("#stockExpiration");
  const idInput = $("#stockId");

  if (row) {
    if (titleEl) titleEl.textContent = "Editar stock";

    if (idInput) idInput.value = row.id;
    if (productSelect) productSelect.value = row.product_id || "";
    if (warehouseSelect) warehouseSelect.value = row.warehouse_id || "";

    const qty = Number(row.quantity || 0);
    if (quantityInput) quantityInput.value = qty;
    if (lotInput) lotInput.value = row.lot || "";
    if (expInput) {
      expInput.value = row.expiration_date
        ? String(row.expiration_date).slice(0, 10)
        : "";
    }
  } else {
    if (titleEl) titleEl.textContent = "Nuevo stock";
  }

  const modal = getStockModalInstance();
  if (modal) modal.show();
}

// ======================================================
// AUXILIAR: cargar nombres de subcategorías de los componentes de un kit
// ======================================================

async function loadKitSubcategoryNames(kitRows) {
  const ids = new Set();
  kitRows.forEach((r) => {
    if (r.component_subcategory_id) ids.add(r.component_subcategory_id);
    if (r.subcategory_id) ids.add(r.subcategory_id);
    if (r.sub_category_id) ids.add(r.sub_category_id);
  });

  if (!ids.size) return {};

  const idArray = Array.from(ids);

  try {
    const { data, error } = await supabaseClient
      .from("product_subcategory")
      .select("id, name")
      .in("id", idArray);

    if (error) {
      console.warn(
        "No se pudieron cargar nombres de subcategorías para componentes de kit:",
        error
      );
      return {};
    }

    const map = {};
    (data || []).forEach((row) => {
      map[row.id] = row.name;
    });
    return map;
  } catch (err) {
    console.error(
      "Error inesperado al cargar nombres de subcategorías para kit:",
      err
    );
    return {};
  }
}

// ======================================================
// KITS: ARMADO Y CONSUMO DE COMPONENTES
// ======================================================

async function buildKitConsumptionPlan(kitProductId, warehouseId, kitQty) {
  if (!warehouseId) {
    showErrorToast("Seleccioná un depósito para el kit.");
    return null;
  }
  if (!Number.isFinite(kitQty) || kitQty <= 0) {
    showErrorToast("Ingresá una cantidad válida de kits.");
    return null;
  }

  let kitRows = [];

  try {
    const { data, error } = await supabaseClient
      .from("product_kit_map")
      .select("*")
      .eq("kit_id", kitProductId);

    if (error) {
      console.error("Error al obtener componentes del kit:", error);
      showErrorToast(
        error.message || "No se pudieron obtener los componentes del kit."
      );
      return null;
    }

    kitRows = data || [];
  } catch (error) {
    console.error("Error inesperado al obtener componentes del kit:", error);
    showErrorToast(
      error.message || "No se pudieron obtener los componentes del kit."
    );
    return null;
  }

  if (!kitRows || kitRows.length === 0) {
    await Swal.fire(
      "Sin componentes",
      "Este producto tipo kit no tiene componentes configurados.\nDefinilos en el módulo de productos para poder descontar stock automáticamente.",
      "info"
    );
    return null;
  }

  const subcategoryNameById = await loadKitSubcategoryNames(kitRows);

  const componentPlans = [];

  for (const row of kitRows) {
    const qtyPerKit = Number(row.quantity || 0);
    if (!qtyPerKit) continue;

    const neededTotal = qtyPerKit * kitQty;
    if (neededTotal <= 0) continue;

    const candidateIdsSet = new Set();

    if (row.fixed_product_id) candidateIdsSet.add(row.fixed_product_id);
    if (row.component_product_id) candidateIdsSet.add(row.component_product_id);
    if (row.component_id) candidateIdsSet.add(row.component_id);
    if (row.component_product) candidateIdsSet.add(row.component_product);
    if (row.component) candidateIdsSet.add(row.component);

    if (Array.isArray(row.alternative_product_ids)) {
      row.alternative_product_ids.forEach((pid) => {
        if (pid) candidateIdsSet.add(pid);
      });
    }
    if (Array.isArray(row.alternatives)) {
      row.alternatives.forEach((pid) => {
        if (pid) candidateIdsSet.add(pid);
      });
    }

    const productIds = Array.from(candidateIdsSet);
    if (!productIds.length) continue;

    const { data: lots, error: stockError } = await supabaseClient
      .from("vw_stock_current")
      .select(
        "id, product_id, quantity, reserved, available, lot, expiration_date, warehouse_id, warehouse_name, warehouse_code"
      )
      .in("product_id", productIds)
      .gt("available", 0)
      .order("warehouse_name", { ascending: true })
      .order("expiration_date", { ascending: true });

    if (stockError) {
      console.error("Error al obtener lotes de componente:", stockError);
      showErrorToast(
        stockError.message ||
          "No se pudieron leer los lotes de los componentes del kit."
      );
      return null;
    }

    const lotsByProductId = {};
    (lots || []).forEach((lotRow) => {
      const pid = lotRow.product_id;
      if (!pid) return;
      if (!lotsByProductId[pid]) lotsByProductId[pid] = [];

      const qty = Number(lotRow.quantity || 0);
      const res = Number(lotRow.reserved || 0);
      const avail =
        lotRow.available !== undefined && lotRow.available !== null
          ? Number(lotRow.available || 0)
          : qty - res;

      lotsByProductId[pid].push({
        stockBalanceId: lotRow.id,
        quantity: qty,
        reserved: res,
        available: avail,
        lot: lotRow.lot,
        expiration_date: lotRow.expiration_date,
        warehouse_id: lotRow.warehouse_id,
        warehouse_name: lotRow.warehouse_name,
        warehouse_code: lotRow.warehouse_code,
      });
    });

    const productOptionsForCp = productIds.map((pid) => {
      const p = getProductById(pid);
      const label =
        (p
          ? `${p.code || ""} - ${p.description || ""}`.trim()
          : `Producto ${pid}`) || `Producto ${pid}`;
      return { id: pid, label };
    });

    let groupLabel = getKitComponentGroupLabel(
      row,
      productOptionsForCp,
      subcategoryNameById
    );

    if (row.is_optional) {
      groupLabel += " [opcional]";
    }

    const integerSlots = Math.max(1, Math.round(qtyPerKit));
    const unitQty = kitQty; // cada "item" consume kitQty unidades

    componentPlans.push({
      groupLabel,
      qtyPerKit,
      kitQty,
      neededTotal,
      integerSlots,
      unitQty,
      isOptional: !!row.is_optional,
      productOptions: productOptionsForCp,
      lotsByProductId,
    });
  }

  if (!componentPlans.length) {
    await Swal.fire(
      "Sin componentes válidos",
      "El kit no tiene componentes con cantidad configurada.",
      "info"
    );
    return null;
  }

  const html = componentPlans
    .map((cp, cpIndex) => {
      let slotsHtml = "";

      for (let i = 0; i < cp.integerSlots; i++) {
        const baseId = `kit-comp-${cpIndex}-slot-${i}`;

        const productOptionsHtml = cp.productOptions
          .map(
            (po) =>
              `<option value="${po.id}">${esc(po.label)}</option>`
          )
          .join("");

        slotsHtml += `
          <div class="border rounded-3 p-2 mb-2">
            <div class="small text-muted mb-1">
              Item ${i + 1} de ${cp.integerSlots} · Cantidad a consumir en este item: ${formatQtyDisplay(
                cp.unitQty
              )}
            </div>
            <div class="row g-2 align-items-end">
              <div class="col-12 col-md-6">
                <label class="form-label form-label-sm">Producto</label>
                <select id="${baseId}-product" class="form-select form-select-sm">
                  ${productOptionsHtml}
                </select>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label form-label-sm">Lote</label>
                <select id="${baseId}-lot" class="form-select form-select-sm"></select>
              </div>
            </div>
            <div class="small text-muted mt-1" id="${baseId}-help"></div>
          </div>
        `;
      }

      return `
        <div class="mb-3 text-start">
          <div class="fw-semibold small">${esc(cp.groupLabel)}</div>
          <div class="small text-muted mb-2">
            Necesario total: ${formatQtyDisplay(
              cp.neededTotal
            )} (${formatQtyDisplay(cp.unitQty)} por item × ${
        cp.integerSlots
      } items)
          </div>
          ${slotsHtml}
        </div>
      `;
    })
    .join("");

  const result = await Swal.fire({
    title: "Componentes del kit",
    html,
    width: "60rem",
    focusConfirm: false,
    icon: "question",
    confirmButtonText: "Confirmar",
    cancelButtonText: "Cancelar",
    showCancelButton: true,
    didOpen: (modalEl) => {
      componentPlans.forEach((cp, cpIndex) => {
        for (let i = 0; i < cp.integerSlots; i++) {
          const baseId = `kit-comp-${cpIndex}-slot-${i}`;
          const productSelect = modalEl.querySelector(
            `#${baseId}-product`
          );
          const lotSelect = modalEl.querySelector(`#${baseId}-lot`);
          const help = modalEl.querySelector(`#${baseId}-help`);

          if (!productSelect || !lotSelect) continue;

          const updateLots = () => {
            const pid = productSelect.value;
            const lots = cp.lotsByProductId[pid] || [];

            if (!lots.length) {
              lotSelect.innerHTML = `<option value="">Sin lotes disponibles</option>`;
              if (help) {
                help.textContent =
                  "No hay lotes disponibles para este producto. Cargá stock primero.";
              }
              return;
            }

            if (help) help.textContent = "";
            lotSelect.innerHTML = lots
              .map((lotRow) => {
                const depLabel = [
                  lotRow.warehouse_name || "Depósito sin nombre",
                  lotRow.warehouse_code ? `(${lotRow.warehouse_code})` : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                const parts = [
                  depLabel,
                  lotRow.lot
                    ? `Lote ${esc(lotRow.lot)}`
                    : "Lote sin identificar",
                  `Disp ${formatQtyDisplay(lotRow.available)}`,
                ];
                if (lotRow.expiration_date) {
                  parts.push(`Vence ${formatDate(lotRow.expiration_date)}`);
                }

                return `<option value="${lotRow.stockBalanceId}">${parts
                  .filter(Boolean)
                  .join(" · ")}</option>`;
              })
              .join("");
          };

          productSelect.addEventListener("change", updateLots);
          updateLots();
        }
      });
    },
    preConfirm: () => {
      const aggregateByLot = {};

      for (let cpIndex = 0; cpIndex < componentPlans.length; cpIndex++) {
        const cp = componentPlans[cpIndex];

        for (let i = 0; i < cp.integerSlots; i++) {
          const baseId = `kit-comp-${cpIndex}-slot-${i}`;
          const productSel = document.getElementById(`${baseId}-product`);
          const lotSel = document.getElementById(`${baseId}-lot`);

          if (!productSel || !lotSel) {
            Swal.showValidationMessage(
              "Falta la selección de producto y lote para uno de los componentes."
            );
            return;
          }

          const pid = productSel.value;
          const lotId = lotSel.value;

          if (!pid || !lotId) {
            Swal.showValidationMessage(
              "Seleccioná producto y lote para cada item de componente."
            );
            return;
          }

          const lots = cp.lotsByProductId[pid] || [];
          const lotInfo = lots.find(
            (lotRow) =>
              String(lotRow.stockBalanceId) === String(lotId)
          );
          if (!lotInfo) {
            Swal.showValidationMessage(
              "Lote inválido seleccionado para uno de los componentes."
            );
            return;
          }

          const key = String(lotInfo.stockBalanceId);
          if (!aggregateByLot[key]) {
            aggregateByLot[key] = {
              stockBalanceId: lotInfo.stockBalanceId,
              compProductId: pid,
              productLabel: cp.groupLabel,
              warehouse_id: lotInfo.warehouse_id,
              lot: lotInfo.lot,
              neededQty: 0,
              available: lotInfo.available,
              quantity: lotInfo.quantity,
              reserved: lotInfo.reserved,
            };
          }

          aggregateByLot[key].neededQty += cp.unitQty;
        }
      }

      // Validamos que ningún lote quede negativo
      for (const key of Object.keys(aggregateByLot)) {
        const entry = aggregateByLot[key];
        if (entry.neededQty > entry.available + 1e-9) {
          Swal.showValidationMessage(
            `El lote seleccionado no tiene stock suficiente para el componente: ${entry.productLabel}`
          );
          return;
        }
      }

      return Object.values(aggregateByLot);
    },
  });

  if (!result.isConfirmed) return null;
  return result.value || null;
}

// ======================================================
// MOVIMIENTOS DE STOCK
// ======================================================

async function insertStockMovement(mov) {
  try {
    const { error } = await supabaseClient.from("stock_movements").insert({
      stock_balance_id: mov.stock_balance_id,
      product_id: mov.product_id,
      warehouse_id: mov.warehouse_id,
      lot: mov.lot || null,
      movement_type: mov.movement_type,
      quantity: mov.quantity,
      related_kit_product_id: mov.related_kit_product_id || null,
      reference: mov.reference || null,
      movement_date: mov.movement_date || new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.warn("No se pudo registrar movimiento de stock:", error);
    }
  } catch (err) {
    console.warn("Error inesperado al registrar movimiento de stock:", err);
  }
}

// ======================================================
// GUARDAR STOCK (incluye kits)
// ======================================================

async function saveStock() {
  const idInput = $("#stockId");
  const productSelect = $("#stockProduct");
  const warehouseSelect = $("#stockWarehouse");
  const quantityInput = $("#stockQuantity");
  const lotInput = $("#stockLot");
  const expInput = $("#stockExpiration");

  if (!productSelect || !warehouseSelect || !quantityInput) {
    showErrorToast("Error de formulario.");
    return;
  }

  const id = idInput?.value || null;
  const productId = productSelect.value;
  const warehouseId = warehouseSelect.value;
  const quantity = parseFloat(quantityInput.value || "0") || 0;
  const lot = lotInput?.value.trim() || null;
  const expirationDate = expInput?.value || null;

  if (!productId || !warehouseId) {
    showErrorToast("Completá producto y depósito.");
    return;
  }

  const reserved = 0;
  const isKit = isKitProduct(productId);
  const idNum = id ? Number(id) : null;

  if (id && isKit) {
    await Swal.fire(
      "Atención",
      "Por ahora no se puede editar un lote de un producto tipo kit.\nEliminá el lote y cargalo nuevamente si necesitás corregirlo.",
      "warning"
    );
    return;
  }

  let kitPlan = null;
  if (!id && isKit) {
    kitPlan = await buildKitConsumptionPlan(productId, warehouseId, quantity);
    if (!kitPlan) return;
  }

  const nowIso = new Date().toISOString();

  try {
    // 1) Consumimos componentes del kit (si aplica)
    if (kitPlan && kitPlan.length) {
      for (const cp of kitPlan) {
        const newQtyRaw = cp.quantity - cp.neededQty;
        const newQty = newQtyRaw > 0 ? newQtyRaw : 0;

        const updateData = {
          quantity: newQty,
          updated_at: nowIso,
        };

        // Si el lote queda en cero o menos, lo "sacamos" del stock (soft delete)
        if (newQty <= 0) {
          updateData.is_active = false;
          updateData.deleted_at = nowIso;
        }

        const { error: updError } = await supabaseClient
          .from("stock_balances")
          .update(updateData)
          .eq("id", cp.stockBalanceId);

        if (updError) {
          console.error("Error al descontar componente de kit:", updError);
          showErrorToast(
            updError.message ||
              "No se pudo descontar el stock de los componentes del kit."
          );
          return;
        }

        // Movimiento de salida por armado de kit
        await insertStockMovement({
          stock_balance_id: cp.stockBalanceId,
          product_id: cp.compProductId,
          warehouse_id: cp.warehouse_id,
          lot: cp.lot,
          movement_type: "OUT_KIT",
          quantity: cp.neededQty,
          related_kit_product_id: productId,
          reference: "Consumo al armar kit",
        });
      }
    }

    // 2) Guardamos el lote de stock (kit o producto normal)
    let payload = {
      product_id: productId,
      warehouse_id: Number(warehouseId),
      quantity,
      reserved,
      lot,
      expiration_date: expirationDate || null,
      updated_at: nowIso,
    };

    if (quantity <= 0) {
      payload.quantity = 0;
      payload.is_active = false;
      payload.deleted_at = nowIso;
    } else {
      payload.is_active = true;
      payload.deleted_at = null;
    }

    let error = null;
    let stockBalanceIdForMovement = idNum;

    if (id) {
      // Edición de lote existente (no kit)
      const { error: updError } = await supabaseClient
        .from("stock_balances")
        .update(payload)
        .eq("id", idNum);
      error = updError;
    } else {
      // Alta de lote: primero buscamos si ya existe fila para (product, warehouse, lot),
      // incluyendo soft-deleted (no filtramos por deleted_at)
      let existingRow = null;
      try {
        let query = supabaseClient
          .from("stock_balances")
          .select("id, quantity, deleted_at, is_active")
          .eq("product_id", productId)
          .eq("warehouse_id", Number(warehouseId));

        if (lot) {
          query = query.eq("lot", lot);
        } else {
          query = query.is("lot", null);
        }

        const { data: existingRows, error: existingError } = await query.limit(1);
        if (existingError) {
          console.warn(
            "No se pudo verificar existencia previa de lote, se intentará insertar igual:",
            existingError
          );
        } else if (existingRows && existingRows.length > 0) {
          existingRow = existingRows[0];
        }
      } catch (e) {
        console.warn(
          "Error inesperado verificando existencia previa de lote:",
          e
        );
      }

      if (existingRow) {
        // Ya existe un registro para este producto+depósito+lot → sumamos cantidad y reactivamos si hace falta
        const newTotalQty = (Number(existingRow.quantity || 0) || 0) + quantity;
        const updatePayload = {
          ...payload,
          quantity: newTotalQty,
          is_active: newTotalQty > 0,
          deleted_at: newTotalQty > 0 ? null : nowIso,
        };

        const { error: updError } = await supabaseClient
          .from("stock_balances")
          .update(updatePayload)
          .eq("id", existingRow.id);

        error = updError;
        stockBalanceIdForMovement = existingRow.id;
      } else {
        // No existe → insertamos nuevo registro
        payload.created_at = nowIso;
        const { data, error: insError } = await supabaseClient
          .from("stock_balances")
          .insert(payload)
          .select("id")
          .single();

        error = insError;
        if (!insError && data?.id) {
          stockBalanceIdForMovement = data.id;
        }
      }
    }

    if (error) {
      console.error("Error al guardar stock:", error);
      showErrorToast(error.message || "No se pudo guardar el stock.");
      return;
    }

    // 3) Movimiento de ingreso para el lote creado/actualizado (kit o producto normal)
    if (!id && stockBalanceIdForMovement && quantity > 0) {
      await insertStockMovement({
        stock_balance_id: stockBalanceIdForMovement,
        product_id: productId,
        warehouse_id: Number(warehouseId),
        lot,
        movement_type: "IN",
        quantity,
        related_kit_product_id: isKit ? productId : null,
        reference: isKit ? "Ingreso de kit armado" : "Ingreso manual",
      });
    }

    const modal = getStockModalInstance();
    if (modal) modal.hide();

    showSuccessToast("Stock guardado correctamente.");
    await reloadStockData();
  } catch (err) {
    console.error("Error inesperado al guardar stock:", err);
    showErrorToast("Error inesperado al guardar stock.");
  }
}

// ======================================================
// ELIMINAR (soft delete)
// ======================================================

function confirmDeleteStock(row) {
  Swal.fire({
    title: "¿Eliminar lote de stock?",
    text: `Producto "${row.product_name}" en depósito "${row.warehouse_name}".`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Sí, eliminar",
    cancelButtonText: "Cancelar",
  }).then(async (result) => {
    if (!result.isConfirmed) return;
    await softDeleteStock(row.id);
  });
}

async function softDeleteStock(id) {
  try {
    const { error } = await supabaseClient
      .from("stock_balances")
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
      })
      .eq("id", Number(id));

    if (error) {
      console.error("Error al eliminar stock:", error);
      showErrorToast("No se pudo eliminar el lote de stock.");
      return;
    }

    showSuccessToast("Lote de stock eliminado.");
    await reloadStockData();
  } catch (err) {
    console.error("Error inesperado al eliminar stock:", err);
    showErrorToast("Error inesperado al eliminar stock.");
  }
}

// ======================================================
// ALTA RÁPIDA DE DEPÓSITO
// ======================================================

async function handleAddWarehouse() {
  const { value: formValues } = await Swal.fire({
    title: "Nuevo depósito",
    html: `
      <div class="mb-2 text-start">
        <label class="form-label form-label-sm">Código</label>
        <input
          id="swal-warehouse-code"
          type="text"
          class="form-control form-control-sm"
          placeholder="Ej: DEP-01"
        />
      </div>
      <div class="mb-2 text-start">
        <label class="form-label form-label-sm">Nombre</label>
        <input
          id="swal-warehouse-name"
          type="text"
          class="form-control form-control-sm"
          placeholder="Depósito principal"
        />
      </div>
      <div class="mb-2 text-start">
        <label class="form-label form-label-sm">Descripción (opcional)</label>
        <input
          id="swal-warehouse-desc"
          type="text"
          class="form-control form-control-sm"
          placeholder=""
        />
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: "Guardar",
    cancelButtonText: "Cancelar",
    preConfirm: () => {
      const code = document.getElementById("swal-warehouse-code").value.trim();
      const name = document.getElementById("swal-warehouse-name").value.trim();
      const description = document
        .getElementById("swal-warehouse-desc")
        .value.trim();

      if (!code || !name) {
        Swal.showValidationMessage("Completá código y nombre.");
        return;
      }

      return { code, name, description };
    },
  });

  if (!formValues) return;

  try {
    const { code, name, description } = formValues;

    const { data, error } = await supabaseClient
      .from("warehouses")
      .insert({
        code,
        name,
        description: description || null,
        is_active: true,
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.error("Error al crear depósito:", error);
      showErrorToast(error.message || "No se pudo crear el depósito.");
      return;
    }

    showSuccessToast("Depósito creado.");
    await loadWarehousesForModal();

    const select = $("#stockWarehouse");
    if (select && data?.id) {
      select.value = data.id;
    }
  } catch (err) {
    console.error("Error inesperado al crear depósito:", err);
    showErrorToast("Error inesperado al crear depósito.");
  }
}

// ======================================================
// EXPORTACIÓN
// ======================================================

function exportStockCsv() {
  if (!lastFilteredRows || lastFilteredRows.length === 0) {
    showErrorToast("No hay lotes para exportar.");
    return;
  }

  const header = [
    "Producto",
    "Marca",
    "Tipo",
    "Código",
    "Lote",
    "Vencimiento",
    "Depósito",
    "Código depósito",
    "Stock",
    "Reservado",
    "Disponible",
  ];

  const rows = lastFilteredRows.map((row) => {
    const qty = Number(row.quantity || 0);
    const res = Number(row.reserved || 0);
    const avail = Number(
      row.available !== undefined && row.available !== null
        ? row.available
        : qty - res
    );

    return [
      esc(row.product_name),
      esc(row.brand_name),
      esc(row.type_name),
      esc(row.product_sku),
      esc(row.lot),
      row.expiration_date ? formatDate(row.expiration_date) : "",
      esc(row.warehouse_name),
      esc(row.warehouse_code),
      qty.toFixed(3),
      res.toFixed(3),
      avail.toFixed(3),
    ];
  });

  const csvContent = [header, ...rows]
    .map((r) =>
      r
        .map((cell) => {
          const v = cell == null ? "" : String(cell);
          if (v.includes(";") || v.includes('"') || v.includes("\n")) {
            return `"${v.replace(/"/g, '""')}"`;
          }
          return v;
        })
        .join(";")
    )
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stock_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showSuccessToast("CSV generado.");
}

function exportStockXlsx() {
  if (!lastFilteredRows || lastFilteredRows.length === 0) {
    showErrorToast("No hay lotes para exportar.");
    return;
  }

  const data = lastFilteredRows.map((row) => {
    const qty = Number(row.quantity || 0);
    const res = Number(row.reserved || 0);
    const avail = Number(
      row.available !== undefined && row.available !== null
        ? row.available
        : qty - res
    );

    return {
      Producto: esc(row.product_name),
      Marca: esc(row.brand_name),
      Tipo: esc(row.type_name),
      Código: esc(row.product_sku),
      Lote: esc(row.lot),
      Vencimiento: row.expiration_date ? formatDate(row.expiration_date) : "",
      Depósito: esc(row.warehouse_name),
      "Código depósito": esc(row.warehouse_code),
      Stock: qty,
      Reservado: res,
      Disponible: avail,
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Stock");

  const fileName = `stock_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(workbook, fileName);

  showSuccessToast("Excel generado.");
}
