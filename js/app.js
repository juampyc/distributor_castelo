document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('toggleTheme')?.addEventListener('click', ()=>{
    const html = document.documentElement;
    html.setAttribute('data-bs-theme', (html.getAttribute('data-bs-theme')||'light')==='light'?'dark':'light');
  });
});