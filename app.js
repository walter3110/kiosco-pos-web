/* WRC tech · Punto de venta — sistema de ventas para kioscos y almacenes.
   Todo se guarda en el navegador (localStorage). Sin servidor. */

const CLAVE = 'kiosco_pos_v1';
const VERSION = '2.3 · inventario';
let pedidoInstalar = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pedidoInstalar = e; if (tab === 'mas') render(); });
window.addEventListener('appinstalled', () => { pedidoInstalar = null; toast('¡App instalada!'); });
const MEDIOS = ['Efectivo', 'Débito', 'Crédito', 'Transferencia', 'Mercado Pago'];

// ---------- Datos ----------
const datosIniciales = () => ({
  negocio: 'Mi negocio',
  cajero: '',
  ultimoNro: 0,
  productos: [],
  ventas: [],
  cajas: {},
  movimientos: [], // ingresos de mercadería y ajustes de stock // { 'AAAA-MM-DD': { inicial, cerrada, contado, cierre } }
});

let db = cargar();
function cargar() {
  try {
    const t = localStorage.getItem(CLAVE);
    return t ? { ...datosIniciales(), ...JSON.parse(t) } : datosIniciales();
  } catch (e) {
    return datosIniciales();
  }
}
function guardar() {
  try { localStorage.setItem(CLAVE, JSON.stringify(db)); }
  catch (e) { toast('No se pudo guardar. ¿Memoria llena?'); }
}

// ---------- Utilidades ----------
const esTactil = () => window.matchMedia('(hover: none)').matches;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plata = (n) => '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };
const hoy = () => fechaLocal(new Date());
function fechaLocal(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
const diaDe = (iso) => fechaLocal(new Date(iso));
const hora = (iso) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
const kg = (n) => Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const red3 = (n) => Math.round(n * 1000) / 1000;
const precioTxt = (p) => plata(p.precio) + (p.porPeso ? '/kg' : '');
const stockTxt = (p) => (p.porPeso ? kg(p.stock) + ' kg' : p.stock + ' u.');
const cantStock = (i) => (i.kg != null ? i.kg : i.cant); // cuánto descuenta del stock
const fechaLinda = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('oculto');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('oculto'), 2200);
}
function abrirModal(html) {
  $('#toast').classList.add('oculto');
  $('#modal-contenido').innerHTML = html;
  $('#modal').classList.remove('oculto');
  // Sacar el foco de lo que quedó detrás y ponerlo dentro de la ventana
  if (document.activeElement) document.activeElement.blur();
  if (!esTactil()) {
    const f = document.querySelector('#modal input, #modal select') || document.querySelector('#modal .modal-botones .btn.primario, #modal .modal-botones .btn.cobrar');
    if (f) f.focus();
  }
}
function cerrarModal() {
  $('#modal').classList.add('oculto');
  if (tab === 'vender' && !esTactil()) { const b = $('#escanear'); if (b) b.focus(); }
}
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') cerrarModal(); });

// ---------- Navegación ----------
const TITULOS = {
  vender: ['Venta actual', 'Agregar productos a la venta'],
  productos: ['Productos', 'Precios, stock y categorías'],
  caja: ['Caja del día', 'Ventas, medios de pago y cierre'],
  inventario: ['Inventario', 'Ingreso de mercadería, ajustes y stock'],
  mas: ['Reportes y ajustes', 'Cómo viene el negocio'],
};
let tab = 'vender';
$('#campana').addEventListener('click', () => { vistaInv = 'stock'; filtroInv = ''; irA('inventario'); });
document.querySelectorAll('.tabs button').forEach((b) =>
  b.addEventListener('click', () => irA(b.dataset.tab))
);
function irA(t) {
  tab = t;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('activo', b.dataset.tab === t));
  render();
  window.scrollTo(0, 0);
}
function render() {
  $('#negocio').textContent = db.negocio;
  $('#titulo').textContent = TITULOS[tab][0];
  $('#subtitulo').textContent = TITULOS[tab][1];
  $('#main').classList.toggle('ancho', tab === 'vender');
  const caj = db.cajero || 'Cajero';
  $('#cajero-txt').textContent = db.cajero ? 'Cajero: ' + db.cajero : 'Cajero';
  $('#cajero-ini').textContent = caj.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const bajos = db.productos.filter((p) => p.stock <= (p.stockMin || 0)).length;
  $('#badge').textContent = bajos;
  $('#badge').classList.toggle('oculto', !bajos);
  ({ vender: vistaVender, productos: vistaProductos, inventario: vistaInventario, caja: vistaCaja, mas: vistaMas })[tab]();
}

// ================= VENDER =================
let carrito = []; // { id, nombre, precio, costo, cant }
let medio = 'Efectivo';
let descuento = 0; // en pesos
let pagaCon = ''; // con cuánto paga el cliente (efectivo)
const BILLETES = [1000, 2000, 5000, 10000, 20000];
let busqueda = '';
let sel = -1; // producto resaltado con las flechas
let f1Listo = false; // el primer F1 lleva a "paga con", el segundo cobra

const subtotalCarrito = () => carrito.reduce((a, i) => a + i.precio * i.cant, 0);
const totalCarrito = () => subtotalCarrito();
const nroTxt = (n) => '#' + String(n || 0).padStart(5, '0');

