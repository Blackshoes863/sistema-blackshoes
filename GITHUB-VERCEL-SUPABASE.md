# BlackShoes - GitHub, Vercel y Supabase

## Cuenta GitHub

Este proyecto debe subirse a la cuenta nueva/correcta de GitHub de BlackShoes, no a una cuenta asociada por error en esta PC.

En esta maquina no estan instalados:

- `gh`
- `vercel`
- `supabase`

Por eso, antes de publicar hay que iniciar sesion o instalar esas herramientas con la cuenta correcta.

## Nombre tecnico sugerido

Repositorio:

`blackshoes-control`

Proyecto Vercel:

`blackshoes-control`

Supabase:

`blackshoes-control-prod`

## Pasos seguros

1. Crear un repositorio nuevo vacio en la cuenta correcta de GitHub.
2. Inicializar Git localmente en esta carpeta.
3. Hacer el primer commit.
4. Asociar el remote del repo correcto.
5. Subir la rama principal.
6. Crear proyecto nuevo en Supabase.
7. Ejecutar `supabase/migrations/202609150001_blackshoes_core.sql`.
8. Crear el proyecto en Vercel importando ese repo.
9. Configurar variables publicas de Supabase.

## Importante antes de activar Supabase en produccion

La base ya esta disenada para persistencia robusta, pero el frontend todavia conserva la sincronizacion heredada por `localStorage` y `app_records`.

No activar las claves Supabase en `app.js` como solucion final hasta conectar las acciones importantes a las RPC nuevas:

- ventas;
- pagos;
- movimientos de stock;
- productos;
- imagenes;
- gastos.

