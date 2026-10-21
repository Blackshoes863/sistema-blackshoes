const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

// Runtime temporal opcional: no agrega dependencias a la aplicacion.
const runtime = process.env.BLACKSHOES_PGLITE_MODULE;
test("RPC de gastos fijos en PostgreSQL embebido", { skip: !runtime }, async (t) => {
  const { PGlite } = require(runtime);
  const db = new PGlite();
  const root = join(__dirname, "..", "supabase", "migrations");
  const read = (file) => readFileSync(join(root, file), "utf8");
  const admin = "00000000-0000-4000-8000-000000000001";
  const expense = (id = "light", amount = 100, category = "Servicios") => ({ template_id: id, concept: id, amount, category });
  const register = async (rows, date = "2026-10-01", operation = randomUUID()) => {
    const result = await db.query("select public.register_fixed_expenses($1::uuid, $2::date, $3::jsonb) as result", [operation, date, JSON.stringify(rows)]);
    return result.rows[0].result;
  };
  const reset = () => db.exec("truncate public.expenses, public.audit_log");
  const count = async () => Number((await db.query("select count(*) as count from public.expenses")).rows[0].count);
  try {
    await db.exec(`
      create schema auth;
      create table auth.users(id uuid primary key);
      create role anon;
      create role authenticated;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
    `);
    const core = read("202609150001_blackshoes_core.sql");
    await db.exec(core.slice(core.indexOf("create table if not exists public.profiles"), core.indexOf("create or replace function public.set_updated_at")));
    await db.exec(core.slice(core.indexOf("create or replace function public.add_audit_log"), core.indexOf("create or replace function public.create_sale")));
    await db.exec(read("202609160006_add_owner_role.sql"));
    await db.exec(read("202610060001_dashboard_month_daily_summary.sql"));
    await db.exec(`insert into auth.users values ('${admin}'); insert into public.profiles(id, role, active) values ('${admin}', 'admin', true); select set_config('request.jwt.claim.sub', '${admin}', false);`);
    const migration = read("202610210003_fixed_expenses.sql");
    await db.exec(migration);
    await db.exec(migration);

    await t.test("guarda el lote completo y usa fecha argentina", async () => {
      const result = await register([expense("rent", 200, "Alquiler"), expense()]);
      assert.equal(result.savedCount, 2);
      assert.equal(await count(), 2);
      const date = await db.query("select (expense_at at time zone 'America/Argentina/Buenos_Aires')::date::text as date, fixed_month::text as month from public.expenses limit 1");
      assert.deepEqual(date.rows[0], { date: "2026-10-01", month: "2026-10-01" });
    });

    await t.test("un error en el segundo gasto revierte todo el lote y la auditoria", async () => {
      await reset();
      await assert.rejects(register([expense("a-valid"), expense("z-invalid", -1)]), /Importe invalido/);
      assert.equal(await count(), 0);
      assert.equal(Number((await db.query("select count(*) as count from public.audit_log")).rows[0].count), 0);
    });

    await t.test("reintento devuelve el resultado original; parametros distintos se rechazan", async () => {
      await reset();
      const operation = randomUUID();
      const first = await register([expense()], "2026-10-01", operation);
      assert.deepEqual(await register([expense()], "2026-10-01", operation), first);
      assert.equal(await count(), 1);
      await assert.rejects(register([expense("light", 200)], "2026-10-01", operation), /otros parametros/);
      assert.equal((await db.query("select amount from public.expenses")).rows[0].amount, "100.00");
    });

    await t.test("nueva carga del mismo mes actualiza la fila sin duplicarla", async () => {
      await reset();
      const first = await register([expense()]);
      const second = await register([expense("light", 250)], "2026-10-21");
      assert.equal(await count(), 1);
      assert.equal(second.expenses[0].id, first.expenses[0].id);
      assert.equal(second.expenses[0].amount, 250);
      await register([expense()], "2026-11-01");
      assert.equal(await count(), 2);
    });

    await t.test("no pisa gastos manuales ni resucita filas archivadas", async () => {
      await reset();
      await db.exec("insert into public.expenses(operation_id, category, amount, note) values (gen_random_uuid(), 'Servicios', 50, 'Manual')");
      const first = await register([expense()]);
      await db.query("update public.expenses set archived_at=now() where id=$1::uuid", [first.expenses[0].id]);
      const next = await register([expense()]);
      assert.notEqual(first.expenses[0].id, next.expenses[0].id);
      assert.equal(await count(), 3);
    });

    await t.test("rechaza duplicados, importes invalidos y mercaderia", async () => {
      await reset();
      for (const rows of [[expense(), expense()], [expense("light", "NaN")], [expense("light", "Infinity")], [expense("light", 100, "CompraMercaderia")]]) {
        await assert.rejects(register(rows));
      }
      assert.equal(await count(), 0);
    });

    await t.test("solo personal activo puede ejecutar; anon no tiene permisos", async () => {
      await db.exec(`update public.profiles set active=false where id='${admin}'`);
      await assert.rejects(register([expense()]), /No autorizado/);
      await db.exec(`update public.profiles set active=true where id='${admin}'`);
      await db.exec("set role anon");
      await assert.rejects(register([expense()]), /permission denied/);
      await db.exec("reset role");
    });

    await t.test("servicios precargados son fijos en listado, estadisticas y Excel", async () => {
      await reset();
      await register([expense()]);
      await db.exec("insert into public.expenses(operation_id, expense_at, category, amount, note) values (gen_random_uuid(), '2026-10-02T03:00:00Z', 'Servicios', 50, 'Variable')");
      const page = (await db.query("select public.list_expenses_page(p_behavior=>'fijo') as result")).rows[0].result;
      assert.equal(page.totalCount, 1);
      assert.equal(page.rows[0].behavior, "fijo");
      assert.equal(page.rows[0].detail, "Gasto fijo mensual");
      const summary = (await db.query("select public.get_report_summary('2026-10-01', '2026-10-31') as result")).rows[0].result;
      assert.equal(summary.fixedExpenses, 100);
      assert.equal(summary.variableExpenses, 50);
      const exported = (await db.query("select public.get_excel_export_data('2026-10-01', '2026-10-21') as result")).rows[0].result;
      assert.ok(JSON.stringify(exported).includes('"behavior":"fijo"'));
    });
  } finally {
    await db.close();
  }
});
