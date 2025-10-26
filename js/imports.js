const fileInput = document.getElementById('csvFile');
const btnImport = document.getElementById('btnImportCsv');
const logEl = document.getElementById('importLog');
btnImport?.addEventListener('click', async ()=>{
  const f = fileInput.files?.[0];
  if(!f) return Swal.fire('Atención','Elegí un archivo CSV','info');
  const text = await f.text();
  const rows = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  let provCount=0, partCount=0; let lastProvIds = {};
  for(const line of rows){
    const [tipo, provincia, partido] = line.split(',').map(s=> s?.trim());
    if(!tipo || !provincia) continue;
    if(tipo.toLowerCase()==='province'){
      const { data } = await sb.from('provinces').insert({ name: provincia }).select('id').single().onConflict('name').ignore();
      if(data?.id) lastProvIds[provincia]=data.id; provCount++;
    } else if(tipo.toLowerCase()==='partido' && partido){
      let provId = lastProvIds[provincia];
      if(!provId){ const { data: p } = await sb.from('provinces').select('id').eq('name', provincia).maybeSingle(); provId = p?.id; }
      if(!provId) continue;
      await sb.from('partidos').insert({ province_id: provId, name: partido }).onConflict('province_id,name').ignore();
      partCount++;
    }
  }
  if(logEl) logEl.innerHTML = `Importadas Provincias: <b>${provCount}</b> · Partidos: <b>${partCount}</b>`;
  Swal.fire('OK','Importación finalizada','success');
});