function vistaVender() {
  f1Listo = false;
  const sub = subtotalCarrito();
  const total = totalCarrito();
  const unidades = carrito.reduce((a, i) => a + (i.kg != null ? 1 : i.cant), 0);
  const prods = listaProductosVenta();

  $('#app').innerHTML = `
  <div class="atajos">
    ${[['F1', 'Cobrar'], ['F2', 'Buscar por nombre'], ['F3', 'Medio de pago'], ['F8', 'Importe libre'], ['F9', 'Cancelar venta']]
      .map(([k, t]) => `<button class="atajo" data-tecla="${k}"><kbd>${k}</kbd>${t}</button>`).join('')}
    <span class="atajo-extra"><kbd>3*</kbd> + escanear = cantidad · <kbd>+</kbd><kbd>−</kbd> último · <kbd>Supr</kbd> quitar último · <kbd>Esc</kbd> volver al lector</span>
  </div>
  <div class="venta-grid">
    <div class="tarjeta">
      <div class="lector">
        <div class="lector-tit"><span>📟 Lector de código de barras</span><span class="lector-estado"></span></div>
        <div class="fila">
          <input id="escanear" placeholder="Escaneá o escribí el código" autocomplete="off" enterkeyhint="go" inputmode="numeric">
          <button class="btn primario fijo" id="btn-scan" title="Escanear con la cámara del celular">📷</button>
        </div>
      </div>
      <input id="buscar" style="margin-top:10px" placeholder="🔍  Buscar por nombre…  (F2)" autocomplete="off" enterkeyhint="search" value="${esc(busqueda)}">
      <div class="prod-lista ${!busqueda && !esTactil() ? 'oculto' : ''}" id="prod-lista">${prodListaHtml(prods)}</div>
      <button class="linkbtn" id="btn-libre" style="margin-top:8px">+ Importe libre (fiambre, verdura, varios) <span class="kbd">F8</span></button>

      <div class="ticket">
        ${carrito.length === 0 ? '<div class="vacio">Todavía no agregaste productos</div>' : `
        <ul class="lista">
          ${carrito.map((i, idx) => `
            <li>
              <div class="info">
                <div class="nombre">${esc(i.nombre)}</div>
                <div class="sub">${i.kg != null ? `${kg(i.kg)} kg × ${plata(i.precioKg)}/kg = <b>${plata(i.precio)}</b>` : `${plata(i.precio)} c/u · ${plata(i.precio * i.cant)}`}</div>
              </div>
              <div class="cant">
                ${i.kg != null
                  ? `<button class="btn chico" style="width:auto;border-radius:8px" data-peso="${idx}">⚖️ Peso</button>`
                  : `<button data-menos="${idx}" aria-label="Restar">−</button><b>${i.cant}</b><button data-mas="${idx}" aria-label="Sumar">+</button>`}
                <button class="borrar" data-quitar="${idx}" aria-label="Quitar">🗑</button>
              </div>
            </li>`).join('')}
        </ul>`}
        <div class="subtotales">
          <span>${unidades} producto${unidades === 1 ? '' : 's'}</span>
          <span class="tot">Total: ${plata(total)}</span>
        </div>
      </div>

      <div class="sub" style="margin-top:12px;margin-bottom:6px">Medio de pago <span class="kbd">F3</span></div>
      <div class="pagos">
        ${MEDIOS.map((m) => `<button data-medio="${m}" class="${m === medio ? 'activo' : ''}">${m}</button>`).join('')}
      </div>
      ${medio === 'Efectivo' ? `
        <div class="efectivo">
          <label for="pagaCon">¿Con cuánto paga el cliente?</label>
          <input id="pagaCon" inputmode="decimal" placeholder="$ 0" value="${esc(pagaCon)}">
          <div class="billetes">
            <button data-billete="justo">Justo</button>
            ${BILLETES.map((b) => `<button data-billete="${b}">${plata(b)}</button>`).join('')}
          </div>
          <div class="vuelto-box" id="vuelto">${vueltoHtml(total)}</div>
        </div>` : ''}
      <button class="btn cobrar bloque" id="btn-cobrar" style="margin-top:12px" ${carrito.length ? '' : 'disabled'}>COBRAR ${plata(total)} 💳 <span class="kbd">F1</span></button>
    </div>

    <div class="tarjeta resumen">
      <h2 style="font-size:1.25rem">Resumen de venta</h2>
      <div class="dato"><span class="sub">Productos:</span><b>${unidades}</b></div>
      <div class="dato"><span class="sub">Pago:</span><b>${esc(medio)}</b></div>
      ${ultimasVentasHtml()}
      <button class="btn cancelar bloque" id="btn-vaciar" style="margin-top:14px" ${carrito.length ? '' : 'disabled'}>Cancelar venta 🗑 <span class="kbd">F9</span></button>
    </div>
  </div>
  `;

  const lector = $('#escanear');
  lector.addEventListener('keydown', (e) => {
    // Con el lector vacío: + / − cambian la cantidad del último producto, Supr lo quita
    if (!lector.value && carrito.length && ['+', '-', 'Delete'].includes(e.key)) {
      e.preventDefault(); modificarUltimo(e.key); return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const { cant, q } = separarCantidad(lector.value);
    if (!q) return;
    const p = db.productos.find((x) => x.codigo && x.codigo === q);
    if (p) { lector.value = ''; agregar(p, cant); return; }
    if (/[a-záéíóúñ]/i.test(q)) { busqueda = lector.value; lector.value = ''; vistaVender(); $('#buscar').focus(); return; }
    lector.value = '';
    codigoNoEncontrado(q);
  });

  const inp = $('#buscar');
  const refrescarLista = () => {
    $('#prod-lista').classList.toggle('oculto', !busqueda && !esTactil());
    $('#prod-lista').innerHTML = prodListaHtml(listaProductosVenta());
    const el = document.querySelector('#prod-lista .item.sel');
    if (el) el.scrollIntoView({ block: 'nearest' });
  };
  inp.addEventListener('input', () => { busqueda = inp.value; sel = -1; refrescarLista(); });
  inp.addEventListener('keydown', (e) => {
    const lista = listaProductosVenta();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!lista.length) return;
      sel = e.key === 'ArrowDown' ? Math.min(lista.length - 1, sel + 1) : Math.max(0, sel - 1);
      refrescarLista();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const { cant, q } = separarCantidad(inp.value);
    if (!q) return;
    const exacto = db.productos.find((p) => p.codigo && p.codigo === q);
    const p = exacto || (sel >= 0 ? lista[sel] : null) || (lista.length === 1 ? lista[0] : null);
    if (p) { busqueda = ''; sel = -1; agregar(p, cant); }
    else if (!lista.length) toast('No se encontró ese producto');
    else toast('Hay varios: elegí con ↑ ↓ y Enter');
  });
  $('#prod-lista').addEventListener('click', (e) => {
    const b = e.target.closest('[data-prod]');
    if (b) { const { cant } = separarCantidad(busqueda); busqueda = ''; sel = -1; agregar(db.productos.find((p) => p.id === b.dataset.prod), cant); }
  });
  $('#btn-libre').onclick = importeLibre;

  document.querySelectorAll('[data-mas]').forEach((b) => (b.onclick = () => { carrito[b.dataset.mas].cant++; vistaVender(); }));
  document.querySelectorAll('[data-menos]').forEach((b) => (b.onclick = () => {
    const i = carrito[b.dataset.menos];
    i.cant--;
    if (i.cant <= 0) carrito.splice(b.dataset.menos, 1);
    vistaVender();
  }));
  document.querySelectorAll('[data-peso]').forEach((b) => (b.onclick = () => {
    const i = carrito[b.dataset.peso];
    pedirPeso(db.productos.find((p) => p.id === i.id) || { id: i.id, nombre: i.nombre, precio: i.precioKg, costo: 0, porPeso: true }, +b.dataset.peso);
  }));
  document.querySelectorAll('[data-quitar]').forEach((b) => (b.onclick = () => { carrito.splice(b.dataset.quitar, 1); vistaVender(); }));
  document.querySelectorAll('[data-medio]').forEach((b) => (b.onclick = () => { medio = b.dataset.medio; vistaVender(); }));
  $('#btn-scan').onclick = () => escanear(venderPorCodigo);
  document.querySelectorAll('[data-tecla]').forEach((b) => (b.onclick = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: b.dataset.tecla, bubbles: true }))));

  const inpPaga = $('#pagaCon');
  if (inpPaga) {
    inpPaga.addEventListener('input', () => { pagaCon = inpPaga.value; $('#vuelto').innerHTML = vueltoHtml(total); });
    inpPaga.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); cobrar(); } });
    document.querySelectorAll('[data-billete]').forEach((b) => (b.onclick = () => {
      pagaCon = b.dataset.billete === 'justo' ? String(total) : b.dataset.billete;
      inpPaga.value = pagaCon;
      $('#vuelto').innerHTML = vueltoHtml(total);
    }));
  }

  $('#btn-vaciar').onclick = cancelarVenta;
  $('#btn-cobrar').onclick = cobrar;
  document.querySelectorAll('[data-venta]').forEach((b) => b.addEventListener('click', () => verVenta(b.dataset.venta)));

  if (!esTactil()) {
    if (busqueda) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    else lector.focus();
  }
}

function modificarUltimo(tecla) {
  const i = carrito[carrito.length - 1];
  if (!i) return;
  if (tecla === 'Delete') carrito.pop();
  else if (i.kg != null) return toast('Para productos por peso usá el botón ⚖️ Peso');
  else { i.cant += tecla === '+' ? 1 : -1; if (i.cant <= 0) carrito.pop(); }
  vistaVender();
}
function codigoNoEncontrado(codigo) {
  if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
  abrirModal(`
    <div style="text-align:center">
      <div style="font-size:2.4rem">❓</div>
      <h2>Código no encontrado</h2>
      <div class="sub" style="font-size:1rem">El código <b>${esc(codigo)}</b> no está cargado.</div>
    </div>
    <div class="modal-botones">
      <button class="btn" id="cn-crear">Crear producto</button>
      <button class="btn primario" id="cn-ok">Seguir vendiendo <span class="kbd">Enter</span></button>
    </div>`);
  $('#cn-ok').onclick = cerrarModal;
  $('#cn-crear').onclick = () => editarProducto(null, codigo);
  $('#cn-ok').focus();
}

function cancelarVenta() {
  if (!carrito.length) return toast('No hay ninguna venta en curso');
  const unidades = carrito.reduce((a, i) => a + (i.kg != null ? 1 : i.cant), 0);
  abrirModal(`
    <div style="text-align:center">
      <div style="font-size:2.6rem">⚠️</div>
      <h2>¿Cancelar la venta?</h2>
      <div class="sub" style="font-size:.95rem">Se van a borrar <b>${unidades} producto${unidades === 1 ? '' : 's'}</b> por <b>${plata(totalCarrito())}</b>.<br>Esto no se puede deshacer.</div>
    </div>
    <div class="modal-botones">
      <button class="btn primario" id="cv-no">No, volver <span class="kbd">Enter</span></button>
      <button class="btn cancelar" id="cv-si">Sí, cancelar <span class="kbd">S</span></button>
    </div>`);
  const si = () => {
    document.removeEventListener('keydown', teclaS, true);
    carrito = []; descuento = 0; medio = 'Efectivo'; pagaCon = ''; busqueda = ''; sel = -1;
    cerrarModal(); vistaVender(); toast('Venta cancelada');
  };
  const no = () => { document.removeEventListener('keydown', teclaS, true); cerrarModal(); };
  const teclaS = (e) => {
    if ($('#modal').classList.contains('oculto')) return document.removeEventListener('keydown', teclaS, true);
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); si(); }
  };
  document.addEventListener('keydown', teclaS, true);
  $('#cv-si').onclick = si;
  $('#cv-no').onclick = no;
  $('#cv-no').focus();
}
// "3*coca" o "3*7790..." → 3 unidades
function separarCantidad(texto) {
  const m = String(texto).trim().match(/^(\d+)\s*[*xX]\s*(.+)$/);
  return m ? { cant: Math.max(1, parseInt(m[1], 10)), q: m[2].trim() } : { cant: 1, q: String(texto).trim() };
}

