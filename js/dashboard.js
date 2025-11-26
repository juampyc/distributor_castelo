let chartByProvince, chartByType;
async function loadKPIs(){
  const [{ count: totalClientes }, { data: porTipoProv }] = await Promise.all([
    sb.from('clients').select('*', { count: 'exact', head: true }),
    sb.rpc('clients_by_type_province')
  ]);
  const kpisRow = document.getElementById('kpisRow');
  if(kpisRow){
    kpisRow.innerHTML = `<div class="col-6 col-md-3"><div class="card"><div class="card-body text-center"><div class="text-secondary small">Clientes</div><div class="display-6">${totalClientes ?? 0}</div></div></div></div>`;
  }
  const tbody = document.querySelector('#kpiTable tbody');
  if(tbody){
    tbody.innerHTML = (porTipoProv||[]).map(r=>`<tr><td>${$utils.esc(r.comercio_name||'—')}</td><td>${$utils.esc(r.provincia_name||'—')}</td><td class="text-end">${r.cnt}</td></tr>`).join('');
  }
  const { data: allProv } = await sb.from('clients_view').select('provincia_name');
  const provAgg = {}; (allProv||[]).forEach(r=>{ const k=r.provincia_name||'—'; provAgg[k]=(provAgg[k]||0)+1; });
  renderOrUpdateChart('chartByProvince','Clientes por Provincia', Object.keys(provAgg), Object.values(provAgg), (c)=> chartByProvince=c);
  const { data: allType } = await sb.from('clients_view').select('comercio_name');
  const typeAgg = {}; (allType||[]).forEach(r=>{ const k=r.comercio_name||'—'; typeAgg[k]=(typeAgg[k]||0)+1; });
  renderOrUpdateChart('chartByType','Clientes por Tipo', Object.keys(typeAgg), Object.values(typeAgg), (c)=> chartByType=c);
}
function renderOrUpdateChart(canvasId, title, labels, data, setRef){
  const el = document.getElementById(canvasId);
  if(!el || typeof Chart === 'undefined') return;
  if(canvasId==='chartByProvince' && chartByProvince){ chartByProvince.destroy(); }
  if(canvasId==='chartByType' && chartByType){ chartByType.destroy(); }
  const chart = new Chart(el, { type:'bar', data:{ labels, datasets:[{ label:title, data }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:{ y:{ beginAtZero:true, ticks:{ precision:0 }}}} });
  setRef(chart);
}
document.getElementById('btnRefreshKpis')?.addEventListener('click', loadKPIs);
document.addEventListener('DOMContentLoaded', loadKPIs);
