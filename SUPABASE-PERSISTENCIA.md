# BlackShoes - Persistencia Supabase

Este documento deja separada la arquitectura nueva de Supabase del modo local actual.

## Decision

El Supabase nuevo de BlackShoes debe usar tablas reales, no un estado completo serializado.

La migracion principal queda en:

`supabase/migrations/202609150001_blackshoes_core.sql`

## Hallazgos del sistema actual

- El sistema local guarda el estado completo en `localStorage`.
- El modo Supabase heredado usa tablas genericas como `app_records` y `app_config`.
- Ese modo heredado hace `upsert` de payloads completos por coleccion/registro.
- Hay acciones de sincronizacion que pueden guardar configuraciones o ultimo acceso.
- El stock local se calcula modificando objetos de producto y variantes en memoria.

Conclusion: no hay que activar `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` en el frontend actual hasta reemplazar la capa de escritura por operaciones granulares.

## Arquitectura nueva

Tablas principales:

- `products`
- `product_variants`
- `product_images`
- `product_categories`
- `product_subcategories`
- `customers`
- `sales`
- `sale_items`
- `payments`
- `stock_movements`
- `expenses`
- `audit_log`
- `business_settings`
- `profiles`

## Reglas aplicadas

- Cada entidad tiene `id` unico e inmutable.
- Las ventas usan `operation_id` unico.
- Los pagos usan `operation_id` unico.
- Los movimientos de stock usan `operation_id`.
- El historial relevante se agrega en `audit_log`.
- El stock se descuenta con `update ... where current_stock >= cantidad` dentro de funciones RPC.
- Si dos usuarios venden al mismo tiempo, Postgres bloquea la fila de variante y evita pisadas.
- El catalogo publico lee `catalog_products` y no escribe nada.
- El catalogo no expone cantidades exactas, solo disponibilidad.

## RPC criticas

- `create_sale(operation_id, customer_id, paid_amount, payment_method, manual_total, notes, items)`
- `register_customer_payment(operation_id, customer_id, sale_id, amount, method, note)`
- `register_stock_movement(operation_id, variant_id, quantity_delta, movement_type, unit_cost, note)`

Estas funciones son idempotentes: si llega dos veces el mismo `operation_id`, devuelven el registro ya creado.

## Proximo paso de codigo

Hay que crear una capa de datos en el frontend que reemplace:

- escritura de ventas local;
- escritura de pagos de cliente;
- ingreso/reduccion de mercaderia;
- creacion/edicion de producto;
- carga de imagenes;
- gastos.

Cada una debe llamar a tablas o RPC puntuales. Navegar, renderizar, filtrar, ordenar o abrir pantallas debe seguir siendo solo lectura.

## Publicacion

Para publicar sin riesgo:

1. Crear Supabase nuevo de BlackShoes.
2. Ejecutar la migracion SQL.
3. Crear el primer usuario desde Auth.
4. Activar ese usuario como admin en `profiles`.
5. Conectar el frontend a las variables publicas anon de ese proyecto.
6. Reemplazar la sincronizacion heredada antes de permitir uso multiusuario real.

