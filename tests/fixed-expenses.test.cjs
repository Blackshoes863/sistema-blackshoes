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
const fixedCode = section("function parseMoneyInput(", "function formatMoneyInputValue(")
  + section("let fixedExpensesInProgress =", "function renderSettings()");
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};

function setup({ cloud = true, session = true, rpc } = {}) {
  const calls = [];
  const messages = [];
  let operation = 0;
  const fields = {
    fixedExpensesDate: { value: "2026-10-21", disabled: false },
    confirmFixedExpensesButton: { textContent: "Cargar Gastos Fijos", disabled: false },
    fixedExpensesTable: { innerHTML: "" },
  };
  const selected = {
    rent: { checked: true, disabled: false, value: "100" },
    light: { checked: false, disabled: false, value: "200" },
    disabled: { checked: true, disabled: false, value: "300" },
  };
  fields.fixedExpensesModal = {
    querySelectorAll: () => [fields.fixedExpensesDate, fields.confirmFixedExpensesButton, ...Object.values(selected)],
    classList: { remove: () => calls.push({ name: "close" }), add() {} }, setAttribute() {},
  };
  const c = vm.createContext({
    CLOUD_DATA_ENABLED: cloud,
    state: {
      expenses: [], expensesPage: 3, expenseFilters: {}, selectedMonth: "2026-10",
      fixedExpenseTemplates: [
        { id: "rent", concept: "Alquiler", category: "Alquiler", amount: 100 },
        { id: "light", concept: "Luz", category: "Servicios", amount: 200 },
        { id: "disabled", concept: "Antiguo", category: "Servicios", disabled: true },
      ],
    },
    document: {
      getElementById: (id) => fields[id],
      querySelector: (selector) => {
        const id = selector.match(/="([^"]+)"/)?.[1];
        return selector.includes("data-fixed-enabled") ? selected[id] : { value: selected[id]?.value };
      },
    },
    normalizeDateInput: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "",
    monthKeyFromDate: (date) => date.slice(0, 7), monthLabel: (date) => date,
    expenseCategoryRules: { Alquiler: { type: "expense" }, Servicios: { type: "expense" }, CompraMercaderia: { type: "purchase" } },
    cloudEnabledWithSession: () => session,
    cloudOperationId: () => `operation-${++operation}`,
    supabaseClient: { rpc: async (name, args) => {
      calls.push({ name, args: structuredClone(args) });
      if (rpc) return rpc(name, args);
      return { data: { savedCount: args.p_expenses.length, expenses: args.p_expenses.map((row) => ({ id: `saved-${row.template_id}`, fixed_template_id: row.template_id, amount: row.amount })) } };
    } },
    mergeCloudExpenseRecord: (row) => {
      c.state.expenses = c.state.expenses.filter((expense) => expense.id !== row.id);
      c.state.expenses.push(row);
    },
    invalidateCloudExpensesCache: () => calls.push({ name: "invalidate" }),
    persistStateLocalOnly: () => calls.push({ name: "persist" }),
    loadCloudExpensesPage: async (...args) => calls.push({ name: "reload", args }),
    loadCloudDashboardSummary: async () => calls.push({ name: "dashboard" }),
    logActivity: () => calls.push({ name: "activity" }),
    saveState: () => calls.push({ name: "legacy-save" }),
    render: () => calls.push({ name: "render" }),
    showActionToast: (message) => messages.push(message), alert: (message) => messages.push(message),
    uid: () => "local-expense", todayIso: () => "2026-10-21",
    normalizeFixedExpenseTemplates: (rows) => rows,
    formatAllMoneyInputs() {},
    expenseCategoryLabel: (value) => value,
    htmlAttr: (value) => String(value).replaceAll("<", "&lt;"),
  });
  vm.runInContext(fixedCode, c);
  return { c, calls, messages, fields, selected };
}

test("el modal usa el importe base y no muestra plantillas deshabilitadas", () => {
  const h = setup();
  h.c.renderFixedExpensesTable();
  assert.match(h.fields.fixedExpensesTable.innerHTML, /data-fixed-amount="rent"[^>]*value="100"/);
  assert.doesNotMatch(h.fields.fixedExpensesTable.innerHTML, /data-fixed-amount="disabled"/);
});

