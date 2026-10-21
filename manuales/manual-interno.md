# Manual interno BlackShoes

## Limpieza automatica de productos sin stock

Regla definida:

- Si un producto queda sin stock, el sistema guarda la fecha en `products.out_of_stock_since`.
- Si el producto vuelve a tener stock antes de 30 dias, esa fecha se limpia y el contador vuelve a cero.
- Si pasan 30 dias sin reposicion, la limpieza automatica archiva el producto, lo despublica del catalogo y elimina sus imagenes de Supabase Storage.
- El producto interno `MANUAL_INTERNAL` nunca entra en esta limpieza.

Por seguridad, las imagenes no se borran desde SQL. Primero la Edge Function elimina los archivos del bucket `product-images` usando la API de Storage, y despues archiva el producto y sus registros asociados.

## Archivos relacionados

- Migracion: `supabase/migrations/202609150004_stale_product_cleanup.sql`
- Funcion automatica: `supabase/functions/cleanup-stale-products/index.ts`

## Activacion en Supabase

1. Ejecutar la migracion `202609150004_stale_product_cleanup.sql` en el SQL editor de Supabase.
2. Deployar la Edge Function `cleanup-stale-products`.
3. Configurar en la Edge Function:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CLEANUP_FUNCTION_SECRET`
4. Crear un Cron diario en Supabase que haga un `POST` a la Edge Function.

Ejemplo de URL:

`https://zojdhyuocprglqhddgxv.supabase.co/functions/v1/cleanup-stale-products`

Header recomendado:

`Authorization: Bearer {SUPABASE_SERVICE_ROLE_KEY}`

`x-cleanup-secret: {CLEANUP_FUNCTION_SECRET}`

## Prueba manual

Para probar sin esperar 30 dias, llamar la funcion con un valor menor:

`POST /functions/v1/cleanup-stale-products?days=1`

Usar esto solo en pruebas. En produccion dejar `days=30`.

## Carga de informacion al ingresar

El sistema no necesita descargar todo el historial apenas se abre.

Modo inicial:

- configuracion del negocio;
- productos, categorias y variantes;
- clientes;
- ventas recientes y deudas pendientes;
- gastos recientes;
- ultimos movimientos de stock.

Modo completo:

- se descarga al entrar a Historial de Ventas, Clientes, Gastos y Mercaderia o Estadisticas;
- tambien se descarga al tocar sincronizar manualmente.

La configuracion tecnica esta en `app.js`:

- `CLOUD_INITIAL_SALES_DAYS`
- `CLOUD_INITIAL_EXPENSE_DAYS`

Hoy queda en 60 dias para ventas y gastos iniciales. Desde Configuracion > Carga de Datos se puede cambiar a 30, 60, 90, 180, 365 dias o Todo.

## Cierres mensuales persistentes

- Aplicar `supabase/migrations/202610150001_monthly_closures.sql` en Supabase.
- El boton de cierre llama a `save_monthly_closure` y solo confirma el guardado cuando Supabase responde.
- PostgreSQL calcula ventas, gastos y costo de mercaderia de todo el mes, con fechas de Argentina y excluyendo registros archivados. Las compras de mercaderia no se descuentan otra vez como gasto operativo.
- El cierre conserva la definicion del Resumen: ingresos por ventas totales, menos gastos y costo vendido. No cambia la distincion de ingresos reales/ficticios de Estadisticas.
- Se guarda un snapshot en `monthly_closures`. Volver a cerrar el mismo mes actualiza ese registro; no duplica cierres. Las nuevas operaciones no modifican un cierre ya guardado hasta volver a cerrarlo.
- Al ingresar o sincronizar se descargan los cierres de Supabase, independientemente de los dias de ventas descargados al navegador.
- Eliminar un cierre lo archiva mediante `archive_monthly_closure`; no modifica ventas ni gastos. La creacion, actualizacion y eliminacion quedan en `audit_log`.
- Solo usuarios activos del personal pueden leer u operar cierres. El cliente no puede escribir la tabla directamente ni enviar importes calculados localmente.
- Cierres antiguos que sigan en el navegador se conservan y muestran `Sin guardar en Supabase`. Volver a cerrar ese mes recalcula el mes completo y lo guarda en la base. Un cierre que nunca salio del navegador no se recupera desde Supabase.

Pruebas del flujo de guardado y recarga: `node --test tests/monthly-closures.test.cjs`.

## Ocultar agotados en el catalogo

Aplicar `supabase/migrations/202610150002_catalog_stock_visibility.sql` para que la vista publica respete `business_settings.out_of_stock_product_mode` antes de paginar o contar productos. Afecta listado, filtros, detalle y relacionados.

Con `hide`, un producto con control de stock se muestra solo si tiene algun talle activo, no archivado y con unidades. Los productos sin control de stock siguen disponibles. Con `show`, los agotados publicados siguen visibles con su estado.

Pruebas de visibilidad: `node --test tests/catalog-stock-visibility.test.cjs`.

## Costo de items manuales en Venta Local

Aplicar `supabase/migrations/202610150003_manual_sale_cost.sql`.

- Los items manuales nuevos traen marcada la casilla `Calcular costo`. Los borradores anteriores conservan su decision previa.
- El porcentaje es el configurado en `Costo sin precio de costo`, el mismo de productos sin costo cargado. La etiqueta muestra el costo total de esa linea, incluyendo la cantidad.
- Al destildar se guarda costo cero. No se aplica el porcentaje de respaldo sobre ese cero.
- La RPC calcula el costo en PostgreSQL sobre el precio unitario del item, antes de descuentos, total final manual y pagos parciales.
- Se guardan `sale_items.unit_cost` y `sale_items.calculate_manual_cost`. Cambiar el porcentaje despues no altera el costo guardado de esa venta.
- Los costos manuales guardados se incluyen en Gastos/Mercaderia, Resumen, Estadisticas y cierres mensuales. La venta manual sigue fuera de las categorias de productos.
- La migracion no recalcula ni modifica los importes de ventas anteriores.

Pruebas: `node --test tests/manual-sale-cost.test.cjs`.

## Actualizacion masiva de precios

Aplicar `supabase/migrations/202610210001_product_price_update.sql`.

- Modificar Precios consulta y actualiza toda la base mediante RPC, no solo las paginas cargadas en el navegador.
- Permite todos los productos o una categoria; excluye archivados y el producto interno de ventas manuales. Incluye productos publicados, no publicados y sin stock.
- Aplica el porcentaje al precio de venta base y redondea a pesos enteros. No modifica costos, promociones, precio mayorista, stock, imagenes ni ventas anteriores.
- PostgreSQL guarda todo en una transaccion y registra precios anteriores/nuevos en `audit_log`. Solo personal activo puede ejecutar la operacion.
- Un reintento con el mismo identificador y parametros devuelve el resultado guardado sin aplicar dos veces el porcentaje. El boton queda bloqueado mientras se guarda.
- La cantidad de productos de la vista previa viene de Supabase. Tras guardar se invalida la cache y se recarga la pagina; las respuestas anteriores se descartan.
- Si falta aplicar la migracion o Supabase rechaza el cambio, se informa el error y el formulario queda abierto.

Pruebas: `node --test tests/product-price-update.test.cjs`.
