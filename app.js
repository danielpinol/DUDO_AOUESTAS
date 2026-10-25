/* =========================================================
   DUDO — control de apuestas
   MODELO DE DATOS
   jugadores: [{ id, nombre, apuesta, celdas:[{ monto, multa }] }]
       celdas[p].monto = la apuesta de la mesa en el partido p (no se edita a mano
                         en la tabla: sale del botón "Monto de la apuesta")
       celdas[p].multa = el recargo que lleva SOLO ese jugador en ese partido.
                         Se edita en la casilla. Paga monto + multa.
   partidos:  [{ cerrado, netos:{idJugador:neto}, ganadores:[id], unaFicha:[id], tres, perdioPrimero }]
       netos solo tiene algo cuando el partido ya se cerró
       perdioPrimero = id del primero que perdió en ese partido (null si no lo han anotado).
                       La regla de la mesa: ese empieza el partido siguiente.
                       El partido 1 no lo empieza nadie fijo: lo sortea la mesa.
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
  return { cerrado:false, netos:{}, ganadores:[], unaFicha:[], tres:false, perdioPrimero:null };
}

/* =========================================================
   GUARDADO
   La mesa vive en el localStorage del navegador, bajo una sola clave.
   Cerrás la pestaña, apagás el teléfono, volvés mañana: la mesa sigue ahí.
   Es por navegador y por dispositivo; no viaja a ningún servidor.

   El único caso en que NO se puede guardar es cuando el navegador tiene el
   almacenamiento bloqueado (modo incógnito de algunos, cookies apagadas).
   Ahí se sigue jugando igual, pero solo mientras la pestaña esté abierta,
   y el pie lo avisa en rojo para que nadie se lleve la sorpresa.
   ========================================================= */
const CLAVE = 'dudo-mesa-v2';
let temporizadorGuardado = null;
let modoGuardado = 'memoria'; // 'local' | 'memoria'

// Se prueba UNA sola vez al abrir, con una escritura de verdad: preguntar si
// localStorage "existe" no sirve, en incógnito existe y revienta al escribir.
function detectarGuardado(){
  try{
    localStorage.setItem(CLAVE + '-prueba', 'ok');
    localStorage.removeItem(CLAVE + '-prueba');
    modoGuardado = 'local';
  }catch(e){
    modoGuardado = 'memoria';   // no hay dónde guardar, solo dura la sesión
  }
}

function guardarAhora(){
  if (modoGuardado === 'memoria') return;
  try{
    localStorage.setItem(CLAVE, JSON.stringify({ jugadores, partidos, contadorId }));
  }catch(e){
    // si falla (por ejemplo, disco lleno) se avisa en pantalla, nunca en la consola
    modoGuardado = 'memoria';
    actualizarPie();
    avisar('No se pudo guardar en este navegador');
  }
}

// se llama en cada cambio; espera un poco para no escribir en cada tecla
function guardar(){
  if (modoGuardado === 'memoria') return;
  clearTimeout(temporizadorGuardado);
  temporizadorGuardado = setTimeout(guardarAhora, 350);
}

function leerGuardado(){
  if (modoGuardado !== 'local') return null;
  try{
    const crudo = localStorage.getItem(CLAVE);
    return crudo ? JSON.parse(crudo) : null;
  }catch(e){
    return null;   // no hay nada guardado todavía, o quedó ilegible
  }
}

/* ---------- avisos y confirmación propios ----------
   Nada de alert, confirm ni prompt: en varios navegadores vienen bloqueados
   y el botón se queda sin hacer nada. */
let temporizadorAviso = null;
// tipo 'alerta': en rojo, se sacude y dura más, para lo que hay que corregir
function avisar(mensaje, tipo){
  const a = document.getElementById('aviso');
  const alerta = tipo === 'alerta';
  a.textContent = mensaje;
  a.className = 'aviso' + (alerta ? ' alerta' : '');
  a.hidden = false;
  // Si el aviso ya estaba en pantalla la animación no vuelve a correr sola:
  // se apaga, se fuerza el dibujado y se vuelve a prender.
  a.style.animation = 'none';
  void a.offsetWidth;
  a.style.animation = '';
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { a.hidden = true; }, alerta ? 4000 : 2200);
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

/* Lo que se apostó en una columna. No hay una sola cifra garantizada: cada
   quien puede llevar una multa distinta en su casilla. Se toma la que más se
   repite, que es la apuesta de la mesa, y se avisa aparte si alguien va aparte. */
