const BLACKSHOES_BUSINESS = {
  businessName: "BlackShoes",
  whatsappNumber: "",
  defaultWhatsappMessage: "Hola {businessName}, quiero consultar por este producto:",
  ...(window.BLACKSHOES_BUSINESS_CONFIG || {}),
};

const BLACKSHOES_CATALOG_CONFIG = {
  supabaseUrl: "",
  supabasePublishableKey: "",
  enabled: false,
  productsView: "catalog_products",
  localStoreKey: "blackshoes-control-v1",
  sizeAvailabilityMode: BLACKSHOES_BUSINESS.sizeAvailabilityMode || "show-unavailable",
  outOfStockProductMode: BLACKSHOES_BUSINESS.outOfStockProductMode || "show",
  ...(window.BLACKSHOES_CATALOG_REMOTE_CONFIG || {}),
};

const currency = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

let catalogProducts = [];
let catalogClient = null;
let catalogRemotePaging = false;
let catalogCurrentPage = 1;
let catalogTotalCount = 0;
let catalogPageSize = 24;
let catalogSearchTimer = null;

function catalogRootPath() {
  return "/catalogo/";
}

function catalogSection() {
  return "all";
}

function isProductDetailPage() {
  return Boolean(document.getElementById("productDetail"));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function productSlug(product) {
  return product.slug || slugify(`${product.code || ""}-${product.name || product.description || ""}-${product.color || ""}`);
}

function productPublicUrl(product) {
  return `${window.location.origin}/catalogo/producto.html?slug=${encodeURIComponent(productSlug(product))}`;
}

function normalizeImages(row) {
  const value = row.images || row.imageUrls || row.image_urls || row.photos || row.photo_urls || [];
  if (Array.isArray(value)) {
    return value
      .map((image) => String(image?.url || image?.storage_path || image?.storagePath || image || "").trim())
      .filter(Boolean);
  }
  return String(value || "").split(/\r?\n|,/).map((url) => url.trim()).filter(Boolean);
}

function normalizeSizes(row) {
  const value = row.sizeVariants || row.size_variants || row.sizes || row.variants || [];
  const list = Array.isArray(value)
    ? value
    : String(value || "").split(/\r?\n|,/).map((entry) => {
      const [size, stock = "0"] = entry.split(/[:=]/);
      return { size, stock };
    });
  return list
    .map((variant) => ({
      size: String(variant.size || variant.talle || variant.name || "").trim().toUpperCase(),
      stock: variant.stock == null && variant.available === true
        ? 1
        : Math.max(0, Math.floor(Number(variant.stock || variant.quantity || 0))),
    }))
    .filter((variant) => variant.size);
}

function normalizeCatalogProduct(row) {
  const sizes = normalizeSizes(row);
  const stock = sizes.length
    ? sizes.reduce((total, variant) => total + Number(variant.stock || 0), 0)
    : Number(row.stock || 0);
  const name = row.name || row.description || "Producto";
  return {
    id: row.id,
    slug: row.slug,
    code: row.code || "",
    name,
    description: row.catalogDescription || row.catalog_description || row.description || name,
    category: row.category || "Sin categoria",
    subcategory: row.subcategory || "",
    color: row.color || "",
    colorGroup: row.colorGroup || row.color_group || row.modelSlug || row.model_slug || slugify(name.replace(/\b(negro|blanco|rojo|azul|verde|rosa|beige|marron|gris)\b/gi, "")),
    price: Number(row.price || 0),
    promoPrice: Number(row.promoPrice || row.promo_price || 0),
    wholesalePrice: Number(row.wholesalePrice || row.wholesale_price || 0),
    stock,
    tracksStock: row.tracks_stock ?? row.tracksStock ?? true,
    published: row.published !== false,
    featured: Boolean(row.featured),
    isNew: Boolean(row.isNew || row.is_new),
    images: normalizeImages(row),
    sizes,
    createdAt: row.createdAt || row.created_at || "",
  };
}

function renderStatus(message) {
  const status = document.getElementById("catalogStatus");
  if (status) status.textContent = message;
}

function renderBusinessIdentity() {
  document.querySelectorAll(".brand strong").forEach((node) => {
    node.textContent = BLACKSHOES_BUSINESS.businessName;
  });
}

function productHasStock(product) {
  if (!product.tracksStock) return true;
  if (product.sizes.length) return product.sizes.some((variant) => variant.stock > 0);
  return product.stock > 0;
}

function publicProducts() {
  const section = catalogSection();
  return catalogProducts.filter((product) =>
    product.published && (BLACKSHOES_CATALOG_CONFIG.outOfStockProductMode !== "hide" || productHasStock(product))
  );
}

function renderSelectOptions(selectId, values, fallbackLabel) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const selected = select.value || "all";
  const options = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  select.innerHTML = [
    `<option value="all">${fallbackLabel}</option>`,
    ...options.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
  ].join("");
  select.value = options.includes(selected) ? selected : "all";
}

