import { getSupabase, parseSbError, sbNow } from './common/supa.js';
import { showToast } from './components/toast.js';

let sb;

document.addEventListener('DOMContentLoaded', async () => {
  sb = await getSupabase();
  document.getElementById('btn-new').addEventListener('click', openNew);
  document.getElementById('btn-save-doc').addEventListener('click', saveDoc);
  document.getElementById('btn-add-line').addEventListener('click', addLine);
  bindCustAutocomplete(document.getElementById('cust-name'));
  bindDiscounts();
  await listDocs();
});

function bindDiscounts(){
  const pct=document.getElementById('disc-pct'), amt=document.getElementById('disc-amt');
  pct.addEventListener('input',()=>{ const s=calcSubtotal(); const p=parseFloat(pct.value||'0'); document.getElementById('disc-amt').value=(s*(p/100)).toFixed(2); recalcTotal(); });
  amt.addEventListener('input',()=>{ const s=calcSubtotal(); const a=parseFloat(amt.value||'0'); document.getElementById('disc-pct').value=(s? (a*100/s):0).toFixed(2); recalcTotal(); });
}

async function listDocs(){
  const { data, error } = await sb.from('sale').select(`id, doc_type, doc_number, doc_date, total, customer:customer_id (name)`).order('doc_date',{ascending:false}).limit(200);
  if(error){ console.error(error); return; }
  const tb=document.getElementById('tbl-docs');
  tb.innerHTML = (data||[]).map(d=>`
    <tr>
      <td>${d.doc_number||''}</td>
      <td>${d.doc_type==='CREDIT_NOTE'?'NC':'Factura'}</td>
      <td>${d.customer?.name||''}</td>
      <td>${d.doc_date||''}</td>
      <td class="text-end">${Number(d.total||0).toFixed(2)}</td>
      <td class="text-end"><button class="btn btn-sm btn-outline-secondary" data-id="${d.id}"><i class="bi bi-eye"></i></button></td>
    </tr>`).join('');
  tb.querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>viewDoc(Number(b.dataset.id))));
}