function apuestaColumna(indice){
  const cuenta = new Map();
  let conMulta = 0;
  jugadores.forEach(j => {
    const c = j.celdas[indice];
    if (!c) return;
    const m = Number(c.monto) || 0;
    cuenta.set(m, (cuenta.get(m) || 0) + 1);
    if ((Number(c.multa) || 0) > 0) conMulta++;
  });
  if (!cuenta.size) return { monto:0, multas:0 };

  let comun = 0, veces = -1;
  cuenta.forEach((n, m) => { if (n > veces){ veces = n; comun = m; } });
  return { monto: comun, multas: conMulta };
}

// Lo que pone ese jugador en ese partido, antes de dobles y virgos
function loQuePone(j, indice){
  const c = j.celdas[indice];
  if (!c) return 0;
  return (Number(c.monto) || 0) + (Number(c.multa) || 0);
}

// Suma vertical de una columna: la neta si está cerrado, lo apostado si sigue abierto
function sumaColumna(indice){
  const p = partidos[indice];
  if (p.cerrado){
    return jugadores.reduce((s, j) => s + (Number(p.netos[j.id]) || 0), 0);
  }
  return jugadores.reduce((s, j) => s + loQuePone(j, indice), 0);
}

// El partido en juego es el primero que siga abierto
function indiceAbierto(){
  return partidos.findIndex(p => !p.cerrado);
}

/* ---------- alta y baja ---------- */
function agregarJugador(enfocar){
  const apuesta = jugadores.length ? jugadores[0].apuesta : 20;
  const celdas = partidos.map(() => ({ monto: apuesta, multa:0 }));
  jugadores.push({ id: contadorId++, nombre: nombrePorDefecto(), apuesta: apuesta, celdas: celdas });
  dibujar();
  // Enfocar el nombre recién creado para escribirlo de una vez.
  // Al ARRANCAR no: en Android eso levanta el teclado antes de que se vea nada,
  // el visualViewport se parte a la mitad y la tabla queda debajo del teclado,
  // como si no tuviera ni un dato.
  if (enfocar === false) return;
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
      if (p.perdioPrimero === id) p.perdioPrimero = null;
    });
    dibujar();
    avisar(j.nombre + ' salió de la mesa');
  });
}

