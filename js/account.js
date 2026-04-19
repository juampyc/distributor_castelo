// js/account.js
// Módulo CUENTA CORRIENTE - Programa Distribuidora 2

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

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

function showSuccessToast(msg) {
  Toast.fire({ icon: "success", title: msg || "OK", timer: 2000 });
}
function showErrorToast(msg) {
  Toast.fire({ icon: "error", title: msg || "Error", timer: 3000 });
}

const accountState = {
  page: 1,
  pageSize: 25,
  total: 0,
  search: "",
  filters: {
    customer_id: "",
    movement_type: "",
    date_from: "",
    date_to: "",
  },
  loading: false,
};

let supabaseClient = null;

let customers = [];
let cashboxes = [];

let allLedgerRows = [];
let lastFilteredRows = [];

let paymentModalInstance = null;

document.addEventListener("DOMContentLoaded", () => {
  try {
    supabaseClient = window.sb || window.supabase || null;
    if (!supabaseClient) {
      showErrorToast("Error: Supabase no inicializado.");
      return;
    }
    initAccountPage();
  } catch (e) {
    console.error(e);
    showErrorToast("Error al cargar Cuenta Corriente.");
  }
});

async function initAccountPage() {
  bindEvents();
  await loadCustomers();
  await loadCashboxes();
  await reloadLedger();
}

function vendorLabel(v) {
  const name = v?.nombre || "";
  const loc = v?.localidad || "";
  return [name, loc ? `· ${loc}` : ""].filter(Boolean).join(" ");
}

async function loadCustomers() {
  try {
    const { data, error } = await supabaseClient
      .from("clients")
      .select("id, nombre, localidad, is_client, is_active")
      .eq("is_client", true)
      .eq("is_active", true)
      .order("nombre", { ascending: true });

    if (error) {
      console.warn("No se pudieron cargar clientes:", error);
      customers = [];
      return;
    }

    customers = data || [];

    const filterSel = $("#filterAccountCustomer");
    const paySel = $("#paymentCustomer");

    if (filterSel) {
      filterSel.innerHTML = `<option value="">Seleccioná cliente</option>`;
      customers.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = vendorLabel(c);
        filterSel.appendChild(opt);
      });
    }

    if (paySel) {
      paySel.innerHTML = `<option value="">Seleccioná cliente</option>`;
      customers.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = vendorLabel(c);
        paySel.appendChild(opt);
      });
    }
  } catch (e) {
    console.error("Error inesperado cargando clientes:", e);
    customers = [];
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

    const sel = $("#paymentCashbox");
    if (sel) {
      sel.innerHTML = `<option value="">Seleccioná caja</option>`;
      cashboxes.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = `${c.name}${c.code ? ` · ${c.code}` : ""}`;
        sel.appendChild(opt);
      });
    }
  } catch (e) {
    console.error("Error inesperado cargando cajas:", e);
    cashboxes = [];
  }
}

