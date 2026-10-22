const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const source = readFileSync(join(__dirname, "..", "app.js"), "utf8");
const helpers = source.slice(source.indexOf("function customerWhatsappUrl("), source.indexOf("function renderCustomers("));
const htmlAttr = source.slice(source.indexOf("function htmlAttr("), source.indexOf("function showActionToast("));
const context = vm.createContext({});
vm.runInContext(htmlAttr + helpers, context);

test("WhatsApp acepta telefonos argentinos nacionales e internacionales sin modificar el cliente", () => {
  for (const phone of ["3564621982", "03564 621982", "3564 15 621982", "03564-15-621982",
    "+54 9 3564 621982", "5493564621982", "+54 (3564) 621982", "0054 9 3564 621982"]) {
    const customer = { phone };
    assert.equal(context.customerWhatsappUrl(customer), "https://wa.me/5493564621982", phone);
    assert.equal(customer.phone, phone);
  }
  assert.equal(context.customerWhatsappUrl({ phone: "011 15 2345 6789" }), "https://wa.me/5491123456789");
  assert.equal(context.customerWhatsappUrl({ phone: "0351 15 5551020" }), "https://wa.me/5493515551020");
});

test("otros paises conservan su prefijo internacional explicito", () => {
  assert.equal(context.customerWhatsappUrl({ phone: "+598 99 123 456" }), "https://wa.me/59899123456");
  assert.equal(context.customerWhatsappUrl({ phone: "00 1 (202) 555-0123" }), "https://wa.me/12025550123");
});

test("no muestra boton para telefonos vacios, incompletos, ambiguos o contenido malicioso", () => {
  for (const phone of [null, "", "   ", "Sin telefono", "12345", "15621982", "11123456789", "++5493564621982",
    "+000000000000", "12345678901234567890", '3564621982\" onclick=\"alert(1)', "3564621982 / 3515551020"]) {
    assert.equal(context.customerWhatsappUrl({ phone }), "", String(phone));
    assert.equal(context.customerWhatsappButton({ phone, name: "Cliente" }), "");
  }
  assert.equal(context.customerWhatsappUrl(null), "");
});

test("el enlace es accesible, escapa nombres y abre sin enviar mensajes automaticamente", () => {
  const html = context.customerWhatsappButton({ phone: "3564621982", name: 'Ana \"<Cliente>\"' });
  assert.match(html, /href="https:\/\/wa\.me\/5493564621982"/);
  assert.match(html, /aria-label="Hablar por WhatsApp con Ana &quot;&lt;Cliente&gt;&quot;"/);
  assert.match(html, /title=/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /assets\/whatsapp\.svg/);
  assert.doesNotMatch(html, /\?text=|onclick=/);
});

test("el listado incorpora el boton sin nuevas columnas ni escrituras remotas", () => {
  const render = source.slice(source.indexOf("function renderCustomers("), source.indexOf("function openCustomerInfoModal("));
  assert.match(render, /\$\{customerWhatsappButton\(customer\)\}/);
  assert.equal((render.match(/<th[ >]/g) || []).length, 6);
  assert.doesNotMatch(helpers, /fetch\(|\.rpc\(|saveState\(|\.update\(/);
});