test("la carga envia solo lo seleccionado en una RPC y refresca listado y resumen", async () => {
  const h = setup();
  assert.equal(await h.c.confirmFixedExpenses(), true);
  assert.equal(h.calls[0].name, "register_fixed_expenses");
  assert.equal(h.calls[0].args.p_date, "2026-10-21");
  assert.deepEqual(h.calls[0].args.p_expenses, [{ template_id: "rent", concept: "Alquiler", category: "Alquiler", amount: 100 }]);
  assert.equal(h.c.state.expenses.length, 1);
  assert.equal(h.c.state.expensesPage, 1);
  assert.ok(h.calls.some((call) => call.name === "dashboard"));
  assert.ok(h.calls.some((call) => call.name === "invalidate"));
  assert.ok(h.calls.some((call) => call.name === "reload"));
  assert.equal(h.calls.some((call) => call.name === "legacy-save"), false);
  assert.equal(h.fields.confirmFixedExpensesButton.disabled, false);
});

test("los separadores de miles conservan el importe al cargar y al guardar plantillas", async () => {
  const h = setup();
  h.selected.rent.value = "150.000";
  assert.equal(await h.c.confirmFixedExpenses(), true);
  assert.equal(h.calls[0].args.p_expenses[0].amount, 150000);
  const fields = { concept: { value: "Alquiler" }, category: { value: "Alquiler" }, amount: { value: "150.000" } };
  h.c.document.querySelectorAll = () => [{
    dataset: { fixedTemplateRow: "rent" },
    querySelector: (selector) => fields[selector.match(/="([^"]+)"/)[1]],
  }];
  h.c.renderSettings = () => {};
  vm.runInContext(section("function saveFixedExpenseTemplatesFromSettings()", "function addFixedExpenseTemplate()"), h.c);
  h.c.saveFixedExpenseTemplatesFromSettings();
  assert.equal(h.c.state.fixedExpenseTemplates[0].amount, 150000);
});

test("un fallo mantiene los datos y valores del modal y reutiliza la operacion al reintentar", async () => {
  let attempt = 0;
  const h = setup({ rpc: (_name, args) => {
    if (++attempt === 1) return { error: { message: "timeout" } };
    return { data: { savedCount: 1, expenses: [{ id: "saved", fixed_template_id: "rent", amount: args.p_expenses[0].amount }] } };
  } });
  assert.equal(await h.c.confirmFixedExpenses(), false);
  assert.equal(h.c.state.expenses.length, 0);
  assert.equal(h.selected.rent.checked, true);
  assert.equal(h.selected.rent.value, "100");
  assert.equal(h.fields.confirmFixedExpensesButton.disabled, false);
  assert.equal(await h.c.confirmFixedExpenses(), true);
  const mutations = h.calls.filter((call) => call.name === "register_fixed_expenses");
  assert.equal(mutations[0].args.p_operation_id, mutations[1].args.p_operation_id);
});

test("cambiar el importe tras un error genera una nueva operacion", async () => {
  const h = setup({ rpc: () => ({ error: { message: "RPC faltante" } }) });
  await h.c.confirmFixedExpenses();
  h.selected.rent.value = "150";
  await h.c.confirmFixedExpenses();
  assert.notEqual(h.calls[0].args.p_operation_id, h.calls[1].args.p_operation_id);
});

test("doble clic y cierre quedan bloqueados mientras Supabase guarda", async () => {
  const pending = deferred();
  const h = setup({ rpc: () => pending.promise });
  const save = h.c.confirmFixedExpenses();
  assert.equal(h.fields.confirmFixedExpensesButton.disabled, true);
  assert.equal(await h.c.confirmFixedExpenses(), false);
  h.c.closeFixedExpensesModal();
  assert.ok(!h.calls.some((call) => call.name === "close"));
  pending.resolve({ data: { savedCount: 1, expenses: [{ id: "saved", fixed_template_id: "rent", amount: 100 }] } });
  assert.equal(await save, true);
  assert.equal(h.fields.confirmFixedExpensesButton.textContent, "Cargar Gastos Fijos");
  h.c.closeFixedExpensesModal();
  assert.ok(h.calls.some((call) => call.name === "close"));
});

test("valida todos los importes antes de escribir y rechaza mercaderia", async () => {
  for (const amount of ["0", "-1", "NaN", "Infinity"]) {
    const h = setup();
    h.selected.light.checked = true;
    h.selected.light.value = amount;
    assert.equal(await h.c.confirmFixedExpenses(), false);
    assert.equal(h.calls.length, 0);
    assert.equal(h.c.state.expenses.length, 0);
  }
  const h = setup();
  h.c.state.fixedExpenseTemplates[0].category = "CompraMercaderia";
  assert.equal(await h.c.confirmFixedExpenses(), false);
  assert.equal(h.calls.length, 0);
});

