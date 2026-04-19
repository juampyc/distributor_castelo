// js/components/dropdownPlus.js
// Componente genérico para selects con botón "+" (DropdownPlus)
// Uso típico:
// registerDropdownPlus({
//   table: 'product_type',
//   labelField: 'name',
//   displayName: 'tipo de producto',
//   addButton: document.getElementById('btnAddProductTypeForm'),
//   onCreated: (row) => { ... recargar combo ... }
// });

(function () {
  if (typeof window.Swal === "undefined") {
    console.warn("SweetAlert2 no está cargado. dropdownPlus no se inicializa.");
    return;
  }

  // ======================================================
  // TOAST COMPARTIDO (IGUAL A STOCK)
  // ======================================================
  if (typeof window.Toast === "undefined") {
    window.Toast = Swal.mixin({
      toast: true,
      position: "top",
      showConfirmButton: false,
      timerProgressBar: true,
      didOpen: (toast) => {
        toast.addEventListener("mouseenter", Swal.stopTimer);
        toast.addEventListener("mouseleave", Swal.resumeTimer);
      },
    });
  }

  if (typeof window.showSuccessToast !== "function") {
    window.showSuccessToast = function (message) {
      window.Toast.fire({
        icon: "success",
        title: message || "Operación exitosa",
        timer: 2000,
      });
    };
  }

  if (typeof window.showErrorToast !== "function") {
    window.showErrorToast = function (message) {
      window.Toast.fire({
        icon: "error",
        title: message || "Ocurrió un error",
        timer: 3000,
      });
    };
  }

  // ======================================================
  // CLIENTE SUPABASE
  // ======================================================
  function getSupabaseClient() {
    const client = window.sb || window.supabase || null;
    if (!client) {
      console.error("Supabase client no encontrado (sb / supabase).");
      showErrorToast("Error de configuración: Supabase no inicializado.");
    }
    return client;
  }

  // ======================================================
  // FUNCIÓN PRINCIPAL
  // ======================================================
  function registerDropdownPlus(config) {
    if (!config || !config.addButton) return;
    const btn = config.addButton;
    const table = config.table;
    const labelField = config.labelField || "name";
    const displayName = config.displayName || "registro";
    const onCreated = typeof config.onCreated === "function" ? config.onCreated : null;

    btn.addEventListener("click", async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;

      try {
        // Caso especial: ENVASE (container) → nombre + tipo (producto / kit)
        if (table === "container") {
          const { value: formValues } = await Swal.fire({
            title: "Nuevo envase",
            html: `
              <div class="mb-2 text-start">
                <label class="form-label form-label-sm">Nombre del envase</label>
                <input
                  id="swal-envase-name"
                  type="text"
                  class="form-control form-control-sm"
                  placeholder="Ej: Lata 473 ml"
                />
              </div>
              <div class="mb-2 text-start">
                <label class="form-label form-label-sm d-block">Tipo de envase</label>
                <div class="form-check form-check-inline">
                  <input
                    class="form-check-input"
                    type="radio"
                    name="swal-envase-tipo"
                    id="swal-envase-producto"
                    value="producto"
                    checked
                  />
                  <label class="form-check-label" for="swal-envase-producto">Producto</label>
                </div>
                <div class="form-check form-check-inline">
                  <input
                    class="form-check-input"
                    type="radio"
                    name="swal-envase-tipo"
                    id="swal-envase-kit"
                    value="kit"
                  />
                  <label class="form-check-label" for="swal-envase-kit">Kit</label>
                </div>
              </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: "Guardar",
            cancelButtonText: "Cancelar",
            preConfirm: () => {
              const nameInput = document.getElementById("swal-envase-name");
              const tipoInput = document.querySelector(
                'input[name="swal-envase-tipo"]:checked'
              );

              const name = nameInput ? nameInput.value.trim() : "";
              const tipo = tipoInput ? tipoInput.value : "";

              if (!name || !tipo) {
                Swal.showValidationMessage("Completá nombre y tipo de envase.");
                return;
              }

              return {
                name,
                is_kit: tipo === "kit",
              };
            },
          });

          if (!formValues) {
            // cancelado
            return;
          }

          const payload = {
            name: formValues.name,
            is_kit: formValues.is_kit,
          };

          const { data, error } = await supabase
            .from("container")
            .insert(payload)
            .select("*")
            .single();

          if (error) {
            console.error("Error al crear envase:", error);
            showErrorToast(error.message || "No se pudo crear el envase.");
            return;
          }

          showSuccessToast("Envase guardado correctamente.");

          if (onCreated && data) {
            await onCreated(data);
          }

          return;
        }

        // Caso general: otros catálogos (categoría, subcategoría, marca, tamaño, unidad, etc.)
        const { value: name } = await Swal.fire({
          title: `Nuevo ${displayName}`,
          input: "text",
          inputLabel: "Nombre",
          inputPlaceholder: `Ingresá el nombre del ${displayName}`,
          showCancelButton: true,
          confirmButtonText: "Guardar",
          cancelButtonText: "Cancelar",
          inputValidator: (value) => {
            if (!value || !value.trim()) {
              return "Completá el nombre.";
            }
            return null;
          },
        });

        if (!name || !name.trim()) {
          // cancelado o sin dato
          return;
        }

        const payload = {};
        payload[labelField] = name.trim();

        const { data, error } = await supabase
          .from(table)
          .insert(payload)
          .select("*")
          .single();

        if (error) {
          console.error(`Error al crear ${displayName}:`, error);
          showErrorToast(error.message || `No se pudo crear el ${displayName}.`);
          return;
        }

        showSuccessToast("Guardado correctamente.");

        if (onCreated && data) {
          await onCreated(data);
        }
      } catch (err) {
        console.error(`Error inesperado en DropdownPlus (${displayName}):`, err);
        showErrorToast("Ocurrió un error al guardar.");
      }
    });
  }

  // Exponer globalmente
  window.registerDropdownPlus = registerDropdownPlus;
})();