// Borra todo y arranca de cero
function nuevaMesa(){
  confirmar('Nueva mesa', 'Se van los jugadores, todos los partidos y lo guardado. No se puede regresar.', () => {
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
  refrescarNombres();
  actualizarPie();
}

/* Mientras se escribe un nombre la tabla no se redibuja (se perdería el
   cursor), así que lo que repite nombres fuera de la columna de jugadores se
   pone al día aquí: las opciones de "perdió primero" y el nombre que muestra
   su caja. Se recalculan todos porque un cambio puede volver repetido
   (o dejar de serlo) el nombre de otro. */
function refrescarNombres(){
  document.querySelectorAll('select.perdio-sel, #perdioPrimero').forEach(sel => {
    for (let k = 0; k < sel.options.length; k++){
      const j = buscar(Number(sel.options[k].value));
      if (j) sel.options[k].textContent = etiqueta(j);
    }
  });
  document.querySelectorAll('[data-nombre-de]').forEach(el => {
    const j = buscar(Number(el.getAttribute('data-nombre-de')));
    if (j) el.textContent = etiqueta(j);
  });
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

/* La multa de UN jugador en UN partido. No toca a nadie más: esa persona paga
   la apuesta de la mesa más su multa. Cero es lo normal. */
function cambiarMulta(id, indice, valor){
  const j = buscar(id);
  if (!j || !partidos[indice] || partidos[indice].cerrado) return;
  const c = j.celdas[indice];
  if (!c) return;
  const r = montoValido(valor);
  if (r.aviso) avisar(r.aviso);
  c.multa = r.valor;
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
    j.celdas.forEach((c, i) => { if (!partidos[i].cerrado) c.monto = monto; });
  });
  cerrar('modalMonto');
  dibujar();
}

/* ---------- perdió primero ----------
   A la gente se le olvida quién sale. La regla: el primero que pierde en un
   partido empieza el siguiente (el partido 1 lo sortea la mesa). Se anota en
   el encabezado de la columna en cuanto pasa, y al cerrar el partido se
   vuelve a preguntar, ya con lo anotado, por si nadie se acordó. Quién
   empieza solo se dice en la alerta del cierre: con eso arrancan y ya no
   hace falta tenerlo a la vista durante el partido. */
function opcionesJugadores(seleccionado){
  return '<option value="">Escoger</option>' + jugadores.map(j =>
    '<option value="' + j.id + '"' + (j.id === seleccionado ? ' selected' : '') + '>' + escapar(etiqueta(j)) + '</option>'
  ).join('');
}

function cambiarPerdio(indice, valor){
  const p = partidos[indice];
  if (!p || p.cerrado) return;
  const id = Number(valor) || 0;
  p.perdioPrimero = buscar(id) ? id : null;
  dibujar();
}

function textoChoque(id){
  return buscar(id).nombre + ' perdió primero, así que no pudo haber ganado. Cambiá el ganador o quién perdió primero.';
}

/* =========================================================
   DIBUJO DE LA TABLA
   Partido abierto: casillas editables con lo que apostó cada quien.
   Partido cerrado: el resultado neto, verde o rojo, de solo lectura.
   ========================================================= */
function dibujar(){
  const cont = document.getElementById('contenedorTabla');
  // El marco mide lo que mide la tabla (width:max-content). Cuando adentro no
  // hay tabla sino un mensaje, ese ancho ya no sirve: hay que avisarle para que
  // se abra a lo ancho de la pantalla en vez de encogerse al ancho del texto.
  const marco = document.querySelector('.marco');
  const nombres = document.getElementById('columnaNombres');

  if (!jugadores.length){
    if (marco) marco.classList.add('sin-mesa');
    nombres.innerHTML = '';
    cont.innerHTML =
      '<div class="vacio">' +
        '<div class="vacio-dado" aria-hidden="true">' +
          '<span></span><span></span><span></span>' +
          '<span></span><span></span><span></span>' +
          '<span></span><span></span><span></span>' +
        '</div>' +
        '<h3>La mesa está vacía</h3>' +
        '<p>Añadí a los que van a jugar y poné el monto de la apuesta.</p>' +
      '</div>';
    actualizarPie();
    return;
  }
  if (marco) marco.classList.remove('sin-mesa');

  const abierto = indiceAbierto();

  // Dos tablas con las mismas filas: izq = solo los nombres (no se mueve),
  // html = los partidos y el total (es la que se desliza)
  let izq = '<table><thead><tr><th class="col-nombre">Jugador</th></tr></thead><tbody>';
  let html = '<table><thead><tr>';
  partidos.forEach((p, i) => {
    html += '<th class="col-partido ' + (p.cerrado ? 'es-cerrado' : 'es-abierto') + '">';
    html += '<span class="encabezado-partido">Partido ' + (i + 1);
    if (p.cerrado){
      html += '<button class="btn-reabrir" title="Reabrir este partido" onclick="pedirReabrir(' + i + ')">↺</button>';
    }
    html += '</span>';
    html += '<span class="estado-partido">' + (p.cerrado ? 'cerrado' : (i === abierto ? 'en juego' : 'abierto')) + '</span>';
    // La apuesta de esa columna, chiquita, debajo del nombre del partido
    const a = apuestaColumna(i);
    html += '<span class="apuesta-partido">apuesta = ' + q(a.monto) +
            (a.multas ? '<i>' + a.multas + ' con multa</i>' : '') + '</span>';
    if (p.cerrado){
      // ya cerrado queda de recuerdo: chiquito y sin caja
      const quien = buscar(p.perdioPrimero);
      if (quien){
        html += '<span class="perdio-cerrado">perdió primero' +
                  '<b data-nombre-de="' + quien.id + '">' + escapar(etiqueta(quien)) + '</b></span>';
      }
    } else {
      /* Quién perdió primero: una sola caja con el rótulo adentro, que se lee
         como un campo y no como renglones sueltos. Nada de filas aparte: cada
         renglón de más es un jugador menos en pantalla. El select va encima,
         invisible, y es el que recibe el toque: abre la lista de siempre. */
      const quien = buscar(p.perdioPrimero);
      html += '<label class="perdio-caja' + (quien ? '' : ' pendiente') + '">' +
                '<span class="perdio-rotulo">Perdió primero</span>' +
                '<span class="perdio-valor"' + (quien ? ' data-nombre-de="' + quien.id + '"' : '') + '>' +
                  (quien ? escapar(etiqueta(quien)) : 'Escoger') + '</span>' +
                '<select class="perdio-sel" aria-label="Perdió primero en el partido ' + (i + 1) + '" ' +
                  'onchange="cambiarPerdio(' + i + ', this.value)">' + opcionesJugadores(p.perdioPrimero) + '</select>' +
              '</label>';
    }
    html += '</th>';
  });
  html += '<th class="col-total">Total</th><th></th></tr></thead><tbody>';

  jugadores.forEach((j, i) => {
    izq += '<tr><td class="col-nombre"><div class="celda-nombre"><span class="ficha-num">' + (i + 1) + '</span>' +
           '<input class="nombre" value="' + escapar(j.nombre) + '" maxlength="' + MAX_NOMBRE + '" ' +
           'oninput="cambiarNombre(' + j.id + ', this.value)" ' +
           'onblur="cerrarNombre(' + j.id + ')"></div></td></tr>';
    html += '<tr>';

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
        // La apuesta ya está en el encabezado de la columna: repetirla en cada
        // fila era ruido. Aquí solo va lo que cambia de una persona a otra.
        const c = j.celdas[r];
        const multa = Number(c.multa) || 0;
        html += '<td class="' + (r === abierto ? 'jugando' : 'abierta') +
                (multa > 0 ? ' con-multa' : '') + '">' +
                '<label class="celda-multa">' +
                  '<input class="monto multa" type="number" inputmode="decimal" min="0" max="' + MONTO_MAX + '" ' +
                  'value="' + multa + '" onchange="cambiarMulta(' + j.id + ', ' + r + ', this.value)">' +
                  '<span class="rotulo-multa">Multa</span>' +
                '</label></td>';
      }
    });

    const total = totalJugador(j);
    const claseTotal = total > 0 ? 'mas' : (total < 0 ? 'menos' : 'cero');
    const pulso = destelloGanadores.includes(j.id) ? ' gano' : '';
    html += '<td class="total ' + claseTotal + pulso + '" data-jugador="' + j.id + '">' + firmado(total) + '</td>';
    // Basurero en su propia columna, lejos del nombre, para no borrar a nadie sin querer
    html += '<td class="quitar"><button class="btn-basura" title="Quitar jugador" aria-label="Quitar a ' + escapar(j.nombre) + '" onclick="quitarJugador(' + j.id + ')">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M9 2.5h6l.8 1.5H20v2.2H4V4h4.2L9 2.5zM5.6 8h12.8l-1.1 13.5H6.7L5.6 8zm4 2.5v8.5h1.6v-8.5H9.6zm3.2 0v8.5h1.6v-8.5h-1.6z"/></svg>' +
            '</button></td>';
    html += '</tr>';
  });

  // Fila de sumas: en un partido cerrado tiene que dar cero; si no da cero, va en rojo
  izq += '</tbody><tfoot><tr><td class="col-nombre">Suma</td></tr></tfoot></table>';
  html += '</tbody><tfoot><tr>';
  partidos.forEach((p, r) => {
    const suma = sumaColumna(r);
    if (p.cerrado){
      const cuadra = Math.abs(suma) < 0.005;
      html += '<td class="' + (cuadra ? 'cuadra' : 'descuadra') + '">' + (cuadra ? 'Q0' : firmado(suma)) + '</td>';
    } else {
      html += '<td class="en-juego' + (r === abierto ? ' jugando' : '') + '">' + q(suma) + '</td>';
    }
  });
  const granTotal = jugadores.reduce((s, j) => s + totalJugador(j), 0);
  const cuadraTodo = Math.abs(granTotal) < 0.005;
  html += '<td class="gran-total ' + (cuadraTodo ? 'cuadra' : 'descuadra') + '">' +
          (cuadraTodo ? 'Q0' : firmado(granTotal)) + '</td><td></td>';
  html += '</tr></tfoot></table>';

  nombres.innerHTML = izq;
  cont.innerHTML = html;
  igualarFilas();
  destelloPartido = -1;      // marcas de un solo uso
  destelloGanadores = [];
  actualizarPie();
}

