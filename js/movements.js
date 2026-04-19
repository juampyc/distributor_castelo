/* ==========================
 *  movements.js
 *  Pantalla Movimientos de stock
 * ========================== */

// -------- Utilidades básicas --------
const $  = (q, scope = document)=> scope.querySelector(q);
const $$ = (q, scope = document)=> Array.from(scope.querySelectorAll(q));
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const esc = (v)=>{
  if (v === null || v === undefined) return "";
  return String(v).replace(/[&<>"']/g, ch => (
    { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch] || ch
  ));
};
function debounce(fn,ms){ let t; return (...a)=>{clearTimeout(t); t=setTimeout(()=>fn(...a),ms);} }

// -------- SweetAlert helpers (toasts arriba) --------
function showSuccessToast(title, text){
  return Swal.fire({
    icon: "success",
    title: title || "OK",
    text: text || "",
    toast: true,
    position: "top",
    showConfirmButton: false,
    timer: 2000,
    timerProgressBar: true
  });
}

function showErrorToast(title, text){
  return Swal.fire({
    icon: "error",
    title: title || "Error",
    text: text || "",
    toast: true,
    position: "top",
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true
  });
}

// -------- Helpers de formato --------
function formatDateTime(value){
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return esc(value);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function formatQtyDisplay(value){
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0";
  const rounded = Math.round(num);
  if (Math.abs(num - rounded) < 1e-6) return String(rounded);
  return num.toFixed(3).replace(/\.?0+$/, "");
}

// -------- Estado global --------
let movementsState = {
  page: 1,
  pageSize: 25,
  totalRows: 0,
  search: "",
  filters: {
    movementType: "",
    productSearch: "",
    dateFrom: "",
    dateTo: ""
  }
};

let lastMovements = [];

// -------- Arranque --------
document.addEventListener("DOMContentLoaded", () => {
  bindMovementsUI();
  initMovementsApp().catch(e => {
    console.error("Error al inicializar movimientos", e);
    showErrorToast("Error","No se pudo inicializar la pantalla de movimientos");
  });
});

async function initMovementsApp(){
  // Esperar a que sb esté inicializado por supabase_client.js
  while (!window.sb) { await sleep(50); }

  await listMovements();
}

// -------- Enlaces UI --------
function bindMovementsUI(){
  $("#btnRefreshMovements")?.addEventListener("click", () => {
    movementsState.page = 1;
    listMovements();
  });

  $("#movementsSearchInput")?.addEventListener(
    "input",
    debounce(() => {
      movementsState.search = $("#movementsSearchInput").value.trim();
      movementsState.page = 1;
      listMovements();
    }, 250)
  );

  $("#filterMovementType")?.addEventListener("change", (e) => {
    movementsState.filters.movementType = e.target.value || "";
    movementsState.page = 1;
    listMovements();
  });

  $("#filterProduct")?.addEventListener(
    "input",
    debounce((e) => {
      movementsState.filters.productSearch = e.target.value.trim();
      movementsState.page = 1;
      listMovements();
    }, 250)
  );

  $("#filterDateFrom")?.addEventListener("change", (e) => {
    movementsState.filters.dateFrom = e.target.value || "";
    movementsState.page = 1;
    listMovements();
  });

  $("#filterDateTo")?.addEventListener("change", (e) => {
    movementsState.filters.dateTo = e.target.value || "";
    movementsState.page = 1;
    listMovements();
  });

  $("#movementsPageSize")?.addEventListener("change", (e) => {
    movementsState.pageSize = +e.target.value || 25;
    movementsState.page = 1;
    listMovements();
  });

  $("#movementsPrevPage")?.addEventListener("click", () => {
    if (movementsState.page > 1) {
      movementsState.page--;
      listMovements();
    }
  });

  $("#movementsNextPage")?.addEventListener("click", () => {
    if (movementsState.page * movementsState.pageSize < movementsState.totalRows) {
      movementsState.page++;
      listMovements();
    }
  });

  $("#btnExportMovementsCsv")?.addEventListener("click", () => exportMovements("csv"));
  $("#btnExportMovementsXlsx")?.addEventListener("click", () => exportMovements("xlsx"));

  // Sidebar mobile/desktop (mismo comportamiento que otras pantallas)
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

// -------- Filtros comunes (reutilizado por listado + export) --------
function applyFiltersToQuery(q){
  const { search, filters } = movementsState;
  const ors = [];

  if (search){
    const s = search;
    ors.push(
      `product_description.ilike.%${s}%`,
      `product_code.ilike.%${s}%`,
      `lot.ilike.%${s}%`,
      `reference.ilike.%${s}%`
    );
  }

  if (filters.productSearch){
    const s = filters.productSearch;
    ors.push(
      `product_description.ilike.%${s}%`,
      `product_code.ilike.%${s}%`
    );
  }

  if (ors.length){
    q = q.or(ors.join(","));
  }

  if (filters.movementType){
    q = q.eq("movement_type", filters.movementType);
  }

  if (filters.dateFrom){
    q = q.gte("movement_date", filters.dateFrom);
  }

  if (filters.dateTo){
    // hasta fin de día: sumo 1 día y uso < ISO
    const dtTo = new Date(filters.dateTo);
    dtTo.setDate(dtTo.getDate() + 1);
    const isoTo = dtTo.toISOString();
    q = q.lt("movement_date", isoTo);
  }

  return q;
}

// -------- Listado principal --------
async function listMovements(){
  try{
    const tbody = $("#movementsTableBody");
    const summary = $("#movementsSummaryText");
    if (tbody){
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center small text-muted py-3">
            Cargando movimientos...
          </td>
        </tr>`;
    }
    if (summary){
      summary.textContent = "Cargando movimientos...";
    }

    const from = (movementsState.page - 1) * movementsState.pageSize;
    const to   = from + movementsState.pageSize - 1;

    let q = sb
      .from("vw_stock_movements")
      .select("*", { count: "exact" })
      .order("movement_date", { ascending: false })   // <<< más nuevo primero
      .range(from, to);

    q = applyFiltersToQuery(q);

    const { data, error, count } = await q;
    if (error){
      console.error("listMovements error", error);
      if (tbody){
        tbody.innerHTML = `
          <tr>
            <td colspan="8" class="text-center small text-danger py-3">
              Error al cargar movimientos.
            </td>
          </tr>`;
      }
      if (summary){
        summary.textContent = "Error al cargar movimientos.";
      }
      showErrorToast("Error","No se pudieron cargar los movimientos");
      return;
    }

    lastMovements = data || [];
    movementsState.totalRows = count || 0;

    renderMovementsTable();
    updateMovementsPagination(from, to);
  }catch(e){
    console.error("listMovements ex", e);
    showErrorToast("Error","Error inesperado al cargar movimientos");
  }
}

function renderMovementsTable(){
  const tbody = $("#movementsTableBody");
  if (!tbody) return;

  if (!lastMovements.length){
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center small text-muted py-3">
          Sin movimientos para los filtros seleccionados.
        </td>
      </tr>`;
    return;
  }

  const rowsHtml = lastMovements.map(renderMovementRow).join("");
  tbody.innerHTML = rowsHtml;
}

function renderMovementRow(r){
  const rawQty = r.quantity || 0;
  const adjQty =
    r.movement_type === "OUT" || r.movement_type === "OUT_KIT"
      ? -Math.abs(rawQty)
      : rawQty;

  const productLabel = [r.product_description, r.product_code]
    .filter(Boolean)
    .join(" · ");

  const warehouseLabel = [r.warehouse_name, r.warehouse_code]
    .filter(Boolean)
    .join(" ");

  const extraParts = [];
  if (r.lot) extraParts.push(`Lote: ${r.lot}`);
  if (r.stock_balance_id) extraParts.push(`ID: ${r.stock_balance_id}`);
  const extraLine = extraParts.join(" · ");

  return `
    <tr data-id="${esc(r.id)}">
      <td>${formatDateTime(r.movement_date)}</td>
      <td>
        <div class="fw-semibold">${esc(productLabel || "")}</div>
        ${
          extraLine
            ? `<div class="small text-muted">${esc(extraLine)}</div>`
            : ""
        }
      </td>
      <td>${esc(r.brand_name || "")}</td>
      <td>${esc(r.movement_type || "")}</td>
      <td class="text-end">${formatQtyDisplay(adjQty)}</td>
      <td>${esc(r.lot || "")}</td>
      <td>
        <div>${esc(warehouseLabel || "")}</div>
      </td>
      <td>${esc(r.reference || "")}</td>
    </tr>`;
}

function updateMovementsPagination(from, to){
  const info = $("#movementsPaginationInfo");
  const indicator = $("#movementsPageIndicator");
  const summary = $("#movementsSummaryText");

  if (!info || !indicator) return;

  if (!movementsState.totalRows){
    info.textContent = "Sin movimientos para los filtros";
    indicator.textContent = "1";
    if (summary) summary.textContent = "Historial de movimientos de stock.";
    return;
  }

  const start = from + 1;
  const end   = Math.min(to + 1, movementsState.totalRows);
  info.textContent = `Mostrando ${start}–${end} de ${movementsState.totalRows} movimientos.`;
  indicator.textContent = movementsState.page;

  if (summary){
    summary.textContent = `Total de movimientos: ${movementsState.totalRows}`;
  }

  const btnPrev = $("#movementsPrevPage");
  const btnNext = $("#movementsNextPage");
  if (btnPrev) btnPrev.disabled = movementsState.page <= 1;
  if (btnNext) btnNext.disabled = movementsState.page * movementsState.pageSize >= movementsState.totalRows;
}

// -------- Export --------
async function exportMovements(format){
  try{
    let q = sb
      .from("vw_stock_movements")
      .select("*")
      .order("movement_date", { ascending: false });   // <<< export también de más nuevo a más viejo

    q = applyFiltersToQuery(q);

    const { data, error } = await q;
    if (error){
      console.error("exportMovements error", error);
      showErrorToast("Error","No se pudo exportar el historial de movimientos");
      return;
    }

    const rows = (data || []).map(r => {
      const rawQty = r.quantity || 0;
      const adjQty =
        r.movement_type === "OUT" || r.movement_type === "OUT_KIT"
          ? -Math.abs(rawQty)
          : rawQty;

      const productLabel = [r.product_description, r.product_code]
        .filter(Boolean)
        .join(" · ");

      const warehouseLabel = [r.warehouse_name, r.warehouse_code]
        .filter(Boolean)
        .join(" ");

      return {
        Fecha: formatDateTime(r.movement_date),
        Producto: productLabel || "",
        Marca: r.brand_name || "",
        Tipo: r.movement_type || "",
        Cantidad: adjQty,
        Lote: r.lot || "",
        Deposito: warehouseLabel || "",
        Referencia: r.reference || ""
      };
    });

    if (!rows.length){
      showErrorToast("Sin datos","No hay movimientos para exportar");
      return;
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Movimientos");

    const today = new Date().toISOString().slice(0,10);
    if (format === "csv"){
      XLSX.writeFile(wb, `movimientos_stock_${today}.csv`, { bookType:"csv" });
    } else {
      XLSX.writeFile(wb, `movimientos_stock_${today}.xlsx`, { bookType:"xlsx" });
    }

    showSuccessToast("OK","Movimientos exportados");
  }catch(e){
    console.error("exportMovements ex", e);
    showErrorToast("Error","Error inesperado al exportar movimientos");
  }
}