function vueltoHtml(total) {
  if (!String(pagaCon).trim()) return '<span class="sub">Poné con cuánto paga para calcular el vuelto</span>';
  const v = num(pagaCon) - total;
  return v >= 0
    ? `<span>Vuelto</span><b class="verde">${plata(v)}</b>`
    : `<span class="rojo">Falta</span><b class="rojo">${plata(-v)}</b>`;
}
function listaProductosVenta() {
  const q = separarCantidad(busqueda).q.toLowerCase();
  return db.productos
    .filter((p) => !q || p.nombre.toLowerCase().includes(q) || (p.codigo || '').includes(q))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
    .slice(0, 40);
}
function prodListaHtml(prods) {
  if (!db.productos.length) return '<div class="vacio">No hay productos. Cargalos en <b>Productos</b> o en <b>Más → ejemplo</b>.</div>';
  if (!prods.length) return '<div class="vacio">Sin resultados</div>';
  return prods.map((p, n) => `
    <div class="item ${n === sel ? 'sel' : ''}">
      <div class="info" style="min-width:0">
        <div class="nombre" style="font-weight:600">${esc(p.nombre)}</div>
        <div class="sub">${p.porPeso ? '⚖️ ' : ''}${precioTxt(p)}${p.codigo ? ' · Cód. ' + esc(p.codigo) : ''} · Stock: <span class="${p.stock <= (p.stockMin || 0) ? 'rojo' : ''}">${stockTxt(p)}</span></div>
      </div>
      <button class="btn agregar" data-prod="${p.id}">+ Agregar</button>
    </div>`).join('');
}
function agregar(p, cant = 1) {
  if (!p) return;
  if (p.porPeso) return pedirPeso(p);
  const ya = carrito.find((i) => i.id === p.id);
  if (ya) ya.cant += cant;
  else carrito.push({ id: p.id, nombre: p.nombre, precio: p.precio, costo: p.costo || 0, cant });
  if (p.stock <= 0) toast(`Ojo: ${p.nombre} figura sin stock`);
  else toast(`${p.nombre} agregado`);
  vistaVender();
}
function pedirPeso(p, idxEditar = null) {
  const actual = idxEditar != null ? carrito[idxEditar] : null;
  let modo = 'peso';
  abrirModal(`
    <h2>⚖️ ${esc(p.nombre)}</h2>
    <div class="sub">${plata(p.precio)} el kilo</div>
    <div class="pagos" style="grid-template-columns:1fr 1fr;margin-top:12px">
      <button data-modo="peso" class="activo">Por peso</button>
      <button data-modo="importe">Por importe ($)</button>
    </div>
    <label id="w-label">Peso en gramos</label>
    <input id="w-valor" inputmode="decimal" placeholder="Ej: 250" value="${actual ? Math.round(actual.kg * 1000) : ''}" style="font-size:1.4rem;font-weight:700">
    <div class="billetes" id="w-rapidos"></div>
    <div class="vuelto-box" id="w-res"></div>
    <div class="modal-botones"><button class="btn gris" onclick="cerrarModal()">Cancelar</button><button class="btn primario" id="w-ok">${actual ? 'Actualizar' : 'Agregar'}</button></div>`);
  const calc = () => {
    const v = num($('#w-valor').value);
    if (v <= 0) return null;
    if (modo === 'peso') return { kg: red3(v / 1000), precio: Math.round((v / 1000) * p.precio) };
    return { kg: red3(v / p.precio), precio: Math.round(v) };
  };
  const mostrar = () => {
    const r = calc();
    $('#w-res').innerHTML = r ? `<span>${kg(r.kg)} kg</span><b class="verde">${plata(r.precio)}</b>` : '<span class="sub">Ingresá el valor</span>';
  };
  const rapidos = () => {
    const vals = modo === 'peso' ? [100, 150, 200, 250, 500, 1000] : [1000, 2000, 3000, 5000];
    $('#w-rapidos').innerHTML = vals.map((v) => `<button data-rap="${v}">${modo === 'peso' ? (v >= 1000 ? v / 1000 + ' kg' : v + ' g') : plata(v)}</button>`).join('');
    document.querySelectorAll('[data-rap]').forEach((b) => (b.onclick = () => { $('#w-valor').value = b.dataset.rap; mostrar(); }));
  };
  document.querySelectorAll('[data-modo]').forEach((b) => (b.onclick = () => {
    modo = b.dataset.modo;
    document.querySelectorAll('[data-modo]').forEach((x) => x.classList.toggle('activo', x === b));
    $('#w-label').textContent = modo === 'peso' ? 'Peso en gramos' : 'Importe que pide el cliente ($)';
    $('#w-valor').placeholder = modo === 'peso' ? 'Ej: 250' : 'Ej: 2000';
    $('#w-valor').value = ''; rapidos(); mostrar(); $('#w-valor').focus();
  }));
  $('#w-valor').oninput = mostrar;
  $('#w-valor').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#w-ok').click(); } };
  rapidos(); mostrar(); $('#w-valor').focus();
  $('#w-ok').onclick = () => {
    const r = calc();
    if (!r) return toast('Poné el peso o el importe');
    const item = { id: p.id, nombre: p.nombre, porPeso: true, kg: r.kg, precioKg: p.precio, precio: r.precio, costo: Math.round(r.kg * (p.costo || 0)), cant: 1 };
    if (actual) carrito[idxEditar] = item; else carrito.push(item);
    if (p.stock != null && p.stock < r.kg) toast(`Ojo: ${p.nombre} figura con poco stock`);
    cerrarModal(); vistaVender();
  };
}
function venderPorCodigo(codigo) {
  const p = db.productos.find((x) => x.codigo === codigo);
  if (p) agregar(p); else codigoNoEncontrado(codigo);
}
function importeLibre() {
  abrirModal(`
    <h2>Importe libre</h2>
    <div class="sub">Para algo que no está cargado (fiambre, verdura, etc.)</div>
    <label>Descripción</label><input id="l-nombre" value="Varios">
    <label>Importe</label><input id="l-precio" inputmode="decimal" placeholder="0">
    <div class="modal-botones"><button class="btn gris" onclick="cerrarModal()">Cancelar</button><button class="btn primario" id="l-ok">Agregar</button></div>`);
  $('#l-precio').focus();
  $('#l-ok').onclick = () => {
    const precio = num($('#l-precio').value);
    if (precio <= 0) return toast('Poné un importe');
    carrito.push({ id: 'libre-' + uid(), nombre: $('#l-nombre').value || 'Varios', precio, costo: 0, cant: 1, libre: true });
    cerrarModal(); vistaVender();
  };
}
function cobrar() {
  if (!carrito.length) return;
  const subtotal = subtotalCarrito();
  const total = totalCarrito();
  const paga = medio === 'Efectivo' && String(pagaCon).trim() ? num(pagaCon) : null;
  if (paga !== null && paga < total) return toast(`Falta plata: el cliente paga ${plata(paga)} y son ${plata(total)}`);
  db.ultimoNro = (db.ultimoNro || db.ventas.length) + 1;
  const venta = {
    id: uid(),
    nro: db.ultimoNro,
    fecha: new Date().toISOString(),
    items: carrito.map((i) => ({ ...i })),
    subtotal,
    descuento,
    total,
    medio,
    pagaCon: paga,
    vuelto: paga !== null ? paga - total : null,
  };
  db.ventas.push(venta);
  carrito.forEach((i) => {
    const p = db.productos.find((x) => x.id === i.id);
    if (p) p.stock = red3(p.stock - cantStock(i));
  });
  guardar();
  carrito = []; medio = 'Efectivo'; descuento = 0; busqueda = ''; pagaCon = '';
  render();
  if (venta.vuelto !== null) {
    abrirModal(`
      <div style="text-align:center">
        <div class="sub">Venta ${nroTxt(venta.nro)} · Total ${plata(total)} · Pagó ${plata(venta.pagaCon)}</div>
        <div style="font-size:1.1rem;margin-top:14px">Darle de vuelto</div>
        <div class="vuelto-grande">${plata(venta.vuelto)}</div>
      </div>
      <div class="modal-botones"><button class="btn cobrar" onclick="cerrarModal()">Listo</button></div>`);
  } else {
    toast(`Venta ${nroTxt(venta.nro)} registrada: ${plata(total)}`);
  }
}
function ultimasVentasHtml() {
  const v = db.ventas.filter((x) => diaDe(x.fecha) === hoy()).slice(-5).reverse();
  return `<h3>Últimas ventas</h3>
    ${v.length ? `<ul class="lista">${v.map((x, i) => `<li data-venta="${x.id}" style="cursor:pointer">
      <div class="info"><div class="nro ${x.anulada ? 'rojo' : ''}">${nroTxt(x.nro)}${x.anulada ? ' (anulada)' : ''}</div>
      <div class="sub">Hoy ${hora(x.fecha)} · ${esc(x.medio)}</div></div>
      <div class="monto ${i === 0 && !x.anulada ? 'verde' : ''}" style="font-size:1.1rem">${plata(x.total)}</div></li>`).join('')}</ul>`
      : '<div class="vacio">Todavía no hay ventas hoy</div>'}`;
}
function verVenta(id) {
  const v = db.ventas.find((x) => x.id === id);
  if (!v) return;
  abrirModal(`
    <h2>Venta ${nroTxt(v.nro)}</h2>
    <div class="sub">${new Date(v.fecha).toLocaleString('es-AR')} · ${esc(v.medio)}</div>
    <ul class="lista">${v.items.map((i) => `<li><div class="info">${i.kg != null ? kg(i.kg) + ' kg' : i.cant + '×'} ${esc(i.nombre)}</div><div class="monto">${plata(i.precio * i.cant)}</div></li>`).join('')}</ul>
    ${v.descuento ? `<div class="sub">Subtotal ${plata(v.subtotal)} · Descuento −${plata(v.descuento)}</div>` : ''}
    ${v.pagaCon != null ? `<div class="sub">Pagó con ${plata(v.pagaCon)} · Vuelto ${plata(v.vuelto)}</div>` : ''}
    <div class="total"><span>Total</span><span>${plata(v.total)}</span></div>
    ${v.anulada ? '<div class="aviso">Esta venta está anulada.</div>' : ''}
    <div class="modal-botones">
      <button class="btn gris" onclick="cerrarModal()">Cerrar</button>
      ${v.anulada ? '' : '<button class="btn peligro" id="anular">Anular venta</button>'}
    </div>`);
  const b = $('#anular');
  if (b) b.onclick = () => {
    if (!confirm('¿Anular esta venta? El stock se devuelve.')) return;
    v.anulada = true;
    v.items.forEach((i) => { const p = db.productos.find((x) => x.id === i.id); if (p) p.stock = red3(p.stock + cantStock(i)); });
    guardar(); cerrarModal(); render(); toast('Venta anulada');
  };
}

