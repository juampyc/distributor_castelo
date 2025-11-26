// js/components/dropdownPlus.js
// Componente reutilizable para selects con botón "+" que crea nuevos valores en tablas de catálogo.
// Usa el cliente global `sb` (mismo que vendors.js).

(function () {
  'use strict';

  // Si ya se definió en otra página, no lo redefinimos
  if (window.registerDropdownPlus) return;

  /**
   * Registra un dropdown con botón "+" que abre un mini-modal (SweetAlert)
   * y crea un nuevo registro en la tabla indicada.
   *
   * @param {Object} config
   * @param {string} config.table      - Nombre de la tabla en Supabase (ej: "product_type").
   * @param {string} [config.labelField="name"] - Campo de texto (por defecto "name").
   * @param {string} [config.displayName="valor"] - Nombre descriptivo para el usuario.
   * @param {HTMLElement|string} config.addButton - Botón que dispara el alta (elemento o selector).
   * @param {Function} [config.onCreated] - Callback (row) cuando se crea el registro.
   */
  window.registerDropdownPlus = function registerDropdownPlus(config) {
    const {
      table,
      labelField = 'name',
      displayName = 'valor',
      addButton,
      onCreated,
    } = config || {};

    if (!table || !addButton) return;

    let buttonEl = addButton;
    if (typeof addButton === 'string') {
      buttonEl = document.querySelector(addButton);
    }
    if (!buttonEl) return;

    buttonEl.addEventListener('click', async () => {
      if (!window.Swal) {
        const value = window.prompt(`Nuevo ${displayName}:`);
        if (!value) return;
        await insertValue(value.trim());
        return;
      }

      const result = await Swal.fire({
        title: `Nuevo ${capitalizar(displayName)}`,
        input: 'text',
        inputLabel: `Nombre del ${displayName}`,
        inputPlaceholder: `Ingresá el ${displayName}...`,
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        inputValidator: (value) => {
          if (!value) return 'El valor no puede estar vacío';
          return null;
        },
      });

      if (!result.isConfirmed || !result.value) return;
      await insertValue(result.value.trim());
    });

    async function insertValue(name) {
      // Usa el cliente sb (mismo que vendors.js)
      if (!window.sb) {
        console.warn('Supabase client `sb` no está disponible en DropdownPlus');
        return;
      }

      const payload = {};
      payload[labelField] = name;

      const { data, error } = await sb
        .from(table)
        .insert(payload)
        .select()
        .single();

      if (error) {
        console.error('Error al crear valor en', table, error);
        if (window.Swal) {
          await Swal.fire(
            'Error',
            `No se pudo crear el ${displayName}.`,
            'error'
          );
        } else {
          window.alert('Error al guardar el nuevo valor');
        }
        return;
      }

      if (typeof onCreated === 'function') {
        try {
          onCreated(data);
        } catch (err) {
          console.error('Error en onCreated de DropdownPlus', err);
        }
      }

      if (window.Swal) {
        await Swal.fire(
          'OK',
          `${capitalizar(displayName)} creado correctamente.`,
          'success'
        );
      }
    }

    function capitalizar(str) {
      if (!str) return '';
      return str.charAt(0).toUpperCase() + str.slice(1);
    }
  };
})();
