async function loadKPIs(){
  // totales rápidos
  const [{ count: totalClientes }, { data: porTipoProv }] = await Promise.all([
    sb.from('clients').select('*', { count: 'exact', head: true }),
    sb.rpc('clients_by_type_province')
  ]);

  const kpisRow = document.getElementById('kpisRow');
  kpisRow.innerHTML = `
    <div class="col-6 col-md-3">
      <div class="card"><div class="card-body text-center">
        <div class="text-secondary small">Clientes</div>
        <div class="display-6">${totalClientes ?? 0}</div>
      </div></div></div>
  `;

  const tbody = document.querySelector('#kpiTable tbody');
  tbody.innerHTML = (porTipoProv||[]).map(r=>`
    <tr><td>${$utils.esc(r.comercio_name||'—')}</td><td>${$utils.esc(r.provincia_name||'—')}</td><td class="text-end">${r.cnt}</td></tr>
  `).join('');
}

document.getElementById('btnRefreshKpis').addEventListener('click', loadKPIs);
document.addEventListener('DOMContentLoaded', loadKPIs);
