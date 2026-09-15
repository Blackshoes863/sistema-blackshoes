# BlackShoes - Arquitectura inicial

## Estado actual

- Proyecto local: `sistema-blackshoes-2026-09-08`.
- Negocio: BlackShoes.
- Tipo: local fisico.
- Moneda: pesos argentinos.
- Supabase: desactivado por seguridad hasta crear un proyecto nuevo.
- Ventas online: ocultas para esta etapa, conservadas como modulo recuperable.
- Taller: removido del uso visible de BlackShoes.

## Areas del proyecto

- `/admin`: acceso al sistema interno de gestion.
- `/catalogo`: catalogo publico para clientes.
- `/catalogo/[slug]`: objetivo de ruta final para la pagina individual de producto. En la version estatica local queda representada por `catalogo/producto.html?slug=...`; cuando pasemos a Vercel o a una app con rutas, se mapea a `/catalogo/:slug`.

## Fuente de verdad

Supabase debe ser la unica fuente de verdad cuando se active la nube nueva:

- El sistema interno crea y modifica productos.
- El sistema interno carga stock, precios y talles.
- El catalogo publico solo lee productos publicables desde Supabase.
- No se cargan productos ni stock dos veces.
- El stock exacto se usa internamente; el catalogo publico solo muestra disponibilidad.

Mientras Supabase esta desactivado, la version local del catalogo puede leer la misma base del navegador (`localStorage`) que usa el sistema interno. Eso permite probar el flujo sin duplicar carga. Al activar Supabase nuevo, esa lectura local se reemplaza por la vista publica segura.

## Regla de producto y variantes

- Cada color distinto es un producto distinto.
- Los talles son variantes internas de stock dentro del producto.
- Ejemplo: `Vestido Olivia Negro` contiene talles `S`, `M`, `L` con stock propio.
- Una venta local de `Vestido Olivia Negro / M` descuenta solamente el talle `M`.

## Publicacion en catalogo

Cada producto puede marcarse como:

- publicado / no publicado;
- destacado;
- novedad.

Solo los productos publicados aparecen en el catalogo. Esto es independiente del stock.

## Disponibilidad publica

El catalogo queda preparado con configuracion para:

- mostrar talles sin stock como `Agotado`;
- ocultar talles sin stock;
- mostrar productos totalmente agotados;
- ocultar productos totalmente agotados.

## Modelo sugerido

- `business_settings`: nombre del negocio, numero de WhatsApp, mensaje predeterminado y reglas de disponibilidad publica.
- `products`: producto principal, SKU, color, precio base, precio promocional, precio mayorista, estado publicable, destacado, novedad y slug.
- `product_size_variants`: talles del producto y stock exacto por talle.
- `product_images`: imagen principal/secundarias, ruta de Supabase Storage y orden.
- `stock_movements`: entradas, ventas, ajustes y devoluciones.
- `sales`: ventas del local.

Para el catalogo publico conviene exponer una vista segura, por ejemplo `catalog_products`, que devuelva solo productos publicados con precio, precio promocional, fotos, color, talles y disponibilidad publica.

La vista publica no debe exponer cantidades exactas si no hace falta; puede devolver `available: true/false` por talle, o devolver stock a la interfaz solo si las reglas de seguridad lo permiten y el frontend lo transforma a disponibilidad.

## Busqueda, filtros y orden

El catalogo debe consultar productos en una sola query optimizada y filtrar por:

- texto: nombre, categoria y SKU/codigo;
- categoria;
- talle realmente existente y disponible;
- color;
- rango de precio;
- disponibilidad.

Ordenes:

- mas nuevos;
- precio menor a mayor;
- precio mayor a menor;
- destacados.

Las secciones `Novedades` y `Destacados` se basan en campos manuales: `is_new` y `featured`.

## WhatsApp

El catalogo genera un mensaje automatico con:

- producto;
- color;
- talle elegido;
- precio vigente.

Cuando tengamos el numero definitivo, se completa `whatsappNumber` en la configuracion del catalogo.

El link debe usar siempre `https://wa.me/{numero}?text={mensaje}` y `encodeURIComponent` para el mensaje.

## Imagenes

Supabase Storage:

- bucket sugerido: `product-images`;
- ruta sugerida: `products/{product_id}/{image_id}.webp`;
- metadata en `product_images`: `product_id`, `storage_path`, `alt_text`, `sort_order`, `is_primary`.

Para web conviene generar versiones optimizadas:

- formato WebP o AVIF;
- ancho mobile y desktop;
- carga lazy en grillas;
- imagen principal precargable en la pagina individual si usamos Next.js.

## Seguridad Supabase

Reglas:

- nunca exponer `service_role_key` en frontend;
- el catalogo publico solo puede leer datos de catalogo publicados;
- usuarios anonimos no pueden modificar productos, precios, stock, ventas ni configuraciones internas;
- el sistema interno requiere autenticacion;
- cambios de stock, ventas y precios solo para usuarios autorizados;
- RLS habilitado en todas las tablas sensibles.

Politicas sugeridas:

- `catalog_products`: lectura anonima publica, solo con productos publicados y disponibilidad sin cantidades exactas.
- `products`, `product_size_variants`, `product_images`: sin lectura anonima directa; la exposicion publica pasa por la vista segura.
- `business_settings` y `product_categories`: lectura anonima limitada a los campos necesarios para mostrar el catalogo.
- `sales`, `stock_movements`, `customers`, `purchases` y configuraciones internas: sin lectura anonima.

## Performance

- Evitar una query por tarjeta.
- Crear una vista `catalog_products` que devuelva producto, imagen principal, talles y disponibilidad agregada.
- Indices sugeridos: `products(slug)`, `products(published, featured, is_new)`, `products(category)`, `products(color)`, `product_size_variants(product_id, size)`, `product_images(product_id, sort_order)`.
- Si pasamos a Next.js App Router: usar Server Components para catalogo/producto, `generateMetadata` para SEO y revalidacion controlada.
- Para muchos productos: paginacion o infinite scroll.

## SEO y links compartidos

Cada producto debe generar:

- URL amigable: `/catalogo/{slug}`;
- title: `{Producto} | {Marca}`;
- meta description con descripcion corta y precio;
- Open Graph con nombre, descripcion e imagen principal;
- imagen social tomada de la imagen principal del producto.

En la version estatica local existe `catalogo/producto.html?slug=...`. Al migrar a Next.js/Vercel, esa URL pasa a `/catalogo/[slug]`.

## Pendiente antes de activar Supabase

- Crear proyecto Supabase nuevo exclusivo de BlackShoes.
- Ejecutar la migracion robusta `supabase/migrations/202609150001_blackshoes_core.sql`.
- Reemplazar las claves vacias del admin y del catalogo por las credenciales nuevas.
- Definir si el catalogo permite solo consulta o tambien pedidos/reservas.
- Reemplazar la sincronizacion heredada de estado completo por las RPC transaccionales antes de uso multiusuario real.
