const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const source = readFileSync(join(__dirname, "..", "catalogo", "catalogo.js"), "utf8");

function setup() {
  const handlers = {};
  const context = vm.createContext({
    window: { location: { origin: "https://catalog.example", pathname: "/catalogo/producto.html", search: "" }, addEventListener() {} },
    document: { getElementById() { return null; }, addEventListener(name, callback) { handlers[name] = callback; } },
    URLSearchParams,
  });
  vm.runInContext(source.replace(/loadCatalogProducts\(\);\s*$/, ""), context);
  const main = { src: "one.webp", alt: "Foto 1" };
  const thumbs = ["one", "two", "three"].map((name, i) => ({
    dataset: { galleryImage: `${name}.webp`, galleryAlt: `Foto ${i + 1}` },
    current: String(i === 0),
    getAttribute() { return this.current; },
    setAttribute(_, value) { this.current = value; },
    closest() { return gallery; },
  }));
  const gallery = { querySelector() { return main; }, querySelectorAll() { return thumbs; } };
  return { context, handlers, main, thumbs, gallery };
}

test("las flechas aparecen solo con mas de una foto", () => {
  const { context } = setup();
  assert.doesNotMatch(context.productGallery({ name: "Producto", images: [] }), /data-gallery-delta/);
  assert.doesNotMatch(context.productGallery({ name: "Producto", images: ["one.webp"] }), /data-gallery-delta/);
  const html = context.productGallery({ name: "Producto", images: ["one.webp", "two.webp"] });
  assert.match(html, /data-gallery-delta="-1"/);
  assert.match(html, /data-gallery-delta="1"/);
  assert.match(html, /aria-label="Foto anterior"/);
  assert.match(html, /aria-label="Foto siguiente"/);
});

test("las flechas recorren todas las fotos, envuelven y sincronizan miniaturas", () => {
  const { context, main, thumbs, gallery } = setup();
  context.moveGalleryImage(gallery, -1);
  assert.equal(main.src, "three.webp");
  assert.equal(main.alt, "Foto 3");
  assert.deepEqual(thumbs.map(t => t.current), ["false", "false", "true"]);
  context.moveGalleryImage(gallery, 1);
  assert.equal(main.src, "one.webp");
  context.selectGalleryImage(gallery, 1);
  context.moveGalleryImage(gallery, 1);
  assert.equal(main.src, "three.webp");
  context.moveGalleryImage(null, 1);
});

test("click en icono, miniaturas y teclado usan la misma seleccion", () => {
  const { context, handlers, main, thumbs, gallery } = setup();
  const arrow = { dataset: { galleryDelta: "1" }, closest() { return gallery; } };
  handlers.click({ target: { closest: selector => selector === "[data-gallery-delta]" ? arrow : null } });
  assert.equal(main.src, "two.webp");
  handlers.click({ target: { closest: selector => selector === "[data-gallery-thumb]" ? thumbs[2] : null } });
  assert.equal(main.src, "three.webp");
  let prevented = false;
  handlers.keydown({ key: "ArrowRight", target: { closest() { return gallery; } }, preventDefault() { prevented = true; } });
  assert.equal(main.src, "one.webp");
  assert.equal(prevented, true);
  context.selectGalleryImage(gallery, NaN);
  assert.equal(main.src, "one.webp");
});
