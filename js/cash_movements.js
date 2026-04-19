// js/cash_movements.js
// Módulo MOVIMIENTOS DE CAJA - Programa Distribuidora 2

const $ = (s, sc = document) => sc.querySelector(s);
const $$ = (s, sc = document) => Array.from(sc.querySelectorAll(s));

const esc = (v) => (v === null || v === undefined ? "" : String(v));

const debounce = (fn, delay = 300) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
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

const money = (n) => {
  const num = Number(n || 0);
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

// SweetAlert2 Toasts
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

function ok(msg) {
  Toast.fire({ icon: "success", title: msg || "OK", timer: 2000 });
}
function err(msg) {
  Toast.fire({ icon: "error", title: msg || "Error", timer: 3000 });
}

const state = {
  page: 1,
  pageSize: 25,
  total: 0,
  search: "",
  filters: {
    cashbox_id: "",
    movement_type: "",
    category: "",
    date_from: "",
    date_to: "",
  },
  loading: false,
};

let supabaseClient = null;

let cashboxes = [];
let customers = [];

let allRows = [];
let lastFiltered = [];

let modalInstance = null;

document.addEventListener("DOMContentLoaded", () => {
  supabaseClient = window.sb || window.supabase || null;
  if (!supabaseClient) {
    err("Supabase no inicializado.");
    return;
  }

  init().catch((e) => {
    console.error(e);
    err("Error al cargar Movimientos de caja.");
  });
});

async function init() {
  bind();
  await loadCashboxes();
  await loadCustomers();
  await reload();
}

function bind() {
  const search = $("#cashMovSearchInput");
  const fCashbox = $("#filterCashbox");
  const fType = $("#filterCashMovType");
  const fCat = $("#filterCashMovCategory");
  const fFrom = $("#filterCashMovDateFrom");
  const fTo = $("#filterCashMovDateTo");
  const pageSize = $("#cashMovPageSize");

  const btnAdd = $("#btnAddCashMovement");
  const btnRefresh = $("#btnRefreshCashMovements");

  const btnCsv = $("#btnExportCashMovCsv");
  const btnXlsx = $("#btnExportCashMovXlsx");

  const btnPrev = $("#cashMovPrevPage");
  const btnNext = $("#cashMovNextPage");

  if (search) {
    search.addEventListener(
      "input",
      debounce((e) => {
        state.search = e.target.value || "";
        state.page = 1;
        applyAndRender();
      }, 250)
    );
  }

  if (fCashbox) {
    fCashbox.addEventListener("change", (e) => {
      state.filters.cashbox_id = e.target.value || "";
      state.page = 1;
      applyAndRender();
    });
  }

  if (fType) {
    fType.addEventListener("change", (e) => {
      state.filters.movement_type = e.target.value || "";
      state.page = 1;
      applyAndRender();
    });
  }

  if (fCat) {
    fCat.addEventListener("change", (e) => {
      state.filters.category = e.target.value || "";
      state.page = 1;
      applyAndRender();
    });
  }

  if (fFrom) {
    fFrom.addEventListener("change", (e) => {
      state.filters.date_from = e.target.value || "";
      state.page = 1;
      applyAndRender();
    });
  }

  if (fTo) {
    fTo.addEventListener("change", (e) => {
      state.filters.date_to = e.target.value || "";
      state.page = 1;
      applyAndRender();
    });
  }

  if (pageSize) {
    pageSize.addEventListener("change", (e) => {
      const v = parseInt(e.target.value, 10);
      state.pageSize = Number.isFinite(v) ? v : 25;
      state.page = 1;
      applyAndRender();
    });
  }

  if (btnAdd) btnAdd.addEventListener("click", () => openModal());
  if (btnRefresh) btnRefresh.addEventListener("click", () => reload());

  if (btnCsv) btnCsv.addEventListener("click", exportCsv);
  if (btnXlsx) btnXlsx.addEventListener("click", exportXlsx);

  if (btnPrev) {
    btnPrev.addEventListener("click", () => {
      if (state.page > 1) {
        state.page -= 1;
        applyAndRender();
      }
    });
  }
  if (btnNext) {
    btnNext.addEventListener("click", () => {
      const tp = Math.max(1, Math.ceil(state.total / state.pageSize));
      if (state.page < tp) {
        state.page += 1;
        applyAndRender();
      }
    });
  }

  // Modal
  const btnSave = $("#btnSaveCashMovement");
  const form = $("#cashMovementForm");
  if (btnSave) {
    btnSave.addEventListener("click", async () => {
      if (!form) return;
      if (!form.checkValidity()) {
        form.classList.add("was-validated");
        return;
      }
      await saveMovement();
    });
  }
}

async function loadCashboxes() {
  try {
    const { data, error } = await supabaseClient
      .from("cashboxes")
      .select("id, code, name, is_active, deleted_at")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      console.warn("No se pudieron cargar cajas:", error);
      cashboxes = [];
      return;
    }

    cashboxes = data || [];

    // filtros
    const sel = $("#filterCashbox");
    if (sel) {
      const cur = state.filters.cashbox_id || "";
      sel.innerHTML = `<option value="">Todas las cajas</option>`;
      cashboxes.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = `${c.name}${c.code ? ` · ${c.code}` : ""}`;
        sel.appendChild(opt);
      });
      sel.value = cur;
    }

    // modal
    const sel2 = $("#cmCashbox");
    if (sel2) {
      sel2.innerHTML = `<option value="">Seleccioná caja</option>`;
      cashboxes.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = `${c.name}${c.code ? ` · ${c.code}` : ""}`;
        sel2.appendChild(opt);
      });
    }
  } catch (e) {
    console.error("Error inesperado cargando cajas:", e);
    cashboxes = [];
  }
}