/* Las dos tablas son independientes, así que cada fila de nombres tiene que
   medir lo mismo que su fila de partidos o se desalinean (el encabezado de
   los partidos, por ejemplo, es mucho más alto que "Jugador"). Se mide todo
   primero y se escribe después, para no forzar el dibujado fila por fila. */
function igualarFilas(){
  const izq = document.querySelectorAll('#columnaNombres tr');
  const der = document.querySelectorAll('#contenedorTabla tr');
  if (!izq.length || izq.length !== der.length) return;
  let i;
  for (i = 0; i < izq.length; i++){ izq[i].style.height = ''; der[i].style.height = ''; }
  const altos = [];
  for (i = 0; i < izq.length; i++){
    altos.push(Math.ceil(Math.max(izq[i].getBoundingClientRect().height, der[i].getBoundingClientRect().height)));
  }
  for (i = 0; i < izq.length; i++){
    izq[i].style.height = altos[i] + 'px';
    der[i].style.height = altos[i] + 'px';
  }
}

// Al girar la iPad o cuando terminan de llegar las letras, los altos cambian
window.addEventListener('resize', igualarFilas);
window.addEventListener('orientationchange', () => setTimeout(igualarFilas, 300));
if (document.fonts && document.fonts.ready) document.fonts.ready.then(igualarFilas);

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
  const abierto = indiceAbierto();

  // Solo dos datos: cuántos son y por qué partido van.
  const partes = [
    jugadores.length + ' jugador' + (jugadores.length === 1 ? '' : 'es'),
    abierto >= 0 ? 'Partido <b>' + (abierto + 1) + '</b>' : 'Sin partido abierto'
  ];
  // El guardado solo se menciona cuando está fallando: si va bien, no gasta espacio.
  if (modoGuardado === 'memoria'){
    partes.push('<span style="color:var(--rojo)">no guarda al recargar</span>');
  }
  document.getElementById('resumenPie').innerHTML = partes.join(' · ');
  document.getElementById('btnFinalizar').disabled = jugadores.length < 2 || abierto < 0;
  const btnFin = document.getElementById('btnFinNoche');
  if (btnFin) btnFin.disabled = !partidosJugados();
  guardar(); // actualizarPie corre en cada cambio, así que guardamos aquí
}