function openNew(){
  const f = document.getElementById('frm-doc');
  f.reset();
  document.getElementById('doc-number').value='';
  document.getElementById('doc-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('doc-rows').innerHTML='';
  addLine();
  recalcTotal();
  bootstrap.Modal.getOrCreateInstance(document.getElementById('docModal')).show();
}

function addLine(){
  const tb=document.getElementById('doc-rows');
  const tr=document.createElement('tr');
  tr.innerHTML = `
    <td><input class="form-control form-control-sm prod-name" placeholder="Producto" data-id=""></td>
    <td><input class="form-control form-control-sm desc" placeholder="Descripción"></td>
    <td><input type="number" class="form-control form-control-sm qty" min="0.01" step="0.01" value="1"></td>
    <td><input type="number" class="form-control form-control-sm unit" min="0" step="0.01" value="0.00"></td>
    <td class="text-end"><input class="form-control form-control-sm subtotal text-end" readonly></td>
    <td class="text-end"><button class="btn btn-sm btn-outline-danger"><i class="bi bi-x"></i></button></td>`;
  tr.querySelector('button').addEventListener('click',()=>{ tr.remove(); recalcTotal(); });
  const inp=tr.querySelector('.prod-name');
  bindProdAutocomplete(inp, tr);
  ['input','change'].forEach(ev=>{
    tr.querySelector('.qty').addEventListener(ev,()=>updateRowSubtotal(tr));
    tr.querySelector('.unit').addEventListener(ev,()=>updateRowSubtotal(tr));
  });
  tb.appendChild(tr);
}

function bindCustAutocomplete(inp){
  let timer=null;
  inp.addEventListener('input', async ()=>{
    clearTimeout(timer);
    timer=setTimeout(async()=>{
      const val = inp.value.trim(); if(val.length<2) return;
      const {data} = await sb.from('vendor').select('id,name').ilike('name', `%${val}%`).eq('kind','customer').limit(10);
      let menu=inp.parentElement.querySelector('.auto-menu');
      if(!menu){ menu=document.createElement('div'); menu.className='auto-menu position-absolute bg-white rounded p-1'; menu.style.maxHeight='160px'; menu.style.overflow='auto'; inp.parentElement.style.position='relative'; inp.parentElement.appendChild(menu); }
      menu.innerHTML=(data||[]).map(c=>`<div class="px-2 py-1 auto-item" data-id="${c.id}">${c.name}</div>`).join('');
      menu.querySelectorAll('.auto-item').forEach(it=>it.addEventListener('click',()=>{ inp.value=it.textContent; inp.dataset.id=it.dataset.id; menu.remove(); }));
    },250);
  });
}

function bindProdAutocomplete(inp, tr){
  let timer=null;
  inp.addEventListener('input', async ()=>{
    clearTimeout(timer);
    timer=setTimeout(async()=>{
      const val = inp.value.trim(); if(val.length<2) return;
      const {data} = await sb.from('product').select('id, code, description').ilike('description', `%${val}%`).limit(10);
      let menu=inp.parentElement.querySelector('.auto-menu');
      if(!menu){ menu=document.createElement('div'); menu.className='auto-menu position-absolute bg-white rounded p-1'; menu.style.maxHeight='160px'; menu.style.overflow='auto'; inp.parentElement.style.position='relative'; inp.parentElement.appendChild(menu); }
      menu.innerHTML=(data||[]).map(p=>`<div class="px-2 py-1 auto-item" data-id="${p.id}" data-desc="${p.description}">${p.code||''} — ${p.description}</div>`).join('');
      menu.querySelectorAll('.auto-item').forEach(it=>it.addEventListener('click',async()=>{
        inp.value=it.textContent; inp.dataset.id=it.dataset.id; menu.remove();
        // Traer precio sugerido de la lista activa
        const unit = await getSuggestedPrice(Number(it.dataset.id));
        tr.querySelector('.desc').value = it.dataset.desc;
        tr.querySelector('.unit').value = unit.toFixed(2);
        updateRowSubtotal(tr);
      }));
    },250);
  });
}

async function getSuggestedPrice(product_id){
  // Lista activa: fecha actual dentro de rango, si hay varias, mayor list_number
  const today = new Date().toISOString().slice(0,10);
  const { data:pl, error } = await sb.from('price_list')
    .select('id,list_number')
    .lte('start_date', today)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order('list_number', {ascending:false})
    .limit(1);
  if(error || !pl || !pl.length) return 0;
  const plId = pl[0].id;
  const { data:item } = await sb.from('price_list_item').select('unit_price').eq('price_list_id', plId).eq('product_id', product_id).single();
  return item?.unit_price || 0;
}

function updateRowSubtotal(tr){
  const qty=parseFloat(tr.querySelector('.qty').value||'0');
  const unit=parseFloat(tr.querySelector('.unit').value||'0');
  tr.querySelector('.subtotal').value=(qty*unit).toFixed(2);
  recalcTotal();
}

function calcSubtotal(){
  let sum=0;
  document.querySelectorAll('#doc-rows .subtotal').forEach(i=>sum+=parseFloat(i.value||'0'));
  document.getElementById('sum-sub').value=sum.toFixed(2);
  return sum;
}
function recalcTotal(){
  const s = calcSubtotal();
  const d = parseFloat(document.getElementById('disc-amt').value||'0');
  document.getElementById('sum-total').value = Math.max(s-d,0).toFixed(2);
}

async function saveDoc(){
  // Validar
  const type = document.getElementById('doc-type').value;
  const custId = Number(document.getElementById('cust-name').dataset.id||0);
  const docDate = document.getElementById('doc-date').value || new Date().toISOString().slice(0,10);
  if(!custId){ alert('Seleccioná un cliente.'); return; }
  const lines = collectLines(); if(!lines.length){ alert('Agregá al menos una línea.'); return; }

  // Numeración correlativa
  const doc_number = await nextDocNumber(type);

  const subtotal = parseFloat(document.getElementById('sum-sub').value||'0');
  const discount_amount = parseFloat(document.getElementById('disc-amt').value||'0');
  const discount_percent = parseFloat(document.getElementById('disc-pct').value||'0');
  const total = parseFloat(document.getElementById('sum-total').value||'0');

  // Insertar encabezado
  const header = { doc_type:type, doc_number, doc_date:docDate, customer_id:custId, subtotal, discount_amount, discount_percent, total, notes:null, created_at:sbNow() };
  const { data:hdr, error:e1 } = await sb.from('sale').insert(header).select('id').single();
  if(e1){ alert('Error guardando doc: '+parseSbError(e1)); return; }
  const sale_id = hdr.id;

  // Insertar líneas
  const rows = lines.map(l=>({ sale_id, product_id:l.product_id, description:l.description, qty:l.qty, unit_price:l.unit_price, line_total:l.line_total }));
  const { error:e2 } = await sb.from('sale_item').insert(rows);
  if(e2){ alert('Error guardando líneas: '+parseSbError(e2)); return; }

  // Impacto en cuenta corriente (ledger)
  const isInvoice = type==='INVOICE';
  const ledger = { customer_id:custId, entry_date:docDate, ref_doc_type:type, ref_doc_number:doc_number, debit:isInvoice?total:0, credit:isInvoice?0:total, created_at:sbNow() };
  const { error:e3 } = await sb.from('customer_ledger').insert(ledger);
  if(e3){ console.warn('Ledger err:', e3); } // no bloquear

  bootstrap.Modal.getOrCreateInstance(document.getElementById('docModal')).hide();
  showToast('Documento guardado','success');
  await listDocs();
}

function collectLines(){
  const rows=[];
  document.querySelectorAll('#doc-rows tr').forEach(tr=>{
    const pid=Number(tr.querySelector('.prod-name').dataset.id||0);
    const desc=tr.querySelector('.desc').value?.toString().trim()||'';
    const qty=parseFloat(tr.querySelector('.qty').value||'0');
    const unit=parseFloat(tr.querySelector('.unit').value||'0');
    const subtotal=qty*unit;
    if(pid && qty>0){
      rows.push({product_id:pid, description:desc, qty, unit_price:unit, line_total:subtotal});
    }
  });
  return rows;
}

async function nextDocNumber(doc_type){
  // Implementación simple: upsert de secuencia por doc_type
  // 1) leer
  let { data:seq } = await sb.from('document_sequence').select('current_number,prefix').eq('doc_type',doc_type).single();
  // 2) si no existe, crear
  if(!seq){
    const { data:ins } = await sb.from('document_sequence').insert({ doc_type, prefix: doc_type==='INVOICE'?'F-':'NC-', current_number:0 }).select().single();
    seq = ins;
  }
  const next = (seq.current_number||0)+1;
  // 3) update atómico (no 100% seguro sin RPC; sirve para demo)
  await sb.from('document_sequence').update({ current_number: next }).eq('doc_type', doc_type);
  return `${seq.prefix||''}${next}`;
}

async function viewDoc(id){
  // (placeholder) Podrías abrir un modal con detalle
  showToast('Ver detalle #'+id,'secondary');
}