test("sin sesion, sin fecha o sin seleccion no anuncia un guardado local", async () => {
  const noSession = setup({ session: false });
  assert.equal(await noSession.c.confirmFixedExpenses(), false);
  assert.equal(noSession.calls.length, 0);
  const h = setup();
  h.fields.fixedExpensesDate.value = "";
  assert.equal(await h.c.confirmFixedExpenses(), false);
  h.fields.fixedExpensesDate.value = "2026-10-21";
  h.selected.rent.checked = false;
  assert.equal(await h.c.confirmFixedExpenses(), false);
  assert.equal(h.calls.length, 0);
});

test("una respuesta incompleta no modifica los datos ni confirma el guardado", async () => {
  const h = setup({ rpc: () => ({ data: { savedCount: 1, expenses: [] } }) });
  assert.equal(await h.c.confirmFixedExpenses(), false);
  assert.equal(h.c.state.expenses.length, 0);
  assert.match(h.messages[0], /no confirmo/);
});

test("un fallo de cache despues de confirmar informa que Supabase ya guardo", async () => {
  const h = setup();
  h.c.persistStateLocalOnly = () => { throw new Error("almacenamiento lleno"); };
  assert.equal(await h.c.confirmFixedExpenses(), true);
  assert.match(h.messages[0], /se guardaron en Supabase/);
});

test("modo local sigue actualizando una sola vez la plantilla del mes", async () => {
  const h = setup({ cloud: false });
  assert.equal(await h.c.confirmFixedExpenses(), true);
  h.selected.rent.value = "150";
  assert.equal(await h.c.confirmFixedExpenses(), true);
  assert.equal(h.c.state.expenses.length, 1);
  assert.equal(h.c.state.expenses[0].amount, 150);
});

test("recargar gastos conserva identidad mensual y clasificacion fija", () => {
  const c = vm.createContext({
    state: { expenses: [], purchases: [] },
    isoDateFromTimestamp: (date) => date.slice(0, 10),
    expenseCategoryRules: { Alquiler: { behavior: "fijo" } },
  });
  vm.runInContext(section("function normalizeCloudExpense(", "function normalizeCloudStockMovement("), c);
  const row = { id: "saved", expense_at: "2026-10-21T03:00:00Z", category: "Servicios", note: "Luz", amount: 100, fixed_template_id: "light" };
  c.mergeCloudExpenseRecord(row);
  c.mergeCloudExpenseRecord({ ...row, amount: 200 });
  assert.equal(c.state.expenses.length, 1);
  assert.equal(c.state.expenses[0].kind, "fijo");
  assert.equal(c.state.expenses[0].fixedTemplateId, "light");
  assert.equal(c.state.expenses[0].source, "fixed-monthly");
  assert.equal(c.normalizeCloudExpense({ expense_at: "2026-10-21", category: "Alquiler" }).kind, "fijo");
  assert.equal(c.normalizeCloudExpense({ expense_at: "2026-10-21", category: "Servicios" }).kind, "variable");
});

test("una respuesta de gastos anterior al guardado no restaura la cache vieja", async () => {
  const old = deferred();
  const fresh = deferred();
  let attempt = 0;
  const c = vm.createContext({
    state: { expenseFilters: {}, expensesPage: 1 },
    cloudExpensesCache: new Map(), cloudExpensesLoads: new Map(), cloudExpensesFailures: new Map(), cloudExpenseRowsByKey: new Map(), cloudDashboardSummaryCache: new Map(),
    cloudEnabledWithSession: () => true,
    cloudExpensesRequest: () => ({ page: 1, pageSize: 40 }), cloudExpensesKey: () => "page-1",
    normalizeCloudExpensePageRow: (row) => row,
    invalidateCloudReportSummaryCache() {}, console,
    supabaseClient: { rpc: () => ++attempt === 1 ? old.promise : fresh.promise },
  });
  vm.runInContext("let cloudExpensesRevision = 0;\n"
    + section("async function loadCloudExpensesPage(", "function requestCloudExpensesPage(")
    + section("function invalidateCloudExpensesCache()", "function expenseEntryByKey("), c);
  const previous = c.loadCloudExpensesPage();
  c.invalidateCloudExpensesCache();
  const current = c.loadCloudExpensesPage();
  old.resolve({ data: { rows: [], totalAmount: 0 } });
  assert.equal(await previous, null);
  assert.equal(c.cloudExpensesCache.size, 0);
  assert.equal(c.cloudExpensesLoads.size, 1);
  fresh.resolve({ data: { rows: [{ amount: 100 }], totalAmount: 100 } });
  await current;
  assert.equal(c.cloudExpensesLoads.size, 0);
  assert.equal(c.cloudExpensesCache.get("page-1").totalAmount, 100);
});
