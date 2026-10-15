const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "..", "catalogo", "catalogo.js"), "utf8");

function catalog(rows, mode = "hide", remote = true) {
  const grid = { innerHTML: "" };
  const empty = { hidden: true, innerHTML: "" };
  const context = vm.createContext({
    window: { location: { origin: "https://catalog.example", search: "?slug=agotado", pathname: "/catalogo/producto.html" }, addEventListener() {} },
    document: { addEventListener() {}, getElementById: (id) => ({ catalogGrid: grid, catalogEmpty: empty }[id] || null) },
    URLSearchParams,
  });
  vm.runInContext(source.replace(/loadCatalogProducts\(\);\s*$/, "") + `
    globalThis.api = {
      setup(rows, mode, remote) {
        catalogProducts = rows.map(normalizeCatalogProduct);
        catalogRemotePaging = remote;
        BLACKSHOES_CATALOG_CONFIG.outOfStockProductMode = mode;
        BLACKSHOES_CATALOG_CONFIG.sizeAvailabilityMode = "hide-unavailable";
      },
      renderCatalogGrid, publicProducts, selectedProduct, sizeChips, normalizeCatalogProduct
    };
  `, context);
  context.api.setup(rows, mode, remote);
  return { api: context.api, grid, empty };
}

const stocked = { id: "1", slug: "stock", name: "Con unidades", published: true, tracks_stock: true, variants: [{ size: "M", available: true }] };
const depleted = { id: "2", slug: "agotado", name: "Sin unidades", published: true, tracks_stock: true, variants: [{ size: "L", available: false }] };
const untracked = { id: "3", slug: "sin-control", name: "Sin control de stock", published: true, tracks_stock: false, variants: [] };

test("el listado remoto oculta agotados cuando esta configurado hide", () => {
  const { api, grid } = catalog([stocked, depleted]);
  api.renderCatalogGrid();
  assert.match(grid.innerHTML, /Con unidades/);
  assert.doesNotMatch(grid.innerHTML, /Sin unidades|Agotado/);
});

test("el modo show conserva los agotados y muestra su estado", () => {
  const { api, grid } = catalog([stocked, depleted], "show");
  api.renderCatalogGrid();
  assert.match(grid.innerHTML, /Sin unidades/);
  assert.match(grid.innerHTML, /Agotado/);
});

test("sin control de stock no se considera agotado ni oculta sus talles", () => {
  const { api, grid } = catalog([untracked]);
  api.renderCatalogGrid();
  assert.match(grid.innerHTML, /Sin control de stock/);
  const product = api.normalizeCatalogProduct({ ...untracked, variants: [{ size: "UNICO", stock: 0 }] });
  assert.match(api.sizeChips(product), /UNICO/);
  assert.doesNotMatch(api.sizeChips(product), /Agotado/);
});

test("un producto con un talle disponible sigue publicado", () => {
  const { api } = catalog([{ ...depleted, variants: [{ size: "M", available: false }, { size: "L", available: true }] }]);
  assert.equal(api.publicProducts().length, 1);
});

test("un producto oculto no aparece en el detalle por enlace directo", () => {
  const { api } = catalog([depleted]);
  assert.equal(api.selectedProduct(), undefined);
});

test("sin talles disponibles no muestra Disponible por error", () => {
  const { api } = catalog([]);
  assert.match(api.sizeChips(api.normalizeCatalogProduct(depleted)), /Agotado/);
  assert.doesNotMatch(api.sizeChips(api.normalizeCatalogProduct(depleted)), /Disponible/);
});

test("el listado local y los productos sin publicar respetan la visibilidad", () => {
  const { api, grid } = catalog([stocked, depleted, { ...untracked, published: false }], "hide", false);
  api.renderCatalogGrid();
  assert.match(grid.innerHTML, /Con unidades/);
  assert.doesNotMatch(grid.innerHTML, /Sin unidades|Sin control de stock/);
});

test("una pagina sin productos visibles muestra el estado vacio", () => {
  const { api, grid, empty } = catalog([depleted]);
  api.renderCatalogGrid();
  assert.equal(grid.innerHTML, "");
  assert.equal(empty.hidden, false);
  assert.match(empty.innerHTML, /No hay productos disponibles/);
});
