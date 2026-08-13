/* =========================================================
   DUDO — control de apuestas
   MODELO DE DATOS
   jugadores: [{ id, nombre, apuesta, celdas:[{ monto, editado }] }]
       celdas[p] = lo que ese jugador puso en el partido p (antes de multiplicadores)
   partidos:  [{ cerrado, netos:{idJugador:neto}, ganadores:[id], unaFicha:[id], tres }]
       netos solo tiene algo cuando el partido ya se cerró
   Cada columna es un partido completo, con su propio ganador y sus propias cuentas.
   ========================================================= */
let jugadores = [];
let partidos = [];
let contadorId = 1;
const MAX_PARTIDOS = 30;

// Nombre por defecto: "Jugador 1", "Jugador 2"... buscando el primer número libre
// para que no se repita si quitás a alguien de en medio.
function nombrePorDefecto(){
  const usados = new Set(jugadores.map(j => j.nombre));
  let n = 1;
  while (usados.has('Jugador ' + n)) n++;
  return 'Jugador ' + n;
}

/* ---------- animación del cierre ----------
   Marcas de un solo uso: dibujar() las gasta y las apaga, para que la
   animación corra una vez al cerrar y no se repita en cada redibujado. */
let destelloPartido = -1;
let destelloGanadores = [];

// Si el aparato pidió menos movimiento, se respeta
function prefiereQuieto(){
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function partidoNuevo(){
  return { cerrado:false, netos:{}, ganadores:[], unaFicha:[], tres:false };
}

/* =========================================================
   GUARDADO
   Usa window.storage si existe (visor de Claude) y si no
   localStorage (cuando abrís el archivo en tu propia máquina).
   ========================================================= */
const CLAVE = 'dudo-mesa-v2';
let temporizadorGuardado = null;
let modoGuardado = 'memoria'; // 'claude' | 'local' | 'memoria'

// Se prueba UNA sola vez al abrir, con una escritura real
async function detectarGuardado(){
  try{
    if (window.storage && window.storage.set){
      await window.storage.set(CLAVE + '-prueba', 'ok');
      try{ await window.storage.delete(CLAVE + '-prueba'); }catch(e){}
      modoGuardado = 'claude';
      return;
    }
  }catch(e){ /* no sirve, seguimos */ }

  try{
    localStorage.setItem(CLAVE + '-prueba', 'ok');
    localStorage.removeItem(CLAVE + '-prueba');
    modoGuardado = 'local';
    return;
  }catch(e){ /* no sirve, seguimos */ }

  modoGuardado = 'memoria'; // no hay dónde guardar, solo dura la sesión
}

async function guardarAhora(){
  if (modoGuardado === 'memoria') return;
  const datos = JSON.stringify({ jugadores, partidos, contadorId });
  try{
    if (modoGuardado === 'claude') await window.storage.set(CLAVE, datos);
    else localStorage.setItem(CLAVE, datos);
  }catch(e){
    // si falla, bajamos a memoria y lo avisamos en pantalla, nunca en la consola
    modoGuardado = 'memoria';
    actualizarPie();
    avisar('No se pudo guardar en este visor');
  }
}

// se llama en cada cambio; espera un poco para no escribir en cada tecla
function guardar(){
  if (modoGuardado === 'memoria') return;
  clearTimeout(temporizadorGuardado);
  temporizadorGuardado = setTimeout(guardarAhora, 350);
}

async function leerGuardado(){
  try{
    if (modoGuardado === 'claude'){
      const r = await window.storage.get(CLAVE);
      return r && r.value ? JSON.parse(r.value) : null;
    }
    if (modoGuardado === 'local'){
      const crudo = localStorage.getItem(CLAVE);
      return crudo ? JSON.parse(crudo) : null;
    }
  }catch(e){ /* no hay nada guardado todavía */ }
  return null;
}

/* ---------- avisos y confirmación propios ----------
   Nada de alert, confirm ni prompt: en varios visores vienen bloqueados
   y el botón se queda sin hacer nada. */
let temporizadorAviso = null;
function avisar(mensaje){
  const a = document.getElementById('aviso');
  a.textContent = mensaje;
  a.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { a.hidden = true; }, 2200);
}

