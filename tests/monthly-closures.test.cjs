const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "..", "app.js"), "utf8");
const cloudFunctions = source.slice(source.indexOf("let cloudMonthlyClosuresRevision ="), source.indexOf("async function loadCloudData("));
const closeFunctions = source.slice(source.indexOf("async function closeSelectedMonth()"), source.indexOf("function renderMonthlyClosures()"));
const ID = "a1234567-1234-4123-8123-123456789abc";

function row(month = "2026-09-01", extra = {}) {
  return {
    id: ID, month, closed_at: "2026-10-15T12:00:00Z", archived_at: null,
    summary: { monthRevenue: 100000, monthExpenses: 10000, monthMerchandiseCost: 40000, monthResult: 50000, monthSalesCount: 25 },
    ...extra,
  };
}

function harness({ closures = [], rpc = async () => ({ data: row() }), selectPage = async () => ({ data: [] }) } = {}) {
  const calls = [], alerts = [], toasts = [];
  let persisted = null;
  const button = { disabled: false, textContent: "Cerrar Mes" };
  const context = vm.createContext({
    state: { selectedMonth: "2026-09", monthlyClosures: structuredClone(closures), sales: [] },
    CLOUD_DATA_ENABLED: true,
    cloudEnabledWithSession: () => true,
    isUuid: (id) => /^[a-f0-9-]{36}$/i.test(String(id || "")),
    monthLabel: (key) => `Mes ${key}`,
    currentMonthKey: () => "2026-10",
    monthlyClosureMetrics: () => { throw new Error("No debe calcular desde ventas locales parciales"); },
    document: { getElementById: () => button },
    supabaseClient: {
      rpc: async (name, args) => { calls.push({ name, args }); return rpc(name, args); },
      from: (table) => {
        assert.equal(table, "monthly_closures");
        const query = { select: () => query, order: () => query, range: (from, to) => selectPage(from, to) };
        return query;
      },
    },
    persistStateLocalOnly: () => { persisted = structuredClone(context.state); },
    saveState: () => { throw new Error("No debe usar el sync viejo"); },
    renderMonthlyClosures: () => {}, renderDashboard: () => {}, logActivity: () => {},
    showActionToast: (message) => toasts.push(message), alert: (message) => alerts.push(message),
    openConfirmModal: (options) => { context.confirmAction = options.onConfirm; },
  });
  vm.runInContext(cloudFunctions + "\n" + closeFunctions, context);
  return { context, calls, alerts, toasts, button, persisted: () => persisted };
}

test("usa el mes completo de Supabase y reemplaza el cierre local del mismo mes", async () => {
  const h = harness({ closures: [{ id: "local-1", monthKey: "2026-09", income: 1 }] });
  await h.context.closeSelectedMonth();
  assert.deepEqual(h.calls.map((call) => call.name), ["save_monthly_closure"]);
  assert.equal(h.calls[0].args.p_month, "2026-09-01");
  assert.equal(h.context.state.monthlyClosures.length, 1);
  assert.equal(h.context.state.monthlyClosures[0].income, 100000);
  assert.equal(h.context.state.monthlyClosures[0].salesCount, 25);
  assert.equal(h.persisted().monthlyClosures[0].syncStatus, "synced");
  assert.equal(h.alerts.length, 0);
  assert.equal(h.button.disabled, false);
});

test("una segunda sesion recupera el cierre y sus valores originales", async () => {
  const h = harness({ selectPage: async () => ({ data: [row()] }) });
  await h.context.loadCloudMonthlyClosures();
  assert.equal(h.context.state.monthlyClosures[0].id, ID);
  assert.equal(h.context.state.monthlyClosures[0].result, 50000);
  assert.equal(h.persisted().monthlyClosures.length, 1);
});

test("un error al guardar conserva el cierre anterior y libera el boton", async () => {
  const h = harness({ closures: [{ id: "local-1", monthKey: "2026-09", income: 123 }], rpc: async () => ({ error: { message: "sin conexion" } }) });
  await h.context.closeSelectedMonth();
  assert.equal(h.context.state.monthlyClosures[0].income, 123);
  assert.equal(h.toasts.length, 0);
  assert.match(h.alerts[0], /sin conexion/);
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, "Cerrar Mes");
});

test("sin sesion no crea un cierre solo local ni muestra exito", async () => {
  const h = harness();
  h.context.cloudEnabledWithSession = () => false;
  await h.context.closeSelectedMonth();
  assert.equal(h.calls.length, 0);
  assert.equal(h.context.state.monthlyClosures.length, 0);
  assert.equal(h.toasts.length, 0);
  assert.match(h.alerts[0], /Ingresa/);
});

test("doble click no duplica pedidos mientras se guarda", async () => {
  let finish;
  const h = harness({ rpc: () => new Promise((resolve) => { finish = resolve; }) });
  const first = h.context.closeSelectedMonth();
  await h.context.closeSelectedMonth();
  assert.equal(h.calls.length, 1);
  finish({ data: row() });
  await first;
  assert.equal(h.context.state.monthlyClosures.length, 1);
});

test("conserva cierres viejos locales y no resucita un mes archivado", async () => {
  const h = harness({
    closures: [{ id: "local-1", monthKey: "2026-08" }, { id: "local-2", monthKey: "2026-09" }],
    selectPage: async () => ({ data: [row("2026-09-01", { archived_at: "2026-10-15T13:00:00Z" })] }),
  });
  await h.context.loadCloudMonthlyClosures();
  assert.equal(h.context.state.monthlyClosures.length, 1);
  assert.equal(h.context.state.monthlyClosures[0].monthKey, "2026-08");
});

test("una recarga vieja no pisa un cierre recien actualizado", async () => {
  let finish;
  const h = harness({ selectPage: () => new Promise((resolve) => { finish = resolve; }) });
  const loading = h.context.loadCloudMonthlyClosures();
  await h.context.closeSelectedMonth();
  finish({ data: [] });
  assert.equal(await loading, false);
  assert.equal(h.context.state.monthlyClosures[0].id, ID);
});

test("el borrado remoto fallido conserva el cierre; el exitoso lo quita", async () => {
  const h = harness({ selectPage: async () => ({ data: [row()] }), rpc: async () => ({ error: { message: "fallo remoto" } }) });
  await h.context.loadCloudMonthlyClosures();
  h.context.deleteMonthlyClosure(ID);
  await h.context.confirmAction();
  assert.equal(h.context.state.monthlyClosures.length, 1);
  assert.match(h.alerts[0], /fallo remoto/);
  h.context.supabaseClient.rpc = async () => ({ error: null });
  h.context.deleteMonthlyClosure(ID);
  await h.context.confirmAction();
  assert.equal(h.context.state.monthlyClosures.length, 0);
  assert.equal(h.persisted().monthlyClosures.length, 0);
});

test("una lectura fallida o un cierre incompleto conservan el estado previo", async () => {
  const h = harness({ closures: [{ id: "local-1", monthKey: "2026-09" }], selectPage: async () => ({ error: { message: "sin permisos" } }) });
  await assert.rejects(h.context.loadCloudMonthlyClosures(), /sin permisos/);
  assert.equal(h.context.state.monthlyClosures[0].id, "local-1");
  h.context.supabaseClient.rpc = async () => ({ data: row("2026-09-01", { summary: {} }) });
  await h.context.closeSelectedMonth();
  assert.equal(h.context.state.monthlyClosures[0].id, "local-1");
  assert.match(h.alerts[0], /incompleto/);
});