function customerLabel(c) {
  const name = c?.nombre || "";
  const loc = c?.localidad || "";
  return [name, loc ? `· ${loc}` : ""].filter(Boolean).join(" ");
}

async function loadCustomers() {
  try {
    const { data, error } = await supabaseClient
      .from("clients")
      .select("id, nombre, localidad, is_active, is_client")
      .eq("is_active", true)
      .order("nombre", { ascending: true });

    if (error) {
      console.warn("No se pudieron cargar clientes:", error);
      customers = [];
      return;
    }

    customers = data || [];

    const sel = $("#cmCustomer");
    if (sel) {
      sel.innerHTML = `<option value="">—</option>`;
      customers.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = customerLabel(c);
        sel.appendChild(opt);
      });
    }
  } catch (e) {
    console.error("Error inesperado cargando clientes:", e);
    customers = [];
  }
}

function renderLoading() {
  const tbody = $("#cashMovementsTableBody");
  if (!tbody) return;
  tbody.innerHTML = `
    <tr>
      <td colspan="8" class="text-center py-3">
        <div class="spinner-border spinner-border-sm me-2" role="status"></div>
        Cargando movimientos...
      </td>
    </tr>
  `;
}

async function reload() {
  state.loading = true;
  renderLoading();

  try {
    // Preferimos view con nombres (caja + cliente)
    let { data, error } = await supabaseClient
      .from("vw_cash_movements")
      .select("*")
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false });

    // Fallback sin view: muestra ids
    if (error) {
      console.warn("vw_cash_movements no disponible, fallback cash_movements:", error);
      const r = await supabaseClient
        .from("cash_movements")
        .select("*")
        .order("movement_date", { ascending: false })
        .order("created_at", { ascending: false });
      data = r.data;
      error = r.error;
    }

    if (error) {
      console.error(error);
      err("No se pudieron cargar movimientos.");
      return;
    }

    allRows = data || [];
    state.page = 1;
    applyAndRender();
    ok("Movimientos actualizados.");
  } catch (e) {
    console.error(e);
    err("Error inesperado cargando movimientos.");
  } finally {
    state.loading = false;
  }
}

function applyAndRender() {
  const s = state.search.trim().toLowerCase();
  const { cashbox_id, movement_type, category, date_from, date_to } = state.filters;

  let filtered = allRows.slice();

  if (cashbox_id) filtered = filtered.filter((r) => String(r.cashbox_id) === String(cashbox_id));
  if (movement_type) filtered = filtered.filter((r) => String(r.movement_type) === String(movement_type));
  if (category) filtered = filtered.filter((r) => String(r.category) === String(category));

  if (s) {
    filtered = filtered.filter((r) => {
      const h = [
        r.reference,
        r.notes,
        r.cashbox_name,
        r.cashbox_code,
        r.customer_name,
        r.category,
        r.movement_type,
      ]
        .map((v) => (v ? String(v).toLowerCase() : ""))
        .join(" ");
      return h.includes(s);
    });
  }

  if (date_from) {
    const d0 = new Date(date_from + "T00:00:00");
    filtered = filtered.filter((r) => {
      const d = new Date(r.movement_date || r.created_at);
      return !Number.isNaN(d.getTime()) && d >= d0;
    });
  }
  if (date_to) {
    const d1 = new Date(date_to + "T23:59:59");
    filtered = filtered.filter((r) => {
      const d = new Date(r.movement_date || r.created_at);
      return !Number.isNaN(d.getTime()) && d <= d1;
    });
  }

  lastFiltered = filtered;
  state.total = filtered.length;

  const tp = Math.max(1, Math.ceil(state.total / state.pageSize));
  if (state.page > tp) state.page = tp;

  const start = (state.page - 1) * state.pageSize;
  const end = start + state.pageSize;
  const pageRows = filtered.slice(start, end);

  render(pageRows);
  paginate();
}

function typeBadge(t) {
  const s = String(t || "");
  if (s === "IN") return `<span class="badge text-bg-success">IN</span>`;
  if (s === "OUT") return `<span class="badge text-bg-danger">OUT</span>`;
  return `<span class="badge text-bg-light border">${esc(s)}</span>`;
}

