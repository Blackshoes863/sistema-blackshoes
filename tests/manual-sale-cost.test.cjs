const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "..", "app.js"), "utf8");
const slices = [
  ["function itemUnitCost(", "function saleMissingCostItems("],
  ["function addManualItem(", "function updateCartItem("],
  ["async function cloudSaleItemsFromCartAsync(", "async function saveCloudLocalSale("],
  ["function normalizeCloudPayment(", "function mergeCloudSalesIntoState("],
].map(([start, end]) => source.slice(source.indexOf(start), source.indexOf(end))).join("\n");

function setup(rate = 0.45) {
  let currentRate = rate;
  let persisted;
  const context = vm.createContext({
    state: { products: [], carts: [{ id: "cart-1", items: [] }] },
    businessSettings: () => ({ missingCostFallbackRate: currentRate }),
    sum: (rows, fn) => rows.reduce((total, row) => total + fn(row), 0),
    saveUiState: () => { persisted = structuredClone(context.state); },
    render: () => {}, renderCartWorkspace: () => {},
    ensureCloudManualProduct: async () => "manual-product-id",
    resolveCloudSaleVariant: async () => null,
    isUuid: () => true,
    isoDateFromTimestamp: (date) => String(date || "").slice(0, 10),
    normalizeCustomerDni: (value) => value,
  });
  vm.runInContext(slices, context);
  return { context, setRate: (value) => { currentRate = value; }, persisted: () => persisted };
}

test("manuales nuevos tienen la casilla activada y usan el porcentaje configurado", () => {
  const h = setup();
  h.context.addManualItem("cart-1", "Ingreso manual", 100);
  const item = h.context.state.carts[0].items[0];
  assert.equal(item.calculateManualCost, true);
  assert.equal(h.context.itemUnitCost(item), 45);
  assert.equal(h.persisted().carts[0].items[0].calculateManualCost, true);
});

test("destildar guarda costo cero; volver a tildar recupera el costo estimado", () => {
  const { context: c } = setup();
  c.addManualItem("cart-1", "Manual", 100);
  c.setCartManualItemCost("cart-1", 0, false);
  assert.equal(c.itemUnitCost(c.state.carts[0].items[0]), 0);
  c.setCartManualItemCost("cart-1", 0, true);
  assert.equal(c.itemUnitCost(c.state.carts[0].items[0]), 45);
});

test("el payload envia la decision por item, junto al precio y cantidad", async () => {
  const { context: c } = setup();
  c.addManualItem("cart-1", "Con costo", 100);
  c.addManualItem("cart-1", "Sin costo", 200);
  const cart = c.state.carts[0];
  cart.items[0].quantity = 2;
  c.setCartManualItemCost(cart.id, 1, false);
  cart.manualTotalEnabled = true;
  cart.manualTotal = 150;
  cart.paidAmount = 10;
  const items = await c.cloudSaleItemsFromCartAsync(cart);
  assert.equal(items[0].calculate_manual_cost, true);
  assert.equal(items[0].unit_cost, 45);
  assert.equal(items[0].unit_price, 100);
  assert.equal(items[0].quantity, 2);
  assert.equal(items[1].calculate_manual_cost, false);
  assert.equal(items[1].unit_cost, 0);
  assert.equal(c.saleMerchandiseCost({ channel: "local", items: cart.items, total: 150, paidAmount: 10 }), 90);
});

test("una venta recargada conserva la decision y el costo original al cambiar el porcentaje", () => {
  const h = setup();
  const sale = h.context.normalizeCloudSale({
    id: "sale-1", total: 100, paid_amount: 100,
    sale_items: [{ product_id: "manual-product-id", sku: "MANUAL_INTERNAL", product_name: "Manual", quantity: 2, unit_price: 100, unit_cost: 45, calculate_manual_cost: true }],
  });
  h.setRate(0.8);
  assert.equal(sale.items[0].manual, true);
  assert.equal(sale.items[0].calculateManualCost, true);
  assert.equal(h.context.saleMerchandiseCost(sale), 90);
});

test("un costo cero guardado sigue siendo cero aunque cambie el porcentaje", () => {
  const h = setup(0.8);
  const sale = h.context.normalizeCloudSale({
    sale_items: [{ sku: "MANUAL_INTERNAL", quantity: 1, unit_price: 100, unit_cost: 0, calculate_manual_cost: false }],
  });
  assert.equal(h.context.saleMerchandiseCost(sale), 0);
});

test("porcentaje cero y redondeo a centavos coinciden con el calculo del servidor", () => {
  const h = setup(0);
  const item = { manual: true, calculateManualCost: true, unitPrice: 101 };
  assert.equal(h.context.itemUnitCost(item), 0);
  h.setRate(0.4555);
  assert.equal(h.context.itemUnitCost(item), 46.01);
});

test("los borradores manuales viejos no activan costos sin elegirlo", () => {
  const { context: c } = setup();
  assert.equal(c.itemUnitCost({ manual: true, unitPrice: 100 }), 0);
});

test("ventas anteriores respetan los costos ya guardados sin recalcularlos", () => {
  const { context: c } = setup(0.8);
  assert.equal(c.saleMerchandiseCost({ items: [{ manual: true, unitCost: 25, unitPrice: 100, quantity: 1 }] }), 25);
});

test("productos normales mantienen su costo y el estimado si no tienen costo", () => {
  const { context: c } = setup();
  c.state.products.push({ id: "p1", cost: 30 });
  assert.equal(c.itemUnitCost({ productId: "p1", unitPrice: 100 }), 30);
  assert.equal(c.itemUnitCost({ productId: "p2", unitPrice: 100 }), 45);
});
