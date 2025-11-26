document.addEventListener('DOMContentLoaded', () => {
  // Siempre arrancar con la barra colapsada (solo íconos en desktop)
  document.body.classList.add('sidebar-collapsed');

  // Toggle claro/oscuro si existe el botón
  const html = document.documentElement;
  const themeBtn = document.getElementById('toggleTheme');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const current = html.getAttribute('data-bs-theme') || 'light';
      html.setAttribute('data-bs-theme', current === 'light' ? 'dark' : 'light');
    });
  }

  // Controles de barra lateral (desktop + mobile)
  const collapseBtn   = document.getElementById('sidebarCollapse');
  const mobileToggle  = document.getElementById('sidebarToggle');
  const backdrop      = document.getElementById('sidebarBackdrop');

  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      document.body.classList.toggle('sidebar-collapsed');
    });
  }

  const closeSidebarMobile = () => {
    document.body.classList.remove('sidebar-open');
  };
  const toggleSidebarMobile = () => {
    document.body.classList.toggle('sidebar-open');
  };

  if (mobileToggle) {
    mobileToggle.addEventListener('click', toggleSidebarMobile);
  }
  if (backdrop) {
    backdrop.addEventListener('click', closeSidebarMobile);
  }
});