// ================= PRODUCTOS =================
let filtroProd = '';
let soloBajo = false;

function vistaProductos() {
  const cats = [...new Set(db.productos.map((p) => p.categoria).filter(Boolean))].sort();
  let lista = db.productos
    .filter((p) => !filtroProd || p.nombre.toLowerCase().includes(filtroProd.toLowerCase()) || (p.codigo || '').includes(filtroProd))
    .filter((p) => !soloBajo || p.stock <= (p.stockMin || 0))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  const bajos = db.productos.filter((p) => p.stock <= (p.stockMin || 0)).length;

  $('#app').innerHTML = `
    <div class="fila" style="margin-bottom:10px">
      <button class="btn primario" id="nuevo">+ Nuevo producto</button>
      <button class="btn fijo" id="aumento">% Aumentar</button>
    </div>
    <div class="tarjeta">
      <input id="filtro" placeholder="Buscar producto o código" value="${esc(filtroProd)}">
      <div class="fila" style="margin-top:8px">
        <button class="btn chico ${soloBajo ? 'primario' : ''}" id="bajo">Stock bajo (${bajos})</button>
        <span class="sub" style="text-align:right">${db.productos.length} productos</span>
      </div>
    </div>
    <div class="tarjeta">
      ${lista.length === 0 ? `<div class="vacio">${db.productos.length ? 'No hay coincidencias' : 'Todavía no cargaste productos'}</div>` : `
      <ul class="lista">
        ${lista.map((p) => `
          <li data-edit="${p.id}">
            <div class="info">
              <div class="nombre">${esc(p.nombre)}</div>
              <div class="sub">${p.porPeso ? '⚖️ Por peso · ' : ''}${esc(p.categoria || 'Sin categoría')}${p.codigo ? ' · ' + esc(p.codigo) : ''}</div>
            </div>
            <span class="etiqueta ${p.stock <= (p.stockMin || 0) ? 'bajo' : 'ok'}">${stockTxt(p)}</span>
            <div class="monto">${precioTxt(p)}</div>
          </li>`).join('')}
      </ul>`}
    </div>
    <datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
  `;
  const f = $('#filtro');
  f.addEventListener('input', () => { filtroProd = f.value; const pos = f.selectionStart; vistaProductos(); const n = $('#filtro'); n.focus(); n.setSelectionRange(pos, pos); });
  $('#bajo').onclick = () => { soloBajo = !soloBajo; vistaProductos(); };
  $('#nuevo').onclick = () => editarProducto(null);
  $('#aumento').onclick = aumentoMasivo;
  document.querySelectorAll('[data-edit]').forEach((li) => li.addEventListener('click', () => editarProducto(li.dataset.edit)));
}

function editarProducto(id, codigoInicial = '') {
  const p = id ? db.productos.find((x) => x.id === id) : { nombre: '', codigo: codigoInicial, categoria: '', costo: '', precio: '', stock: '', stockMin: '', porPeso: false };
  abrirModal(`
    <h2>${id ? 'Editar' : 'Nuevo'} producto</h2>
    <label>Nombre *</label><input id="p-nombre" value="${esc(p.nombre)}">
    <label class="check"><input type="checkbox" id="p-peso" ${p.porPeso ? 'checked' : ''}> ⚖️ Se vende por peso (fiambres, quesos, etc.)</label>
    <label id="p-cod-label">Código de barras</label>
    <div class="fila"><input id="p-codigo" value="${esc(p.codigo)}" inputmode="numeric" placeholder="Escribilo o escanealo"><button class="btn primario fijo" id="p-scan" type="button">📷 Escanear</button></div>
    <button class="linkbtn oculto" id="p-gen" type="button" style="margin-top:6px">Usar el próximo código libre</button>
    <label>Categoría</label><input id="p-cat" value="${esc(p.categoria)}" list="cats" placeholder="Golosinas, Bebidas, Almacén…">
    <div class="grilla2">
      <div><label id="l-costo">Costo</label><input id="p-costo" value="${p.costo}" inputmode="decimal"></div>
      <div><label id="l-precio">Precio venta *</label><input id="p-precio" value="${p.precio}" inputmode="decimal"></div>
      <div><label id="l-stock">Stock</label><input id="p-stock" value="${p.stock}" inputmode="decimal"></div>
      <div><label id="l-min">Stock mínimo</label><input id="p-min" value="${p.stockMin}" inputmode="decimal"></div>
    </div>
    <div id="p-margen" class="sub" style="margin-top:8px"></div>
    <div class="modal-botones">
      ${id ? '<button class="btn peligro fijo" id="p-borrar">Borrar</button>' : ''}
      <button class="btn" onclick="cerrarModal()">Cancelar</button>
      <button class="btn primario" id="p-ok">Guardar</button>
    </div>`);
  const margen = () => {
    const c = num($('#p-costo').value), v = num($('#p-precio').value);
    $('#p-margen').textContent = c > 0 && v > 0 ? `Ganancia: ${plata(v - c)} (${Math.round(((v - c) / c) * 100)}%)` : '';
  };
  $('#p-costo').oninput = margen; $('#p-precio').oninput = margen; margen();
  const modoPeso = () => {
    const w = $('#p-peso').checked;
    $('#p-cod-label').textContent = w ? 'Código propio (ej: 101)' : 'Código de barras';
    $('#p-codigo').placeholder = w ? 'Código corto para tipearlo rápido' : 'Escribilo o escanealo';
    $('#l-costo').textContent = w ? 'Costo por kg' : 'Costo';
    $('#l-precio').textContent = w ? 'Precio por kg *' : 'Precio venta *';
    $('#l-stock').textContent = w ? 'Stock (kg)' : 'Stock';
    $('#l-min').textContent = w ? 'Stock mínimo (kg)' : 'Stock mínimo';
    $('#p-gen').classList.toggle('oculto', !w);
  };
  $('#p-peso').onchange = modoPeso; modoPeso();
  $('#p-gen').onclick = () => {
    let n = 101;
    while (db.productos.some((x) => x.codigo === String(n) && x.id !== id)) n++;
    $('#p-codigo').value = String(n);
  };
  $('#p-scan').onclick = () => escanear((codigo) => {
    const otro = db.productos.find((x) => x.codigo === codigo && x.id !== id);
    $('#p-codigo').value = codigo;
    toast(otro ? `Ojo: ese código ya es de "${otro.nombre}"` : 'Código cargado');
    if (!$('#p-nombre').value) $('#p-nombre').focus();
  });

  $('#p-ok').onclick = () => {
    const nombre = $('#p-nombre').value.trim();
    const precio = num($('#p-precio').value);
    const codigo = $('#p-codigo').value.trim();
    if (!nombre) return toast('Falta el nombre');
    if (precio <= 0) return toast('Falta el precio de venta');
    if (codigo && db.productos.some((x) => x.codigo === codigo && x.id !== id)) return toast('Ese código ya está en otro producto');
    const datos = {
      nombre, codigo, precio,
      categoria: $('#p-cat').value.trim(),
      costo: num($('#p-costo').value),
      stock: num($('#p-stock').value),
      stockMin: num($('#p-min').value),
      porPeso: $('#p-peso').checked,
    };
    let nuevo = null;
    if (id) Object.assign(p, datos);
    else { nuevo = { id: uid(), ...datos }; db.productos.push(nuevo); }
    guardar(); cerrarModal(); toast('Producto guardado');
    if (nuevo && tab === 'vender') agregar(nuevo); else render();
  };
  const borrar = $('#p-borrar');
  if (borrar) borrar.onclick = () => {
    if (!confirm(`¿Borrar "${p.nombre}"?`)) return;
    db.productos = db.productos.filter((x) => x.id !== id);
    guardar(); cerrarModal(); render(); toast('Producto borrado');
  };
}

