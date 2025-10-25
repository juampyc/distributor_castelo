// Navegación y tema
const sections = {
  dashboard: document.getElementById('section-dashboard'),
  clientes:  document.getElementById('section-clientes'),
  rutas:     document.getElementById('section-rutas'),
  importar:  document.getElementById('section-importar'),
};

function showSection(name){
  Object.entries(sections).forEach(([k,el])=> el.classList.toggle('d-none', k!==name));
  document.querySelectorAll('.nav-link').forEach(a=> a.classList.toggle('active', a.dataset.section===name));
  window.scrollTo({top:0,behavior:'smooth'});
}

document.querySelectorAll('[data-section]').forEach(el=>{
  el.addEventListener('click', (e)=>{ e.preventDefault(); showSection(el.dataset.section); });
});

// default
document.addEventListener('DOMContentLoaded', ()=> showSection('clientes'));

document.getElementById('toggleTheme').addEventListener('click', ()=>{
  const html = document.documentElement;
  html.setAttribute('data-bs-theme', (html.getAttribute('data-bs-theme')||'light')==='light'?'dark':'light');
});

// Utils compartidas
window.$utils = {
  debounce(fn,ms){ let t; return (...a)=>{clearTimeout(t); t=setTimeout(()=>fn(...a),ms);} },
  esc(s){ return String(s||'').replace(/[&<>'"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",""":"&quot;"}[c])); },
};
