const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const root = join(__dirname, "..");
const source = readFileSync(join(root, "app.js"), "utf8");
const html = readFileSync(join(root, "index.html"), "utf8");
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

function setup() {
  const products = [
    { id: "zero", code: "R001", description: "Remera", category: "Remeras", subcategory: "Urbano", tracksStock: true, stock: 0, published: true, sizeVariants: [{ size: "M", stock: 0 }, { size: "L", stock: 0 }] },
    { id: "available", tracksStock: true, stock: 0, sizeVariants: [{ size: "M", stock: 2 }, { size: "L", stock: 0 }] },
    { id: "untracked", tracksStock: false, stock: 0, sizeVariants: [] },
    { id: "empty", category: "Zapatillas", tracksStock: true, stock: 0, sizeVariants: [] },
    { id: "local-available", tracksStock: true, stock: 3, sizeVariants: [] },
  ];
  const c = vm.createContext({
    state: { products, productFilters: { stock: "zero" }, productPage: 3 },
    PRODUCT_PAGE_SIZE: 30,
    normalizeProductDescription: (value) => String(value),
    sum: (rows, fn) => rows.reduce((total, row) => total + fn(row), 0),
    compareProducts: () => 0,
  });
  vm.runInContext(section("function normalizeProductSizeVariants(", "function productAvailableSizeVariants(")
    + section("function filteredProducts()", "function productRecentValue(")
    + section("function cloudProductsRequest(", "function cloudProductsMetaKey("), c);
  return c;
}

test("la lista de stock ofrece Sin stock (0) sin agregar otro control", () => {
  const select = html.match(/<select id="productStockFilter"[\s\S]*?<\/select>/)[0];
  assert.match(select, /<option value="zero">Sin stock \(0\)<\/option>/);
  for (const value of ["all", "tracked", "untracked"]) assert.ok(select.includes(`value="${value}"`));
});

test("sin stock incluye suma cero y productos sin variantes, no un talle aislado agotado", () => {
  const c = setup();
  assert.deepEqual(Array.from(c.filteredProducts(), (product) => product.id), ["zero", "empty"]);
});

test("un producto sin control de stock nunca se considera agotado", () => {
  const c = setup();
  c.state.products = [c.state.products.find((product) => product.id === "untracked")];
  assert.equal(c.filteredProducts().length, 0);
});

test("el filtro se combina con busqueda, categoria, subcategoria y publicacion", () => {
  const c = setup();
  Object.assign(c.state.productFilters, { query: "r001", category: "Remeras", subcategory: "Urbano", published: "published" });
  assert.equal(c.filteredProducts().length, 1);
  c.state.productFilters.published = "unpublished";
  assert.equal(c.filteredProducts().length, 0);
  c.state.productFilters = { stock: "zero", query: "no-existe" };
  assert.equal(c.filteredProducts().length, 0);
});

test("los filtros anteriores mantienen su significado", () => {
  const c = setup();
  c.state.productFilters.stock = "all";
  assert.equal(c.filteredProducts().length, 5);
  c.state.productFilters.stock = "tracked";
  assert.equal(c.filteredProducts().length, 4);
  c.state.productFilters.stock = "untracked";
  assert.deepEqual(Array.from(c.filteredProducts(), (product) => product.id), ["untracked"]);
});

test("RPC y cache distinguen productos sin stock del resto de filtros y paginas", () => {
  const c = setup();
  const zero = c.cloudProductsRequest({ stock: "zero" }, 2);
  assert.equal(zero.stock, "zero");
  assert.equal(zero.page, 2);
  assert.equal(zero.pageSize, 30);
  const key = c.cloudProductsKey(zero);
  assert.notEqual(key, c.cloudProductsKey(c.cloudProductsRequest({ stock: "all" }, 2)));
  assert.notEqual(key, c.cloudProductsKey(c.cloudProductsRequest({ stock: "zero" }, 1)));
  assert.notEqual(key, c.cloudProductsKey(c.cloudProductsRequest({ stock: "zero", category: "Remeras" }, 2)));
  assert.match(section("async function loadCloudProductsPage(", "function requestCloudProductsPage("), /p_stock: request.stock/);
});

test("cambiar stock vuelve a pagina 1, persiste la seleccion y actualiza el listado", () => {
  const c = setup();
  const calls = [];
  c.saveUiState = () => calls.push("save");
  c.renderCatalog = () => calls.push("render");
  vm.runInContext("function changeStock(event) {\n"
    + section('  if (event.target.id === "productStockFilter") {', '  if (event.target.matches("[data-variant-size], [data-variant-stock]"))') + "\n}", c);
  c.changeStock({ target: { id: "productStockFilter", value: "zero" } });
  assert.equal(c.state.productFilters.stock, "zero");
  assert.equal(c.state.productPage, 1);
  assert.deepEqual(calls, ["save", "render"]);
});

test("SQL filtra el stock agregado antes del conteo y conserva el resto de la RPC", () => {
  const original = readFileSync(join(root, "supabase/migrations/202609240004_products_page.sql"), "utf8").replace(/\r\n/g, "\n");
  const migration = readFileSync(join(root, "supabase/migrations/202610210002_products_zero_stock_filter.sql"), "utf8").replace(/\r\n/g, "\n");
  const start = "create or replace function public.list_products_page(";
  const end = "grant execute on function public.list_products_page(text, text, text, text, text, text, integer, integer) to authenticated;";
  const functionBody = (sql) => sql.slice(sql.indexOf(start), sql.indexOf(end) + end.length);
  const predicate = "        or (v_stock = 'zero' and pr.tracks_stock = true and pr.stock_total = 0)\n";
  assert.equal(functionBody(migration).replace(predicate, ""), functionBody(original));
  assert.ok(migration.indexOf(predicate) < migration.indexOf("counted as ("));
  assert.match(migration, /select sum\(pv.current_stock\)/);
  assert.match(migration, /pv.active = true\s+and pv.archived_at is null/);
  assert.match(migration, /notify pgrst, 'reload schema'/);
});