function aumentoMasivo() {
  const cats = [...new Set(db.productos.map((p) => p.categoria).filter(Boolean))].sort();
  abrirModal(`
    <h2>Aumentar precios</h2>
    <div class="sub">Sube el precio de venta (y el costo, si querés) en un porcentaje.</div>
    <label>Porcentaje de aumento</label><input id="a-pct" inputmode="decimal" placeholder="Ej: 10">
    <label>Aplicar a</label>
    <select id="a-cat"><option value="">Todos los productos</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
    <label><input type="checkbox" id="a-costo" checked style="width:auto"> Aumentar también el costo</label>
    <label><input type="checkbox" id="a-redondeo" checked style="width:auto"> Redondear a $10</label>
    <div class="modal-botones"><button class="btn" onclick="cerrarModal()">Cancelar</button><button class="btn primario" id="a-ok">Aplicar</button></div>`);
  $('#a-ok').onclick = () => {
    const pct = num($('#a-pct').value);
    if (!pct) return toast('Poné un porcentaje');
    const cat = $('#a-cat').value, conCosto = $('#a-costo').checked, red = $('#a-redondeo').checked;
    const f = 1 + pct / 100;
    let n = 0;
    db.productos.forEach((p) => {
      if (cat && p.categoria !== cat) return;
      p.precio = red ? Math.ceil((p.precio * f) / 10) * 10 : Math.round(p.precio * f * 100) / 100;
      if (conCosto && p.costo) p.costo = Math.round(p.costo * f * 100) / 100;
      n++;
    });
    guardar(); cerrarModal(); vistaProductos(); toast(`${n} precios actualizados`);
  };
}

// ================= INVENTARIO =================
const MOTIVOS = ['Conteo / diferencia', 'Rotura', 'Vencido', 'Robo / faltante', 'Consumo propio', 'Devolución a proveedor', 'Otro'];
let filtroInv = '';
let vistaInv = 'stock'; // stock | movimientos

function vistaInventario() {
  const prods = db.productos;
  const valorCosto = prods.reduce((a, p) => a + Math.max(0, p.stock) * (p.costo || 0), 0);
  const valorVenta = prods.reduce((a, p) => a + Math.max(0, p.stock) * (p.precio || 0), 0);
  const sinStock = prods.filter((p) => p.stock <= 0).length;
  const bajos = prods.filter((p) => p.stock > 0 && p.stock <= (p.stockMin || 0)).length;
  const lista = prods
    .filter((p) => !filtroInv || p.nombre.toLowerCase().includes(filtroInv.toLowerCase()) || (p.codigo || '').includes(filtroInv))
    .sort((a, b) => (a.stock - (a.stockMin || 0)) - (b.stock - (b.stockMin || 0)) || a.nombre.localeCompare(b.nombre));
  const movs = (db.movimientos || []).slice(-60).reverse();

  $('#app').innerHTML = `
    <div class="stats stats4">
      <div class="stat"><div class="v">${plata(valorCosto)}</div><div class="l">Stock valorizado (a costo)</div></div>
      <div class="stat"><div class="v verde">${plata(valorVenta)}</div><div class="l">Stock a precio de venta</div></div>
      <div class="stat"><div class="v rojo">${sinStock}</div><div class="l">Sin stock</div></div>
      <div class="stat"><div class="v" style="color:#b45309">${bajos}</div><div class="l">Stock bajo</div></div>
    </div>

    <div class="tarjeta">
      <h2>📥 Ingreso de mercadería</h2>
      <div class="lector">
        <div class="lector-tit"><span>📟 Escaneá lo que entra del proveedor</span><span class="lector-estado"></span></div>
        <div class="fila">
          <input id="inv-lector" placeholder="Código del producto y Enter" autocomplete="off" inputmode="numeric">
          <button class="btn primario fijo" id="inv-scan" title="Escanear con la cámara">📷</button>
        </div>
      </div>
      <div class="sub" style="margin-top:6px">También podés tocar <b>Ingreso</b> en cualquier producto de la lista.</div>
    </div>

    <div class="pagos" style="grid-template-columns:1fr 1fr">
      <button data-vinv="stock" class="${vistaInv === 'stock' ? 'activo' : ''}">📋 Stock actual</button>
      <button data-vinv="movimientos" class="${vistaInv === 'movimientos' ? 'activo' : ''}">🕓 Movimientos</button>
    </div>

    ${vistaInv === 'stock' ? `
    <div class="tarjeta">
      <input id="inv-filtro" placeholder="🔍  Filtrar por nombre o código" value="${esc(filtroInv)}">
      ${lista.length ? `<ul class="lista">${lista.map((p) => {
        const estado = p.stock <= 0 ? ['bajo', 'Sin stock'] : p.stock <= (p.stockMin || 0) ? ['medio', 'Bajo'] : ['ok', 'OK'];
        return `<li>
          <div class="info">
            <div class="nombre">${p.porPeso ? '⚖️ ' : ''}${esc(p.nombre)}</div>
            <div class="sub">${p.codigo ? 'Cód. ' + esc(p.codigo) + ' · ' : ''}mín. ${p.porPeso ? kg(p.stockMin || 0) + ' kg' : (p.stockMin || 0)}</div>
          </div>
          <span class="etiqueta ${estado[0]}">${stockTxt(p)}</span>
          <div class="acciones">
            <button class="btn chico" data-ing="${p.id}">+ Ingreso</button>
            <button class="btn chico gris" data-aj="${p.id}">Ajustar</button>
          </div>
        </li>`;
      }).join('')}</ul>` : `<div class="vacio">${prods.length ? 'Sin coincidencias' : 'Todavía no hay productos cargados'}</div>`}
    </div>` : `
    <div class="tarjeta">
      ${movs.length ? `<ul class="lista">${movs.map((m) => `
        <li>
          <div class="info">
            <div class="nombre">${esc(m.nombre)}</div>
            <div class="sub">${new Date(m.fecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${m.tipo === 'ingreso' ? 'Ingreso' : 'Ajuste: ' + esc(m.motivo)}${m.usuario ? ' · ' + esc(m.usuario) : ''}</div>
          </div>
          <div class="monto ${m.cant >= 0 ? 'verde' : 'rojo'}">${m.cant >= 0 ? '+' : '−'}${m.porPeso ? kg(Math.abs(m.cant)) + ' kg' : Math.abs(m.cant)}</div>
        </li>`).join('')}</ul>` : '<div class="vacio">Todavía no hay movimientos. Los ingresos y ajustes aparecen acá.</div>'}
    </div>`}
  `;

  const lec = $('#inv-lector');
  lec.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = lec.value.trim();
    if (!q) return;
    lec.value = '';
    ingresoPorCodigo(q);
  });
  $('#inv-scan').onclick = () => escanear(ingresoPorCodigo);
  document.querySelectorAll('[data-vinv]').forEach((b) => (b.onclick = () => { vistaInv = b.dataset.vinv; vistaInventario(); }));
  const f = $('#inv-filtro');
  if (f) f.addEventListener('input', () => { filtroInv = f.value; const pos = f.selectionStart; vistaInventario(); const n = $('#inv-filtro'); n.focus(); n.setSelectionRange(pos, pos); });
  document.querySelectorAll('[data-ing]').forEach((b) => (b.onclick = () => ingresoMercaderia(db.productos.find((p) => p.id === b.dataset.ing))));
  document.querySelectorAll('[data-aj]').forEach((b) => (b.onclick = () => ajustarStock(db.productos.find((p) => p.id === b.dataset.aj))));
  if (!esTactil() && !filtroInv) lec.focus();
}

