// js/cashboxes.js
// Módulo CAJAS - Programa Distribuidora 2

const $ = (s, sc = document) => sc.querySelector(s);
const $$ = (s, sc = document) => Array.from(sc.querySelectorAll(s));

const esc = (v) => (v === null || v === undefined ? "" : String(v));
const debounce = (fn, d = 300) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), d);
  };
};

const money = (n) => {
  const num = Number(n || 0);
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

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

function ok(msg) { Toast.fire({ icon: "success", title: msg || "OK", timer: 2000 }); }
function err(msg) { Toast.fire({ icon: "error", title: msg || "Error", timer: 3000 }); }

const state = {
  page: 1,
  pageSize: 25,
  total: 0,
  search: "",
  filterActive: "all",
};

let supabaseClient = null;
let allRows = [];
let lastFiltered = [];
let modalInstance = null;
let currentRow = null;

document.addEventListener("DOMContentLoaded", () => {
  supabaseClient = window.sb || window.supabase || null;
  if (!supabaseClient) {
    err("Supabase no inicializado.");
    return;
  }
  init();
});

async function init() {
  bind();
  await reload();
}

function bind() {
  const search = $("#cashboxesSearchInput");
  const filterActive = $("#filterCashboxActive");
  const pageSize = $("#cashboxesPageSize");
  const btnAdd = $("#btnAddCashbox");
  const btnRefresh = $("#btnRefreshCashboxes");

  const btnCsv = $("#btnExportCashboxesCsv");
  const btnXlsx = $("#btnExportCashboxesXlsx");

  const btnPrev = $("#cashboxesPrevPage");
  const btnNext = $("#cashboxesNextPage");

  if (search) {
    search.addEventListener("input", debounce((e) => {
      state.search = e.target.value || "";
      state.page = 1;
      applyAndRender();
    }, 250));
  }

  if (filterActive) {
    filterActive.addEventListener("change", (e) => {
      state.filterActive = e.target.value || "all";
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

  if (btnAdd) btnAdd.addEventListener("click", () => openModal(null));
  if (btnRefresh) btnRefresh.addEventListener("click", () => reload());

  if (btnCsv) btnCsv.addEventListener("click", exportCsv);
  if (btnXlsx) btnXlsx.addEventListener("click", exportXlsx);

  if (btnPrev) btnPrev.addEventListener("click", () => {
    if (state.page > 1) { state.page -= 1; applyAndRender(); }
  });
  if (btnNext) btnNext.addEventListener("click", () => {
    const tp = Math.max(1, Math.ceil(state.total / state.pageSize));
    if (state.page < tp) { state.page += 1; applyAndRender(); }
  });

  const tbody = $("#cashboxesTableBody");
  if (tbody) {
    tbody.addEventListener("click", async (e) => {
      const b = e.target.closest("button[data-action]");
      if (!b) return;
      const action = b.getAttribute("data-action");
      const id = b.getAttribute("data-id");
      const row = allRows.find((r) => String(r.id) === String(id));
      if (!row) return;

      if (action === "edit") openModal(row);
      if (action === "delete") await softDelete(row);
    });
  }

  const btnSave = $("#btnSaveCashbox");
  if (btnSave) btnSave.addEventListener("click", save);
}

async function reload() {
  const tbody = $("#cashboxesTableBody");
  if (tbody) {
    tbody.innerHTML = `
      <tr><td colspan="5" class="text-center py-3">
        <div class="spinner-border spinner-border-sm me-2"></div>Cargando cajas...
      </td></tr>`;
  }

  try {
    // Preferimos view de balance
    let { data, error } = await supabaseClient
      .from("vw_cashbox_balance")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      console.warn("vw_cashbox_balance no disponible, fallback cashboxes:", error);
      const r = await supabaseClient
        .from("cashboxes")
        .select("*")
        .order("name", { ascending: true });
      data = r.data;
      error = r.error;
    }

    if (error) {
      console.error(error);
      err("No se pudieron cargar cajas.");
      return;
    }

    allRows = data || [];
    state.page = 1;
    applyAndRender();
    ok("Cajas actualizadas.");
  } catch (e) {
    console.error(e);
    err("Error inesperado cargando cajas.");
  }
}

function applyAndRender() {
  const s = state.search.trim().toLowerCase();
  let filtered = allRows.slice();

  if (s) {
    filtered = filtered.filter((r) => {
      const h = [r.name, r.code, r.description].map((v) => (v ? String(v).toLowerCase() : "")).join(" ");
      return h.includes(s);
    });
  }

  if (state.filterActive === "active") filtered = filtered.filter((r) => (r.is_active === true) && !r.deleted_at);
  if (state.filterActive === "inactive") filtered = filtered.filter((r) => (r.is_active === false) || !!r.deleted_at);

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

function badgeActive(row) {
  if (row.deleted_at || row.is_active === false) return `<span class="badge text-bg-danger">Inactiva</span>`;
  return `<span class="badge text-bg-success">Activa</span>`;
}

function render(rows) {
  const tbody = $("#cashboxesTableBody");
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-3 text-muted">Sin cajas para los filtros.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((r) => {
    const balance = Number(r.balance ?? 0);
    return `
      <tr>
        <td class="fw-semibold">${esc(r.name || "")}</td>
        <td>${esc(r.code || "")}</td>
        <td>${badgeActive(r)}</td>
        <td class="text-end">$ ${money(balance)}</td>
        <td class="text-end text-nowrap">
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary" data-action="edit" data-id="${r.id}" title="Editar">
              <i class="bi bi-pencil"></i>
            </button>
            <button class="btn btn-outline-danger" data-action="delete" data-id="${r.id}" title="Eliminar (soft)">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function paginate() {
  const info = $("#cashboxesRowsInfo");
  const ind = $("#cashboxesPageIndicator");
  const prev = $("#cashboxesPrevPage");
  const next = $("#cashboxesNextPage");

  const total = state.total;
  const tp = Math.max(1, Math.ceil(total / state.pageSize));
  const from = total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const to = Math.min(total, state.page * state.pageSize);

  if (info) info.textContent = total ? `Mostrando ${from}–${to} de ${total}` : "Sin resultados";
  if (ind) ind.textContent = state.page;
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= tp;
}

function getModal() {
  if (!modalInstance) {
    const el = $("#cashboxModal");
    if (el) modalInstance = new bootstrap.Modal(el);
  }
  return modalInstance;
}

function openModal(row) {
  currentRow = row ? { ...row } : null;

  const form = $("#cashboxForm");
  const title = $("#cashboxModalTitle");

  if (form) {
    form.reset();
    form.classList.remove("was-validated");
  }

  $("#cashboxId").value = row?.id || "";
  $("#cashboxCode").value = row?.code || "";
  $("#cashboxName").value = row?.name || "";
  $("#cashboxDescription").value = row?.description || "";
  $("#cashboxIsActive").checked = row ? !!row.is_active && !row.deleted_at : true;

  if (title) title.textContent = row ? "Editar caja" : "Nueva caja";

  const m = getModal();
  if (m) m.show();
}

async function save() {
  const form = $("#cashboxForm");
  if (!form) return;

  if (!form.checkValidity()) {
    form.classList.add("was-validated");
    return;
  }

  const id = $("#cashboxId").value || null;
  const code = $("#cashboxCode").value.trim();
  const name = $("#cashboxName").value.trim();
  const description = $("#cashboxDescription").value.trim() || null;
  const is_active = $("#cashboxIsActive").checked;

  const nowIso = new Date().toISOString();

  try {
    if (!id) {
      const { error } = await supabaseClient.from("cashboxes").insert({
        code, name, description,
        is_active,
        created_at: nowIso,
        updated_at: nowIso,
      });

      if (error) {
        console.error(error);
        err(error.message || "No se pudo crear la caja.");
        return;
      }
      ok("Caja creada.");
    } else {
      const { error } = await supabaseClient.from("cashboxes").update({
        code, name, description,
        is_active,
        deleted_at: is_active ? null : nowIso,
        updated_at: nowIso,
      }).eq("id", id);

      if (error) {
        console.error(error);
        err(error.message || "No se pudo actualizar la caja.");
        return;
      }
      ok("Caja actualizada.");
    }

    const m = getModal();
    if (m) m.hide();

    await reload();
  } catch (e) {
    console.error(e);
    err("Error inesperado al guardar.");
  }
}

async function softDelete(row) {
  const r = await Swal.fire({
    title: "Eliminar caja",
    text: `Se hará soft delete: "${row.name}"`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Eliminar",
    cancelButtonText: "Cancelar",
  });
  if (!r.isConfirmed) return;

  const nowIso = new Date().toISOString();
  const { error } = await supabaseClient.from("cashboxes").update({
    is_active: false,
    deleted_at: nowIso,
    updated_at: nowIso,
  }).eq("id", row.id);

  if (error) {
    console.error(error);
    err("No se pudo eliminar.");
    return;
  }

  ok("Caja eliminada.");
  await reload();
}

function exportCsv() {
  if (!lastFiltered.length) { err("No hay cajas para exportar."); return; }

  const header = ["Nombre", "Código", "Activa", "Saldo"];
  const rows = lastFiltered.map((r) => [
    r.name || "",
    r.code || "",
    (!r.deleted_at && r.is_active) ? "SI" : "NO",
    Number(r.balance ?? 0),
  ]);

  const csv = [header, ...rows].map((row) =>
    row.map((c) => {
      const v = c == null ? "" : String(c);
      if (v.includes(";") || v.includes('"') || v.includes("\n")) return `"${v.replace(/"/g, '""')}"`;
      return v;
    }).join(";")
  ).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cajas_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  ok("CSV generado.");
}

function exportXlsx() {
  if (!lastFiltered.length) { err("No hay cajas para exportar."); return; }

  const data = lastFiltered.map((r) => ({
    Nombre: r.name || "",
    Código: r.code || "",
    Activa: (!r.deleted_at && r.is_active) ? "SI" : "NO",
    Saldo: Number(r.balance ?? 0),
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cajas");
  XLSX.writeFile(wb, `cajas_${new Date().toISOString().slice(0, 10)}.xlsx`);
  ok("Excel generado.");
}
