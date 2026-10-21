const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "..", "app.js"), "utf8");
function slice(start, end) {
  assert.ok(source.indexOf(start) >= 0 && source.indexOf(end) > source.indexOf(start));
  return source.slice(source.indexOf(start), source.indexOf(end));
}
const priceCode = slice("let priceUpdateInProgress =", "async function commitProductFormSave(")
  + slice("async function applyPriceUpdate(", "function stockTrackedProducts(");
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function setup({ cloud = true, session = true, rpc } = {}) {
  const calls = [];
  const messages = [];
  const elements = {
    priceUpdateScope: { value: "all", disabled: false },
    priceUpdateCategory: { value: "Remeras", disabled: false },
    priceUpdatePreview: { textContent: "" },
    applyPriceUpdateButton: { textContent: "Aplicar Cambio", disabled: false },
    priceUpdateModal: { classList: { remove() {}, add() {} }, setAttribute() {} },
  };
  elements.priceUpdateForm = { elements: [elements.priceUpdateScope, elements.priceUpdateCategory, elements.applyPriceUpdateButton] };
  const c = vm.createContext({
    CLOUD_DATA_ENABLED: cloud,
    cloudEnabledWithSession: () => session,
    document: { getElementById: (id) => elements[id], querySelector: () => ({ classList: { toggle() {} } }) },
    state: { products: [{ id: "p1", category: "Remeras", price: 100, cost: 30, promoPrice: 90 }], productFilters: {}, productPage: 2 },
    supabaseClient: { rpc: async (name, args) => {
      calls.push({ name, args: structuredClone(args) });
      if (rpc) return rpc(name, args);
      return name === "get_product_price_update_preview" ? { data: { totalCount: 152 } }
        : { data: { updatedCount: 2, products: [{ id: "p1", price: 110, updated_at: "now" }, { id: "unloaded", price: 220, updated_at: "now" }] } };
    } },
    cloudOperationId: () => `operation-${calls.length}`,
    invalidateCloudProductsCache: () => calls.push({ name: "invalidate" }),
    persistStateLocalOnly: () => calls.push({ name: "persist" }),
    loadCloudProductsPage: async (...args) => calls.push({ name: "reload", args }),
    logActivity: () => calls.push({ name: "audit-local" }),
    saveState: () => calls.push({ name: "legacy-save" }),
    render: () => calls.push({ name: "render" }),
    showActionToast: (message) => messages.push(message),
    alert: (message) => messages.push(message),
    isAccessoryCategory: () => false,
  });
  vm.runInContext(priceCode, c);
  return { c, calls, messages, elements };
}

test("la vista previa cuenta la base completa, no el unico producto descargado", async () => {
  const h = setup();
  await h.c.updatePriceUpdatePreview();
  assert.match(h.elements.priceUpdatePreview.textContent, /152 Productos/);
  assert.equal(h.calls[0].args.p_category, null);
  assert.equal(h.elements.applyPriceUpdateButton.disabled, false);
  await h.c.updatePriceUpdatePreview();
  assert.equal(h.calls.length, 1, "editar el porcentaje no vuelve a consultar el mismo alcance");
});

test("el cambio de categoria descarta respuestas anteriores y deshabilita alcance vacio", async () => {
  const old = deferred();
  const h = setup({ rpc: async (_name, args) => args.p_category ? { data: { totalCount: 0 } } : old.promise });
  const pending = h.c.updatePriceUpdatePreview();
  h.elements.priceUpdateScope.value = "category";
  await h.c.updatePriceUpdatePreview();
  old.resolve({ data: { totalCount: 152 } });
  await pending;
  assert.match(h.elements.priceUpdatePreview.textContent, /0 Productos/);
  assert.equal(h.elements.applyPriceUpdateButton.disabled, true);
});

test("una categoria vacia invalida la consulta anterior", async () => {
  const request = deferred();
  const h = setup({ rpc: () => request.promise });
  const pending = h.c.updatePriceUpdatePreview();
  h.elements.priceUpdateScope.value = "category";
  h.elements.priceUpdateCategory.value = "";
  await h.c.updatePriceUpdatePreview();
  request.resolve({ data: { totalCount: 152 } });
  await pending;
  assert.match(h.elements.priceUpdatePreview.textContent, /Elegi una categoria/);
  assert.equal(h.elements.applyPriceUpdateButton.disabled, true);
});

test("RPC aplica a toda la categoria y conserva costo y promocion locales", async () => {
  const h = setup();
  h.elements.priceUpdateScope.value = "category";
  assert.equal(await h.c.applyPriceUpdate(10), true);
  assert.equal(h.calls[0].name, "update_product_prices");
  assert.equal(h.calls[0].args.p_category, "Remeras");
  assert.equal(h.calls[0].args.p_percent, 10);
  assert.equal(h.c.state.products[0].price, 110);
  assert.equal(h.c.state.products[0].cost, 30);
  assert.equal(h.c.state.products[0].promoPrice, 90);
  assert.equal(h.calls.some((call) => call.name === "legacy-save"), false);
  assert.ok(h.calls.findIndex((call) => call.name === "invalidate") < h.calls.findIndex((call) => call.name === "reload"));
  assert.equal(h.calls.find((call) => call.name === "reload").args[1], 2);
  assert.match(h.messages[0], /2 productos/);
});

test("doble clic no duplica la operacion y el boton se restaura al finalizar", async () => {
  const request = deferred();
  const h = setup({ rpc: () => request.promise });
  const pending = h.c.applyPriceUpdate(10);
  assert.equal(h.elements.applyPriceUpdateButton.disabled, true);
  assert.equal(await h.c.applyPriceUpdate(10), false);
  request.resolve({ data: { updatedCount: 0, products: [] } });
  assert.equal(await pending, true);
  assert.equal(h.calls.filter((call) => call.name === "update_product_prices").length, 1);
  assert.equal(h.elements.applyPriceUpdateButton.disabled, false);
  assert.equal(h.elements.applyPriceUpdateButton.textContent, "Aplicar Cambio");
});