/* =========================================================
   FIN DE LA NOCHE
   Un resumen de todo lo que pasó: cómo quedó cada quien y qué pasó en cada
   partido. No borra nada, la mesa queda igual: el paso de confirmar es solo
   para que nadie lo abra de un dedazo en medio de una partida.
   ========================================================= */
function partidosJugados(){
  return partidos.filter(p => p.cerrado).length;
}

function pedirFinNoche(){
  const cuantos = partidosJugados();
  if (!cuantos){ avisar('Todavía no hay ningún partido cerrado'); return; }
  confirmar('Fin de la noche',
    'Se arma el resumen de ' + cuantos + ' partido' + (cuantos === 1 ? '' : 's') +
    ' y de cómo quedó cada quien. No se borra nada: la mesa queda igual por si van a seguir.',
    abrirResumen);
}

// Lo que se llevaron los ganadores en un partido: el pozo que se repartió
function pozoDe(p){
  return jugadores.reduce((t, j) => t + Math.max(0, Number(p.netos[j.id]) || 0), 0);
}

/* Quién le paga a quién, con la menor cantidad de pagos posible.
   Al final de la noche nadie quiere leer una tabla de netos y ponerse a
   restar: quiere que le digan "Tavo le da Q205 a Piña" y ya.
   Se emparejan los que más deben con los que más tienen por cobrar, y cada
   pago cierra al menos una de las dos puntas: salen como mucho N-1 pagos. */
function cuentasDeLaNoche(){
  const deben  = [];
  const cobran = [];
  jugadores.forEach(j => {
    const t = Math.round(totalJugador(j) * 100) / 100;
    if (t < -0.005)      deben.push({ j: j, falta: -t });
    else if (t > 0.005) cobran.push({ j: j, falta: t });
  });
  deben.sort((a, b) => b.falta - a.falta);
  cobran.sort((a, b) => b.falta - a.falta);

  const pagos = [];
  let d = 0, c = 0, vueltas = 0;
  // el tope de vueltas es una red por si algún redondeo raro no deja avanzar
  while (d < deben.length && c < cobran.length && vueltas++ < 400){
    const monto = Math.min(deben[d].falta, cobran[c].falta);
    if (monto > 0.005) pagos.push({ de: deben[d].j, a: cobran[c].j, monto: monto });
    deben[d].falta  -= monto;
    cobran[c].falta -= monto;
    if (deben[d].falta  <= 0.005) d++;
    if (cobran[c].falta <= 0.005) c++;
  }
  return pagos;
}