function renderFilterOptions(products) {
  renderSelectOptions("catalogCategory", products.map((product) => product.category), "Categorias");
  renderSelectOptions("catalogSubcategory", products.map((product) => product.subcategory), "Subcategorias");
  renderSelectOptions("catalogColor", products.map((product) => product.color), "Colores");
  renderSelectOptions("catalogSize", products.flatMap((product) => product.sizes.map((variant) => variant.size)), "Talles");
}

function renderRemoteFilterOptions(filters = {}) {
  renderSelectOptions("catalogCategory", filters.categories || [], "Categorias");
  renderSelectOptions("catalogSubcategory", filters.subcategories || [], "Subcategorias");
  renderSelectOptions("catalogColor", filters.colors || [], "Colores");
  renderSelectOptions("catalogSize", filters.sizes || [], "Talles");
}

function catalogFilterValues() {
  const maxPriceRaw = document.getElementById("catalogMaxPrice")?.value || "";
  return {
    query: String(document.getElementById("catalogSearch")?.value || "").trim(),
    category: document.getElementById("catalogCategory")?.value || "all",
    subcategory: document.getElementById("catalogSubcategory")?.value || "all",
    color: document.getElementById("catalogColor")?.value || "all",
    size: document.getElementById("catalogSize")?.value || "all",
    minPrice: Number(document.getElementById("catalogMinPrice")?.value || 0) || null,
    maxPrice: maxPriceRaw === "" ? null : Number(maxPriceRaw),
    sort: document.getElementById("catalogSort")?.value || "new",
  };
}

function renderCatalogPagination() {
  const pagination = document.getElementById("catalogPagination");
  if (!pagination) return;
  if (!catalogRemotePaging || catalogTotalCount <= catalogPageSize) {
    pagination.innerHTML = "";
    pagination.hidden = true;
    return;
  }
  const totalPages = Math.max(1, Math.ceil(catalogTotalCount / catalogPageSize));
  catalogCurrentPage = Math.min(Math.max(1, catalogCurrentPage), totalPages);
  pagination.hidden = false;
  pagination.innerHTML = `
    <button class="secondary-action" data-catalog-page-delta="-1" ${catalogCurrentPage <= 1 ? "disabled" : ""} type="button">Anterior</button>
    <span>Pagina ${catalogCurrentPage} de ${totalPages}</span>
    <button class="secondary-action" data-catalog-page-delta="1" ${catalogCurrentPage >= totalPages ? "disabled" : ""} type="button">Siguiente</button>
  `;
}