function bindEvents() {
  const search = $("#accountSearchInput");
  const fCustomer = $("#filterAccountCustomer");
  const fType = $("#filterAccountType");
  const fFrom = $("#filterAccountDateFrom");
  const fTo = $("#filterAccountDateTo");
  const pageSize = $("#accountPageSize");

  const btnRefresh = $("#btnRefreshAccount");
  const btnPay = $("#btnRegisterPayment");

  const btnCsv = $("#btnExportAccountCsv");
  const btnXlsx = $("#btnExportAccountXlsx");

  const btnPrev = $("#accountPrevPage");
  const btnNext = $("#accountNextPage");

  if (search) {
    search.addEventListener(
      "input",
      debounce((e) => {
        accountState.search = e.target.value || "";
        accountState.page = 1;
        applyFiltersAndRender();
      }, 250)
    );
  }

  if (fCustomer) {
    fCustomer.addEventListener("change", async (e) => {
      accountState.filters.customer_id = e.target.value || "";
      accountState.page = 1;
      await updateBalanceCard();
      applyFiltersAndRender();
    });
  }

  if (fType) {
    fType.addEventListener("change", (e) => {
      accountState.filters.movement_type = e.target.value || "";
      accountState.page = 1;
      applyFiltersAndRender();
    });
  }

  if (fFrom) {
    fFrom.addEventListener("change", (e) => {
      accountState.filters.date_from = e.target.value || "";
      accountState.page = 1;
      applyFiltersAndRender();
    });
  }
  if (fTo) {
    fTo.addEventListener("change", (e) => {
      accountState.filters.date_to = e.target.value || "";
      accountState.page = 1;
      applyFiltersAndRender();
    });
  }

  if (pageSize) {
    pageSize.addEventListener("change", (e) => {
      const v = parseInt(e.target.value, 10);
      accountState.pageSize = Number.isFinite(v) ? v : 25;
      accountState.page = 1;
      applyFiltersAndRender();
    });
  }

  if (btnRefresh) btnRefresh.addEventListener("click", () => reloadLedger());
  if (btnPay) btnPay.addEventListener("click", () => openPaymentModal());

  if (btnCsv) btnCsv.addEventListener("click", exportAccountCsv);
  if (btnXlsx) btnXlsx.addEventListener("click", exportAccountXlsx);

  if (btnPrev) {
    btnPrev.addEventListener("click", () => {
      if (accountState.page > 1) {
        accountState.page -= 1;
        applyFiltersAndRender();
      }
    });
  }
  if (btnNext) {
    btnNext.addEventListener("click", () => {
      const totalPages = Math.max(1, Math.ceil(accountState.total / accountState.pageSize));
      if (accountState.page < totalPages) {
        accountState.page += 1;
        applyFiltersAndRender();
      }
    });
  }

  // Payment modal events
  const btnSavePayment = $("#btnSavePayment");
  const btnAddCashboxInline = $("#btnAddCashboxInline");
  const paymentForm = $("#paymentForm");

  if (btnAddCashboxInline) btnAddCashboxInline.addEventListener("click", handleAddCashboxInline);

  if (btnSavePayment) {
    btnSavePayment.addEventListener("click", async () => {
      if (!paymentForm) return;
      if (!paymentForm.checkValidity()) {
        paymentForm.classList.add("was-validated");
        return;
      }
      await registerPayment();
    });
  }
}

async function reloadLedger() {
  accountState.loading = true;
  renderLoading();

  try {
    // Preferimos view
    let { data, error } = await supabaseClient
      .from("vw_account_ledger")
      .select("*")
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false });

    // fallback
    if (error) {
      console.warn("vw_account_ledger no disponible, fallback a account_ledger:", error);
      const r = await supabaseClient
        .from("account_ledger")
        .select("*")
        .order("movement_date", { ascending: false })
        .order("created_at", { ascending: false });
      data = r.data;
      error = r.error;
    }

    if (error) {
      console.error(error);
      showErrorToast("No se pudieron obtener movimientos.");
      return;
    }

    allLedgerRows = data || [];
    accountState.page = 1;

    await updateBalanceCard();
    applyFiltersAndRender();
    showSuccessToast("Cuenta corriente actualizada.");
  } catch (e) {
    console.error(e);
    showErrorToast("Error inesperado al cargar movimientos.");
  } finally {
    accountState.loading = false;
  }
}

function renderLoading() {
  const tbody = $("#accountTableBody");
  if (!tbody) return;
  tbody.innerHTML = `
    <tr>
      <td colspan="6" class="text-center py-3">
        <div class="spinner-border spinner-border-sm me-2" role="status"></div>
        Cargando movimientos...
      </td>
    </tr>
  `;
}

