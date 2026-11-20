// MYPECAR RUC GRATIS v3 - BLOQUEA SUNAT y autocompleta gratis
(function(){
  const _open = window.open;
  // Bloquea la ventana de SUNAT
  window.open = function(url, name, specs){
    const _u = url ? url.toString() : '';
    if (_u.includes('consultaruc') || _u.includes('jcrS00Alias') || _u.includes('sunat.gob.pe')) {
      console.log('SUNAT bloqueado, usando API gratis');
      let m = _u.match(/nroRuc=(\d{11})/) || _u.match(/(\d{11})/);
      let ruc = m ? m[1] : (document.querySelector('input[placeholder*="RUC" i]')?.value || '').trim();
      if (ruc) consultarRucGratisReal(ruc);
      return { closed:false, focus:()=>{}, close:()=>{} }; // no abre nada
    }
    return _open.call(window, url, name, specs);
  };

  async function consultarRucGratisReal(ruc){
    let btn = document.querySelector('button i.fa-search, button i.fa-solid.fa-magnifying-glass')?.closest('button') || document.querySelector('button:has(i)');
    let orig = btn ? btn.innerHTML : '';
    if(btn){ btn.innerHTML='⏳'; btn.disabled=true; }
    try{
      let url=`https://api.apis.net.pe/v2/ruc?numero=${ruc}`;
      let proxy=`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      let res = await fetch(proxy);
      if(!res.ok) throw new Error('apisnet fail');
      let j = await res.json();
      let razon = j.nombre || j.razonSocial || j.razon_social || '';
      let direccion = j.direccion || j.direccionCompleta || '';
      let estado = (j.estado || 'ACTIVO').toUpperCase();
      let cond = (j.condicion || j.condicionDomicilio || 'HABIDO').toUpperCase();
      if(!razon) throw new Error('sin razon');

      // Llena los campos de Nuevo Proveedor
      let inputs = document.querySelectorAll('input');
      inputs.forEach(inp=>{
        let id=(inp.id||'').toLowerCase(), name=(inp.name||'').toLowerCase(), ph=(inp.placeholder||'').toLowerCase();
        if(id.includes('razon') || name.includes('razon') || ph.includes('razon') || (inp.closest('div')?.innerHTML||'').includes('Razón Social')){
          // Solo si es el input de razon social vacio
          if(inp.value.trim()==='' || inp===document.querySelectorAll('input')[1]){ /* heuristica */ }
        }
      });
      // Intento directo por posicion: en tu pantalla, RUC es input 0, Razon es input 1
      let todosInputs = document.querySelectorAll('input[type="text"], input:not([type])');
      if(todosInputs.length >= 2){
        // El segundo input suele ser Razon Social
        for(let i=0;i<todosInputs.length;i++){
          let label = todosInputs[i].closest('div')?.parentElement?.innerText || '';
          if(label.includes('Razón Social') || todosInputs[i].previousElementSibling?.textContent?.includes('Razón')){
             todosInputs[i].value = razon; todosInputs[i].dispatchEvent(new Event('input',{bubbles:true})); todosInputs[i].dispatchEvent(new Event('change',{bubbles:true}));
          }
          if(label.includes('Nombre Comercial') && !todosInputs[i].value) {
             // no llenar
          }
        }
      }
      // Metodo mas seguro: busca por el texto "Razón Social" y llena el siguiente input
      document.querySelectorAll('div').forEach(div=>{
        if(div.textContent.trim()==='Razón Social'){
          let inp = div.parentElement?.querySelector('input');
          if(inp){ inp.value=razon; inp.dispatchEvent(new Event('input',{bubbles:true})); }
        }
        if(div.textContent.trim()==='Estado Tributario SUNAT'){
          let sel = div.parentElement?.querySelector('select');
          if(sel){ 
            // intenta poner ACTIVO
            for(let o of sel.options){ if(o.text.toUpperCase().includes(estado)) { sel.value=o.value; sel.dispatchEvent(new Event('change',{bubbles:true})); break; } }
          }
        }
        if(div.textContent.trim()==='Condición del Domicilio'){
          let sel = div.parentElement?.querySelector('select');
          if(sel){ 
            for(let o of sel.options){ if(o.text.toUpperCase().includes(cond) || o.text.toUpperCase().includes('HABIDO')) { sel.value=o.value; sel.dispatchEvent(new Event('change',{bubbles:true})); break; } }
          }
        }
      });

      alert('✅ RUC GRATIS encontrado:\n'+razon+'\n'+estado+' / '+cond);
    }catch(e){
      console.error(e);
      // Si falla la API gratis, ahi si deja abrir SUNAT
      alert('No se pudo gratis, se abre SUNAT como respaldo');
      _open.call(window, `https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/jcrS00Alias?accion=consPorRuc&nroRuc=${ruc}`, '_blank');
    }finally{
      if(btn){ btn.innerHTML=orig; btn.disabled=false; }
    }
  }
})();