function abrirResumen(){
  const cerrados = partidos
    .map((p, i) => ({ p: p, i: i }))
    .filter(x => x.p.cerrado);

  const repartido = cerrados.reduce((s, x) => s + pozoDe(x.p), 0);

  const puestos = jugadores
    .map(j => ({
      j: j,
      total: totalJugador(j),
      ganados: cerrados.filter(x => x.p.ganadores.includes(j.id)).length
    }))
    .sort((a, b) => b.total - a.total);

  const cobran = puestos.filter(x => x.total >  0.005);
  const pagan  = puestos.filter(x => x.total < -0.005);
  const iguales = puestos.filter(x => Math.abs(x.total) <= 0.005);

  let html = '<div class="res-cabecera">' +
    '<h2>Fin de la noche</h2>' +
    '<p class="res-sub">' +
      cerrados.length + ' partido' + (cerrados.length === 1 ? '' : 's') + ' jugado' + (cerrados.length === 1 ? '' : 's') +
      ' · ' + jugadores.length + ' jugador' + (jugadores.length === 1 ? '' : 'es') +
      ' · ' + q(repartido) + ' repartidos' +
    '</p></div>';

  /* ---------- 1. LAS CUENTAS: lo primero, porque es lo que se necesita ---------- */
  const pagos = cuentasDeLaNoche();
  html += '<section class="res-bloque res-cuentas">' +
          '<h3>Quién le paga a quién</h3>';

  if (!pagos.length){
    html += '<p class="res-nada">Nadie le debe nada a nadie: la noche quedó pareja.</p>';
  } else {
    html += '<ul class="res-lista">';
    pagos.forEach(pg => {
      html += '<li class="res-pago">' +
        '<span class="res-de">' + escapar(pg.de.nombre) + '</span>' +
        '<span class="res-flecha" aria-hidden="true">→</span>' +
        '<span class="res-a">' + escapar(pg.a.nombre) + '</span>' +
        '<span class="res-monto">' + q(pg.monto) + '</span>' +
      '</li>';
    });
    html += '</ul>';
  }

  // Si alguien se salió de la mesa a medias, las columnas dejan de sumar cero
  // y estos pagos no cierran. Más vale decirlo que dar una cuenta falsa.
  const descuadre = jugadores.reduce((s, j) => s + totalJugador(j), 0);
  if (Math.abs(descuadre) > 0.005){
    html += '<p class="res-alerta">Ojo: las cuentas de la mesa no dan cero (' +
            firmado(descuadre) + '), seguramente porque alguien salió a media noche. ' +
            'Estos pagos no van a cerrar del todo.</p>';
  }
  html += '</section>';

  html += '<div class="res-columnas">';

  /* ---------- 2. CÓMO QUEDÓ CADA QUIEN ---------- */
  html += '<section class="res-bloque"><h3>Cómo quedó cada quien</h3>';

  const grupo = (rotulo, clase, lista) => {
    if (!lista.length) return '';
    let t = '<p class="res-grupo ' + clase + '">' + rotulo + '</p><ul class="res-lista">';
    lista.forEach(x => {
      t += '<li class="res-jugador ' + clase + '">' +
        '<span class="res-nombre">' + escapar(x.j.nombre) + '</span>' +
        '<span class="res-ganados">' +
          (x.ganados ? 'ganó ' + x.ganados + ' de ' + cerrados.length : 'no ganó ninguno') +
        '</span>' +
        '<span class="res-plata">' + firmado(x.total) + '</span>' +
      '</li>';
    });
    return t + '</ul>';
  };

  html += grupo('Cobran', 'cobra', cobran);
  html += grupo('Pagan', 'paga', pagan);
  html += grupo('Quedaron iguales', 'igual', iguales);
  html += '</section>';

  /* ---------- 3. PARTIDO POR PARTIDO, con encabezados ---------- */
  html += '<section class="res-bloque"><h3>Partido por partido</h3>' +
    '<table class="res-tabla"><thead><tr>' +
      '<th>#</th><th>Ganó</th><th>Apuesta</th><th>Pozo</th>' +
    '</tr></thead><tbody>';

  cerrados.forEach(x => {
    const nombres = x.p.ganadores
      .map(id => { const j = buscar(id); return j ? escapar(j.nombre) : 'ya no está'; })
      .join(' y ');
    let marcas = '';
    if (x.p.tres) marcas += '<em class="res-marca virgo">virgo</em>';
    if (x.p.unaFicha.length){
      marcas += '<em class="res-marca doble">' + x.p.unaFicha.length + ' doble</em>';
    }
    html += '<tr>' +
      '<td class="res-num">' + (x.i + 1) + '</td>' +
      '<td class="res-gano">' + (nombres || '—') + marcas + '</td>' +
      '<td class="res-apuesta">' + q(apuestaColumna(x.i).monto) + '</td>' +
      '<td class="res-pozo">' + q(pozoDe(x.p)) + '</td>' +
    '</tr>';
  });
  html += '</tbody></table></section>';

  html += '</div>';

  document.getElementById('cuerpoResumen').innerHTML = html;
  abrir('modalResumen');
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
  // ya viene con lo que anotaron en el encabezado, si lo anotaron
  document.getElementById('perdioPrimero').innerHTML = opcionesJugadores(partidos[abierto].perdioPrimero);
  ['ganador1','ganador2','perdioPrimero'].forEach(idSel => {
    const sel = document.getElementById(idSel);
    sel.onchange = sincronizarFinal;
    sel.oninput = sincronizarFinal;   // por si el navegador no dispara change
    sel.onblur = sincronizarFinal;
  });
  sincronizarFinal();

  abrir('modalFinal');
}