function applyFiltersAndRender() {
  const search = accountState.search.trim().toLowerCase();
  const { customer_id, movement_type, date_from, date_to } = accountState.filters;

  let filtered = allLedgerRows.slice();

  if (customer_id) filtered = filtered.filter((r) => String(r.customer_id) === String(customer_id));
  if (movement_type) filtered = filtered.filter((r) => String(r.movement_type) === String(movement_type));

  if (search) {
    filtered = filtered.filter((r) => {
      const h = [r.reference, r.notes, r.customer_name || r.customer_nombre, r.movement_type]
        .map((v) => (v ? String(v).toLowerCase() : ""))
        .join(" ");
      return h.includes(search);
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

  lastFilteredRows = filtered;
  accountState.total = filtered.length;

  const totalPages = Math.max(1, Math.ceil(accountState.total / accountState.pageSize));
  if (accountState.page > totalPages) accountState.page = totalPages;

  const start = (accountState.page - 1) * accountState.pageSize;
  const end = start + accountState.pageSize;
  const pageRows = filtered.slice(start, end);

  renderTable(pageRows);
  renderPagination(filtered.length, accountState.page, accountState.pageSize);
}

function typeBadge(t) {
  const s = String(t || "");
  if (s === "SALE") return `<span class="badge text-bg-warning">SALE</span>`;
  if (s === "PAYMENT") return `<span class="badge text-bg-success">PAYMENT</span>`;
  if (s === "ADJ") return `<span class="badge text-bg-secondary">ADJ</span>`;
  return `<span class="badge text-bg-light border">${esc(s)}</span>`;
}

function renderTable(rows) {
  const tbody = $("#accountTableBody");
  if (!tbody) return;

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-3 text-muted">
          No hay movimientos para los filtros seleccionados.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows
    .map((r) => {
      const cust = r.customer_name || r.customer_nombre || "";
      const amt = Number(r.amount || 0);

      return `
        <tr>
          <td>${esc(r.movement_date ? formatDate(r.movement_date) : formatDate(r.created_at))}</td>
          <td>${esc(cust)}</td>
          <td>${typeBadge(r.movement_type)}</td>
          <td class="text-end">$ ${money(amt)}</td>
          <td>${esc(r.reference || "")}</td>
          <td>${esc(r.notes || "")}</td>
        </tr>
      `;
    })
    .join("");
}

function renderPagination(totalFiltered, page, pageSize) {
  const info = $("#accountRowsInfo");
  const indicator = $("#accountPageIndicator");
  const btnPrev = $("#accountPrevPage");
  const btnNext = $("#accountNextPage");

  const total = totalFiltered;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  if (info) info.textContent = total ? `Mostrando ${from}–${to} de ${total}` : "Sin resultados";
  if (indicator) indicator.textContent = page;
  if (btnPrev) btnPrev.disabled = page <= 1;
  if (btnNext) btnNext.disabled = page >= totalPages;
}

async function updateBalanceCard() {
  const customer_id = accountState.filters.customer_id || "";
  const balText = $("#accountBalanceText");
  const hint = $("#accountBalanceHint");

  if (!customer_id) {
    if (balText) balText.textContent = "$ 0";
    if (hint) hint.textContent = "Seleccioná un cliente.";
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from("vw_account_balance_by_customer")
      .select("customer_id, balance")
      .eq("customer_id", customer_id)
      .single();

    if (error) {
      console.warn("No se pudo leer balance (view):", error);
      if (hint) hint.textContent = "No se pudo calcular el saldo (ver view).";
      return;
    }

    const balance = Number(data?.balance || 0);
    if (balText) balText.textContent = `$ ${money(balance)}`;
    if (hint) hint.textContent = "Saldo = Ventas - Pagos";
  } catch (e) {
    console.error(e);
    if (hint) hint.textContent = "Error al calcular saldo.";
  }
}

// ======================================================
// PAYMENT MODAL
// ======================================================

function getPaymentModalInstance() {
  if (!paymentModalInstance) {
    const el = $("#paymentModal");
    if (el) paymentModalInstance = new bootstrap.Modal(el);
  }
  return paymentModalInstance;
}

function resetPaymentForm() {
  const form = $("#paymentForm");
  if (!form) return;
  form.reset();
  form.classList.remove("was-validated");
  const date = $("#paymentDate");
  if (date) date.value = new Date().toISOString().slice(0, 10);

  const filterCustomer = $("#filterAccountCustomer")?.value || "";
  const customerSel = $("#paymentCustomer");
  if (customerSel && filterCustomer) customerSel.value = filterCustomer;
}

async function openPaymentModal() {
  if (!accountState.filters.customer_id) {
    showErrorToast("Seleccioná un cliente en filtros primero.");
    return;
  }
  resetPaymentForm();
  await loadCashboxes();

  const modal = getPaymentModalInstance();
  if (modal) modal.show();
}

async function handleAddCashboxInline() {
  const { value: vals } = await Swal.fire({
    title: "Nueva caja",
    html: `
      <div class="mb-2 text-start">
        <label class="form-label form-label-sm">Código</label>
        <input id="swal-cashbox-code" class="form-control form-control-sm" placeholder="Ej: CAJA-01" />
      </div>
      <div class="mb-2 text-start">
        <label class="form-label form-label-sm">Nombre</label>
        <input id="swal-cashbox-name" class="form-control form-control-sm" placeholder="Caja principal" />
      </div>
      <div class="mb-2 text-start">
        <label class="form-label form-label-sm">Descripción (opcional)</label>
        <input id="swal-cashbox-desc" class="form-control form-control-sm" placeholder="" />
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: "Guardar",
    cancelButtonText: "Cancelar",
    preConfirm: () => {
      const code = document.getElementById("swal-cashbox-code").value.trim();
      const name = document.getElementById("swal-cashbox-name").value.trim();
      const description = document.getElementById("swal-cashbox-desc").value.trim();
      if (!code || !name) {
        Swal.showValidationMessage("Completá código y nombre.");
        return;
      }
      return { code, name, description };
    },
  });

  if (!vals) return;

  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseClient
      .from("cashboxes")
      .insert({
        code: vals.code,
        name: vals.name,
        description: vals.description || null,
        is_active: true,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id")
      .single();

    if (error) {
      console.error(error);
      showErrorToast(error.message || "No se pudo crear la caja.");
      return;
    }

    showSuccessToast("Caja creada.");
    await loadCashboxes();

    const sel = $("#paymentCashbox");
    if (sel && data?.id) sel.value = data.id;
  } catch (e) {
    console.error(e);
    showErrorToast("Error inesperado creando caja.");
  }
}

async function registerPayment() {
  const customer_id = $("#paymentCustomer")?.value || "";
  const movement_date = $("#paymentDate")?.value || "";
  const amount = Number($("#paymentAmount")?.value || 0);
  const cashbox_id = $("#paymentCashbox")?.value || "";
  const reference = $("#paymentReference")?.value?.trim() || null;
  const notes = $("#paymentNotes")?.value?.trim() || null;

  if (!customer_id || !movement_date || !cashbox_id || !(amount > 0)) {
    showErrorToast("Completá cliente, fecha, monto y caja.");
    return;
  }

  const nowIso = new Date().toISOString();

  try {
    const { error: ledErr } = await supabaseClient.from("account_ledger").insert({
      customer_id,
      movement_type: "PAYMENT",
      amount,
      reference,
      movement_date,
      notes,
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
    });

    if (ledErr) {
      console.error(ledErr);
      showErrorToast(ledErr.message || "No se pudo registrar el pago en cuenta corriente.");
      return;
    }

    const { error: cashErr } = await supabaseClient.from("cash_movements").insert({
      cashbox_id,
      movement_type: "IN",
      category: "PAYMENT",
      amount,
      customer_id,
      reference,
      movement_date,
      notes,
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
    });

    if (cashErr) {
      console.error(cashErr);
      showErrorToast(cashErr.message || "No se pudo registrar el ingreso en caja.");
      return;
    }

    showSuccessToast("Pago registrado.");
    const modal = getPaymentModalInstance();
    if (modal) modal.hide();

    await reloadLedger();
  } catch (e) {
    console.error(e);
    showErrorToast("Error inesperado registrando pago.");
  }
}

// ======================================================
// EXPORTS
// ======================================================

function exportAccountCsv() {
  if (!lastFilteredRows.length) {
    showErrorToast("No hay movimientos para exportar.");
    return;
  }

  const header = ["Fecha", "Cliente", "Tipo", "Monto", "Referencia", "Notas"];
  const rows = lastFilteredRows.map((r) => [
    r.movement_date ? formatDate(r.movement_date) : formatDate(r.created_at),
    r.customer_name || r.customer_nombre || "",
    r.movement_type || "",
    Number(r.amount || 0),
    r.reference || "",
    r.notes || "",
  ]);

  const csv = [header, ...rows]
    .map((line) =>
      line
        .map((v) => {
          const s = v === null || v === undefined ? "" : String(v);
          return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `account_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportAccountXlsx() {
  if (!lastFilteredRows.length) {
    showErrorToast("No hay movimientos para exportar.");
    return;
  }

  const rows = lastFilteredRows.map((r) => ({
    Fecha: r.movement_date ? formatDate(r.movement_date) : formatDate(r.created_at),
    Cliente: r.customer_name || r.customer_nombre || "",
    Tipo: r.movement_type || "",
    Monto: Number(r.amount || 0),
    Referencia: r.reference || "",
    Notas: r.notes || "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "CuentaCorriente");
  XLSX.writeFile(wb, `account_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