function filteredProducts() {
  const query = String(document.getElementById("catalogSearch")?.value || "").trim().toLowerCase();
  const category = document.getElementById("catalogCategory")?.value || "all";
  const subcategory = document.getElementById("catalogSubcategory")?.value || "all";
  const color = document.getElementById("catalogColor")?.value || "all";
  const size = document.getElementById("catalogSize")?.value || "all";
  const minPrice = Number(document.getElementById("catalogMinPrice")?.value || 0);
  const maxPriceRaw = document.getElementById("catalogMaxPrice")?.value || "";
  const maxPrice = maxPriceRaw === "" ? Infinity : Number(maxPriceRaw);
  const sort = document.getElementById("catalogSort")?.value || "new";
  const rows = publicProducts().filter((product) => {
    const matchesCategory = category === "all" || product.category === category;
    const matchesSubcategory = subcategory === "all" || product.subcategory === subcategory;
    const matchesColor = color === "all" || product.color === color;
    const activePrice = product.promoPrice > 0 && product.promoPrice < product.price ? product.promoPrice : product.price;
    const matchesPrice = activePrice >= minPrice && activePrice <= maxPrice;
    const sizeVariants = size === "all" ? product.sizes : product.sizes.filter((variant) => variant.size === size);
    const matchesSize = size === "all" || sizeVariants.some((variant) => !product.tracksStock || variant.stock > 0);
    const haystack = [product.code, product.sku, product.name, product.description, product.category, product.subcategory, product.color].join(" ").toLowerCase();
    return matchesCategory && matchesSubcategory && matchesColor && matchesPrice && matchesSize && (!query || haystack.includes(query));
  });
  return rows.sort((a, b) => {
    if (sort === "priceAsc") return effectivePrice(a) - effectivePrice(b);
    if (sort === "priceDesc") return effectivePrice(b) - effectivePrice(a);
    return newestFirst(a, b);
  });
}

function newestFirst(a, b) {
  return Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
}

function effectivePrice(product) {
  return product.promoPrice > 0 && product.promoPrice < product.price ? product.promoPrice : product.price;
}

function availabilityText(product) {
  return productHasStock(product) ? "Disponible" : "Agotado";
}

function priceBlock(product) {
  if (product.promoPrice > 0 && product.promoPrice < product.price) {
    return `<div class="price-row"><strong>${currency.format(product.promoPrice)}</strong><span>${currency.format(product.price)}</span></div>`;
  }
  return `<div class="price-row"><strong>${currency.format(product.price)}</strong></div>`;
}

function sizeChips(product, interactive = false, selectedSize = "") {
  const visibleSizes = BLACKSHOES_CATALOG_CONFIG.sizeAvailabilityMode === "hide-unavailable"
    ? product.sizes.filter((variant) => variant.stock > 0)
    : product.sizes;
  if (!visibleSizes.length) return '<span class="size-chip ok">Disponible</span>';
  return visibleSizes.map((variant) => {
    const available = !product.tracksStock || variant.stock > 0;
    const selected = variant.size === selectedSize ? " selected" : "";
    const text = available ? `${variant.size} ✓` : `${variant.size} Agotado`;
    if (!interactive) return `<span class="size-chip ${available ? "ok" : "out"}">${escapeHtml(text)}</span>`;
    return `<button class="size-chip ${available ? "ok" : "out"}${selected}" data-select-size="${escapeHtml(variant.size)}" ${available ? "" : "disabled"} type="button">${escapeHtml(text)}</button>`;
  }).join("");
}

function relatedColorProducts(product) {
  return publicProducts().filter((item) => item.colorGroup && item.colorGroup === product.colorGroup);
}

function colorText(product) {
  const colors = [...new Set(relatedColorProducts(product).map((item) => item.color).filter(Boolean))];
  return colors.length > 1 ? colors.join(", ") : product.color || "Unico";
}