/* Un ganador no pudo haber perdido con 1 ficha: si lo eligen como ganador,
   se le quita la marca sola y se le bloquea el chip. Tampoco se repite el ganador.
   Ni pudo haber perdido primero, pero eso NO se arregla solo: no se sabe cuál
   de las dos está mal, así que se marcan las dos en rojo y que escojan. */
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

  // Cada cambio deja viejo el error de abajo; si el choque sigue, se vuelve a poner
  const selPerdio = document.getElementById('perdioPrimero');
  const idPerdio = Number(selPerdio.value) || 0;
  const choca = !!idPerdio && ganadores.includes(idPerdio);
  selPerdio.classList.toggle('choca', choca);
  document.getElementById('ganador1').classList.toggle('choca', choca && idPerdio === id1);
  sel2.classList.toggle('choca', choca && idPerdio === id2);
  document.getElementById('errorFinal').textContent = choca ? textoChoque(idPerdio) : '';
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
   - si se ganó con 3 fichas o más (virgo): cada perdedor pone UNA apuesta más
   - si alguien perdió con 1 ficha (doble): ese pone UNA apuesta más
   - los dos recargos SE SUMAN, cada uno vale una apuesta, y no se multiplican:
     con apuesta de Q20 -> doble Q40, virgo Q40, doble+virgo Q60 (no Q80)
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
  const idPerdio = Number(document.getElementById('perdioPrimero').value) || 0;
  const tres = document.getElementById('tresFichas').checked;

  if (jugadores.length < 2){ err.textContent = 'Tiene que haber al menos dos jugadores en la mesa.'; return; }
  if (!id1){ err.textContent = 'Falta decir quién ganó.'; return; }
  if (id2 && id2 === id1){ err.textContent = 'Los dos ganadores tienen que ser distintos.'; return; }
  // sin esto no se sabe quién empieza el siguiente, que es justo lo que se olvida
  if (!idPerdio){ err.textContent = 'Falta decir quién perdió primero: ese empieza el siguiente.'; return; }
  // por si alguien salió de la mesa con el modal abierto
  if (!buscar(id1) || (id2 && !buscar(id2)) || !buscar(idPerdio)){
    err.textContent = 'Ese jugador ya no está en la mesa. Cerrá esto y volvé a intentar.';
    return;
  }
  const ganadores = id2 ? [id1, id2] : [id1];
  if (ganadores.length >= jugadores.length){ err.textContent = 'Tiene que quedar al menos un perdedor.'; return; }
  if (ganadores.includes(idPerdio)){ err.textContent = textoChoque(idPerdio); return; }

  // Aunque todo lo demás falle, el cálculo se niega a correr con esta combinación
  const choque = unaFicha.filter(id => ganadores.includes(id));
  if (choque.length){
    unaFicha = unaFicha.filter(id => !ganadores.includes(id));
    sincronizarFinal();
    err.textContent = buscar(choque[0]).nombre + ' no puede haber ganado y perdido con 1 ficha. Ya le quité la marca, revisá y dale otra vez.';
    return;
  }

  /* Lo que aporta cada quien en este partido.
     Cada recargo vale UNA apuesta más y se SUMAN entre ellos; no se multiplican.
     Con apuesta de Q20: doble = 20+20 = 40, virgo = 20+20 = 40,
     doble y virgo a la vez = 20+20+20 = 60. Nunca 80.

     La multa va aparte y se suma UNA sola vez al final: es un castigo de esa
     persona, no una apuesta, así que no se dobla con el doble ni con el virgo.
     Apuesta 20, multa 15, perdió doble en partido de virgo: 20+20+20+15 = 75. */
  const aporte = {};
  jugadores.forEach(j => {
    const esGanador = ganadores.includes(j.id);
    const porVirgo  = tres && !esGanador;
    const porDoble  = unaFicha.includes(j.id) && !esGanador;
    const recargos  = (porVirgo ? 1 : 0) + (porDoble ? 1 : 0);
    const base  = Number(j.celdas[indice].monto) || 0;
    const multa = Number(j.celdas[indice].multa) || 0;
    aporte[j.id] = base * (1 + recargos) + multa;
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
    tres: tres,
    perdioPrimero: idPerdio
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
      jugadores.forEach(j => j.celdas.push({ monto: j.apuesta, multa:0 }));
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
  abrirEmpieza(indice);
}

/* Después de cerrar, en grande: quién empieza el siguiente, que es lo que se
   les olvida. No se cierra tocando el fondo: hay que darle al botón. */
function abrirEmpieza(indiceCerrado){
  const quien = buscar(partidos[indiceCerrado].perdioPrimero);
  // Solo si el que sigue está por jugarse. Si llegaron al tope no hay
  // siguiente, y si cerraron uno viejo que habían reabierto, el siguiente
  // ya se jugó.
  const siguiente = partidos[indiceCerrado + 1];
  if (!quien || !siguiente || siguiente.cerrado) return;
  document.getElementById('tituloEmpieza').textContent = 'Partido ' + (indiceCerrado + 1) + ' terminado';
  document.getElementById('rotuloEmpieza').textContent = 'El partido ' + (indiceCerrado + 2) + ' lo empieza';
  document.getElementById('nombreEmpieza').textContent = etiqueta(quien);
  document.getElementById('btnEmpieza').textContent = 'Empezar partido ' + (indiceCerrado + 2);
  abrir('modalEmpieza');
}

/* Reabrir: las casillas vuelven a los montos apostados, queda editable
   otra vez y sale del total. Se pide confirmación antes. */
function pedirReabrir(indice){
  if (!partidos[indice] || !partidos[indice].cerrado) return;
  confirmar('Reabrir el partido ' + (indice + 1),
    'Se borran los resultados de esa columna, las casillas vuelven a los montos apostados y el partido sale del total.',
    () => {
      // quién perdió primero no cambia por reabrirlo
      partidos[indice] = Object.assign(partidoNuevo(), { perdioPrimero: partidos[indice].perdioPrimero });
      dibujar();
      avisar('Partido ' + (indice + 1) + ' reabierto');
    });
}

/* =========================================================
   LA BARRA DE ABAJO
   Está clavada al borde inferior de la PANTALLA con position:fixed, y ya.
   Nada de JavaScript midiendo el teclado: eso era justo lo que la movía.
   Al salir el teclado, la barra se queda donde está y el teclado la tapa.

   Lo único que hace falta de JS es decirle al contenido cuánto alto ocupa la
   barra, para que la última fila de la tabla no quede escondida detrás. Se
   MIDE, no se adivina: el alto cambia con el tamaño de letra, con el largo del
   texto y con la franja de abajo del iPhone.
   ========================================================= */
function medirPie(){
  const pie = document.querySelector('.pie');
  if (!pie) return;
  const alto = Math.ceil(pie.getBoundingClientRect().height);
  if (alto > 0) document.documentElement.style.setProperty('--alto-pie', alto + 'px');
}

if (window.ResizeObserver){
  new ResizeObserver(medirPie).observe(document.querySelector('.pie'));
} else {
  window.addEventListener('resize', medirPie);
  window.addEventListener('orientationchange', () => setTimeout(medirPie, 300));
}
medirPie();

/* cerrar modal tocando el fondo, menos los que son obligatorios (data-fijo) */
document.querySelectorAll('.velo').forEach(v => {
  v.addEventListener('click', e => { if (e.target === v && !v.hasAttribute('data-fijo')) v.hidden = true; });
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
        tres: !!(p && p.tres),
        perdioPrimero: Number(p && p.perdioPrimero) || null
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
      // Lo guardado por una versión vieja traía { monto, editado } sin multa:
      // el monto se respeta tal cual y la multa arranca en cero.
      celdas.push(c
        ? { monto: montoValido(c.monto).valor, multa: montoValido(c.multa).valor }
        : { monto: apuesta, multa:0 });
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
    if (!vivos.has(p.perdioPrimero)) p.perdioPrimero = null;
    if (p.cerrado && !Object.keys(p.netos).length) Object.assign(p, partidoNuevo(), { perdioPrimero: p.perdioPrimero });
  });

  // el contador nunca puede repetir un id que ya está en la mesa
  const mayor = jugadores.reduce((m, j) => Math.max(m, j.id), 0);
  contadorId = Math.max(Number(datos.contadorId) || 1, mayor + 1);
  return true;
}

