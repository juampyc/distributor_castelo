// js/sidebar_loader.js

(async function loadSidebar() {
  const container = document.getElementById("sidebarContainer");
  if (!container) return;

  try {
    const resp = await fetch("partials/sidebar.html", { cache: "no-cache" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    container.innerHTML = html;
  } catch (err) {
    console.error("Error cargando sidebar:", err);
    return;
  }

  initSidebarControlsLocal();
  markActiveSidebarLink();
})();

function initSidebarControlsLocal() {
  const collapseBtn  = document.getElementById("sidebarCollapse");
  const mobileToggle = document.getElementById("sidebarToggle");
  const backdrop     = document.getElementById("sidebarBackdrop");

  // Siempre arrancar colapsada (igual que app.js)
  document.body.classList.add("sidebar-collapsed");

  const closeSidebarMobile = () => {
    document.body.classList.remove("sidebar-open");
  };
  const toggleSidebarMobile = () => {
    document.body.classList.toggle("sidebar-open");
  };

  if (collapseBtn && !collapseBtn.dataset.bound) {
    collapseBtn.addEventListener("click", () => {
      document.body.classList.toggle("sidebar-collapsed");
    });
    collapseBtn.dataset.bound = "1";
  }

  if (mobileToggle && !mobileToggle.dataset.bound) {
    mobileToggle.addEventListener("click", toggleSidebarMobile);
    mobileToggle.dataset.bound = "1";
  }

  if (backdrop && !backdrop.dataset.bound) {
    backdrop.addEventListener("click", closeSidebarMobile);
    backdrop.dataset.bound = "1";
  }
}

function markActiveSidebarLink() {
  try {
    const path = window.location.pathname.split("/").pop() || "index.html";
    const links = document.querySelectorAll(".sidebar-nav a.sidebar-link");
    links.forEach((a) => {
      const href = a.getAttribute("href") || "";
      const hrefFile = href.split("/").pop();
      if (hrefFile === path) {
        a.classList.add("active");
      } else {
        a.classList.remove("active");
      }
    });
  } catch (err) {
    console.warn("No se pudo marcar el link activo de la sidebar:", err);
  }
}
