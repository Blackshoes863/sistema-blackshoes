const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "..", "app.js"), "utf8");
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

function setup({ cloud = true } = {}) {
  const calls = [];
  const elements = Object.fromEntries(["stockHistoryProduct", "stockHistoryProductSearch", "stockHistoryType", "stockHistoryFrom", "stockHistoryTo", "stockHistoryTable", "stockHistoryPagination"].map((id) => [id, { value: "", innerHTML: "" }]));
  elements.stockHistoryProduct.value = "all";
  elements.stockHistoryType.value = "all";
  elements.stockHistoryModal = { classList: { contains: () => true, add() {}, remove() {} }, setAttribute() {} };
  const c = vm.createContext({
    state: { stockHistory: [], stockHistoryPage: 1 },
    cloudStockHistoryCache: new Map(), cloudStockHistoryLoads: new Map(), cloudStockHistoryFailures: new Map(),
    document: { getElementById: (id) => elements[id] },
    cloudEnabledWithSession: () => cloud,
    isUuid: (id) => id === "product-id",
    normalizeDateInput: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "",
    normalizeCloudStockMovement: (row) => row,
    formatDateShort: (date) => date, stockTypeLabel: (type) => type,
    stockHistoryPaginationControls: (page, pages, total) => `${page}/${pages}: ${total}`,
    renderStockHistoryProductOptions() {},
    setDateInput: (input, value) => { input.value = value; },
    supabaseClient: { rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { rows: [], totalCount: 501, page: args.p_page, pageSize: args.p_page_size } };
    } }, console,
  });
  vm.runInContext(source.match(/const STOCK_HISTORY_LIMIT = \d+;/)[0]
    + source.match(/const STOCK_HISTORY_PAGE_SIZE = \d+;/)[0]
    + section("function stockHistoryFiltersFromInputs()", "function configuredCloudInitialDays(")
    + section("function renderStockHistoryFilters()", "function openManualItemModal()"), c);
  return { c, calls, elements };
}

test("sin fechas limita a diez paginas de veinte movimientos", () => {
  const { c } = setup();
  assert.equal(c.stockHistoryViewLimit({}), 200);
  assert.equal(c.cloudStockHistoryRequest({}, 99).page, 10);
  assert.equal(c.cloudStockHistoryRequest({}, 2).page, 2);
  assert.equal(c.cloudStockHistoryRequest({}, 0).pageSize, 20);
});

test("Desde o Hasta permiten consultar movimientos anteriores sin el limite reciente", () => {
  const { c } = setup();
  for (const filters of [{ from: "2020-01-01" }, { to: "2020-12-31" }, { from: "2020-01-01", to: "2020-12-31" }]) {
    assert.equal(c.stockHistoryViewLimit(filters), Infinity);
    assert.equal(c.cloudStockHistoryRequest(filters, 15).page, 15);
  }
});

test("RPC conserva la consulta paginada y limita solo el total de la vista reciente", async () => {
  const { c, calls } = setup();
  const recent = await c.loadCloudStockHistoryPage({}, 10);
  assert.equal(recent.totalCount, 200);
  assert.equal(calls[0].name, "list_stock_history_page");
  assert.equal(calls[0].args.p_page, 10);
  assert.equal(calls[0].args.p_page_size, 20);
  assert.equal(calls[0].args.p_from, null);
  const range = await c.loadCloudStockHistoryPage({ from: "2020-01-01", to: "2020-12-31" }, 15);
  assert.equal(range.totalCount, 501);
  assert.equal(calls[1].args.p_page, 15);
  assert.equal(calls[1].args.p_from, "2020-01-01");
  assert.equal(calls[1].args.p_to, "2020-12-31");
});

test("volver a una pagina usa cache y las fechas y filtros tienen entradas separadas", async () => {
  const { c, calls } = setup();
  await c.loadCloudStockHistoryPage({}, 1);
  await c.loadCloudStockHistoryPage({}, 1);
  assert.equal(calls.length, 1);
  const key = c.cloudStockHistoryKey(c.cloudStockHistoryRequest({}, 1));
  for (const filters of [{ from: "2020-01-01" }, { productId: "product-id" }, { type: "venta" }, { productQuery: "R001" }]) {
    assert.notEqual(key, c.cloudStockHistoryKey(c.cloudStockHistoryRequest(filters, 1)));
  }
});

test("mientras carga pagina dos no vuelve a pagina uno por una copia local vacia", () => {
  const { c, elements } = setup();
  c.cloudStockHistoryCache.set(c.cloudStockHistoryKey(c.cloudStockHistoryRequest({}, 1)), { rows: [], totalCount: 200, page: 1 });
  c.state.stockHistoryPage = 2;
  c.requestCloudStockHistoryPage = () => {};
  c.renderStockHistoryTable();
  assert.equal(c.state.stockHistoryPage, 2);
  assert.match(elements.stockHistoryTable.innerHTML, /Cargando movimientos/);
  assert.equal(elements.stockHistoryPagination.innerHTML, "2/10: 200");
});

test("la copia local muestra los ultimos 200 sin eliminar el historial de origen", () => {
  const { c, elements } = setup({ cloud: false });
  c.state.stockHistory = Array.from({ length: 300 }, (_, id) => ({
    id, productId: "product-id", productCode: `R${id}`, productName: "Producto", type: "entrada", date: "2020-01-01", quantity: 1, stockAfter: id, note: "Prueba",
  }));
  c.renderStockHistoryTable();
  assert.equal(elements.stockHistoryPagination.innerHTML, "1/10: 200");
  assert.match(elements.stockHistoryTable.innerHTML, /R299/);
  c.state.stockHistoryPage = 10;
  c.renderStockHistoryTable();
  assert.match(elements.stockHistoryTable.innerHTML, /R100/);
  assert.doesNotMatch(elements.stockHistoryTable.innerHTML, /<strong>R99<\/strong>/);
  assert.equal(c.state.stockHistory.length, 300);
  elements.stockHistoryFrom.value = "2020-01-01";
  c.state.stockHistoryPage = 15;
  c.renderStockHistoryTable();
  assert.equal(elements.stockHistoryPagination.innerHTML, "15/15: 300");
  assert.match(elements.stockHistoryTable.innerHTML, /<strong>R0<\/strong>/);
});

test("abrir el modal vuelve a la vista reciente con fechas vacias", () => {
  const { c, elements } = setup({ cloud: false });
  elements.stockHistoryFrom.value = "2020-01-01";
  elements.stockHistoryTo.value = "2020-12-31";
  c.state.stockHistoryPage = 15;
  c.openStockHistoryModal();
  assert.equal(c.state.stockHistoryPage, 1);
  assert.equal(elements.stockHistoryFrom.value, "");
  assert.equal(elements.stockHistoryTo.value, "");
});
