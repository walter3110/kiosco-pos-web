/* Kiosco POS — sistema de ventas para kioscos y almacenes.
   Todo se guarda en el navegador (localStorage). Sin servidor. */

const CLAVE = 'kiosco_pos_v1';
const VERSION = '1.3 · escáner';
const MEDIOS = ['Efectivo', 'Débito', 'Crédito', 'Transferencia', 'Mercado Pago'];

// ---------- Datos ----------
const datosIniciales = () => ({
  negocio: 'Mi Kiosco',
  cajero: '',
  ultimoNro: 0,
  productos: [],
  ventas: [],
  cajas: {}, // { 'AAAA-MM-DD': { inicial, cerrada, contado, cierre } }
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
const fechaLinda = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('oculto');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('oculto'), 2200);
}
function abrirModal(html) {
  $('#modal-contenido').innerHTML = html;
  $('#modal').classList.remove('oculto');
}
function cerrarModal() { $('#modal').classList.add('oculto'); }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') cerrarModal(); });

// ---------- Navegación ----------
const TITULOS = {
  vender: ['Venta actual', 'Agregar productos a la venta'],
  productos: ['Productos', 'Precios, stock y categorías'],
  caja: ['Caja del día', 'Ventas, medios de pago y cierre'],
  mas: ['Reportes y ajustes', 'Cómo viene el negocio'],
};
let tab = 'vender';
$('#campana').addEventListener('click', () => { soloBajo = true; filtroProd = ''; irA('productos'); });
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
  $('#cajero-txt').textContent = 'Cajero: ' + caj;
  $('#cajero-ini').textContent = caj.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const bajos = db.productos.filter((p) => p.stock <= (p.stockMin || 0)).length;
  $('#badge').textContent = bajos;
  $('#badge').classList.toggle('oculto', !bajos);
  ({ vender: vistaVender, productos: vistaProductos, caja: vistaCaja, mas: vistaMas })[tab]();
}

// ================= VENDER =================
let carrito = []; // { id, nombre, precio, costo, cant }
let medio = 'Efectivo';
let descuento = 0; // en pesos
let busqueda = '';

const subtotalCarrito = () => carrito.reduce((a, i) => a + i.precio * i.cant, 0);
const totalCarrito = () => Math.max(0, subtotalCarrito() - descuento);
const nroTxt = (n) => '#' + String(n || 0).padStart(5, '0');