function render(rows) {
  const tbody = $("#cashMovementsTableBody");
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-3 text-muted">
          No hay movimientos para los filtros seleccionados.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows
    .map((r) => {
      const date = r.movement_date ? formatDate(r.movement_date) : formatDate(r.created_at);
      const caja = r.cashbox_name
        ? `${r.cashbox_name}${r.cashbox_code ? ` · ${r.cashbox_code}` : ""}`
        : (r.cashbox_id || "");
      const cliente = r.customer_name || (r.customer_id || "");
      const amt = Number(r.amount || 0);

      return `
        <tr>
          <td>${esc(date)}</td>
          <td>${esc(caja)}</td>
          <td>${typeBadge(r.movement_type)}</td>
          <td>${esc(r.category || "")}</td>
          <td class="text-end">$ ${money(amt)}</td>
          <td>${esc(r.reference || "")}</td>
          <td>${esc(cliente)}</td>
          <td>${esc(r.notes || "")}</td>
        </tr>
      `;
    })
    .join("");
}

function paginate() {
  const info = $("#cashMovRowsInfo");
  const indicator = $("#cashMovPageIndicator");
  const btnPrev = $("#cashMovPrevPage");
  const btnNext = $("#cashMovNextPage");

  const total = state.total;
  const tp = Math.max(1, Math.ceil(total / state.pageSize));
  const from = total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const to = Math.min(total, state.page * state.pageSize);

  if (info) info.textContent = total ? `Mostrando ${from}–${to} de ${total}` : "Sin resultados";
  if (indicator) indicator.textContent = state.page;
  if (btnPrev) btnPrev.disabled = state.page <= 1;
  if (btnNext) btnNext.disabled = state.page >= tp;
}

// ======================================================
// MODAL (movimiento manual)
// ======================================================

function getModal() {
  if (!modalInstance) {
    const el = $("#cashMovementModal");
    if (el) modalInstance = new bootstrap.Modal(el);
  }
  return modalInstance;
}

function resetModal() {
  const form = $("#cashMovementForm");
  if (form) {
    form.reset();
    form.classList.remove("was-validated");
  }
  const dt = $("#cmDate");
  if (dt) dt.value = new Date().toISOString().slice(0, 10);
  const type = $("#cmType");
  if (type) type.value = "IN";
  const cat = $("#cmCategory");
  if (cat) cat.value = "EXPENSE";
}

async function openModal() {
  resetModal();
  await loadCashboxes();
  await loadCustomers();
  const modal = getModal();
  if (modal) modal.show();
}

async function saveMovement() {
  const cashbox_id = $("#cmCashbox")?.value || "";
  const movement_date = $("#cmDate")?.value || "";
  const movement_type = $("#cmType")?.value || "IN";
  const category = $("#cmCategory")?.value || "";
  const amount = Number($("#cmAmount")?.value || 0);
  const customer_id = $("#cmCustomer")?.value || null;
  const reference = $("#cmReference")?.value?.trim() || null;
  const notes = $("#cmNotes")?.value?.trim() || null;

  if (!cashbox_id || !movement_date || !category || !(amount > 0)) {
    err("Completá caja, fecha, categoría y monto.");
    return;
  }

  const nowIso = new Date().toISOString();

  try {
    const { error } = await supabaseClient.from("cash_movements").insert({
      cashbox_id,
      movement_type,
      category,
      amount,
      customer_id: customer_id || null,
      reference,
      movement_date,
      notes,
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
    });

    if (error) {
      console.error(error);
      err(error.message || "No se pudo guardar el movimiento.");
      return;
    }

    ok("Movimiento guardado.");
    const modal = getModal();
    if (modal) modal.hide();
    await reload();
  } catch (e) {
    console.error(e);
    err("Error inesperado guardando movimiento.");
  }
}

// ======================================================
// EXPORTS
// ======================================================

function buildExportRows(rows) {
  return (rows || []).map((r) => ({
    Fecha: r.movement_date ? formatDate(r.movement_date) : formatDate(r.created_at),
    Caja: r.cashbox_name ? `${r.cashbox_name}${r.cashbox_code ? ` · ${r.cashbox_code}` : ""}` : (r.cashbox_id || ""),
    Tipo: r.movement_type || "",
    Categoria: r.category || "",
    Monto: Number(r.amount || 0),
    Referencia: r.reference || "",
    Cliente: r.customer_name || (r.customer_id || ""),
    Notas: r.notes || "",
  }));
}

function exportCsv() {
  if (!lastFiltered.length) {
    err("No hay movimientos para exportar.");
    return;
  }

  const rows = buildExportRows(lastFiltered);

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      headers
        .map((h) => {
          const v = r[h];
          const s = v === null || v === undefined ? "" : String(v);
          const escaped = s.includes('"') || s.includes(",") || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
          return escaped;
        })
        .join(",")
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cash_movements_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportXlsx() {
  if (!lastFiltered.length) {
    err("No hay movimientos para exportar.");
    return;
  }
  const rows = buildExportRows(lastFiltered);
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Movimientos");
  XLSX.writeFile(wb, `cash_movements_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