function whatsappHref(product, size = "") {
  const intro = BLACKSHOES_BUSINESS.defaultWhatsappMessage.replace("{businessName}", BLACKSHOES_BUSINESS.businessName);
  const message = [
    intro,
    product.name,
    product.color ? `Color: ${product.color}` : "",
    size ? `Talle: ${size}` : "",
    `Precio: ${currency.format(effectivePrice(product))}`,
    `Link: ${productPublicUrl(product)}`,
  ].filter(Boolean).join("\n");
  const phone = BLACKSHOES_BUSINESS.whatsappNumber.replace(/\D/g, "");
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function productImage(product, className = "product-image") {
  const image = product.images[0];
  if (image) return `<img class="${className}" src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}">`;
  return `<div class="${className} placeholder" aria-hidden="true"><img src="/assets/blackshoes-logo.png" alt=""></div>`;
}

function productGallery(product) {
  const images = (product.images || []).filter(Boolean);
  if (!images.length) {
    return `<section class="product-gallery single">${productImage(product, "gallery-image")}</section>`;
  }
  const firstImage = images[0];
  return `
    <section class="product-gallery" data-product-gallery>
      <div class="gallery-stage">
        <img class="gallery-main-image" data-gallery-main src="${escapeHtml(firstImage)}" alt="${escapeHtml(`${product.name} foto 1`)}">
      </div>
      ${images.length > 1 ? `
        <div class="gallery-thumbs" aria-label="Fotos del producto">
          ${images.map((image, index) => {
            const alt = `${product.name} foto ${index + 1}`;
            return `
              <button class="gallery-thumb" data-gallery-thumb data-gallery-image="${escapeHtml(image)}" data-gallery-alt="${escapeHtml(alt)}" aria-current="${index === 0 ? "true" : "false"}" type="button">
                <img src="${escapeHtml(image)}" alt="${escapeHtml(alt)}">
              </button>
            `;
          }).join("")}
        </div>
      ` : ""}
    </section>
  `;
}

function applyBusinessSettings(data = {}) {
  BLACKSHOES_BUSINESS.businessName = data.business_name || data.businessName || BLACKSHOES_BUSINESS.businessName;
  BLACKSHOES_BUSINESS.whatsappNumber = data.whatsapp_number || data.whatsappNumber || window.BLACKSHOES_BUSINESS_CONFIG?.whatsappNumber || BLACKSHOES_BUSINESS.whatsappNumber;
  BLACKSHOES_BUSINESS.defaultWhatsappMessage = data.default_whatsapp_message || data.defaultWhatsappMessage || BLACKSHOES_BUSINESS.defaultWhatsappMessage;
  BLACKSHOES_CATALOG_CONFIG.sizeAvailabilityMode = data.size_availability_mode || data.sizeAvailabilityMode || BLACKSHOES_CATALOG_CONFIG.sizeAvailabilityMode;
  BLACKSHOES_CATALOG_CONFIG.outOfStockProductMode = data.out_of_stock_product_mode || data.outOfStockProductMode || BLACKSHOES_CATALOG_CONFIG.outOfStockProductMode;
}

function loadLocalCatalogState() {
  try {
    const raw = localStorage.getItem(BLACKSHOES_CATALOG_CONFIG.localStoreKey);
    if (!raw) return false;
    const localState = JSON.parse(raw);
    applyBusinessSettings(localState.catalogSettings || {});
    catalogProducts = (localState.products || []).map(normalizeCatalogProduct);
    return true;
  } catch (error) {
    console.warn("No se pudo leer el catalogo local", error);
    return false;
  }
}

function renderLocalCatalogState() {
  const hasLocalState = loadLocalCatalogState();
  renderBusinessIdentity();
  renderStatus(hasLocalState ? "Vista local conectada" : "Supabase pendiente");
  renderFilterOptions(publicProducts());
  renderCatalogGrid();
  renderProductDetail();
}

async function loadBusinessSettings(client) {
  const { data, error } = await client
    .from("business_settings")
    .select("business_name, whatsapp_number, default_whatsapp_message, size_availability_mode, out_of_stock_product_mode")
    .eq("id", "main")
    .maybeSingle();
  if (error || !data) return;
  applyBusinessSettings(data);
}

function renderCatalogGrid() {
  const grid = document.getElementById("catalogGrid");
  const empty = document.getElementById("catalogEmpty");
  if (!grid) return;
  const products = catalogRemotePaging ? publicProducts() : filteredProducts();
  grid.innerHTML = products.map((product) => {
    const slug = productSlug(product);
    const firstSize = product.sizes.find((variant) => variant.stock > 0)?.size || product.sizes[0]?.size || "";
    return `
      <article class="product-card">
          <a class="product-card-main" href="${catalogRootPath()}producto.html?slug=${encodeURIComponent(slug)}">
          ${productImage(product)}
          <div class="card-badges">
            ${!productHasStock(product) ? '<span>Agotado</span>' : ""}
          </div>
          <small>${escapeHtml([product.category, product.color].filter(Boolean).join(" / "))}</small>
          <h2>${escapeHtml(product.name)}</h2>
          ${priceBlock(product)}
          <p class="product-meta">Colores: ${escapeHtml(colorText(product))}</p>
          <div class="size-row">${sizeChips(product)}</div>
        </a>
        <div class="card-actions">
          <a class="secondary-action" href="${catalogRootPath()}producto.html?slug=${encodeURIComponent(slug)}">Ver producto</a>
          <a class="whatsapp-action" href="${whatsappHref(product, firstSize)}" target="_blank" rel="noopener">WhatsApp</a>
        </div>
      </article>
    `;
  }).join("");
  if (empty) empty.hidden = products.length > 0 || catalogProducts.length > 0 || catalogTotalCount > 0;
  renderCatalogPagination();
}

function selectedProduct() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug") || slugify(window.location.pathname.split("/").filter(Boolean).pop() || "");
  return publicProducts().find((item) => productSlug(item) === slug);
}

