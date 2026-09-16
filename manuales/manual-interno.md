# Manual interno BlackShoes

## Limpieza automatica de productos sin stock

Regla definida:

- Si un producto queda sin stock, el sistema guarda la fecha en `products.out_of_stock_since`.
- Si el producto vuelve a tener stock antes de 60 dias, esa fecha se limpia y el contador vuelve a cero.
- Si pasan 60 dias sin reposicion, la limpieza automatica archiva el producto, lo despublica del catalogo y elimina sus imagenes de Supabase Storage.
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

Para probar sin esperar 60 dias, llamar la funcion con un valor menor:

`POST /functions/v1/cleanup-stale-products?days=1`

Usar esto solo en pruebas. En produccion dejar `days=60`.

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

Hoy queda en 90 dias para ventas y gastos iniciales. Desde Configuracion > Carga de Datos se puede cambiar a 30, 60, 90, 180, 365 dias o Todo.
