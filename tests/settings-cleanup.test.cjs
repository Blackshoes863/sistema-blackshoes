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
  assert.ok(from >= 0 && to > from, `Seccion existente: ${start}`);
  return source.slice(from, to);
}

test("configuracion ya no expone restauracion ni publicacion de la base vieja", () => {
  for (const id of ["importBackupButton", "importBackupInput", "openRemoteBackupsButton", "remoteBackupsModal", "publishLocalPrimaryButton"]) {
    assert.ok(!html.includes(id), id);
    assert.ok(!source.includes(id), `Sin manejadores huerfanos: ${id}`);
  }
  for (const name of ["importBackupFile", "restoreRemoteBackup", "publishLocalStateAsPrimary", "statePreparedForBackupRestore"]) {
    assert.ok(!source.includes(name), `Sin funcion de reemplazo global: ${name}`);
  }
  assert.doesNotMatch(html, /name="mercadoPagoCommissionRate"/);
});

test("se mantienen los ajustes vigentes y la exportacion Excel por RPC", () => {
  for (const id of ["businessSettingsForm", "catalogSettingsForm", "dataLoadSettingsForm", "fixedExpenseSettingsTable", "productCategorySettingsTable", "userPermissionsTable", "openActivityLogButton", "exportExcelBackupButton"]) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.match(source, /supabaseClient\.rpc\("get_excel_export_data"/);
  assert.match(source, /if \(event.target.id === "exportExcelBackupButton"\) exportExcelBackup\(\)/);
  assert.match(source, /function buildExcelBackupWorkbook\(/);
});

test("renderizar ajustes funciona sin el campo de comision retirado", () => {
  const fields = (names) => Object.fromEntries(names.map((name) => [name, { value: "" }]));
  const forms = {
    businessSettingsForm: { elements: fields(["missingCostFallbackPercent"]) },
    catalogSettingsForm: { elements: fields(["businessName", "whatsappNumber", "defaultWhatsappMessage", "sizeAvailabilityMode", "outOfStockProductMode"]) },
    dataLoadSettingsForm: { elements: fields(["cloudInitialSalesDays", "cloudInitialExpenseDays"]) },
  };
  const called = [];
  const c = vm.createContext({
    document: { getElementById: (id) => forms[id] },
    businessSettings: () => ({ missingCostFallbackRate: 0.45, cloudInitialSalesDays: 60, cloudInitialExpenseDays: 30 }),
    missingCostFallbackPercent: (rate) => rate * 100,
    catalogSettings: () => ({ businessName: "BlackShoes", whatsappNumber: "549123", defaultWhatsappMessage: "Hola", sizeAvailabilityMode: "hide-unavailable", outOfStockProductMode: "hide" }),
    renderFixedExpenseSettingsTable: () => called.push("gastos"),
    renderProductCategorySettingsTable: () => called.push("categorias"),
    renderUserPermissionsTable: () => called.push("usuarios"),
  });
  vm.runInContext(section("function renderSettings()", "function userRoleOptions("), c);
  c.renderSettings();
  assert.equal(forms.businessSettingsForm.elements.missingCostFallbackPercent.value, 45);
  assert.equal(forms.catalogSettingsForm.elements.outOfStockProductMode.value, "hide");
  assert.equal(forms.dataLoadSettingsForm.elements.cloudInitialSalesDays.value, "60");
  assert.equal(forms.dataLoadSettingsForm.elements.cloudInitialExpenseDays.value, "30");
  assert.deepEqual(called, ["gastos", "categorias", "usuarios"]);
});

function roleContext(flags = {}) {
  const c = vm.createContext({ MODULE_FLAGS: flags, userRoleLabels: {} });
  vm.runInContext(section("function userRoleOptions(", "function renderUserPermissionsTable("), c);
  return c;
}

test("los roles de modulos desactivados no se ofrecen a usuarios nuevos", () => {
  const options = roleContext().userRoleOptions();
  for (const role of ["admin", "dueno", "local", "consulta"]) assert.ok(options.includes(`value="${role}"`));
  for (const role of ["web", "taller"]) assert.ok(!options.includes(`value="${role}"`));
});

test("un rol anterior se conserva sin ofrecer el otro modulo desactivado", () => {
  const c = roleContext();
  assert.match(c.userRoleOptions("web"), /value="web" selected/);
  assert.doesNotMatch(c.userRoleOptions("web"), /value="taller"/);
  assert.match(c.userRoleOptions("taller"), /value="taller" selected/);
  assert.match(roleContext({ onlineSales: true, workshop: true }).userRoleOptions(), /value="web"/);
});

test("guardar costo estimado conserva los valores heredados y usa Supabase", async () => {
  let saved;
  const c = vm.createContext({
    CLOUD_DATA_ENABLED: true,
    state: { businessSettings: { mercadoPagoCommissionRate: 8, cloudInitialSalesDays: 60 } },
    businessSettings: (target) => target?.businessSettings || c.state.businessSettings,
    formDataObject: () => ({ missingCostFallbackPercent: "55" }),
    missingCostFallbackRateFromPercent: (value) => Number(value) / 100,
    defaultBusinessSettings: { promoDiscounts: {} },
    cloudEnabledWithSession: () => true,
    saveCloudBusinessSettings: async (settings) => { saved = structuredClone(settings); },
    logActivity() {}, saveState() {}, render() {}, showActionToast() {},
  });
  vm.runInContext(section("async function saveBusinessSettingsFromForm(", "async function saveDataLoadSettingsFromForm("), c);
  await c.saveBusinessSettingsFromForm({});
  assert.equal(saved.missingCostFallbackRate, 0.55);
  assert.equal(saved.mercadoPagoCommissionRate, 8);
  assert.equal(c.state.businessSettings.mercadoPagoCommissionRate, 8);
  assert.equal(c.state.businessSettings.cloudInitialSalesDays, 60);
});

test("Carga de Datos todavia guarda los dias y recarga mediante el flujo actual", async () => {
  let reload;
  const c = vm.createContext({
    state: { businessSettings: { missingCostFallbackRate: 0.45 } },
    businessSettings: () => c.state.businessSettings,
    formDataObject: () => ({ cloudInitialSalesDays: "30", cloudInitialExpenseDays: "0" }),
    cloudEnabledWithSession: () => true,
    loadCloudData: async (options) => { reload = options; },
    logActivity() {}, saveState() {}, render() {}, showActionToast() {},
  });
  vm.runInContext(section("async function saveDataLoadSettingsFromForm(", "async function saveCatalogSettingsFromForm("), c);
  await c.saveDataLoadSettingsFromForm({});
  assert.equal(c.state.businessSettings.cloudInitialSalesDays, 30);
  assert.equal(c.state.businessSettings.cloudInitialExpenseDays, 0);
  assert.equal(c.state.businessSettings.missingCostFallbackRate, 0.45);
  assert.equal(reload.mode, "initial");
  assert.equal(reload.force, true);
});

test("el snapshot usa los dias configurados sin depender de los respaldos viejos", async () => {
  let request;
  const c = vm.createContext({
    state: {}, CLOUD_INITIAL_SALES_DAYS: 60, CLOUD_INITIAL_EXPENSE_DAYS: 60,
    CLOUD_OPERATIONAL_MODES: { none: 0, initial: 1, full: 2 }, STOCK_HISTORY_LIMIT: 100,
    cloudEnabledWithSession: () => true,
    businessSettings: () => ({ cloudInitialSalesDays: 30, cloudInitialExpenseDays: 0 }),
    supabaseClient: { rpc: async (name, args) => { request = { name, args }; return { data: { sales: [], expenses: [], stock: [] } }; } },
    normalizeCloudSale: (row) => row, normalizeCloudExpense: (row) => row,
    normalizeCloudStockMovement: (row) => row, persistStateLocalOnly() {},
  });
  vm.runInContext('let cloudOperationalMode = "none"; let cloudOperationalLoadPromise = null;\n'
    + section("function configuredCloudInitialDays(", "async function loadCloudBusinessSettings("), c);
  assert.equal(await c.loadCloudOperationalData(), true);
  assert.equal(request.name, "get_operational_snapshot");
  assert.equal(request.args.p_sales_days, 30);
  assert.equal(request.args.p_expense_days, 0);
});

test("la PWA referencia las mismas versiones que el HTML", () => {
  const sw = readFileSync(join(root, "sw.js"), "utf8");
  for (const file of ["styles.css", "app.js"]) {
    const url = html.match(new RegExp(`${file.replace(".", "\\.")}\\?v=\\d+`))[0];
    assert.ok(sw.includes(url), url);
  }
});

test("el historial conserva los 200 movimientos mas recientes al agregar uno", () => {
  const limit = source.match(/const ACTIVITY_LOG_LIMIT = (\d+);/)[0];
  const c = vm.createContext({
    state: { activityLog: Array.from({ length: 800 }, (_, id) => ({ id: String(id) })) },
    currentActivityUser: () => ({ user: "Admin", email: "admin@example.test" }),
    uid: () => "nuevo",
  });
  vm.runInContext(limit + section("function logActivity(", "function activityLogUsers("), c);
  c.logActivity("settings", "Prueba");
  assert.equal(c.state.activityLog.length, 200);
  assert.equal(c.state.activityLog[0].id, "nuevo");
  assert.equal(c.state.activityLog[199].id, "198");
  assert.match(html, /Registra los ultimos 200 cambios/);
});

test("al normalizar un historial antiguo se conservan los ultimos 200 ordenados por fecha", () => {
  const from = source.indexOf("  next.activityLog = (next.activityLog || [])");
  const to = source.indexOf("  return next;", from);
  assert.ok(from >= 0 && to > from);
  const c = vm.createContext({ next: { activityLog: Array.from({ length: 800 }, (_, id) => ({
    id: String(id), at: new Date(Date.UTC(2026, 0, 1, 0, id)).toISOString(),
  })) } });
  vm.runInContext(source.match(/const ACTIVITY_LOG_LIMIT = (\d+);/)[0] + source.slice(from, to), c);
  assert.equal(c.next.activityLog.length, 200);
  assert.equal(c.next.activityLog[0].id, "799");
  assert.equal(c.next.activityLog[199].id, "600");
});
