# Kiosco POS

Sistema de ventas web para kioscos y almacenes. Funciona desde el celular o la compu, sin instalar nada y sin servidor.

## Qué hace
- **Vender**: lector láser siempre listo (el cursor vuelve solo al campo del lector), buscador por nombre con F2, escaneo con la cámara del celular, ticket con cantidades, importe libre, medios de pago (efectivo con cálculo de vuelto, débito, crédito, transferencia, Mercado Pago). Anular ventas.
- **Productos**: código de barras con la cámara, productos por peso (precio por kg, código propio, venta por gramos o por importe), alta, edición y baja; código, categoría, costo, precio, stock y stock mínimo; margen de ganancia; aumento de precios masivo por % (todos o por categoría).
- **Caja del día**: ventas por medio de pago, ganancia, monto inicial, cierre de caja con diferencia.
- **Reportes**: ventas por día, más vendidos, productos para reponer, valor del stock.
- **Copia de seguridad**: exportar e importar los datos en un archivo.
- Funciona sin internet y se puede instalar como app ("Agregar a pantalla de inicio").

## Atajos de teclado (PC)
F1 cobrar · F2 buscar por nombre · F3 medio de pago · F8 importe libre · F9 cancelar venta · ↑↓ + Enter elegir producto · `3*código` cantidad · +/− último producto · Supr quitar último · Esc cerrar · Alt+1..4 pestañas.

## Importante
Los datos se guardan en el navegador del dispositivo (localStorage). Si se borran los datos del navegador, se pierden: hacé copias de seguridad desde **Más → Copia de seguridad**.

## Usarlo
Abrí `index.html` en el navegador, o publicalo con GitHub Pages (Settings → Pages → Branch `main` / root).