function ingresoPorCodigo(codigo) {
  const p = db.productos.find((x) => x.codigo === codigo);
  if (p) return ingresoMercaderia(p);
  abrirModal(`
    <div style="text-align:center"><div style="font-size:2.4rem">❓</div><h2>Código no encontrado</h2>
    <div class="sub" style="font-size:1rem">El código <b>${esc(codigo)}</b> no está cargado. Si es un producto nuevo, crealo y poné el stock que entra.</div></div>
    <div class="modal-botones"><button class="btn gris" id="cn-no">Cerrar</button><button class="btn primario" id="cn-crear">Crear producto</button></div>`);
  $('#cn-no').onclick = cerrarModal;
  $('#cn-crear').onclick = () => editarProducto(null, codigo);
}

function registrarMovimiento(p, tipo, cant, motivo = '') {
  db.movimientos = db.movimientos || [];
  db.movimientos.push({ id: uid(), fecha: new Date().toISOString(), productoId: p.id, nombre: p.nombre, porPeso: !!p.porPeso, tipo, cant: red3(cant), motivo, stockFinal: p.stock, usuario: db.cajero || '' });
  if (db.movimientos.length > 5000) db.movimientos = db.movimientos.slice(-5000);
}

function ingresoMercaderia(p) {
  if (!p) return;
  const u = p.porPeso ? 'kg' : 'unidades';
  abrirModal(`
    <h2>📥 Ingreso: ${esc(p.nombre)}</h2>
    <div class="sub">Stock actual: <b>${stockTxt(p)}</b></div>
    <label>Cantidad que entra (${u}) *</label>
    <input id="i-cant" inputmode="decimal" placeholder="${p.porPeso ? 'Ej: 2,5' : 'Ej: 24'}" style="font-size:1.3rem;font-weight:700">
    <div class="billetes">${(p.porPeso ? [0.5, 1, 2, 5] : [6, 12, 24, 48]).map((n) => `<button data-q="${n}">+${String(n).replace('.', ',')}</button>`).join('')}</div>
    <div class="grilla2">
      <div><label>Costo ${p.porPeso ? 'por kg' : 'unitario'}</label><input id="i-costo" inputmode="decimal" value="${p.costo || ''}"></div>
      <div><label>Precio de venta${p.porPeso ? ' por kg' : ''}</label><input id="i-precio" inputmode="decimal" value="${p.precio || ''}"></div>
    </div>
    <div id="i-res" class="sub" style="margin-top:8px"></div>
    <div class="modal-botones"><button class="btn gris" onclick="cerrarModal()">Cancelar</button><button class="btn primario" id="i-ok">Sumar al stock</button></div>`);
  const res = () => {
    const c = num($('#i-cant').value);
    const costo = num($('#i-costo').value), precio = num($('#i-precio').value);
    const avisoCosto = p.costo && costo && costo !== p.costo ? ` · Costo ${costo > p.costo ? 'subió' : 'bajó'} ${Math.round(((costo - p.costo) / p.costo) * 100)}%` : '';
    $('#i-res').innerHTML = c > 0 ? `Stock nuevo: <b>${p.porPeso ? kg(red3(p.stock + c)) + ' kg' : red3(p.stock + c) + ' u.'}</b>${costo ? ` · Compra: <b>${plata(c * costo)}</b>` : ''}${avisoCosto}${costo && precio ? ` · Margen ${Math.round(((precio - costo) / costo) * 100)}%` : ''}` : '';
  };
  ['#i-cant', '#i-costo', '#i-precio'].forEach((s) => ($(s).oninput = res));
  document.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { $('#i-cant').value = String(red3(num($('#i-cant').value) + num(b.dataset.q))).replace('.', ','); res(); }));
  $('#i-cant').focus();
  $('#i-ok').onclick = () => {
    const c = num($('#i-cant').value);
    if (c <= 0) return toast('Poné la cantidad que entra');
    const costo = num($('#i-costo').value), precio = num($('#i-precio').value);
    if (costo > 0) p.costo = costo;
    if (precio > 0) p.precio = precio;
    p.stock = red3(p.stock + c);
    registrarMovimiento(p, 'ingreso', c);
    guardar(); cerrarModal(); render();
    toast(`+${p.porPeso ? kg(c) + ' kg' : c} ${p.nombre}`);
    if (tab === 'inventario' && !esTactil()) { const l = $('#inv-lector'); if (l) l.focus(); }
  };
}

function ajustarStock(p) {
  if (!p) return;
  abrirModal(`
    <h2>Ajustar stock: ${esc(p.nombre)}</h2>
    <div class="sub">El sistema dice que hay <b>${stockTxt(p)}</b>.</div>
    <label>¿Cuánto hay realmente? (${p.porPeso ? 'kg' : 'unidades'})</label>
    <input id="a-real" inputmode="decimal" placeholder="Lo que contaste" style="font-size:1.3rem;font-weight:700">
    <label>Motivo</label>
    <select id="a-motivo">${MOTIVOS.map((m) => `<option>${m}</option>`).join('')}</select>
    <div id="a-dif" class="sub" style="margin-top:8px"></div>
    <div class="modal-botones"><button class="btn gris" onclick="cerrarModal()">Cancelar</button><button class="btn primario" id="a-ok">Guardar ajuste</button></div>`);
  $('#a-real').oninput = () => {
    const v = $('#a-real').value.trim();
    if (!v) return ($('#a-dif').innerHTML = '');
    const d = red3(num(v) - p.stock);
    $('#a-dif').innerHTML = d === 0 ? 'Coincide, no hay diferencia' : `Diferencia: <b class="${d > 0 ? 'verde' : 'rojo'}">${d > 0 ? '+' : '−'}${p.porPeso ? kg(Math.abs(d)) + ' kg' : Math.abs(d)}</b>${p.costo ? ` (${plata(Math.abs(d) * p.costo)} a costo)` : ''}`;
  };
  $('#a-ok').onclick = () => {
    const v = $('#a-real').value.trim();
    if (v === '') return toast('Poné cuánto hay realmente');
    const d = red3(num(v) - p.stock);
    if (d === 0) { cerrarModal(); return toast('Sin diferencia, no se cambió nada'); }
    p.stock = red3(num(v));
    registrarMovimiento(p, 'ajuste', d, $('#a-motivo').value);
    guardar(); cerrarModal(); render(); toast('Stock ajustado');
  };
}

// ================= CAJA =================
let diaCaja = hoy();

function resumenDia(dia) {
  const ventas = db.ventas.filter((v) => diaDe(v.fecha) === dia && !v.anulada);
  const porMedio = {};
  MEDIOS.forEach((m) => (porMedio[m] = 0));
  ventas.forEach((v) => (porMedio[v.medio] = (porMedio[v.medio] || 0) + v.total));
  const total = ventas.reduce((a, v) => a + v.total, 0);
  const costo = ventas.reduce((a, v) => a + v.items.reduce((b, i) => b + (i.costo || 0) * i.cant, 0), 0);
  const conCosto = ventas.every((v) => v.items.every((i) => i.costo > 0));
  const caja = db.cajas[dia] || {};
  const efectivoEsperado = (caja.inicial || 0) + porMedio['Efectivo'];
  return { ventas, porMedio, total, costo, conCosto, caja, efectivoEsperado };
}