function confirmar(titulo, texto, alAceptar){
  document.getElementById('tituloConfirmar').textContent = titulo;
  document.getElementById('textoConfirmar').textContent = texto;
  const boton = document.getElementById('btnConfirmar');
  boton.onclick = () => { cerrar('modalConfirmar'); alAceptar(); };
  abrir('modalConfirmar');
}

/* ---------- utilidades ---------- */
function q(n){
  const r = Math.round(n * 100) / 100;
  return 'Q' + (Number.isInteger(r) ? r : r.toFixed(2));
}
function firmado(n){
  const r = Math.round(n * 100) / 100;
  const txt = Number.isInteger(r) ? Math.abs(r) : Math.abs(r).toFixed(2);
  if (r > 0) return '+Q' + txt;
  if (r < 0) return '−Q' + txt;
  return 'Q0';
}
/* ---------- validación de montos ----------
   Un input type=number deja escribir de todo con el teclado: negativos,
   letras, notación científica y cifras absurdas. Todo lo que entra pasa por aquí. */
const MONTO_MAX = 999999;
const MAX_NOMBRE = 18;

function montoValido(valor){
  const n = Number(valor);
  if (!isFinite(n))   return { valor:0, aviso:'Eso no es un número' };
  if (n < 0)          return { valor:0, aviso:'No se puede apostar en negativo' };
  if (n > MONTO_MAX)  return { valor:MONTO_MAX, aviso:'El tope por casilla es ' + q(MONTO_MAX) };
  return { valor: Math.round(n * 100) / 100, aviso:null };  // sin basura de decimales
}