function renderProductDetail(selectedSize = "") {
  const detail = document.getElementById("productDetail");
  if (!detail) return;
  const product = selectedProduct();
  if (!product) {
    detail.innerHTML = `
      <section class="catalog-empty">
        <h1>Producto no disponible</h1>
        <p>El catalogo se va a completar cuando conectemos Supabase nuevo para BlackShoes.</p>
      </section>
    `;
    return;
  }
  document.title = `${product.name} | ${BLACKSHOES_BUSINESS.businessName}`;
  const metaDescription = document.querySelector('meta[name="description"]');
  if (metaDescription) metaDescription.setAttribute("content", `${product.description} ${currency.format(effectivePrice(product))}`);
  const activeSize = selectedSize || product.sizes.find((variant) => variant.stock > 0)?.size || "";
  const colors = relatedColorProducts(product);
  const colorOptions = colors.length > 1 ? `
    <label class="product-control">
      <span>Color</span>
      <select id="productColorSelect">
        ${colors.map((item) => `<option value="${escapeHtml(productSlug(item))}" ${item.id === product.id ? "selected" : ""}>${escapeHtml(item.color || item.name)}</option>`).join("")}
      </select>
    </label>
  ` : `<p class="product-meta">Color: ${escapeHtml(product.color || "Unico")}</p>`;
  const related = publicProducts()
    .filter((item) => item.id !== product.id && item.category === product.category)
    .sort((a, b) => Number(productHasStock(b)) - Number(productHasStock(a)) || newestFirst(a, b))
    .slice(0, 4);
  detail.innerHTML = `
    <article class="product-detail">
      ${productGallery(product)}
      <section class="product-info">
        <div class="card-badges inline">
          ${!productHasStock(product) ? '<span>Agotado</span>' : ""}
        </div>
        <small>${escapeHtml(product.category)}</small>
        <h1>${escapeHtml(product.name)}</h1>
        ${product.code ? `<span class="product-code">Código interno: ${escapeHtml(product.code)}</span>` : ""}
        <p>${escapeHtml(product.description)}</p>
        ${priceBlock(product)}
        ${colorOptions}
        <div class="product-control">
          <span>Talle</span>
          <div class="size-row">${sizeChips(product, true, activeSize)}</div>
        </div>
        <p class="${productHasStock(product) ? "stock-ok" : "stock-out"}">${availabilityText(product)}</p>
        <a class="whatsapp-action full" id="productWhatsapp" href="${whatsappHref(product, activeSize)}" target="_blank" rel="noopener">Consultar por WhatsApp</a>
      </section>
    </article>
    ${related.length ? `
      <section class="related-products">
        <h2>Productos relacionados</h2>
        <div class="catalog-grid compact">
          ${related.map((item) => `
            <a class="mini-card" href="/catalogo/producto.html?slug=${encodeURIComponent(productSlug(item))}">
              ${productImage(item, "mini-image")}
              <strong>${escapeHtml(item.name)}</strong>
              <span>${currency.format(effectivePrice(item))}</span>
            </a>
          `).join("")}
        </div>
      </section>
    ` : ""}
  `;
}

function catalogSlugFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("slug") || slugify(window.location.pathname.split("/").filter(Boolean).pop() || "");
}

async function loadRemoteCatalogPage(page = catalogCurrentPage) {
  if (!catalogClient) return false;
  const filters = catalogFilterValues();
  renderStatus("Actualizando");
  const { data, error } = await catalogClient.rpc("list_public_catalog_products", {
    p_query: filters.query,
    p_category: filters.category,
    p_subcategory: filters.subcategory,
    p_color: filters.color,
    p_size: filters.size,
    p_min_price: filters.minPrice,
    p_max_price: filters.maxPrice,
    p_sort: filters.sort,
    p_page: page,
    p_page_size: catalogPageSize,
  });
  if (error) throw error;
  catalogRemotePaging = true;
  catalogCurrentPage = Number(data?.page || page || 1);
  catalogPageSize = Number(data?.pageSize || catalogPageSize);
  catalogTotalCount = Number(data?.totalCount || 0);
  catalogProducts = (data?.rows || []).map(normalizeCatalogProduct);
  renderRemoteFilterOptions(data?.filters || {});
  renderCatalogGrid();
  renderStatus(catalogTotalCount ? "Catalogo actualizado" : "Sin productos");
  return true;
}

async function loadRemoteProductDetail() {
  if (!catalogClient) return false;
  renderStatus("Actualizando");
  const { data, error } = await catalogClient.rpc("get_public_catalog_product", {
    p_slug: catalogSlugFromUrl(),
  });
  if (error) throw error;
  const rows = [data?.product, ...(data?.related || [])].filter(Boolean);
  catalogRemotePaging = true;
  catalogProducts = rows.map(normalizeCatalogProduct);
  catalogTotalCount = catalogProducts.length;
  renderProductDetail();
  renderStatus(data?.product ? "Producto actualizado" : "Producto no disponible");
  return true;
}

async function loadLegacyCatalogProducts(client) {
  const { data, error } = await client
    .from(BLACKSHOES_CATALOG_CONFIG.productsView)
    .select("*")
    .eq("published", true)
    .order("description", { ascending: true });
  if (error) throw error;
  catalogRemotePaging = false;
  catalogProducts = (data || []).map(normalizeCatalogProduct);
  catalogTotalCount = catalogProducts.length;
  renderFilterOptions(publicProducts());
  renderCatalogGrid();
  renderProductDetail();
  renderStatus("Catalogo actualizado");
}

function reloadCatalogPage({ resetPage = true, debounce = false } = {}) {
  if (!catalogRemotePaging || !catalogClient || isProductDetailPage()) {
    renderCatalogGrid();
    return;
  }
  if (resetPage) catalogCurrentPage = 1;
  const run = () => loadRemoteCatalogPage(catalogCurrentPage).catch((error) => {
    console.warn("No se pudo actualizar la pagina del catalogo", error);
    renderStatus("No disponible");
  });
  if (!debounce) {
    run();
    return;
  }
  clearTimeout(catalogSearchTimer);
  catalogSearchTimer = setTimeout(run, 250);
}