function vistaCaja() {
  const r = resumenDia(diaCaja);
  const esHoy = diaCaja === hoy();
  $('#app').innerHTML = `
    <div class="tarjeta fila">
      <button class="btn fijo" id="dia-ant">‹</button>
      <div style="text-align:center"><b>${esHoy ? 'Hoy' : fechaLinda(diaCaja)}</b><div class="sub">${diaCaja}</div></div>
      <button class="btn fijo" id="dia-sig" ${esHoy ? 'disabled' : ''}>›</button>
    </div>
    ${r.caja.cerrada ? `<div class="aviso">Caja cerrada a las ${hora(r.caja.cierre)}. Contado: ${plata(r.caja.contado)} · Diferencia: <b class="${r.caja.contado - r.efectivoEsperado < 0 ? 'rojo' : 'verde'}">${r.caja.contado - r.efectivoEsperado < 0 ? '−' : '+'}${plata(Math.abs(r.caja.contado - r.efectivoEsperado))}</b></div>` : ''}
    <div class="stats">
      <div class="stat"><div class="v">${plata(r.total)}</div><div class="l">Vendido (${r.ventas.length} ventas)</div></div>
      <div class="stat"><div class="v verde">${plata(r.total - r.costo)}</div><div class="l">Ganancia ${r.conCosto ? '' : 'aprox.*'}</div></div>
    </div>
    <div class="tarjeta">
      <h2>Por medio de pago</h2>
      <ul class="lista">${MEDIOS.map((m) => `<li><span>${m}</span><span class="monto">${plata(r.porMedio[m])}</span></li>`).join('')}</ul>
    </div>
    <div class="tarjeta">
      <h2>Efectivo en caja</h2>
      <label>Monto inicial (cambio)</label>
      <input id="inicial" inputmode="decimal" value="${r.caja.inicial ?? ''}" placeholder="0">
      <div class="total" style="font-size:1.2rem"><span>Debería haber</span><span>${plata(r.efectivoEsperado)}</span></div>
      <button class="btn primario bloque" id="cerrar">${r.caja.cerrada ? 'Volver a contar' : 'Cerrar caja'}</button>
    </div>
    ${r.conCosto ? '' : '<div class="sub">* Hay productos sin costo cargado: la ganancia se calcula solo con los que lo tienen.</div>'}
  `;
  $('#dia-ant').onclick = () => { const d = new Date(diaCaja + 'T12:00:00'); d.setDate(d.getDate() - 1); diaCaja = fechaLocal(d); vistaCaja(); };
  $('#dia-sig').onclick = () => { const d = new Date(diaCaja + 'T12:00:00'); d.setDate(d.getDate() + 1); diaCaja = fechaLocal(d); vistaCaja(); };
  $('#inicial').onchange = (e) => { db.cajas[diaCaja] = { ...(db.cajas[diaCaja] || {}), inicial: num(e.target.value) }; guardar(); vistaCaja(); };
  $('#cerrar').onclick = () => {
    abrirModal(`
      <h2>Cerrar caja</h2>
      <div class="sub">Contá el efectivo que hay en la caja.</div>
      <label>Efectivo contado</label><input id="contado" inputmode="decimal" placeholder="0">
      <div id="dif" class="sub" style="margin-top:8px">Debería haber ${plata(r.efectivoEsperado)}</div>
      <div class="modal-botones"><button class="btn" onclick="cerrarModal()">Cancelar</button><button class="btn primario" id="cc-ok">Cerrar caja</button></div>`);
    $('#contado').oninput = (e) => {
      const d = num(e.target.value) - r.efectivoEsperado;
      $('#dif').innerHTML = `Debería haber ${plata(r.efectivoEsperado)} · Diferencia: <b class="${d < 0 ? 'rojo' : 'verde'}">${d >= 0 ? '+' : '−'}${plata(Math.abs(d))}</b>`;
    };
    $('#cc-ok').onclick = () => {
      db.cajas[diaCaja] = { ...(db.cajas[diaCaja] || {}), cerrada: true, contado: num($('#contado').value), cierre: new Date().toISOString() };
      guardar(); cerrarModal(); vistaCaja(); toast('Caja cerrada');
    };
  };
}

// ================= MÁS (reportes + ajustes) =================
let periodo = 7;

function vistaMas() {
  const desde = new Date(); desde.setHours(0, 0, 0, 0); desde.setDate(desde.getDate() - (periodo - 1));
  const ventas = db.ventas.filter((v) => !v.anulada && new Date(v.fecha) >= desde);
  const total = ventas.reduce((a, v) => a + v.total, 0);
  const ranking = {};
  ventas.forEach((v) => v.items.forEach((i) => {
    const k = i.libre ? 'Importe libre' : i.nombre;
    ranking[k] = ranking[k] || { cant: 0, total: 0 };
    ranking[k].cant += i.kg != null ? i.kg : i.cant; ranking[k].peso = i.kg != null; ranking[k].total += i.cant * i.precio;
  }));
  const top = Object.entries(ranking).sort((a, b) => b[1].total - a[1].total).slice(0, 10);
  const dias = [];
  for (let i = 0; i < periodo; i++) {
    const d = new Date(desde); d.setDate(d.getDate() + i);
    const k = fechaLocal(d);
    dias.push({ k, t: ventas.filter((v) => diaDe(v.fecha) === k).reduce((a, v) => a + v.total, 0) });
  }
  const max = Math.max(1, ...dias.map((d) => d.t));
  const bajos = db.productos.filter((p) => p.stock <= (p.stockMin || 0));
  const valorStock = db.productos.reduce((a, p) => a + Math.max(0, p.stock) * (p.costo || 0), 0);

  $('#app').innerHTML = `
    <div class="pagos" style="grid-template-columns:repeat(3,1fr)">
      ${[1, 7, 30].map((n) => `<button data-per="${n}" class="${n === periodo ? 'activo' : ''}">${n === 1 ? 'Hoy' : n + ' días'}</button>`).join('')}
    </div>
    <div class="stats">
      <div class="stat"><div class="v">${plata(total)}</div><div class="l">Ventas del período</div></div>
      <div class="stat"><div class="v">${plata(ventas.length ? total / ventas.length : 0)}</div><div class="l">Ticket promedio</div></div>
    </div>
    ${periodo > 1 ? `<div class="tarjeta"><h2>Ventas por día</h2>
      <div style="display:flex;align-items:flex-end;gap:3px;height:110px">
        ${dias.map((d) => `<div title="${d.k}: ${plata(d.t)}" style="flex:1;background:var(--verde);border-radius:4px 4px 0 0;height:${Math.max(2, (d.t / max) * 100)}%"></div>`).join('')}
      </div>
      <div class="fila sub" style="margin-top:4px"><span>${fechaLinda(dias[0].k)}</span><span style="text-align:right">${fechaLinda(dias[dias.length - 1].k)}</span></div>
    </div>` : ''}
    <div class="tarjeta"><h2>Más vendidos</h2>
      ${top.length ? `<ul class="lista">${top.map(([n, d]) => `<li><div class="info"><div class="nombre">${esc(n)}</div><div class="sub">${d.peso ? kg(d.cant) + ' kg' : d.cant + ' unidades'}</div></div><div class="monto">${plata(d.total)}</div></li>`).join('')}</ul>` : '<div class="vacio">Sin ventas en este período</div>'}
    </div>
    <div class="tarjeta"><h2>Para reponer (${bajos.length})</h2>
      ${bajos.length ? `<ul class="lista">${bajos.map((p) => `<li><span>${esc(p.nombre)}</span><span class="etiqueta bajo">${stockTxt(p)} / mín ${p.stockMin || 0}</span></li>`).join('')}</ul>` : '<div class="vacio">Nada para reponer 👌</div>'}
      <div class="sub" style="margin-top:8px">Mercadería en stock (a costo): <b>${plata(valorStock)}</b></div>
    </div>
    <div class="tarjeta"><h2>Ajustes</h2>
      <label>Nombre del negocio</label><input id="neg" value="${esc(db.negocio)}">
      <label>Nombre del cajero</label><input id="caj" value="${esc(db.cajero)}" placeholder="Ej: Ana López">
      <div class="fila" style="margin-top:12px">
        <button class="btn" id="exp">⬇ Copia de seguridad</button>
        <button class="btn" id="imp">⬆ Restaurar</button>
      </div>
      <input type="file" id="archivo" accept=".json,application/json" class="oculto">
      <button class="btn bloque" id="demo" style="margin-top:8px">Cargar productos de ejemplo</button>
      ${pedidoInstalar ? '<button class="btn primario bloque" id="instalar" style="margin-top:8px">💻 Instalar como app (funciona sin internet)</button>' : ''}
      <div class="sub" style="margin-top:8px">Los datos se guardan solo en este dispositivo. Hacé una copia de seguridad seguido.</div>
      <div class="sub" style="margin-top:8px">Versión ${VERSION}</div>
    </div>
    <div class="firma">Sistema desarrollado por <b>WRC tech</b></div>`;

  document.querySelectorAll('[data-per]').forEach((b) => (b.onclick = () => { periodo = +b.dataset.per; vistaMas(); }));
  $('#neg').onchange = (e) => { db.negocio = e.target.value.trim() || 'Mi negocio'; guardar(); render(); };
  $('#caj').onchange = (e) => { db.cajero = e.target.value.trim(); guardar(); render(); };
  $('#exp').onclick = exportar;
  $('#imp').onclick = () => $('#archivo').click();
  $('#archivo').onchange = importar;
  $('#demo').onclick = cargarDemo;
  const bi = $('#instalar');
  if (bi) bi.onclick = async () => { pedidoInstalar.prompt(); await pedidoInstalar.userChoice; pedidoInstalar = null; render(); };
}