test("fallo de red conserva precios e identificador para reintentar sin duplicar", async () => {
  let attempt = 0;
  const h = setup({ rpc: () => {
    if (++attempt === 1) throw new Error("timeout");
    return { data: { updatedCount: 1, products: [{ id: "p1", price: 110 }] } };
  } });
  assert.equal(await h.c.applyPriceUpdate(10), false);
  assert.equal(h.c.state.products[0].price, 100);
  assert.equal(h.elements.applyPriceUpdateButton.disabled, false);
  assert.equal(await h.c.applyPriceUpdate(10), true);
  const mutations = h.calls.filter((call) => call.name === "update_product_prices");
  assert.equal(mutations[0].args.p_operation_id, mutations[1].args.p_operation_id);
});

test("cambiar parametros despues de un error genera otra operacion", async () => {
  const h = setup({ rpc: () => ({ error: { message: "RPC inexistente" } }) });
  await h.c.applyPriceUpdate(10);
  await h.c.applyPriceUpdate(20);
  assert.notEqual(h.calls[0].args.p_operation_id, h.calls[1].args.p_operation_id);
  assert.equal(h.c.state.products[0].price, 100);
  assert.match(h.messages[0], /RPC inexistente/);
});

test("sin sesion y porcentajes invalidos no modifican precios", async () => {
  const h = setup({ session: false });
  for (const percent of [NaN, Infinity, -101, 0, 10]) assert.equal(await h.c.applyPriceUpdate(percent), false);
  assert.equal(h.calls.length, 0);
  assert.equal(h.c.state.products[0].price, 100);
});

test("respuesta incompleta no confirma el guardado ni modifica el estado local", async () => {
  const h = setup({ rpc: () => ({ data: { updatedCount: 2, products: [{ id: "p1", price: 110 }] } }) });
  assert.equal(await h.c.applyPriceUpdate(10), false);
  assert.equal(h.c.state.products[0].price, 100);
  assert.match(h.messages[0], /no confirmo/);
});

test("un fallo de cache local no se informa como un fallo del guardado confirmado", async () => {
  const h = setup();
  h.c.persistStateLocalOnly = () => { throw new Error("almacenamiento lleno"); };
  assert.equal(await h.c.applyPriceUpdate(10), true);
  assert.equal(h.c.state.products[0].price, 110);
  assert.match(h.messages[0], /se guardaron en Supabase/);
  assert.match(h.messages[0], /Recarga el sistema/);
});

test("modo local conserva el flujo anterior y persiste la actividad", async () => {
  const h = setup({ cloud: false });
  assert.equal(await h.c.applyPriceUpdate(-100), true);
  assert.equal(h.c.state.products[0].price, 0);
  assert.ok(h.calls.findIndex((call) => call.name === "audit-local") < h.calls.findIndex((call) => call.name === "legacy-save"));
});

test("invalidar la cache descarta respuestas viejas sin borrar una carga nueva", async () => {
  const old = deferred();
  const fresh = deferred();
  let attempt = 0;
  const merged = [];
  const c = vm.createContext({
    state: { productFilters: {}, productPage: 1 },
    cloudProductsCache: new Map(), cloudProductsLoads: new Map(), cloudProductsFailures: new Map(), cloudProductsMetaCache: new Map(),
    cloudEnabledWithSession: () => true,
    cloudProductsRequest: () => ({ page: 1, pageSize: 30 }), cloudProductsKey: () => "page-1",
    rememberCloudProductsMeta() {}, persistStateLocalOnly() {}, console,
    mergeCloudProductsIntoState: (rows) => { merged.push(...rows); return rows; },
    supabaseClient: { rpc: () => ++attempt === 1 ? old.promise : fresh.promise },
  });
  vm.runInContext("let cloudProductsRevision = 0;\n"
    + slice("async function loadCloudProductsPage(", "function requestCloudProductsPage(")
    + slice("function invalidateCloudProductsCache(", "let priceUpdateInProgress ="), c);
  const previous = c.loadCloudProductsPage();
  c.invalidateCloudProductsCache();
  const current = c.loadCloudProductsPage();
  old.resolve({ data: { rows: [{ price: 100 }] } });
  assert.equal(await previous, null);
  assert.equal(c.cloudProductsLoads.size, 1);
  assert.equal(merged.length, 0);
  fresh.resolve({ data: { rows: [{ price: 110 }] } });
  await current;
  assert.equal(c.cloudProductsLoads.size, 0);
  assert.equal(merged[0].price, 110);
});

test("migracion limita permisos, audita y deduplica antes de actualizar solo precios", () => {
  const sql = readFileSync(join(__dirname, "..", "supabase/migrations/202610210001_product_price_update.sql"), "utf8");
  assert.equal((sql.match(/not public\.is_active_staff\(\)/g) || []).length, 2);
  assert.equal((sql.match(/p\.sku is distinct from 'MANUAL_INTERNAL'/g) || []).length, 2);
  assert.equal((sql.match(/p\.archived_at is null/g) || []).length, 2);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.ok(sql.indexOf("return v_previous.after_data") < sql.indexOf("update public.products"));
  assert.match(sql, /set price = round\(t.price \* \(1 \+ p_percent \/ 100\), 0\), updated_by = auth.uid\(\)/);
  assert.match(sql, /revoke all on function public.update_product_prices\(uuid, numeric, text\) from public, anon/);
  assert.match(sql, /grant execute on function public.update_product_prices\(uuid, numeric, text\) to authenticated/);
});