function vistaVender() {
  const sub = subtotalCarrito();
  const total = totalCarrito();
  const unidades = carrito.reduce((a, i) => a + i.cant, 0);
  const prods = listaProductosVenta();

  $('#app').innerHTML = `
  <div class="venta-grid">
    <div class="tarjeta">
      <div class="fila">
        <input id="buscar" placeholder="🔍  Buscar por nombre o código…" autocomplete="off" enterkeyhint="search" value="${esc(busqueda)}">
        <button class="btn primario fijo" id="btn-scan" title="Escanear con la cámara">📷</button>
      </div>
      <div class="prod-lista" id="prod-lista">${prodListaHtml(prods)}</div>
      <button class="linkbtn" id="btn-libre" style="margin-top:8px">+ Importe libre (fiambre, verdura, varios)</button>

      <div class="ticket">
        ${carrito.length === 0 ? '<div class="vacio">Todavía no agregaste productos</div>' : `
        <ul class="lista">
          ${carrito.map((i, idx) => `
            <li>
              <div class="info">
                <div class="nombre">${esc(i.nombre)}</div>
                <div class="sub">${plata(i.precio)} c/u · ${plata(i.precio * i.cant)}</div>
              </div>
              <div class="cant">
                <button data-menos="${idx}" aria-label="Restar">−</button><b>${i.cant}</b><button data-mas="${idx}" aria-label="Sumar">+</button>
                <button class="borrar" data-quitar="${idx}" aria-label="Quitar">🗑</button>
              </div>
            </li>`).join('')}
        </ul>`}
        <div class="subtotales">
          <span>Subtotal: ${plata(sub)}</span>
          <span>Descuento: <button class="linkbtn" id="btn-desc">${plata(descuento)}</button></span>
          <span class="tot">Total: ${plata(total)}</span>
        </div>
      </div>

      <div class="pagos" style="margin-top:12px">
        ${MEDIOS.map((m) => `<button data-medio="${m}" class="${m === medio ? 'activo' : ''}">${m}</button>`).join('')}
      </div>
      ${medio === 'Efectivo' ? `
        <div class="fila"><input id="pagaCon" inputmode="decimal" placeholder="Paga con… (para calcular el vuelto)"></div>
        <div id="vuelto" class="sub" style="margin-top:6px"></div>` : ''}
      <button class="btn cobrar bloque" id="btn-cobrar" style="margin-top:12px" ${carrito.length ? '' : 'disabled'}>COBRAR ${plata(total)} 💳</button>
    </div>

    <div class="tarjeta resumen">
      <h2 style="font-size:1.25rem">Resumen de venta</h2>
      <div class="dato"><span class="sub">Productos:</span><b>${unidades}</b></div>
      <div class="dato"><span class="sub">Pago:</span><b>${esc(medio)}</b></div>
      ${ultimasVentasHtml()}
      <button class="btn cancelar bloque" id="btn-vaciar" style="margin-top:14px" ${carrito.length ? '' : 'disabled'}>Cancelar venta 🗑</button>
    </div>
  </div>`;

  const inp = $('#buscar');
  inp.addEventListener('input', () => { busqueda = inp.value; $('#prod-lista').innerHTML = prodListaHtml(listaProductosVenta()); });
  inp.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = inp.value.trim();
    if (!q) return;
    const exacto = db.productos.find((p) => p.codigo && p.codigo === q);
    const lista = listaProductosVenta();
    const p = exacto || (lista.length === 1 ? lista[0] : null);
    if (p) { busqueda = ''; agregar(p); }
    else if (!lista.length) toast('No se encontró ese producto');
  });
  $('#prod-lista').addEventListener('click', (e) => {
    const b = e.target.closest('[data-prod]');
    if (b) agregar(db.productos.find((p) => p.id === b.dataset.prod));
  });
  $('#btn-libre').onclick = importeLibre;
  $('#btn-desc').onclick = pedirDescuento;

  document.querySelectorAll('[data-mas]').forEach((b) => (b.onclick = () => { carrito[b.dataset.mas].cant++; vistaVender(); }));
  document.querySelectorAll('[data-menos]').forEach((b) => (b.onclick = () => {
    const i = carrito[b.dataset.menos];
    i.cant--;
    if (i.cant <= 0) carrito.splice(b.dataset.menos, 1);
    ajustarDescuento(); vistaVender();
  }));
  document.querySelectorAll('[data-quitar]').forEach((b) => (b.onclick = () => { carrito.splice(b.dataset.quitar, 1); ajustarDescuento(); vistaVender(); }));
  document.querySelectorAll('[data-medio]').forEach((b) => (b.onclick = () => { medio = b.dataset.medio; vistaVender(); }));
  $('#btn-scan').onclick = () => escanear(venderPorCodigo);

  const pagaCon = $('#pagaCon');
  if (pagaCon) pagaCon.addEventListener('input', () => {
    const v = num(pagaCon.value) - total;
    $('#vuelto').innerHTML = pagaCon.value ? (v >= 0 ? `Vuelto: <b class="verde">${plata(v)}</b>` : `<span class="rojo">Faltan ${plata(-v)}</span>`) : '';
  });

  $('#btn-vaciar').onclick = () => {
    if (carrito.length > 2 && !confirm('¿Cancelar la venta actual?')) return;
    carrito = []; descuento = 0; medio = 'Efectivo'; vistaVender();
  };
  $('#btn-cobrar').onclick = cobrar;
  document.querySelectorAll('[data-venta]').forEach((b) => b.addEventListener('click', () => verVenta(b.dataset.venta)));

  if (!('ontouchstart' in window)) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}