function escapar(t){
  return String(t).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function buscar(id){ return jugadores.find(j => j.id === id); }

// Total del jugador: la suma horizontal de los partidos YA CERRADOS.
// Los abiertos no cuentan, porque todavía no se sabe cómo van a quedar.
function totalJugador(j){
  return partidos.reduce((s, p) => p.cerrado ? s + (Number(p.netos[j.id]) || 0) : s, 0);
}

// Suma vertical de una columna: la neta si está cerrado, lo apostado si sigue abierto
function sumaColumna(indice){
  const p = partidos[indice];
  if (p.cerrado){
    return jugadores.reduce((s, j) => s + (Number(p.netos[j.id]) || 0), 0);
  }
  return jugadores.reduce((s, j) => s + (Number(j.celdas[indice].monto) || 0), 0);
}

// El partido en juego es el primero que siga abierto
function indiceAbierto(){
  return partidos.findIndex(p => !p.cerrado);
}

/* ---------- alta y baja ---------- */
function agregarJugador(){
  const apuesta = jugadores.length ? jugadores[0].apuesta : 20;
  const celdas = partidos.map(() => ({ monto: apuesta, editado:false }));
  jugadores.push({ id: contadorId++, nombre: nombrePorDefecto(), apuesta: apuesta, celdas: celdas });
  dibujar();
  // enfocar el nombre recién creado para escribirlo de una vez
  const inputs = document.querySelectorAll('input.nombre');
  const ultimo = inputs[inputs.length - 1];
  if (ultimo){ ultimo.focus(); ultimo.select(); }
}

function quitarJugador(id){
  const j = buscar(id);
  const jugados = partidos.filter(p => p.cerrado && p.netos[id] !== undefined).length;
  const extra = jugados
    ? ' Ya tiene ' + jugados + ' partido' + (jugados === 1 ? '' : 's') + ' cerrado' + (jugados === 1 ? '' : 's') +
      ', así que esas columnas van a dejar de sumar cero y te las voy a marcar en rojo.'
    : '';
  confirmar('Quitar a ' + j.nombre, 'Se borra su fila y todo lo que puso.' + extra, () => {
    jugadores = jugadores.filter(x => x.id !== id);
    partidos.forEach(p => {
      delete p.netos[id];
      p.ganadores = p.ganadores.filter(x => x !== id);
      p.unaFicha = p.unaFicha.filter(x => x !== id);
    });
    dibujar();
    avisar(j.nombre + ' salió de la mesa');
  });
}

// Borra todo y arranca de cero
function nuevaMesa(){
  confirmar('Nueva mesa', 'Se van los jugadores, todos los partidos y lo guardado. No hay vuelta atrás.', () => {
    jugadores = [];
    partidos = [partidoNuevo()];
    contadorId = 1;
    dibujar();
    avisar('Mesa vacía');
  });
}

/* ---------- ediciones en la tabla ---------- */
function cambiarNombre(id, valor){
  const j = buscar(id);
  if (!j) return;
  j.nombre = String(valor).slice(0, MAX_NOMBRE);
  actualizarPie();
}

// Al salir del campo: sin nombre no se puede jugar, así que le ponemos uno.
// También avisa si quedaron dos jugadores llamados igual.
function cerrarNombre(id){
  const j = buscar(id);
  if (!j) return;
  const limpio = j.nombre.trim();
  if (!limpio){
    j.nombre = nombrePorDefecto();
    avisar('Le puse ' + j.nombre + ': no puede quedar sin nombre');
    dibujar();
    return;
  }
  if (limpio !== j.nombre){ j.nombre = limpio; dibujar(); }
  if (jugadores.filter(x => x.nombre === limpio).length > 1){
    avisar('Hay dos ' + limpio + ' en la mesa, fijate de no confundirlos');
  }
}

// Si dos se llaman igual, se les pone el número de fila para poder distinguirlos
function etiqueta(j){
  const repetido = jugadores.filter(x => x.nombre === j.nombre).length > 1;
  return repetido ? (jugadores.indexOf(j) + 1) + ' · ' + j.nombre : j.nombre;
}

// La apuesta rellena las casillas de ESE jugador que no se hayan tocado a mano,
// y solo en los partidos que siguen abiertos: los cerrados ya son historia.
function cambiarApuesta(id, valor){
  const j = buscar(id);
  if (!j) return;
  const r = montoValido(valor);
  if (r.aviso) avisar(r.aviso);
  j.apuesta = r.valor;
  j.celdas.forEach((c, i) => { if (!c.editado && !partidos[i].cerrado) c.monto = j.apuesta; });
  dibujar();
}

// Edición puntual de una casilla: la multa de un jugador en un partido
function cambiarCelda(id, indice, valor){
  const j = buscar(id);
  if (!j || !partidos[indice] || partidos[indice].cerrado) return;
  const c = j.celdas[indice];
  if (!c) return;
  const r = montoValido(valor);
  if (r.aviso) avisar(r.aviso);
  c.monto = r.valor;
  c.editado = true;
  dibujar();
}

function abrirMontoGeneral(){
  const campo = document.getElementById('entradaMonto');
  campo.value = jugadores.length ? jugadores[0].apuesta : '';
  document.getElementById('errorMonto').textContent = '';
  abrir('modalMonto');
  setTimeout(() => { campo.focus(); campo.select(); }, 60);
}

function aplicarMontoGeneral(){
  const monto = Number(document.getElementById('entradaMonto').value);
  if (!(monto > 0)){
    document.getElementById('errorMonto').textContent = 'Poné un monto mayor a cero.';
    return;
  }
  if (!jugadores.length){
    document.getElementById('errorMonto').textContent = 'Primero añadí jugadores.';
    return;
  }
  jugadores.forEach(j => {
    j.apuesta = monto;
    j.celdas.forEach((c, i) => { if (!c.editado && !partidos[i].cerrado) c.monto = monto; });
  });
  cerrar('modalMonto');
  dibujar();
}

/* =========================================================
   DIBUJO DE LA TABLA
   Partido abierto: casillas editables con lo que apostó cada quien.
   Partido cerrado: el resultado neto, verde o rojo, de solo lectura.
   ========================================================= */
function dibujar(){
  const cont = document.getElementById('contenedorTabla');

  if (!jugadores.length){
    cont.innerHTML =
      '<div class="vacio">' +
        '<h3>La mesa está vacía</h3>' +
        '<p>Añadí a los que van a jugar y poné el monto de la apuesta.</p>' +
      '</div>';
    actualizarPie();
    return;
  }

  const abierto = indiceAbierto();

  let html = '<table><thead><tr>';
  html += '<th class="col-nombre">Jugador</th>';
  html += '<th class="col-apuesta">Apuesta</th>';
  partidos.forEach((p, i) => {
    html += '<th class="col-partido ' + (p.cerrado ? 'es-cerrado' : 'es-abierto') + '">';
    html += '<span class="encabezado-partido">Partido ' + (i + 1);
    if (p.cerrado){
      html += '<button class="btn-reabrir" title="Reabrir este partido" onclick="pedirReabrir(' + i + ')">↺</button>';
    }
    html += '</span>';
    html += '<span class="estado-partido">' + (p.cerrado ? 'cerrado' : (i === abierto ? 'en juego' : 'abierto')) + '</span>';
    html += '</th>';
  });
  html += '<th class="col-total">Total</th><th></th></tr></thead><tbody>';

  jugadores.forEach((j, i) => {
    html += '<tr>';
    html += '<td class="col-nombre"><div class="celda-nombre"><span class="ficha-num">' + (i + 1) + '</span>' +
            '<input class="nombre" value="' + escapar(j.nombre) + '" maxlength="' + MAX_NOMBRE + '" ' +
            'oninput="cambiarNombre(' + j.id + ', this.value)" ' +
            'onblur="cerrarNombre(' + j.id + ')"></div></td>';
    html += '<td><input class="monto apuesta" type="number" inputmode="decimal" min="0" max="' + MONTO_MAX + '" value="' + j.apuesta + '" ' +
            'onchange="cambiarApuesta(' + j.id + ', this.value)"></td>';

    partidos.forEach((p, r) => {
      if (p.cerrado){
        const neto = p.netos[j.id];
        // el destello baja escalonado, una fila tras otra
        const chispa = (r === destelloPartido)
          ? ' recien" style="animation-delay:' + (i * 45) + 'ms'
          : '';
        if (neto === undefined){
          // este jugador entró a la mesa después de que se cerró ese partido
          html += '<td class="cerrada' + chispa + '"><span class="neto fuera">—</span></td>';
        } else {
          const clase = neto > 0 ? 'mas' : (neto < 0 ? 'menos' : 'cero');
          html += '<td class="cerrada' + chispa + '"><span class="neto ' + clase + '">' + firmado(neto) + '</span></td>';
        }
      } else {
        const c = j.celdas[r];
        html += '<td><input class="monto' + (c.editado ? ' editado' : '') + '" type="number" inputmode="decimal" min="0" max="' + MONTO_MAX + '" ' +
                'value="' + c.monto + '" onchange="cambiarCelda(' + j.id + ', ' + r + ', this.value)"></td>';
      }
    });

    const total = totalJugador(j);
    const claseTotal = total > 0 ? 'mas' : (total < 0 ? 'menos' : 'cero');
    const pulso = destelloGanadores.includes(j.id) ? ' gano' : '';
    html += '<td class="total ' + claseTotal + pulso + '" data-jugador="' + j.id + '">' + firmado(total) + '</td>';
    html += '<td class="quitar"><button class="btn-x" title="Quitar jugador" onclick="quitarJugador(' + j.id + ')">×</button></td>';
    html += '</tr>';
  });

  // Fila de sumas: en un partido cerrado tiene que dar cero; si no da cero, va en rojo
  html += '</tbody><tfoot><tr>';
  html += '<td class="col-nombre">Suma</td><td></td>';
  partidos.forEach((p, r) => {
    const suma = sumaColumna(r);
    if (p.cerrado){
      const cuadra = Math.abs(suma) < 0.005;
      html += '<td class="' + (cuadra ? 'cuadra' : 'descuadra') + '">' + (cuadra ? 'Q0' : firmado(suma)) + '</td>';
    } else {
      html += '<td class="en-juego">' + q(suma) + '</td>';
    }
  });
  const granTotal = jugadores.reduce((s, j) => s + totalJugador(j), 0);
  const cuadraTodo = Math.abs(granTotal) < 0.005;
  html += '<td class="gran-total ' + (cuadraTodo ? 'cuadra' : 'descuadra') + '">' +
          (cuadraTodo ? 'Q0' : firmado(granTotal)) + '</td><td></td>';
  html += '</tr></tfoot></table>';

  cont.innerHTML = html;
  destelloPartido = -1;      // marcas de un solo uso
  destelloGanadores = [];
  actualizarPie();
}

/* Los totales cuentan desde donde estaban hasta donde quedaron.
   Solo corre al cerrar un partido, no en cada tecleo. */
function animarTotales(previos){
  if (prefiereQuieto()) return;
  const trozos = [];
  document.querySelectorAll('td.total[data-jugador]').forEach(td => {
    const j = buscar(Number(td.dataset.jugador));
    if (!j) return;
    const desde = Number(previos[j.id]) || 0;
    const hasta = totalJugador(j);
    if (desde !== hasta) trozos.push({ td, desde, hasta });
  });
  if (!trozos.length) return;

  const arranque = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const DURACION = 450;
  function paso(ahora){
    const t = Math.min(1, Math.max(0, (ahora - arranque) / DURACION));
    const suave = 1 - Math.pow(1 - t, 3);   // rápido al principio, frena al final
    trozos.forEach(x => {
      x.td.textContent = firmado(t < 1 ? Math.round(x.desde + (x.hasta - x.desde) * suave) : x.hasta);
    });
    if (t < 1) requestAnimationFrame(paso);
  }
  requestAnimationFrame(paso);
}

// deja visible la última columna
function irAlFinal(){
  const cont = document.getElementById('contenedorTabla');
  cont.scrollLeft = cont.scrollWidth;
}

function actualizarPie(){
  const cerrados = partidos.filter(p => p.cerrado).length;
  const abierto = indiceAbierto();

  // Todo en una sola línea, para que el pie no ocupe dos renglones.
  const partes = [
    jugadores.length + ' jugador' + (jugadores.length === 1 ? '' : 'es'),
    abierto >= 0 ? 'En juego: <b>Partido ' + (abierto + 1) + '</b>' : '<b>Sin partido abierto</b>',
    cerrados + ' de ' + partidos.length + ' cerrado' + (partidos.length === 1 ? '' : 's')
  ];
  // El guardado solo se menciona cuando está fallando: si va bien, no gasta espacio.
  if (modoGuardado === 'memoria'){
    partes.push('<span style="color:var(--rojo)">no guarda al recargar</span>');
  }
  document.getElementById('resumenPie').innerHTML = partes.join(' · ');
  document.getElementById('btnFinalizar').disabled = jugadores.length < 2 || abierto < 0;
  guardar(); // actualizarPie corre en cada cambio, así que guardamos aquí
}

/* =========================================================
   MODALES
   ========================================================= */
function abrir(id){ document.getElementById(id).hidden = false; }
function cerrar(id){ document.getElementById(id).hidden = true; }

let unaFicha = [];        // ids de los que perdieron con 1 ficha
let indiceCerrando = -1;  // qué partido está cerrando el modal

function abrirFinalizar(){
  const abierto = indiceAbierto();
  if (jugadores.length < 2 || abierto < 0) return;

  indiceCerrando = abierto;
  unaFicha = [];
  document.getElementById('tituloFinal').textContent = 'Partido ' + (abierto + 1);
  document.getElementById('errorFinal').textContent = '';
  document.getElementById('tresFichas').checked = false;
  document.getElementById('envolturaTres').classList.remove('activo');

  // chips de 1 ficha
  const chips = document.getElementById('chipsUnaFicha');
  chips.innerHTML = jugadores.map(j =>
    '<button class="chip" data-id="' + j.id + '" onclick="alternarFicha(' + j.id + ', this)">' + escapar(etiqueta(j)) + '</button>'
  ).join('');

  // selects de ganadores
  const opciones = jugadores.map(j => '<option value="' + j.id + '">' + escapar(etiqueta(j)) + '</option>').join('');
  document.getElementById('ganador1').innerHTML = '<option value="">GANADOR</option>' + opciones;
  document.getElementById('ganador2').innerHTML = '<option value="">SEGUNDO GANADOR — nadie más</option>' + opciones;
  ['ganador1','ganador2'].forEach(idSel => {
    const sel = document.getElementById(idSel);
    sel.onchange = sincronizarFinal;
    sel.oninput = sincronizarFinal;   // por si el navegador no dispara change
    sel.onblur = sincronizarFinal;
  });
  sincronizarFinal();

  abrir('modalFinal');
}

/* Un ganador no pudo haber perdido con 1 ficha: si lo eligen como ganador,
   se le quita la marca sola y se le bloquea el chip. Tampoco se repite el ganador. */
function sincronizarFinal(){
  const sel2 = document.getElementById('ganador2');
  const id1 = Number(document.getElementById('ganador1').value) || 0;

  // Sin primer ganador no se puede poner el segundo: se apaga y se vacía,
  // para que no quede un segundo ganador escondido si borran el primero.
  sel2.disabled = !id1;
  if (!id1) sel2.value = '';

  const id2 = Number(sel2.value) || 0;
  const ganadores = [id1, id2].filter(Boolean);

  const quitados = unaFicha.filter(id => ganadores.includes(id));
  unaFicha = unaFicha.filter(id => !ganadores.includes(id));
  if (quitados.length){
    avisar(buscar(quitados[0]).nombre + ' ganó, no puede tener 1 ficha');
  }

  document.querySelectorAll('#chipsUnaFicha .chip').forEach(chip => {
    const id = Number(chip.dataset.id);
    const esGanador = ganadores.includes(id);
    chip.disabled = esGanador;
    chip.classList.toggle('bloqueado', esGanador);
    chip.classList.toggle('activo', unaFicha.includes(id));
  });

  // no dejar elegir al mismo en los dos espacios
  document.querySelectorAll('#ganador2 option').forEach(o => { o.disabled = !!o.value && Number(o.value) === id1; });
  document.querySelectorAll('#ganador1 option').forEach(o => { o.disabled = !!o.value && Number(o.value) === id2; });
}

// Lee los selects en el momento, no confía en el estado guardado
function esGanadorActual(id){
  const id1 = Number(document.getElementById('ganador1').value) || 0;
  const id2 = Number(document.getElementById('ganador2').value) || 0;
  return id === id1 || id === id2;
}

function alternarFicha(id, boton){
  // si ya está puesto como ganador, no puede haber perdido con 1 ficha
  if (esGanadorActual(id)){
    avisar(buscar(id).nombre + ' está puesto como ganador');
    return;
  }
  if (unaFicha.includes(id)){
    unaFicha = unaFicha.filter(x => x !== id);
    boton.classList.remove('activo');
  } else {
    unaFicha.push(id);
    boton.classList.add('activo');
  }
}

document.getElementById('tresFichas').addEventListener('change', function(){
  document.getElementById('envolturaTres').classList.toggle('activo', this.checked);
});

/* =========================================================
   CIERRE DE UN PARTIDO
   - cada quien aporta lo que dice su casilla de ESE partido
   - si se ganó con 3 fichas o más: ×2 a la apuesta de todos
   - si alguien perdió con 1 ficha: ×2 extra solo a él, y se acumula con el otro → ×4
   - el pozo lo forman SOLO los perdedores; el ganador no pierde lo suyo
   - los ganadores se parten el pozo en partes iguales
   - al perdedor le queda −(lo que aportó), al ganador +(su parte del pozo)
   - la columna siempre suma cero
   ========================================================= */
function calcularCierre(){
  const err = document.getElementById('errorFinal');
  const indice = indiceCerrando;
  if (indice < 0 || !partidos[indice] || partidos[indice].cerrado){
    err.textContent = 'Ese partido ya no está abierto.';
    return;
  }

  const id1 = Number(document.getElementById('ganador1').value) || 0;
  const id2 = Number(document.getElementById('ganador2').value) || 0;
  const tres = document.getElementById('tresFichas').checked;

  if (jugadores.length < 2){ err.textContent = 'Tiene que haber al menos dos jugadores en la mesa.'; return; }
  if (!id1){ err.textContent = 'Falta decir quién ganó.'; return; }
  if (id2 && id2 === id1){ err.textContent = 'Los dos ganadores tienen que ser distintos.'; return; }
  // por si alguien salió de la mesa con el modal abierto
  if (!buscar(id1) || (id2 && !buscar(id2))){
    err.textContent = 'Ese jugador ya no está en la mesa. Cerrá esto y volvé a intentar.';
    return;
  }
  const ganadores = id2 ? [id1, id2] : [id1];
  if (ganadores.length >= jugadores.length){ err.textContent = 'Tiene que quedar al menos un perdedor.'; return; }

  // Aunque todo lo demás falle, el cálculo se niega a correr con esta combinación
  const choque = unaFicha.filter(id => ganadores.includes(id));
  if (choque.length){
    unaFicha = unaFicha.filter(id => !ganadores.includes(id));
    sincronizarFinal();
    err.textContent = buscar(choque[0]).nombre + ' no puede haber ganado y perdido con 1 ficha. Ya le quité la marca, revisá y dale otra vez.';
    return;
  }

  // lo que aporta cada quien en este partido, con su multiplicador
  const aporte = {};
  jugadores.forEach(j => {
    let mult = 1;
    if (tres) mult *= 2;                                                  // ×2 a todos: se ganó con 3 fichas o más
    if (unaFicha.includes(j.id) && !ganadores.includes(j.id)) mult *= 2;  // ×2 extra: perdió con 1 ficha
    aporte[j.id] = (Number(j.celdas[indice].monto) || 0) * mult;
  });

  // el pozo lo ponen solo los perdedores
  const pozo = jugadores
    .filter(j => !ganadores.includes(j.id))
    .reduce((s, j) => s + aporte[j.id], 0);
  // sin pozo no hay partido que cerrar
  if (!(pozo > 0)){
    err.textContent = 'Nadie puso nada en este partido. Poné los montos en la columna antes de cerrarlo.';
    return;
  }
  const premio = pozo / ganadores.length;

  const netos = {};
  jugadores.forEach(j => {
    netos[j.id] = ganadores.includes(j.id) ? premio : -aporte[j.id];
  });

  // Red de seguridad: una columna cerrada SIEMPRE suma cero.
  // Si por lo que sea no cuadra, no se guarda nada.
  const cuadre = jugadores.reduce((t, j) => t + netos[j.id], 0);
  if (Math.abs(cuadre) > 0.005){
    err.textContent = 'Las cuentas no cuadran (' + firmado(cuadre) + '), así no lo voy a cerrar. Revisá los montos.';
    return;
  }

  partidos[indice] = {
    cerrado: true,
    netos: netos,
    ganadores: ganadores.slice(),
    unaFicha: unaFicha.slice(),
    tres: tres
  };

  cerrar('modalFinal');

  // de dónde venían los totales, para que la cifra cuente hasta la nueva
  const totalesPrevios = {};
  jugadores.forEach(j => { totalesPrevios[j.id] = totalJugador(j) - (netos[j.id] || 0); });

  // Se abre solo el siguiente partido con el monto de apuesta de cada quien.
  // Esta es la ÚNICA forma de crear una columna: no hay botón para adelantarse.
  let seTopo = false;
  if (indiceAbierto() < 0){
    if (partidos.length < MAX_PARTIDOS){
      partidos.push(partidoNuevo());
      jugadores.forEach(j => j.celdas.push({ monto: j.apuesta, editado:false }));
    } else {
      seTopo = true;   // 30 partidos: ya no cabe otro
    }
  }

  destelloPartido = indice;
  destelloGanadores = ganadores.slice();
  dibujar();
  irAlFinal();
  animarTotales(totalesPrevios);
  avisar(seTopo
    ? 'Partido ' + (indice + 1) + ' cerrado · llegaste al tope de ' + MAX_PARTIDOS
    : 'Partido ' + (indice + 1) + ' cerrado');
}

/* Reabrir: las casillas vuelven a los montos apostados, queda editable
   otra vez y sale del total. Se pide confirmación antes. */
function pedirReabrir(indice){
  if (!partidos[indice] || !partidos[indice].cerrado) return;
  confirmar('Reabrir el partido ' + (indice + 1),
    'Se borran los resultados de esa columna, las casillas vuelven a los montos apostados y el partido sale del total.',
    () => {
      partidos[indice] = partidoNuevo();
      dibujar();
      avisar('Partido ' + (indice + 1) + ' reabierto');
    });
}

/* cerrar modal tocando el fondo */
document.querySelectorAll('.velo').forEach(v => {
  v.addEventListener('click', e => { if (e.target === v) v.hidden = true; });
});

/* =========================================================
   ARRANQUE
   ========================================================= */
function pintarDados(){
  // tres dados decorativos con caras 5, 3 y 6
  const caras = {
    5:[1,0,1,0,1,0,1,0,1],
    3:[1,0,0,0,1,0,0,0,1],
    6:[1,0,1,1,0,1,1,0,1]
  };
  document.getElementById('dados').innerHTML = [5,3,6].map(c =>
    '<div class="dado">' + caras[c].map(p => '<span class="pip' + (p ? '' : ' off') + '"></span>').join('') + '</div>'
  ).join('');
}

// Deja el estado sano aunque lo guardado venga incompleto o de una versión vieja
function normalizar(datos){
  if (!datos || !Array.isArray(datos.jugadores) || !datos.jugadores.length) return false;

  partidos = Array.isArray(datos.partidos) && datos.partidos.length
    ? datos.partidos.slice(0, MAX_PARTIDOS).map(p => ({
        cerrado: !!(p && p.cerrado),
        netos: (p && typeof p.netos === 'object' && p.netos) ? p.netos : {},
        ganadores: Array.isArray(p && p.ganadores) ? p.ganadores : [],
        unaFicha: Array.isArray(p && p.unaFicha) ? p.unaFicha : [],
        tres: !!(p && p.tres)
      }))
    : [partidoNuevo()];

  // Los ids son la llave de los resultados guardados. Si vienen repetidos o
  // rotos no hay forma de saber de quién es cada neto, así que se renumera
  // a todos y se sueltan los resultados: los jugadores se salvan, las cuentas no.
  const idsSanos = datos.jugadores.every((j, i, arr) => {
    const id = Number(j && j.id);
    return Number.isInteger(id) && id > 0 &&
           arr.findIndex(x => Number(x && x.id) === id) === i;
  });
  if (!idsSanos){
    datos.jugadores.forEach((j, i) => { if (j) j.id = i + 1; });
    partidos = partidos.map(() => partidoNuevo());
    setTimeout(() => avisar('Lo guardado venía dañado: recuperé los jugadores, no los resultados'), 700);
  }

  jugadores = datos.jugadores.map((j, i) => {
    const apuesta = montoValido(j && j.apuesta).valor;
    const nombre = String((j && j.nombre) || '').trim().slice(0, MAX_NOMBRE) || 'Jugador ' + (i + 1);
    const guardadas = Array.isArray(j && j.celdas) ? j.celdas : [];
    const celdas = [];
    for (let r = 0; r < partidos.length; r++){
      const c = guardadas[r];
      celdas.push(c
        ? { monto: montoValido(c.monto).valor, editado: !!c.editado }
        : { monto: apuesta, editado:false });
    }
    return { id: Number(j.id), nombre: nombre, apuesta: apuesta, celdas: celdas };
  });

  // un partido "cerrado" sin resultados de nadie en realidad está abierto
  const vivos = new Set(jugadores.map(j => j.id));
  partidos.forEach(p => {
    const limpios = {};
    Object.keys(p.netos).forEach(k => {
      const n = Number(p.netos[k]);
      if (vivos.has(Number(k)) && isFinite(n)) limpios[Number(k)] = n;
    });
    p.netos = limpios;
    p.ganadores = p.ganadores.map(Number).filter(x => vivos.has(x));
    p.unaFicha = p.unaFicha.map(Number).filter(x => vivos.has(x));
    if (p.cerrado && !Object.keys(p.netos).length) Object.assign(p, partidoNuevo());
  });

  // el contador nunca puede repetir un id que ya está en la mesa
  const mayor = jugadores.reduce((m, j) => Math.max(m, j.id), 0);
  contadorId = Math.max(Number(datos.contadorId) || 1, mayor + 1);
  return true;
}

async function iniciar(){
  pintarDados();
  await detectarGuardado();
  const datos = await leerGuardado();

  if (normalizar(datos)){
    dibujar();
    avisar('Mesa recuperada');
  } else {
    partidos = [partidoNuevo()];
    agregarJugador();   // la mesa arranca con uno solo: los demás se van añadiendo
    if (modoGuardado === 'memoria'){
      setTimeout(() => avisar('Este visor no deja guardar: descargá el archivo'), 700);
    }
  }
  if (document.activeElement) document.activeElement.blur();
}

// guarda de una si cerrás la pestaña antes de que corra el temporizador
window.addEventListener('beforeunload', guardarAhora);

iniciar();