async function iniciar(){
  pintarDados();

  // Nada de lo de aquí abajo puede tumbar el dibujado. Si el almacén del
  // aparato falla, tarda o devuelve basura, la mesa igual tiene que salir:
  // una tabla en blanco sin explicación es lo peor que puede pasar.
  let recuperada = false;
  try{
    detectarGuardado();
    recuperada = normalizar(leerGuardado());
  }catch(e){
    jugadores = [];
    partidos = [];
    modoGuardado = 'memoria';
  }

  if (recuperada){
    dibujar();
    avisar('Mesa recuperada');
  } else {
    jugadores = [];
    partidos = [partidoNuevo()];
    contadorId = 1;
    agregarJugador(false);   // la mesa arranca con uno solo: los demás se van añadiendo
    if (modoGuardado === 'memoria'){
      setTimeout(() => avisar('Este navegador no deja guardar: la mesa se pierde al cerrar'), 700);
    }
  }
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

// guarda de una si cerrás la pestaña antes de que corra el temporizador
window.addEventListener('beforeunload', guardarAhora);

/* Última red: si iniciar() se cae por lo que sea, la mesa se dibuja igual.
   Antes, un error aquí dejaba la tabla en blanco y sin ninguna señal. */
iniciar().catch(() => {
  try{
    jugadores = [];
    partidos = [partidoNuevo()];
    contadorId = 1;
    modoGuardado = 'memoria';
    agregarJugador(false);
    avisar('Arranqué de cero: no se pudo leer la mesa guardada');
  }catch(e){}
});
