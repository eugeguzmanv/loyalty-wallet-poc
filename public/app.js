const $ = s => document.querySelector(s);
async function api(url, options={}) {
  const r = await fetch(url, { headers: { "Content-Type":"application/json" }, ...options });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { error:text }; }
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function balance(m,b){return b?.programType==="points"?`${m.points} puntos`:`${m.stamps}/${b?.stampThreshold||8} sellos · ${m.availableRewards} recompensa(s)`;}
async function refresh(){
  const s=await api("/api/state"), b=s.business;
  $("#status").textContent=`Google: ${s.integrations.googleWallet?"configurado":"mock"} · Apple: ${s.integrations.appleWallet?"configurado":"sin certificado"}`;
  if(b){$("#business-form [name=name]").value=b.name;$("#business-form [name=programType]").value=b.programType;$("#business-form [name=stampThreshold]").value=b.stampThreshold;$("#business-form [name=pointsPerVisit]").value=b.pointsPerVisit;}
  $("#members").innerHTML=s.members.length?s.members.map(m=>`
    <article class="member"><div><h3>${esc(m.name)}</h3><div class="small">${esc(m.phone||"Sin teléfono")} · ${balance(m,b)}</div><div class="actions" style="margin-top:12px">
      <button data-scan="${esc(m.qrToken)}">Simular escaneo</button>
      <button class="secondary" data-google="${m.id}">Añadir a Google Wallet</button>
      <a class="button secondary" href="/api/members/${m.id}/apple-pass">Apple pass</a>
      ${b?.programType==="points"?`<button class="secondary" data-deduct="${m.id}">Restar puntos</button>`:""}
      ${m.availableRewards?`<button class="secondary" data-redeem="${m.id}">Canjear recompensa</button>`:""}
    </div></div><img class="qr" src="/api/members/${m.id}/qr-image" alt="QR" onerror="this.style.display='none'"></article>`).join(""):"<p class='muted'>Todavía no hay clientes.</p>";
  $("#events").innerHTML=s.events.slice().reverse().slice(0,30).map(e=>`<div class="event"><b>${esc(e.type)}</b> · ${new Date(e.createdAt).toLocaleString()} <span class="small">${esc(JSON.stringify(e.details))}</span></div>`).join("")||"<p class='muted'>Sin actividad.</p>";
  window.currentState=s;
}
$("#business-form").addEventListener("submit",async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));try{await api("/api/business",{method:"POST",body:JSON.stringify(d)});await refresh();}catch(x){alert(x.message)}});
$("#member-form").addEventListener("submit",async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));try{const r=await api("/api/members",{method:"POST",body:JSON.stringify(d)});$("#new-member").innerHTML=`<div class="notice card"><img class="qr" src="${r.qrDataUrl}"><div><b>${esc(r.member.name)}</b><p class="small">Membresía creada. Usa este QR para probar el escaneo.</p><code>${esc(r.member.qrToken)}</code></div></div>`;e.target.reset();await refresh();}catch(x){alert(x.message)}});
async function scan(token){if(!token)return;try{const r=await api("/api/scan",{method:"POST",body:JSON.stringify({token})});$("#scan-result").innerHTML=`<div class="notice"><b>Visita registrada: ${esc(r.member.name)}</b><br>${balance(r.member,window.currentState.business)}${r.rewardAvailable?"<br>Hay una recompensa disponible. El cliente puede aceptarla o rechazarla; rechazarla no elimina la recompensa.":""}<br><span class="small">Actualización Wallet: ${esc(JSON.stringify(r.walletUpdate))}</span></div>`;$("#scan-token").value="";await refresh();}catch(x){$("#scan-result").innerHTML=`<p class="error">${esc(x.message)}</p>`}}
$("#scan-button").onclick=()=>scan($("#scan-token").value.trim());
$("#members").addEventListener("click",async e=>{
  const btn=e.target.closest("button");if(!btn)return;
  try{
    if(btn.dataset.scan){$("#scan-token").value=btn.dataset.scan;await scan(btn.dataset.scan);}
    if(btn.dataset.google){const r=await api(`/api/members/${btn.dataset.google}/google-save`);window.open(r.url,"_blank");}
    if(btn.dataset.redeem){const accept=confirm("¿Confirmar el canje de una recompensa? Cancelar = rechazar y conservarla.");const r=await api(`/api/members/${btn.dataset.redeem}/redeem`,{method:"POST",body:JSON.stringify({accept})});alert(accept?"Recompensa canjeada.":"Recompensa conservada.");await refresh();}
    if(btn.dataset.deduct){const amount=prompt("¿Cuántos puntos deseas descontar?");if(amount!==null){await api(`/api/members/${btn.dataset.deduct}/deduct-points`,{method:"POST",body:JSON.stringify({amount})});await refresh();}}
  }catch(x){alert(x.message)}
});
$("#camera-button").onclick=async()=>{
  if(!window.Html5Qrcode){alert("No se pudo cargar el lector QR.");return;}
  const reader=new Html5Qrcode("reader");
  try{await reader.start({facingMode:"environment"},{fps:10,qrbox:{width:230,height:230}},async decoded=>{await reader.stop();scan(decoded);},()=>{});}
  catch(e){alert("La cámara requiere HTTPS o localhost, y permiso del navegador. Para probar desde el teléfono usa un túnel HTTPS.");}
};
refresh().catch(e=>{$("#status").textContent=e.message});