function listaProductosVenta() {
  const q = busqueda.trim().toLowerCase();
  return db.productos
    .filter((p) => !q || p.nombre.toLowerCase().includes(q) || (p.codigo || '').includes(q))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
    .slice(0, 40);
}
function prodListaHtml(prods) {
  if (!db.productos.length) return '<div class="vacio">No hay productos. Cargalos en <b>Productos</b> o en <b>Más → ejemplo</b>.</div>';
  if (!prods.length) return '<div class="vacio">Sin resultados</div>';
  return prods.map((p) => `
    <div class="item">
      <div class="info" style="min-width:0">
        <div class="nombre" style="font-weight:600">${esc(p.nombre)}</div>
        <div class="sub">${plata(p.precio)} · Stock: <span class="${p.stock <= (p.stockMin || 0) ? 'rojo' : ''}">${p.stock}</span></div>
      </div>
      <button class="btn agregar" data-prod="${p.id}">+ Agregar</button>
    </div>`).join('');
}
function agregar(p) {
  if (!p) return;
  const ya = carrito.find((i) => i.id === p.id);
  if (ya) ya.cant++;
  else carrito.push({ id: p.id, nombre: p.nombre, precio: p.precio, costo: p.costo || 0, cant: 1 });
  if (p.stock <= 0) toast(`Ojo: ${p.nombre} figura sin stock`);
  else toast(`${p.nombre} agregado`);
  vistaVender();
}
function ajustarDescuento() { descuento = Math.min(descuento, subtotalCarrito()); }
function pedirDescuento() {
  if (!carrito.length) return toast('Primero agregá productos');
  abrirModal(`
    <h2>Descuento</h2>
    <div class="sub">Subtotal: ${plata(subtotalCarrito())}</div>
    <label>Porcentaje</label><input id="d-pct" inputmode="decimal" placeholder="Ej: 10">
    <label>…o monto en pesos</label><input id="d-monto" inputmode="decimal" value="${descuento || ''}" placeholder="0">
    <div class="modal-botones"><button class="btn gris" id="d-quitar">Sin descuento</button><button class="btn primario" id="d-ok">Aplicar</button></div>`);
  $('#d-pct').oninput = (e) => { $('#d-monto').value = Math.round(subtotalCarrito() * num(e.target.value) / 100) || ''; };
  $('#d-quitar').onclick = () => { descuento = 0; cerrarModal(); vistaVender(); };
  $('#d-ok').onclick = () => { descuento = Math.max(0, num($('#d-monto').value)); ajustarDescuento(); cerrarModal(); vistaVender(); };
}
function venderPorCodigo(codigo) {
  const p = db.productos.find((x) => x.codigo === codigo);
  if (p) { agregar(p); return; }
  if (confirm(`El código ${codigo} no está cargado. ¿Querés crear el producto?`)) editarProducto(null, codigo);
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
  };
  db.ventas.push(venta);
  carrito.forEach((i) => {
    const p = db.productos.find((x) => x.id === i.id);
    if (p) p.stock -= i.cant;
  });
  guardar();
  carrito = []; medio = 'Efectivo'; descuento = 0; busqueda = '';
  toast(`Venta ${nroTxt(venta.nro)} registrada: ${plata(total)}`);
  render();
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
    <ul class="lista">${v.items.map((i) => `<li><div class="info">${i.cant}× ${esc(i.nombre)}</div><div class="monto">${plata(i.precio * i.cant)}</div></li>`).join('')}</ul>
    ${v.descuento ? `<div class="sub">Subtotal ${plata(v.subtotal)} · Descuento −${plata(v.descuento)}</div>` : ''}
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
    v.items.forEach((i) => { const p = db.productos.find((x) => x.id === i.id); if (p) p.stock += i.cant; });
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
              <div class="sub">${esc(p.categoria || 'Sin categoría')}${p.codigo ? ' · ' + esc(p.codigo) : ''}</div>
            </div>
            <span class="etiqueta ${p.stock <= (p.stockMin || 0) ? 'bajo' : 'ok'}">${p.stock} u.</span>
            <div class="monto">${plata(p.precio)}</div>
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
  const p = id ? db.productos.find((x) => x.id === id) : { nombre: '', codigo: codigoInicial, categoria: '', costo: '', precio: '', stock: '', stockMin: '' };
  abrirModal(`
    <h2>${id ? 'Editar' : 'Nuevo'} producto</h2>
    <label>Nombre *</label><input id="p-nombre" value="${esc(p.nombre)}">
    <label>Código de barras</label>
    <div class="fila"><input id="p-codigo" value="${esc(p.codigo)}" inputmode="numeric" placeholder="Escribilo o escanealo"><button class="btn primario fijo" id="p-scan" type="button">📷 Escanear</button></div>
    <label>Categoría</label><input id="p-cat" value="${esc(p.categoria)}" list="cats" placeholder="Golosinas, Bebidas, Almacén…">
    <div class="grilla2">
      <div><label>Costo</label><input id="p-costo" value="${p.costo}" inputmode="decimal"></div>
      <div><label>Precio venta *</label><input id="p-precio" value="${p.precio}" inputmode="decimal"></div>
      <div><label>Stock</label><input id="p-stock" value="${p.stock}" inputmode="numeric"></div>
      <div><label>Stock mínimo</label><input id="p-min" value="${p.stockMin}" inputmode="numeric"></div>
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
    };
    if (id) Object.assign(p, datos);
    else db.productos.push({ id: uid(), ...datos });
    guardar(); cerrarModal(); vistaProductos(); toast('Producto guardado');
  };
  const borrar = $('#p-borrar');
  if (borrar) borrar.onclick = () => {
    if (!confirm(`¿Borrar "${p.nombre}"?`)) return;
    db.productos = db.productos.filter((x) => x.id !== id);
    guardar(); cerrarModal(); vistaProductos(); toast('Producto borrado');
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
    ranking[k].cant += i.cant; ranking[k].total += i.cant * i.precio;
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
      ${top.length ? `<ul class="lista">${top.map(([n, d]) => `<li><div class="info"><div class="nombre">${esc(n)}</div><div class="sub">${d.cant} unidades</div></div><div class="monto">${plata(d.total)}</div></li>`).join('')}</ul>` : '<div class="vacio">Sin ventas en este período</div>'}
    </div>
    <div class="tarjeta"><h2>Para reponer (${bajos.length})</h2>
      ${bajos.length ? `<ul class="lista">${bajos.map((p) => `<li><span>${esc(p.nombre)}</span><span class="etiqueta bajo">${p.stock} / mín ${p.stockMin || 0}</span></li>`).join('')}</ul>` : '<div class="vacio">Nada para reponer 👌</div>'}
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
      <div class="sub" style="margin-top:8px">Los datos se guardan solo en este dispositivo. Hacé una copia de seguridad seguido.</div>
      <div class="sub" style="margin-top:8px">Versión ${VERSION}</div>
    </div>`;

  document.querySelectorAll('[data-per]').forEach((b) => (b.onclick = () => { periodo = +b.dataset.per; vistaMas(); }));
  $('#neg').onchange = (e) => { db.negocio = e.target.value.trim() || 'Mi Kiosco'; guardar(); render(); };
  $('#caj').onchange = (e) => { db.cajero = e.target.value.trim(); guardar(); render(); };
  $('#exp').onclick = exportar;
  $('#imp').onclick = () => $('#archivo').click();
  $('#archivo').onchange = importar;
  $('#demo').onclick = cargarDemo;
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
  ];
  let n = 0;
  ej.forEach(([nombre, categoria, costo, precio, stock, stockMin, codigo]) => {
    if (db.productos.some((p) => p.nombre === nombre)) return;
    db.productos.push({ id: uid(), nombre, categoria, costo, precio, stock, stockMin, codigo });
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

// ---------- Arranque ----------
window.cerrarModal = cerrarModal;
render();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