async function loadCatalogProducts() {
  if (!BLACKSHOES_CATALOG_CONFIG.enabled || !BLACKSHOES_CATALOG_CONFIG.supabaseUrl || !BLACKSHOES_CATALOG_CONFIG.supabasePublishableKey) {
    renderLocalCatalogState();
    return;
  }

  try {
    renderStatus("Actualizando");
    catalogClient = window.supabase.createClient(
      BLACKSHOES_CATALOG_CONFIG.supabaseUrl,
      BLACKSHOES_CATALOG_CONFIG.supabasePublishableKey
    );
    await loadBusinessSettings(catalogClient);
    renderBusinessIdentity();
    if (isProductDetailPage()) {
      await loadRemoteProductDetail();
      return;
    }
    await loadRemoteCatalogPage(1);
  } catch (error) {
    console.warn("No se pudo cargar el catalogo publico", error);
    try {
      if (catalogClient && !isProductDetailPage()) {
        await loadLegacyCatalogProducts(catalogClient);
        return;
      }
    } catch (legacyError) {
      console.warn("No se pudo cargar el catalogo legacy", legacyError);
    }
    renderStatus("No disponible");
    renderCatalogGrid();
    renderProductDetail();
  }
}

document.getElementById("catalogSearch")?.addEventListener("input", () => reloadCatalogPage({ resetPage: true, debounce: true }));
document.getElementById("catalogCategory")?.addEventListener("change", () => reloadCatalogPage({ resetPage: true }));
document.getElementById("catalogSubcategory")?.addEventListener("change", () => reloadCatalogPage({ resetPage: true }));
document.getElementById("catalogColor")?.addEventListener("change", () => reloadCatalogPage({ resetPage: true }));
document.getElementById("catalogSize")?.addEventListener("change", () => reloadCatalogPage({ resetPage: true }));
document.getElementById("catalogMinPrice")?.addEventListener("input", () => reloadCatalogPage({ resetPage: true, debounce: true }));
document.getElementById("catalogMaxPrice")?.addEventListener("input", () => reloadCatalogPage({ resetPage: true, debounce: true }));
document.getElementById("catalogSort")?.addEventListener("change", () => reloadCatalogPage({ resetPage: true }));
document.addEventListener("click", (event) => {
  const pageButton = event.target.closest("[data-catalog-page-delta]");
  if (pageButton) {
    catalogCurrentPage += Number(pageButton.dataset.catalogPageDelta || 0);
    reloadCatalogPage({ resetPage: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  const galleryThumb = event.target.closest("[data-gallery-thumb]");
  if (galleryThumb) {
    const gallery = galleryThumb.closest("[data-product-gallery]");
    const mainImage = gallery?.querySelector("[data-gallery-main]");
    if (mainImage && galleryThumb.dataset.galleryImage) {
      mainImage.src = galleryThumb.dataset.galleryImage;
      mainImage.alt = galleryThumb.dataset.galleryAlt || mainImage.alt;
      gallery.querySelectorAll("[data-gallery-thumb]").forEach((button) => button.setAttribute("aria-current", "false"));
      galleryThumb.setAttribute("aria-current", "true");
    }
    return;
  }
  const sizeButton = event.target.closest("[data-select-size]");
  if (sizeButton) renderProductDetail(sizeButton.dataset.selectSize);
});
document.addEventListener("change", (event) => {
  if (event.target.id === "productColorSelect") {
    window.location.href = `/catalogo/producto.html?slug=${encodeURIComponent(event.target.value)}`;
  }
});
window.addEventListener("storage", (event) => {
  if (event.key === BLACKSHOES_CATALOG_CONFIG.localStoreKey && !BLACKSHOES_CATALOG_CONFIG.enabled) {
    renderLocalCatalogState();
  }
});
window.addEventListener("focus", () => {
  if (!BLACKSHOES_CATALOG_CONFIG.enabled) renderLocalCatalogState();
});
loadCatalogProducts();