function exportar() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kiosco-backup-${hoy()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function importar(e) {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!Array.isArray(d.productos)) throw new Error();
      if (!confirm('Esto reemplaza todos los datos actuales. ¿Seguir?')) return;
      db = { ...datosIniciales(), ...d };
      guardar(); render(); toast('Datos restaurados');
    } catch (err) { toast('El archivo no es una copia válida'); }
  };
  r.readAsText(f);
}
function cargarDemo() {
  const ej = [
    ['Coca-Cola 500ml', 'Bebidas', 900, 1500, 24, 6, '7790895000997'],
    ['Agua mineral 500ml', 'Bebidas', 500, 900, 20, 6, '7798062540017'],
    ['Alfajor triple', 'Golosinas', 600, 1100, 30, 10, ''],
    ['Chicles x unidad', 'Golosinas', 100, 250, 50, 20, ''],
    ['Paquete de galletitas', 'Almacén', 900, 1600, 15, 5, ''],
    ['Yerba 1kg', 'Almacén', 3500, 5200, 10, 3, ''],
    ['Fideos 500g', 'Almacén', 900, 1500, 12, 4, ''],
    ['Leche 1L', 'Lácteos', 1000, 1500, 3, 6, ''],
    ['Pan lactal', 'Panificados', 1800, 2800, 6, 3, ''],
    ['Lavandina 1L', 'Limpieza', 700, 1200, 8, 3, ''],
    ['Queso fresco', 'Fiambrería', 6000, 9500, 4, 1, '101', true],
    ['Jamón crudo', 'Fiambrería', 16000, 26000, 2, 0.5, '102', true],
    ['Queso de máquina', 'Fiambrería', 8000, 12800, 3, 1, '103', true],
  ];
  let n = 0;
  ej.forEach(([nombre, categoria, costo, precio, stock, stockMin, codigo, porPeso = false]) => {
    if (db.productos.some((p) => p.nombre === nombre)) return;
    db.productos.push({ id: uid(), nombre, categoria, costo, precio, stock, stockMin, codigo, porPeso });
    n++;
  });
  guardar(); toast(`${n} productos de ejemplo cargados`);
}

// ================= ESCÁNER CON CÁMARA =================
// Usa el lector nativo del navegador (Chrome en Android). Si no existe
// (por ejemplo en iPhone), carga la librería ZXing desde internet.
const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar'];
let escaneo = null;

async function escanear(alLeer) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return toast('Este navegador no permite usar la cámara');
  }
  const caja = $('#escaner');
  caja.classList.remove('oculto');
  $('#esc-estado').textContent = 'Abriendo cámara…';
  const video = $('#esc-video');
  escaneo = { activo: true, stream: null, lector: null, alLeer };
  const listo = (codigo) => {
    if (!escaneo || !escaneo.activo) return;
    if (navigator.vibrate) navigator.vibrate(120);
    cerrarEscaner();
    alLeer(String(codigo).trim());
  };

  try {
    if ('BarcodeDetector' in window) {
      const soportados = await BarcodeDetector.getSupportedFormats();
      const detector = new BarcodeDetector({ formats: FORMATOS.filter((f) => soportados.includes(f)) });
      escaneo.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
      video.srcObject = escaneo.stream;
      await video.play();
      $('#esc-estado').textContent = 'Apuntá al código de barras';
      const buscar = async () => {
        if (!escaneo || !escaneo.activo) return;
        try {
          const r = await detector.detect(video);
          if (r.length) return listo(r[0].rawValue);
        } catch (e) {}
        setTimeout(buscar, 200);
      };
      buscar();
    } else {
      await cargarZXing();
      if (!escaneo || !escaneo.activo) return;
      escaneo.lector = new ZXing.BrowserMultiFormatReader();
      $('#esc-estado').textContent = 'Apuntá al código de barras';
      escaneo.lector.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, (res) => { if (res) listo(res.getText()); });
    }
  } catch (e) {
    cerrarEscaner();
    toast(e && e.name === 'NotAllowedError' ? 'No diste permiso a la cámara. Activalo en los ajustes del navegador.' : 'No se pudo abrir la cámara');
  }
}
function cargarZXing() {
  if (window.ZXing) return Promise.resolve();
  return new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js';
    s.onload = ok; s.onerror = () => mal(new Error('sin conexión'));
    document.head.appendChild(s);
  });
}
function cerrarEscaner() {
  if (escaneo) {
    escaneo.activo = false;
    if (escaneo.lector) try { escaneo.lector.reset(); } catch (e) {}
    if (escaneo.stream) escaneo.stream.getTracks().forEach((t) => t.stop());
  }
  escaneo = null;
  const v = $('#esc-video'); v.srcObject = null;
  $('#escaner').classList.add('oculto');
}
$('#esc-cerrar').addEventListener('click', cerrarEscaner);
$('#esc-manual').addEventListener('click', () => {
  const c = prompt('Escribí el código de barras');
  if (!c) return;
  const cb = escaneo && escaneo.alLeer;
  cerrarEscaner();
  if (cb) cb(c.trim());
});

// ================= ATAJOS DE TECLADO =================
const TABS_ORDEN = ['vender', 'productos', 'inventario', 'caja', 'mas'];
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  const modalAbierto = !$('#modal').classList.contains('oculto');
  const escanerAbierto = !$('#escaner').classList.contains('oculto');

  if (escanerAbierto) { if (e.key === 'Escape') cerrarEscaner(); return; }

  if (modalAbierto) {
    if (e.key === 'Escape') { e.preventDefault(); cerrarModal(); }
    else if (e.key === 'Enter' && !['TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement.tagName)) {
      const b = document.querySelector('#modal .modal-botones .btn.primario, #modal .modal-botones .btn.cobrar');
      if (b) { e.preventDefault(); b.click(); }
    }
    if (/^F\d+$/.test(e.key)) e.preventDefault();
    return;
  }

  if (e.altKey && /^[1-5]$/.test(e.key)) { e.preventDefault(); irA(TABS_ORDEN[+e.key - 1]); return; }

  const teclas = ['F1', 'F2', 'F3', 'F8', 'F9'];
  if (teclas.includes(e.key)) {
    e.preventDefault();
    if (tab !== 'vender') irA('vender');
    if (e.key === 'F1') {
      if (!carrito.length) return toast('No hay productos en la venta');
      const paga = $('#pagaCon');
      if (medio === 'Efectivo' && paga && !String(pagaCon).trim() && !f1Listo) { f1Listo = true; paga.focus(); paga.select(); return; }
      cobrar();
    } else if (e.key === 'F2') { const b = $('#buscar'); b.focus(); b.select(); }
    else if (e.key === 'F3') {
      medio = MEDIOS[(MEDIOS.indexOf(medio) + 1) % MEDIOS.length];
      vistaVender(); toast('Medio de pago: ' + medio);
    }
    else if (e.key === 'F8') importeLibre();
    else if (e.key === 'F9') cancelarVenta();
    return;
  }

  if (tab !== 'vender') return;
  if (e.key === 'Escape') {
    if (busqueda || ($('#buscar') && $('#buscar').value)) { busqueda = ''; sel = -1; vistaVender(); }
    const l = $('#escanear'); if (l) l.focus();
    return;
  }
  // Prioridad al lector láser: si el cursor no está en ningún campo, lo que se tipee/escanee va al lector
  const enCampo = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  if (!enCampo && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || e.key === 'Enter')) {
    const l = $('#escanear');
    if (l && e.key !== 'Enter') l.focus();
    else if (l && e.key === 'Enter' && l.value) { e.preventDefault(); l.focus(); l.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
  }
});
document.addEventListener('click', (e) => {
  if (tab !== 'vender' || esTactil() || !$('#modal').classList.contains('oculto')) return;
  if (e.target.closest('input, select, textarea, label')) return;
  setTimeout(() => {
    const a = document.activeElement;
    if (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) return;
    if (!$('#modal').classList.contains('oculto')) return;
    const l = $('#escanear'); if (l) l.focus();
  }, 0);
});
// En PC, la ayuda de F1 del navegador no debe abrirse
window.addEventListener('help', (e) => e.preventDefault());

function actualizarReloj() {
  const d = new Date();
  $('#reloj').textContent = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}
actualizarReloj();
setInterval(actualizarReloj, 20000);

// ---------- Arranque ----------
window.cerrarModal = cerrarModal;
render();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
