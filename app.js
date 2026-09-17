const BLACKSHOES_TECHNICAL_NAME = "blackshoes";
const BUSINESS_NAME = "BlackShoes";
const STORE_KEY = "blackshoes-control-v1";

const ACTIVE_STORE_KEY = STORE_KEY;
const REMOTE_SYNC_DISABLED = true;
const CLOUD_DATA_ENABLED = true;
const MODULE_FLAGS = {
  onlineSales: false,
  workshop: false,
  publicCatalog: true,
};
const SUPABASE_URL = "https://zojdhyuocprglqhddgxv.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_74eFxkDH_3tT_FOzQrrhbw_RP_yTags";
const SUPABASE_STATE_KEY = "blackshoes-app-state-v1";
const SUPABASE_BACKUP_KEY_PREFIX = `${SUPABASE_STATE_KEY}-backup-`;
const SUPABASE_MAX_BACKUPS = 15;
const SUPABASE_PROFILE_CACHE_KEY = "blackshoes-supabase-profile-v1";
const SUPABASE_SETTINGS_COLLECTION = "settings";
const SUPABASE_SETTINGS_RECORD_ID = "main";
const SUPABASE_RECORD_COLLECTIONS = [
  { collection: "customers", stateKey: "customers" },
  { collection: "products", stateKey: "products" },
  { collection: "sales", stateKey: "sales" },
  { collection: "workshopOrders", stateKey: "workshopOrders" },
  { collection: "onlineOrders", stateKey: "onlineOrders" },
  { collection: "arcaDoneOrders", stateKey: "arcaDoneOrders" },
  { collection: "expenses", stateKey: "expenses" },
  { collection: "purchases", stateKey: "purchases" },
  { collection: "stockHistory", stateKey: "stockHistory" },
  { collection: "monthlyClosures", stateKey: "monthlyClosures" },
  { collection: "cashClosures", stateKey: "cashClosures" },
  { collection: "activityLog", stateKey: "activityLog" },
];

let supabaseClient = null;
let supabaseSession = null;
let supabaseProfile = null;
let supabaseProfiles = [];
let remoteSaveInProgress = false;
let remoteSavePending = false;
let remoteHydrationDone = false;
let lastRemoteSaveMessage = "";

const permissionTabs = [
  { id: "dashboard", label: "Resumen" },
  { id: "catalog", label: "Productos" },
  { id: "customers", label: "Clientes" },
  { id: "pos", label: "Ventas Local" },
  { id: "salesHistory", label: "Historial de Ventas" },
  { id: "expenses", label: "Gastos y Mercaderia" },
  { id: "reports", label: "Estadisticas" },
];
const allPermissionTabIds = permissionTabs.map((tab) => tab.id);
const permissionFeatureOptions = [
  { id: "hideLocalMonthlyTotal", label: "Ocultar total local del mes" },
];
const allPermissionFeatureIds = permissionFeatureOptions.map((feature) => feature.id);
const userRoleLabels = {
  admin: "Admin",
  dueno: "Dueño",
  local: "Local",
  web: "Web",
  taller: "Taller",
  consulta: "Consulta",
};
const defaultTabsByRole = {
  admin: allPermissionTabIds,
  dueno: allPermissionTabIds,
  local: ["dashboard", "catalog", "customers", "pos", "salesHistory"],
  web: ["dashboard", "catalog", "customers", "salesHistory"],
  taller: ["dashboard", "catalog", "customers"],
  consulta: ["dashboard", "catalog", "customers", "salesHistory", "reports"],
};

const localIsoDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const todayIso = () => localIsoDate();
const monthAgoIso = () => {
  const now = new Date();
  const previousMonthLastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  const day = Math.min(now.getDate(), previousMonthLastDay);
  return localIsoDate(new Date(now.getFullYear(), now.getMonth() - 1, day));
};
const currentMonthStartIso = () => {
  const now = new Date();
  return localIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
};
const currentMonthEndIso = () => {
  const now = new Date();
  return localIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
};
const daysAgoIso = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localIsoDate(date);
};
const currentMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};
const parseMonthKey = (key) => {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1);
};
const monthKeyFromDate = (date) => date.slice(0, 7);
const formatDateShort = (date) => {
  const [year, month, day] = String(date || "").slice(0, 10).split("-");
  if (!year || !month || !day) return date || "";
  return `${day}/${month}/${year.slice(-2)}`;
};
const normalizeDateInput = (value) => {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/);
  if (!match) return "";
  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  if (parsed.getFullYear() !== Number(year) || parsed.getMonth() + 1 !== Number(month) || parsed.getDate() !== Number(day)) return "";
  return `${year}-${month}-${day}`;
};
const setDateInput = (input, date) => {
  if (!input) return;
  const normalized = normalizeDateInput(date);
  input.value = input.type === "date" ? normalized : formatDateShort(normalized || date);
  if (input.id === "onlineDate") syncOnlineDateDisplay();
};
function syncOnlineDateDisplay() {
  const dateInput = document.getElementById("onlineDate");
  const display = document.getElementById("onlineDateDisplay");
  if (!dateInput || !display) return;
  display.value = dateInput.value ? formatDateShort(dateInput.value) : "";
}
function openNativeDatePicker(input) {
  if (!input) return;
  input.focus();
  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
    } catch (_) {}
  }
}
const monthLabel = (key) => {
  const label = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(parseMonthKey(key));
  return label.charAt(0).toUpperCase() + label.slice(1);
};
const money = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
const shortMoney = (value) => {
  const amount = Number(value || 0);
  if (amount >= 1000000) {
    return `$${(amount / 1000000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} M`;
  }
  if (amount >= 1000) {
    return `$${Math.round(amount / 1000).toLocaleString("es-AR")} mil`;
  }
  return money(amount);
};
const trendMoney = (value) => {
  const amount = Number(value || 0);
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= 1000000) {
    return `${sign}$${(abs / 1000000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} M`;
  }
  if (abs >= 1000) {
    return `${sign}$${(abs / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} k`;
  }
  return `${sign}${money(abs)}`;
};
const shortMonthLabel = (key) => {
  const label = new Intl.DateTimeFormat("es-AR", { month: "short", year: "2-digit" }).format(parseMonthKey(key));
  return label.replace(".", "").replace(" de ", " ");
};
const niceChartMax = (value) => {
  const amount = Math.max(1, Number(value || 0));
  const magnitude = 10 ** Math.floor(Math.log10(amount));
  const normalized = amount / magnitude;
  const rounded = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return rounded * magnitude;
};

const uid = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 999)}`;
const idTimestamp = (id) => Number(String(id || "").match(/-(\d{12,})-/)?.[1] || 0);
const PAGE_SIZE = 40;
const PRODUCT_PAGE_SIZE = 30;
const CUSTOMER_PAGE_SIZE = 40;
const SALES_HISTORY_PAGE_SIZE = 20;
const STOCK_HISTORY_LIMIT = 100;
const STOCK_HISTORY_PAGE_SIZE = 20;
const ACTIVITY_LOG_LIMIT = 800;
const ACTIVITY_LOG_PAGE_SIZE = 40;
const CUSTOMER_INFO_PAGE_SIZE = 10;
const MONTHLY_CLOSURES_PAGE_SIZE = 15;
const REPORT_PREVIEW_LIMIT = 7;
const REPORT_PRODUCT_EXPAND_LIMIT = 30;
const CLOUD_INITIAL_SALES_DAYS = 60;
const CLOUD_INITIAL_EXPENSE_DAYS = 60;
const CLOUD_OPERATIONAL_MODES = {
  none: 0,
  initial: 1,
  full: 2,
};

let pendingConfirmAction = null;
let pendingCancelAction = null;
let pendingCustomerRegisterAction = null;
let pendingCustomerRegisterSkipAction = null;
let pendingProductStockCostSave = null;
const unlockedExpenseAmounts = new Set();

function openConfirmModal({ title = "Confirmar accion", message = "", confirmText = "Confirmar", cancelText = "Cancelar", danger = false, onConfirm = null, onCancel = null }) {
  pendingConfirmAction = typeof onConfirm === "function" ? onConfirm : null;
  pendingCancelAction = typeof onCancel === "function" ? onCancel : null;
  const modal = document.getElementById("confirmModal");
  const titleNode = document.getElementById("confirmTitle");
  const messageNode = document.getElementById("confirmMessage");
  const button = document.getElementById("confirmActionButton");
  const cancelButton = document.getElementById("cancelConfirmModal");
  if (!modal || !titleNode || !messageNode || !button) return;
  titleNode.textContent = title;
  messageNode.textContent = message;
  button.textContent = confirmText;
  if (cancelButton) cancelButton.textContent = cancelText;
  button.className = danger ? "danger" : "primary";
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeConfirmModal({ runCancel = false } = {}) {
  const cancelAction = pendingCancelAction;
  pendingConfirmAction = null;
  pendingCancelAction = null;
  const cancelButton = document.getElementById("cancelConfirmModal");
  if (cancelButton) cancelButton.textContent = "Cancelar";
  const modal = document.getElementById("confirmModal");
  if (modal) {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }
  if (runCancel && cancelAction) cancelAction();
}

function runConfirmAction() {
  const action = pendingConfirmAction;
  closeConfirmModal();
  if (action) action();
}

function openCustomerRegisterModal({ title = "Registrar cliente", message = "", name = "", dni = "", province = "", onRegister = null, onSkip = null } = {}) {
  pendingCustomerRegisterAction = typeof onRegister === "function" ? onRegister : null;
  pendingCustomerRegisterSkipAction = typeof onSkip === "function" ? onSkip : null;
  const modal = document.getElementById("customerRegisterModal");
  const form = document.getElementById("customerRegisterForm");
  const titleNode = document.getElementById("customerRegisterTitle");
  const messageNode = document.getElementById("customerRegisterMessage");
  if (!modal || !form || !titleNode || !messageNode) return;
  form.reset();
  form.elements.name.value = normalizeCustomerName(name);
  form.elements.dni.value = formatCustomerDni(dni);
  form.elements.phone.value = "";
  form.elements.province.value = normalizeProvince(province);
  titleNode.textContent = title;
  messageNode.textContent = message;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  (form.elements.dni || form.elements.phone)?.focus();
}

function closeCustomerRegisterModal({ runSkip = false } = {}) {
  const skipAction = pendingCustomerRegisterSkipAction;
  pendingCustomerRegisterAction = null;
  pendingCustomerRegisterSkipAction = null;
  const modal = document.getElementById("customerRegisterModal");
  if (modal) {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }
  document.getElementById("customerRegisterForm")?.reset();
  if (runSkip && skipAction) skipAction();
}

function submitCustomerRegisterModal(form) {
  const action = pendingCustomerRegisterAction;
  const data = formDataObject(form);
  closeCustomerRegisterModal();
  if (action) {
    action({
      name: normalizeCustomerName(data.name),
      dni: normalizeCustomerDni(data.dni),
      phone: String(data.phone || "").trim(),
      province: normalizeProvince(data.province),
    });
  }
}

function runCancelAction() {
  closeConfirmModal({ runCancel: true });
}

function clampPage(page, totalItems) {
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  return Math.min(Math.max(1, Number(page || 1)), totalPages);
}

function pageItems(items, page) {
  const current = clampPage(page, items.length);
  const start = (current - 1) * PAGE_SIZE;
  return {
    current,
    totalPages: Math.max(1, Math.ceil(items.length / PAGE_SIZE)),
    rows: items.slice(start, start + PAGE_SIZE),
  };
}

function pageItemsBySize(items, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, Number(page || 1)), totalPages);
  const start = (current - 1) * pageSize;
  return {
    current,
    totalPages,
    rows: items.slice(start, start + pageSize),
  };
}

function paginationControls(kind, current, totalPages, totalItems) {
  if (totalItems <= PAGE_SIZE) return "";
  return `
    <div class="pagination">
      <button class="secondary" data-page-kind="${kind}" data-page-delta="-1" ${current <= 1 ? "disabled" : ""} type="button">Anterior</button>
      <span>Página ${current} de ${totalPages}</span>
      <button class="secondary" data-page-kind="${kind}" data-page-delta="1" ${current >= totalPages ? "disabled" : ""} type="button">Siguiente</button>
    </div>
  `;
}

function sizedPaginationControls(kind, current, totalPages, totalItems, pageSize, label = "registros") {
  if (totalItems <= pageSize) return "";
  return `
    <div class="pagination">
      <button class="secondary" data-page-kind="${kind}" data-page-delta="-1" ${current <= 1 ? "disabled" : ""} type="button">Anterior</button>
      <span>Pagina ${current} de ${totalPages} - ${totalItems} ${label}</span>
      <button class="secondary" data-page-kind="${kind}" data-page-delta="1" ${current >= totalPages ? "disabled" : ""} type="button">Siguiente</button>
    </div>
  `;
}

function stockHistoryPaginationControls(current, totalPages, totalItems) {
  if (totalItems <= STOCK_HISTORY_PAGE_SIZE) return "";
  return `
    <div class="pagination">
      <button class="secondary" data-page-kind="stockHistory" data-page-delta="-1" ${current <= 1 ? "disabled" : ""} type="button">Anterior</button>
      <span>Pagina ${current} de ${totalPages} - ${totalItems} movimientos</span>
      <button class="secondary" data-page-kind="stockHistory" data-page-delta="1" ${current >= totalPages ? "disabled" : ""} type="button">Siguiente</button>
    </div>
  `;
}

function customerInfoPaginationControls(current, totalPages, totalItems) {
  if (totalItems <= CUSTOMER_INFO_PAGE_SIZE) return "";
  return `
    <div class="pagination">
      <button class="secondary" data-page-kind="customerInfo" data-page-delta="-1" ${current <= 1 ? "disabled" : ""} type="button">Anterior</button>
      <span>Pagina ${current} de ${totalPages} - ${totalItems} ventas</span>
      <button class="secondary" data-page-kind="customerInfo" data-page-delta="1" ${current >= totalPages ? "disabled" : ""} type="button">Siguiente</button>
    </div>
  `;
}

function monthlyClosuresPaginationControls(current, totalPages, totalItems) {
  if (totalItems <= MONTHLY_CLOSURES_PAGE_SIZE) return "";
  return `
    <div class="pagination">
      <button class="secondary" data-page-kind="monthlyClosures" data-page-delta="-1" ${current <= 1 ? "disabled" : ""} type="button">Anterior</button>
      <span>Pagina ${current} de ${totalPages} - ${totalItems} cierres</span>
      <button class="secondary" data-page-kind="monthlyClosures" data-page-delta="1" ${current >= totalPages ? "disabled" : ""} type="button">Siguiente</button>
    </div>
  `;
}

function activityLogPaginationControls(current, totalPages, totalItems) {
  if (totalItems <= ACTIVITY_LOG_PAGE_SIZE) return "";
  return `
    <div class="pagination">
      <button class="secondary" data-page-kind="activityLog" data-page-delta="-1" ${current <= 1 ? "disabled" : ""} type="button">Anterior</button>
      <span>Pagina ${current} de ${totalPages} - ${totalItems} movimientos</span>
      <button class="secondary" data-page-kind="activityLog" data-page-delta="1" ${current >= totalPages ? "disabled" : ""} type="button">Siguiente</button>
    </div>
  `;
}

function productPaginationControls(current, totalPages, totalItems) {
  if (totalItems <= PRODUCT_PAGE_SIZE) return "";
  return `
    <div class="pagination">
      <button class="secondary" data-page-kind="products" data-page-delta="-1" ${current <= 1 ? "disabled" : ""} type="button">Anterior</button>
      <span>Pagina ${current} de ${totalPages} - ${totalItems} productos</span>
      <button class="secondary" data-page-kind="products" data-page-delta="1" ${current >= totalPages ? "disabled" : ""} type="button">Siguiente</button>
    </div>
  `;
}

function salesHistoryPaginationControls(current, totalPages, totalItems) {
  if (totalItems <= SALES_HISTORY_PAGE_SIZE) return "";
  return `
    <div class="pagination">
      <button class="secondary" data-page-kind="salesHistory" data-page-delta="-1" ${current <= 1 ? "disabled" : ""} type="button">Anterior</button>
      <span>Pagina ${current} de ${totalPages} - ${totalItems} ventas</span>
      <button class="secondary" data-page-kind="salesHistory" data-page-delta="1" ${current >= totalPages ? "disabled" : ""} type="button">Siguiente</button>
    </div>
  `;
}

function isMobileLayout() {
  return Boolean(window.matchMedia?.("(max-width: 760px)").matches);
}

const categoryPrefixes = {
  Accesorios: "A",
  Camperas: "C",
  Conjuntos: "O",
  Hoodies: "H",
  Pantalones: "P",
  Remeras: "R",
  RompeVientos: "M",
  Shorts: "S",
  Zapatillas: "Z",
};

const baseProductCategories = [
  "Accesorios",
  "Camperas",
  "Conjuntos",
  "Hoodies",
  "Pantalones",
  "Remeras",
  "RompeVientos",
  "Shorts",
  "Zapatillas",
];

const commonProductColors = [
  "Negro",
  "Blanco",
  "Gris",
  "Azul",
  "Celeste",
  "Rojo",
  "Bordo",
  "Rosa",
  "Fucsia",
  "Verde",
  "Beige",
  "Marron",
  "Camel",
  "Amarillo",
  "Naranja",
  "Violeta",
  "Lila",
  "Crema",
  "Crudo",
  "Jean",
  "Multicolor",
];

const clothingSubcategories = ["Deportivo", "Urbano"];
const baseProductSubcategories = {
  Accesorios: ["Bijouterie", "Gorras", "Lentes", "Medias"],
  Camperas: clothingSubcategories,
  Conjuntos: clothingSubcategories,
  Hoodies: clothingSubcategories,
  Pantalones: clothingSubcategories,
  Remeras: clothingSubcategories,
  RompeVientos: clothingSubcategories,
  Shorts: clothingSubcategories,
  Zapatillas: clothingSubcategories,
};

const categoryAliases = {
  "hoodies/anorak": "Hoodies",
  "shorts/bermudas": "Shorts",
};

const argentineProvinces = [
  "Buenos Aires",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Córdoba",
  "Corrientes",
  "Entre Ríos",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquén",
  "Río Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego",
  "Tucumán",
];

const onlinePaymentMethods = ["Efectivo", "Débito", "Transferencia", "Mercado Pago", "QR", "Crédito"];
const MERCADO_PAGO_COMMISSION_RATE_WITH_IVA = 3.39 * 1.21;
const onlinePaymentPlatforms = {
  transfer: { label: "Transferencia", commissionRate: 0, skipTiendaNubeCommission: false },
  mercadoPago: { label: "Mercado Pago", commissionRate: MERCADO_PAGO_COMMISSION_RATE_WITH_IVA, skipTiendaNubeCommission: false },
  pagoNube: { label: "Pago nube", commissionRate: 0, skipTiendaNubeCommission: true },
};
const onlinePromoOptions = {
  base: { label: "Sin Promo", discount: 0 },
  off10: { label: "10% OFF", discount: 10 },
  off15: { label: "15% OFF", discount: 15 },
  off20: { label: "20% OFF", discount: 20 },
  off30: { label: "30% OFF", discount: 30 },
  twoForOne: { label: "2x1", discount: 50 },
};
const onlineBaseCosts = {
  insumos: 0.45,
  accesorios: 0.33,
};
const defaultBusinessSettings = {
  tiendaNubeCommissionRate: 0,
  mercadoPagoCommissionRate: 0,
  pagoNubeCommissionRate: 0,
  onlineCostInsumos: 0,
  onlineCostAccesorios: 0,
  cloudInitialSalesDays: 60,
  cloudInitialExpenseDays: 60,
  promoDiscounts: {
    base: 0,
    off10: 0,
    off15: 0,
    off20: 0,
    off30: 0,
    twoForOne: 0,
  },
};
const defaultCatalogSettings = {
  businessName: BUSINESS_NAME,
  whatsappNumber: "+5493564621982",
  defaultWhatsappMessage: "Hola {businessName}, quiero consultar por este producto:",
  sizeAvailabilityMode: "show-unavailable",
  outOfStockProductMode: "show",
};
const defaultCustomProductCategories = [];
// Se usa solo cuando el producto no tiene costo cargado, sin importar si controla stock.
const missingProductCostFallbackRate = 0.5;
const expenseCategoryRules = {
  Alquiler: { type: "expense", behavior: "fijo" },
  Servicios: { type: "expense", behavior: "variable" },
  Sueldos: { type: "expense", behavior: "fijo" },
  Marketing: { type: "expense", behavior: "variable" },
  Comisiones: { type: "expense", behavior: "variable" },
  Envios: { type: "expense", behavior: "variable" },
  Impuestos: { type: "expense", behavior: "fijo" },
  Honorarios: { type: "expense", behavior: "fijo" },
  Mobiliario: { type: "expense", behavior: "variable" },
  DiferenciaCaja: { type: "expense", behavior: "variable", showInForm: false },
  CompraMercaderia: { type: "purchase", behavior: "variable", affectsResult: false },
  Mercaderia: { type: "purchase", behavior: "variable", showInForm: false },
};

const legacyFixedExpenseTemplateIds = new Set([
  "fixed-alquiler-local",
  "fixed-sueldo-local-1",
  "fixed-impuesto-local-1",
  "fixed-sueldo-web-1",
  "fixed-impuesto-web-1",
  "fixed-sueldo-general-1",
  "fixed-impuesto-general-1",
  "fixed-subscripcion-tienda-online",
]);
const defaultFixedExpenseTemplates = [];

const ACCESSORY_PRICE_PRODUCTS_IMPORT_ID = "base-empty-accessory-prices-v2";
const HISTORICAL_RESULTS_IMPORT_ID = "base-empty-monthly-results-v2";
const importedHistoricalMonthlyClosures = [];

const HISTORICAL_CATEGORY_IMPORT_ID = "base-empty-historical-categories-v2";
const importedHistoricalMonthlyDetails = {};

const demoState = () => ({
  offline: false,
  activeView: "dashboard",
  reportPeriod: "month",
  reportScope: "total",
  marginTrendOrder: "chronological",
  localSyncPending: false,
  systemMigrationPending: false,
  deletedRecords: {},
  reportCustomFrom: monthAgoIso(),
  reportCustomTo: todayIso(),
  selectedMonth: currentMonthKey(),
  productFilters: { query: "", sort: "recent", category: "all", subcategory: "all", stock: "all", published: "all" },
  productPage: 1,
  customerFilters: { query: "", sort: "alpha" },
  customerPage: 1,
  expenseFilters: defaultExpenseFilters(),
  userTabPermissions: {},
  onlineDraftLines: [],
  onlineResolvedMissingOrders: [],
  fixedExpenseTemplates: defaultFixedExpenseTemplates.map((template) => ({ ...template })),
  businessSettings: structuredClone(defaultBusinessSettings),
  catalogSettings: structuredClone(defaultCatalogSettings),
  customProductCategories: defaultCustomProductCategories.map((entry) => ({ ...entry })),
  userLastSeen: {},
  monthlyClosures: [],
  monthlyClosuresPage: 1,
  activityLog: [],
  activityLogPage: 1,
  activityLogFilters: { user: "all", type: "all", query: "" },
  activeCartId: null,
  customers: [],
  products: [],
  paymentMethods: [
    { id: "efectivo", name: "Efectivo" },
    { id: "debito", name: "Débito", adjustment: 0 },
    { id: "transferencia", name: "Transferencia", adjustment: 0 },
    { id: "qr", name: "QR", adjustment: 0 },
    { id: "credito", name: "Crédito", adjustment: 0 },
  ],
  carts: [],
  sales: [],
  workshopOrders: [],
  onlineOrders: [],
  arcaDoneOrders: [],
  expenses: [],
  purchases: [],
  stockHistory: [],
});

const initialStockProducts = [];

function emptyDataState() {
  const base = demoState();
  return {
    ...base,
    customers: [],
    products: [],
    carts: [],
    sales: [],
    workshopOrders: [],
    onlineOrders: [],
    arcaDoneOrders: [],
    expenses: [],
    purchases: [],
    stockHistory: [],
  };
}

let state = loadState();
let stockEntryDraft = [];
let productImageDraft = [];
let productVariantDraft = [];
let businessStateDirty = Boolean(state.localSyncPending || state.systemMigrationPending);
let autoRemoteRefreshInProgress = false;
let lastAutoRemoteRefreshAt = 0;
let lastDirtyComparisonState = cloneStateForDirtyComparison(state);
let localChangeRevision = 0;
let cloudOperationalMode = "none";
let cloudOperationalLoadPromise = null;

function sampleTodayLocalSales() {
  return [];
}

function loadState() {
  const saved = localStorage.getItem(ACTIVE_STORE_KEY);
  if (!saved) return normalizeState(emptyDataState());
  try {
    return normalizeState(JSON.parse(saved));
  } catch {
    return normalizeState(emptyDataState());
  }
}

function normalizeDeletedRecords(value = {}) {
  return Object.fromEntries(SUPABASE_RECORD_COLLECTIONS.map(({ collection }) => {
    const records = value?.[collection] || {};
    return [collection, Object.fromEntries(Object.entries(records)
      .filter(([id]) => id)
      .map(([id, deletedAt]) => [id, deletedAt || new Date().toISOString()])
    )];
  }));
}

function emptyPendingRemoteChanges() {
  return {
    settings: false,
    records: Object.fromEntries(SUPABASE_RECORD_COLLECTIONS.map(({ collection }) => [collection, {}])),
  };
}

function normalizePendingRemoteChanges(value = {}) {
  const base = emptyPendingRemoteChanges();
  const records = value?.records || {};
  SUPABASE_RECORD_COLLECTIONS.forEach(({ collection }) => {
    base.records[collection] = Object.fromEntries(Object.entries(records[collection] || {})
      .filter(([id]) => id)
      .map(([id, action]) => [id, action === "delete" ? "delete" : "upsert"])
    );
  });
  base.settings = Boolean(value?.settings);
  return base;
}

function hasPendingRemoteChanges(value = {}) {
  const pending = normalizePendingRemoteChanges(value);
  return Boolean(pending.settings || SUPABASE_RECORD_COLLECTIONS.some(({ collection }) => Object.keys(pending.records[collection] || {}).length));
}

function markPendingRemoteRecord(collection, recordId, action = "upsert", target = state) {
  if (!collection || !recordId || !target) return;
  target.pendingRemoteChanges = normalizePendingRemoteChanges(target.pendingRemoteChanges);
  target.pendingRemoteChanges.records[collection] = target.pendingRemoteChanges.records[collection] || {};
  target.pendingRemoteChanges.records[collection][recordId] = action === "delete" ? "delete" : "upsert";
}

function clearPendingRemoteChanges(target = state) {
  if (!target) return;
  target.pendingRemoteChanges = emptyPendingRemoteChanges();
}

function recordMapById(records = []) {
  return new Map((records || []).filter((record) => record?.id).map((record) => [record.id, record]));
}

function cloneStateForDirtyComparison(value = {}) {
  return normalizeState(JSON.parse(JSON.stringify({
    ...value,
    localSyncPending: false,
    systemMigrationPending: false,
    offline: false,
    pendingRemoteChanges: emptyPendingRemoteChanges(),
  })));
}

function sameRemotePayload(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

function markDirtyRemoteChanges(previousState = {}, nextState = state) {
  if (!nextState) return;
  const dirtyAt = new Date().toISOString();
  nextState.pendingRemoteChanges = normalizePendingRemoteChanges(nextState.pendingRemoteChanges);
  if (!sameRemotePayload(remoteSettingsSnapshot(previousState), remoteSettingsSnapshot(nextState))) {
    nextState.pendingRemoteChanges.settings = true;
  }
  const deletedRecords = normalizeDeletedRecords(nextState.deletedRecords);
  SUPABASE_RECORD_COLLECTIONS.forEach(({ collection, stateKey }) => {
    const previousRecords = recordMapById(previousState[stateKey]);
    const nextRecords = recordMapById(nextState[stateKey]);
    nextRecords.forEach((record, recordId) => {
      if (!sameRemotePayload(previousRecords.get(recordId), record)) {
        record.updatedAt = dirtyAt;
        markPendingRemoteRecord(collection, recordId, "upsert", nextState);
      }
    });
    previousRecords.forEach((_record, recordId) => {
      if (nextRecords.has(recordId)) return;
      nextState.deletedRecords = normalizeDeletedRecords(nextState.deletedRecords);
      nextState.deletedRecords[collection] = nextState.deletedRecords[collection] || {};
      nextState.deletedRecords[collection][recordId] = deletedRecords[collection]?.[recordId] || new Date().toISOString();
      markPendingRemoteRecord(collection, recordId, "delete", nextState);
    });
  });
}

function applyPendingRemoteChangesToState(baseState = {}, localState = {}, pendingChanges = {}) {
  const next = normalizeState(JSON.parse(JSON.stringify(baseState || {})));
  const pending = normalizePendingRemoteChanges(pendingChanges);
  if (pending.settings) applyRemoteSettings(next, remoteSettingsSnapshot(localState));
  SUPABASE_RECORD_COLLECTIONS.forEach(({ collection, stateKey }) => {
    const localRecords = recordMapById(localState[stateKey]);
    Object.entries(pending.records[collection] || {}).forEach(([recordId, action]) => {
      if (action === "delete") {
        next[stateKey] = (next[stateKey] || []).filter((record) => record.id !== recordId);
        next.deletedRecords = normalizeDeletedRecords(next.deletedRecords);
        next.deletedRecords[collection] = next.deletedRecords[collection] || {};
        next.deletedRecords[collection][recordId] = localState.deletedRecords?.[collection]?.[recordId] || new Date().toISOString();
        return;
      }
      const localRecord = localRecords.get(recordId);
      if (!localRecord) return;
      next[stateKey] = [
        ...(next[stateKey] || []).filter((record) => record.id !== recordId),
        { ...localRecord },
      ];
    });
  });
  return normalizeState(next);
}

function normalizeCategoryPrefix(value = "") {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 1);
}

function firstAvailableCategoryPrefix(category = "", reserved = new Set()) {
  const clean = String(category || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
  const letters = [...clean, ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
  return letters.find((letter) => letter && !reserved.has(letter)) || "X";
}

function normalizeCustomProductCategories(value = []) {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set();
  return rows.map((entry) => {
    const category = canonicalProductCategory(normalizeProductDescription(entry.category || entry.name || ""));
    const subcategory = normalizeProductDescription(entry.subcategory || "");
    const prefix = normalizeCategoryPrefix(entry.prefix || entry.codePrefix || "");
    const key = `${categoryKey(category)}::${categoryKey(subcategory)}`;
    if (!category || !prefix || seen.has(key)) return null;
    seen.add(key);
    return {
      id: entry.id || uid("category"),
      categoryId: entry.categoryId || entry.category_id || "",
      subcategoryId: entry.subcategoryId || entry.subcategory_id || "",
      category,
      subcategory,
      prefix,
      active: entry.active !== false,
      sortOrder: Number(entry.sortOrder || entry.order || 0),
    };
  }).filter(Boolean).sort((a, b) =>
    Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
    || a.category.localeCompare(b.category, "es", { sensitivity: "base" })
    || a.subcategory.localeCompare(b.subcategory, "es", { sensitivity: "base" })
  );
}

function normalizeUserLastSeen(value = {}) {
  return Object.fromEntries(Object.entries(value || {}).map(([email, entry]) => {
    const cleanEmail = profileEmailKey(email || entry?.email);
    if (!cleanEmail) return null;
    return [cleanEmail, {
      email: cleanEmail,
      user: String(entry?.user || entry?.name || cleanEmail).trim(),
      at: entry?.at || entry?.lastSeenAt || "",
    }];
  }).filter(Boolean));
}

function recordUpdatedTime(record = {}) {
  return Date.parse(record.updatedAt || record.createdAt || record.closedAt || record.date || record.at || "")
    || idTimestamp(record.id)
    || 0;
}

function deletedAtFor(deletedRecords = {}, collection, recordId) {
  return Date.parse(deletedRecords?.[collection]?.[recordId] || "") || 0;
}

function shouldKeepMergedRecord(record, collection, deletedRecords = {}) {
  const deletedAt = deletedAtFor(deletedRecords, collection, record.id);
  if (!deletedAt) return true;
  return recordUpdatedTime(record) > deletedAt;
}

function mergeRecordVersions(current, incoming, collection) {
  const newest = recordUpdatedTime(incoming) >= recordUpdatedTime(current) ? { ...incoming } : { ...current };
  if (collection === "onlineOrders") {
    const afipDone = Boolean(current?.afipDone || incoming?.afipDone);
    return {
      ...newest,
      afipDone,
      afipDoneAt: current?.afipDoneAt || incoming?.afipDoneAt || (afipDone ? newest.updatedAt || newest.createdAt || new Date().toISOString() : ""),
    };
  }
  return newest;
}

function mergeRecordArrays(remoteRows = [], localRows = [], collection, deletedRecords = {}) {
  const merged = new Map();
  [...remoteRows, ...localRows].forEach((record) => {
    if (!record?.id) return;
    const current = merged.get(record.id);
    merged.set(record.id, current ? mergeRecordVersions(current, record, collection) : { ...record });
  });
  return [...merged.values()].filter((record) => shouldKeepMergedRecord(record, collection, deletedRecords));
}

function mergeDataStates(remoteState = {}, localState = {}) {
  const merged = {
    ...JSON.parse(JSON.stringify(remoteState || {})),
    ...JSON.parse(JSON.stringify(localState || {})),
  };
  const remoteDeleted = normalizeDeletedRecords(remoteState.deletedRecords);
  const localDeleted = normalizeDeletedRecords(localState.deletedRecords);
  merged.deletedRecords = normalizeDeletedRecords(Object.fromEntries(SUPABASE_RECORD_COLLECTIONS.map(({ collection }) => [
    collection,
    { ...(remoteDeleted[collection] || {}), ...(localDeleted[collection] || {}) },
  ])));
  SUPABASE_RECORD_COLLECTIONS.forEach(({ collection, stateKey }) => {
    merged[stateKey] = mergeRecordArrays(remoteState[stateKey], localState[stateKey], collection, merged.deletedRecords);
  });
  return normalizeState(merged);
}

function parseWorkshopOrderNumber(value) {
  const match = String(value || "").trim().match(/^T[-\s]?0*(\d+)$/i);
  if (!match) return null;
  return {
    number: Number(match[1] || 0),
    width: Math.max(4, match[1]?.length || 4),
  };
}

function formatWorkshopOrderNumber(number, width = 4) {
  return `T-${String(Math.max(1, Number(number || 1))).padStart(width, "0")}`;
}

function nextWorkshopOrderNumber(source = state) {
  const maxNumber = (source.workshopOrders || []).reduce((max, order) => {
    const parsed = parseWorkshopOrderNumber(order.number);
    return Math.max(max, parsed?.number || 0);
  }, 0);
  return formatWorkshopOrderNumber(maxNumber + 1);
}

function normalizeWorkshopOrders(value = []) {
  const rows = (value || []).map((order) => ({ ...order }));
  const maxExisting = rows.reduce((max, order) => Math.max(max, parseWorkshopOrderNumber(order.number)?.number || 0), 0);
  const used = new Set();
  let nextNumber = maxExisting;
  let changed = false;
  const orderedRows = rows
    .map((order, index) => ({
      order,
      index,
      sortTime: Date.parse(order.createdAt || order.updatedAt || order.date || "") || idTimestamp(order.id) || index,
    }))
    .sort((a, b) => a.sortTime - b.sortTime || a.index - b.index);

  orderedRows.forEach(({ order }) => {
    const parsed = parseWorkshopOrderNumber(order.number);
    if (parsed?.number && !used.has(parsed.number)) {
      used.add(parsed.number);
      order.number = formatWorkshopOrderNumber(parsed.number, parsed.width);
      return;
    }
    nextNumber += 1;
    order.number = formatWorkshopOrderNumber(nextNumber);
    order.updatedAt = order.updatedAt || new Date().toISOString();
    used.add(nextNumber);
    changed = true;
  });

  return { orders: rows, changed };
}

function rememberDeletedRecord(collection, recordId) {
  if (!collection || !recordId) return;
  state.deletedRecords = normalizeDeletedRecords(state.deletedRecords);
  state.deletedRecords[collection] = state.deletedRecords[collection] || {};
  state.deletedRecords[collection][recordId] = new Date().toISOString();
}

function normalizeProductSizeVariants(value = []) {
  const rows = Array.isArray(value)
    ? value
    : String(value || "")
      .split(/\r?\n|,/)
      .map((entry) => {
        const [size, stock = "0"] = entry.split(/[:=]/);
        return { size, stock };
      });
  const bySize = new Map();
  rows.forEach((row) => {
    const size = normalizeProductDescription(row.size || row.talle || row.name || "").toUpperCase();
    if (!size) return;
    const stock = Math.max(0, Math.floor(Number(row.stock || row.quantity || 0)));
    bySize.set(size, { size, stock });
  });
  return [...bySize.values()];
}

function productSizeStockTotal(product) {
  return sum(normalizeProductSizeVariants(product?.sizeVariants), (variant) => Number(variant.stock || 0));
}

function productHasSizeVariants(product) {
  return normalizeProductSizeVariants(product?.sizeVariants).length > 0;
}

function productAvailableSizeVariants(product) {
  const variants = normalizeProductSizeVariants(product?.sizeVariants);
  return variants.filter((variant) => !product?.tracksStock || Number(variant.stock || 0) > 0);
}

function serializeProductSizeVariants(product) {
  return normalizeProductSizeVariants(product?.sizeVariants)
    .map((variant) => `${variant.size}: ${variant.stock}`)
    .join("\n");
}

const clothingSizeOptions = ["S", "M", "L", "XL", "XXL"];
const shoeSizeOptions = Array.from({ length: 12 }, (_, index) => String(index + 34));

function productSuggestedSizes(category = document.getElementById("productCategory")?.value || "") {
  const normalized = canonicalProductCategory(category);
  if (normalized === "Zapatillas") return shoeSizeOptions;
  if (baseProductCategories.includes(normalized) && normalized !== "Accesorios") return clothingSizeOptions;
  return [];
}

function nextSuggestedProductSize() {
  const used = new Set(normalizeProductSizeVariants(productVariantDraft).map((variant) => variant.size));
  return productSuggestedSizes().find((size) => !used.has(size)) || "";
}

function normalizeProductImageUrls(value = []) {
  const raw = String(value || "");
  const rows = Array.isArray(value) ? value : raw.includes("data:image/") ? raw.split(/\r?\n/) : raw.split(/\r?\n|,/);
  const seen = new Set();
  return rows
    .map((url) => String(url || "").trim())
    .filter(Boolean)
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
}

function serializeProductImageUrls(product) {
  return normalizeProductImageUrls(product?.imageUrls).join("\n");
}

function isDataImageUrl(value) {
  return /^data:image\/[^;]+;base64,/i.test(String(value || ""));
}

function imageExtensionFromDataUrl(dataUrl) {
  const type = String(dataUrl || "").match(/^data:image\/([^;]+);/i)?.[1]?.toLowerCase() || "webp";
  if (type === "jpeg" || type === "jpg") return "jpg";
  if (type === "svg+xml") return "svg";
  return ["webp", "png", "gif", "avif"].includes(type) ? type : "webp";
}

async function dataImageUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error("No pude preparar la imagen para subir.");
  return response.blob();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("No pude leer la imagen."));
    reader.readAsDataURL(file);
  });
}

function optimizeProductImageDataUrl(dataUrl, { maxSize = 1200, quality = 0.78 } = {}) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const ratio = Math.min(1, maxSize / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
      const width = Math.max(1, Math.round((image.naturalWidth || 1) * ratio));
      const height = Math.max(1, Math.round((image.naturalHeight || 1) * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(dataUrl);
        return;
      }
      context.drawImage(image, 0, 0, width, height);
      try {
        const optimized = canvas.toDataURL("image/webp", quality);
        resolve(optimized && optimized.length < dataUrl.length ? optimized : dataUrl);
      } catch {
        resolve(dataUrl);
      }
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

async function productImageFileToDataUrl(file) {
  if (!file || !String(file.type || "").startsWith("image/")) return "";
  const dataUrl = await readFileAsDataUrl(file);
  return optimizeProductImageDataUrl(dataUrl);
}

function renderProductImagePreview() {
  const input = document.getElementById("productImageUrls");
  const preview = document.getElementById("productImagePreview");
  productImageDraft = normalizeProductImageUrls(productImageDraft);
  if (input) input.value = productImageDraft.join("\n");
  if (!preview) return;
  preview.innerHTML = productImageDraft.length
    ? productImageDraft.map((url, index) => `
      <div class="product-image-tile">
        <img src="${htmlAttr(url)}" alt="Foto ${index + 1}">
        <button type="button" data-remove-product-image="${index}" aria-label="Quitar foto">x</button>
      </div>
    `).join("")
    : `<div class="product-image-empty">Sin fotos cargadas</div>`;
}

async function addProductImageFiles(files = []) {
  const list = Array.from(files || []).filter((file) => String(file.type || "").startsWith("image/"));
  if (!list.length) return;
  const availableSlots = Math.max(0, 8 - productImageDraft.length);
  if (!availableSlots) {
    showActionToast("Máximo 8 fotos por producto.");
    return;
  }
  const selected = list.slice(0, availableSlots);
  for (const file of selected) {
    const dataUrl = await productImageFileToDataUrl(file);
    if (dataUrl) productImageDraft = normalizeProductImageUrls([...productImageDraft, dataUrl]);
  }
  renderProductImagePreview();
  showActionToast(`${selected.length} ${selected.length === 1 ? "foto cargada" : "fotos cargadas"}.`);
}

function slugifyCatalogValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function productCatalogSlug(product) {
  return product?.slug || slugifyCatalogValue(`${product?.code || ""}-${product?.description || ""}-${product?.color || ""}`);
}

function cloudEnabledWithSession() {
  return Boolean(CLOUD_DATA_ENABLED && supabaseClient && supabaseSession?.user);
}

function cloudCategoryEntry(row = {}, subcategory = null) {
  return {
    id: subcategory?.id || row.id || uid("category"),
    categoryId: row.id || "",
    subcategoryId: subcategory?.id || "",
    category: normalizeProductDescription(row.name || ""),
    subcategory: normalizeProductDescription(subcategory?.name || ""),
    prefix: normalizeCategoryPrefix(row.code || row.prefix || row.name || ""),
    active: row.active !== false && subcategory?.active !== false,
    sortOrder: Number(subcategory?.sort_order ?? row.sort_order ?? 0),
  };
}

function normalizeCloudProduct(row = {}) {
  const category = normalizeProductDescription(row.product_categories?.name || row.category || "");
  const subcategory = normalizeProductDescription(row.product_subcategories?.name || row.subcategory || "");
  const sizeVariants = normalizeProductSizeVariants((row.product_variants || [])
    .filter((variant) => variant.active !== false && !variant.archived_at)
    .map((variant) => ({
      id: variant.id,
      size: variant.size,
      stock: variant.current_stock,
    })));
  const imageUrls = normalizeProductImageUrls((row.product_images || [])
    .filter((image) => !image.archived_at)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((image) => image.public_url || image.storage_path)
    .filter(Boolean));
  return {
    id: row.id,
    code: row.sku || "",
    barcode: barcodeFromCode(row.sku || ""),
    slug: row.slug || "",
    description: normalizeProductDescription(row.name || ""),
    catalogDescription: String(row.description || "").trim(),
    color: normalizeProductDescription(row.color || ""),
    category: canonicalProductCategory(category),
    subcategory,
    unit: "Unidad",
    cost: Number(row.cost || 0),
    margin: Number(row.margin_percent || 0),
    price: Number(row.price || 0),
    promoPrice: Number(row.promo_price || 0),
    wholesalePrice: Number(row.wholesale_price || 0),
    tracksStock: row.tracks_stock !== false,
    stock: row.tracks_stock === false ? null : sum(sizeVariants, (variant) => Number(variant.stock || 0)),
    published: Boolean(row.published),
    featured: false,
    isNew: false,
    imageUrls,
    images: imageUrls,
    sizeVariants,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
  };
}

async function loadCloudProductCatalog() {
  if (!cloudEnabledWithSession()) return false;
  const [{ data: categories, error: categoryError }, { data: subcategories, error: subcategoryError }, { data: products, error: productError }] = await Promise.all([
    supabaseClient.from("product_categories").select("id,name,slug,code,active,sort_order").is("archived_at", null).order("sort_order", { ascending: true }).order("name", { ascending: true }),
    supabaseClient.from("product_subcategories").select("id,category_id,name,slug,active,sort_order").is("archived_at", null).order("sort_order", { ascending: true }).order("name", { ascending: true }),
    supabaseClient
      .from("products")
      .select("*,product_categories(id,name,slug,code),product_subcategories(id,name,slug),product_variants(id,size,current_stock,active,sort_order,archived_at),product_images(id,storage_path,public_url,alt_text,is_primary,sort_order,archived_at)")
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
  ]);
  if (categoryError) throw new Error(`categorias: ${categoryError.message}`);
  if (subcategoryError) throw new Error(`subcategorias: ${subcategoryError.message}`);
  if (productError) throw new Error(`productos: ${productError.message}`);
  const categoriesById = new Map((categories || []).map((category) => [category.id, category]));
  const categoryRows = [];
  (categories || []).forEach((category) => categoryRows.push(cloudCategoryEntry(category)));
  (subcategories || []).forEach((subcategory) => {
    const category = categoriesById.get(subcategory.category_id);
    if (category) categoryRows.push(cloudCategoryEntry(category, subcategory));
  });
  state.customProductCategories = normalizeCustomProductCategories(categoryRows);
  state.products = (products || [])
    .filter((product) => product.sku !== "MANUAL_INTERNAL")
    .map(normalizeCloudProduct);
  persistStateLocalOnly();
  return true;
}

function cloudProductCategoryRow(categoryName) {
  const category = canonicalProductCategory(categoryName);
  return normalizeCustomProductCategories(state.customProductCategories)
    .find((entry) => canonicalProductCategory(entry.category) === category && !entry.subcategory);
}

function cloudProductSubcategoryRow(categoryName, subcategoryName) {
  const category = canonicalProductCategory(categoryName);
  const subcategory = normalizeProductDescription(subcategoryName || "");
  if (!subcategory) return null;
  return normalizeCustomProductCategories(state.customProductCategories)
    .find((entry) => canonicalProductCategory(entry.category) === category && categoryKey(entry.subcategory) === categoryKey(subcategory));
}

async function syncCloudProductVariants(productId, variants = []) {
  const { data: existing, error: readError } = await supabaseClient
    .from("product_variants")
    .select("id,size")
    .eq("product_id", productId);
  if (readError) throw new Error(`leer variantes: ${readError.message}`);
  const existingBySize = new Map((existing || []).map((variant) => [categoryKey(variant.size), variant]));
  const activeKeys = new Set();
  for (const [index, variant] of normalizeProductSizeVariants(variants).entries()) {
    const key = categoryKey(variant.size);
    activeKeys.add(key);
    const payload = {
      product_id: productId,
      size: variant.size,
      current_stock: Number(variant.stock || 0),
      active: true,
      sort_order: index + 1,
      archived_at: null,
      updated_by: supabaseSession.user.id,
    };
    const existingVariant = existingBySize.get(key);
    const query = existingVariant
      ? supabaseClient.from("product_variants").update(payload).eq("id", existingVariant.id)
      : supabaseClient.from("product_variants").insert({ ...payload, created_by: supabaseSession.user.id });
    const { error } = await query;
    if (error) throw new Error(`guardar variante ${variant.size}: ${error.message}`);
  }
  const removed = (existing || []).filter((variant) => !activeKeys.has(categoryKey(variant.size))).map((variant) => variant.id);
  if (removed.length) {
    const { error } = await supabaseClient
      .from("product_variants")
      .update({ active: false, archived_at: new Date().toISOString(), updated_by: supabaseSession.user.id })
      .in("id", removed);
    if (error) throw new Error(`archivar variantes: ${error.message}`);
  }
}

async function syncCloudProductImages(productId, urls = [], productName = "") {
  const { error: archiveError } = await supabaseClient
    .from("product_images")
    .update({ archived_at: new Date().toISOString() })
    .eq("product_id", productId)
    .is("archived_at", null);
  if (archiveError) throw new Error(`archivar imagenes: ${archiveError.message}`);

  const bucket = supabaseClient.storage.from("product-images");
  const savedImages = [];
  for (const [index, url] of normalizeProductImageUrls(urls).entries()) {
    let storagePath = url;
    let publicUrl = url;
    if (isDataImageUrl(url)) {
      const extension = imageExtensionFromDataUrl(url);
      const path = `products/${productId}/${Date.now()}-${index + 1}-${Math.floor(Math.random() * 100000)}.${extension}`;
      const blob = await dataImageUrlToBlob(url);
      const { error: uploadError } = await bucket.upload(path, blob, {
        contentType: blob.type || `image/${extension}`,
        cacheControl: "31536000",
        upsert: false,
      });
      if (uploadError) throw new Error(`subir imagen: ${uploadError.message}`);
      storagePath = path;
      publicUrl = bucket.getPublicUrl(path).data?.publicUrl || path;
    }
    savedImages.push({ storagePath, publicUrl });
  }

  const rows = savedImages.map((image, index) => ({
      product_id: productId,
      storage_path: image.storagePath,
      public_url: image.publicUrl,
      alt_text: productName,
      is_primary: index === 0,
      sort_order: index + 1,
      created_by: supabaseSession.user.id,
    }));
  if (!rows.length) return [];
  const { error } = await supabaseClient.from("product_images").insert(rows);
  if (error) throw new Error(`guardar imagenes: ${error.message}`);
  return savedImages.map((image) => image.publicUrl);
}

async function saveCloudProductRecord(existing, product) {
  if (!cloudEnabledWithSession()) return product;
  const categoryRow = cloudProductCategoryRow(product.category);
  const subcategoryRow = cloudProductSubcategoryRow(product.category, product.subcategory);
  if (!categoryRow?.categoryId) throw new Error(`No encontre la categoria ${product.category} en Supabase.`);
  const payload = {
    sku: product.code,
    slug: productCatalogSlug(product),
    name: product.description,
    color: product.color || "",
    category_id: categoryRow.categoryId,
    subcategory_id: subcategoryRow?.subcategoryId || null,
    description: product.catalogDescription || "",
    cost: Number(product.cost || 0) || null,
    margin_percent: Number(product.margin || 0),
    price: Number(product.price || 0),
    promo_price: Number(product.promoPrice || 0),
    wholesale_price: Number(product.wholesalePrice || 0),
    tracks_stock: Boolean(product.tracksStock),
    published: Boolean(product.published),
    updated_by: supabaseSession.user.id,
  };
  const query = existing?.id
    ? supabaseClient.from("products").update(payload).eq("id", existing.id).select("*").single()
    : supabaseClient.from("products").insert({ ...payload, created_by: supabaseSession.user.id }).select("*").single();
  const { data, error } = await query;
  if (error) throw new Error(`guardar producto: ${error.message}`);
  await syncCloudProductVariants(data.id, product.tracksStock ? product.sizeVariants : []);
  const imageUrls = await syncCloudProductImages(data.id, product.imageUrls, product.description);
  return { ...product, id: data.id, slug: data.slug, imageUrls, images: imageUrls, createdAt: data.created_at, updatedAt: data.updated_at };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function cloudOperationId() {
  return crypto?.randomUUID ? crypto.randomUUID() : uid("operation");
}

function isoDateFromTimestamp(value) {
  if (!value) return todayIso();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? todayIso() : localIsoDate(date);
}

function cloudTimestampFromDate(value) {
  const date = normalizeDateInput(value) || todayIso();
  return `${date}T12:00:00-03:00`;
}

function normalizeCloudCustomer(row = {}, initialPayments = []) {
  return {
    id: row.id,
    name: normalizeCustomerName(row.name || ""),
    dni: normalizeCustomerDni(row.dni || ""),
    phone: row.phone || "",
    province: normalizeProvince(row.city || row.province || ""),
    notes: row.notes || "",
    initialDebt: Math.max(0, Number(row.initial_debt || 0)),
    initialDebtPayments: normalizeSaleDebtPayments(initialPayments),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || row.created_at || "",
  };
}

function normalizeCloudPayment(row = {}) {
  return {
    id: row.id,
    date: isoDateFromTimestamp(row.paid_at || row.created_at),
    amount: Number(row.amount || 0),
    paymentMethod: row.method || "efectivo",
    notes: row.note || "",
    createdAt: row.created_at || row.paid_at || new Date().toISOString(),
  };
}

function normalizeCloudSale(row = {}) {
  const paymentRows = row.payments || [];
  const initialPayment = paymentRows.find((payment) => String(payment.note || "").includes("Pago registrado al crear la venta"));
  const debtPayments = paymentRows
    .filter((payment) => payment.id !== initialPayment?.id)
    .map(normalizeCloudPayment);
  const items = (row.sale_items || []).map((item) => {
    const product = state.products.find((entry) => entry.id === item.product_id);
    return {
      productId: item.product_id || "",
      variantId: item.variant_id || "",
      code: item.sku || product?.code || "",
      description: item.product_name || product?.description || "Producto",
      category: product?.category || "Manual",
      subcategory: product?.subcategory || "",
      color: item.color || product?.color || "",
      size: item.size || "",
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.unit_price || 0),
      unitCost: Number(item.unit_cost || 0),
      tracksStock: Boolean(item.variant_id),
      manual: !item.product_id,
    };
  });
  return {
    id: row.id,
    localOrderNumber: row.local_order_number,
    date: isoDateFromTimestamp(row.sold_at || row.created_at),
    channel: "local",
    source: "mostrador",
    total: Number(row.total || 0),
    paidAmount: Number(initialPayment?.amount ?? row.paid_amount ?? row.total ?? 0),
    debtPayments,
    syncStatus: "synced",
    saleType: "minorista",
    paymentMethod: row.payment_method || "",
    skipPaymentAdjustment: false,
    manualTotalEnabled: Boolean(row.manual_total_enabled),
    manualTotal: row.manual_total_enabled ? Number(row.total || 0) : "",
    items,
    reference: "",
    customerId: row.customer_id || "",
    customerName: "",
    notes: row.notes || "",
    createdAt: row.created_at || row.sold_at || "",
    updatedAt: row.created_at || row.sold_at || "",
  };
}

function normalizeCloudExpense(row = {}) {
  return {
    id: row.id,
    date: isoDateFromTimestamp(row.expense_at || row.created_at),
    concept: row.note || row.category || "Gasto",
    category: row.category || "Otros",
    kind: "variable",
    area: "local",
    amount: Number(row.amount || 0),
    paymentMethod: row.payment_method || "",
    createdAt: row.created_at || "",
  };
}

function normalizeCloudStockMovement(row = {}) {
  const product = state.products.find((entry) => entry.id === row.product_id);
  const variant = product?.sizeVariants?.find((entry) => entry.id === row.variant_id);
  const typeMap = {
    initial: "entrada",
    purchase: "entrada",
    sale: "venta",
    adjustment: "ajuste",
    return: "ajuste",
    gift: "ajuste",
  };
  return {
    id: row.id,
    date: isoDateFromTimestamp(row.created_at),
    productId: row.product_id || "",
    productCode: product?.code || "",
    productName: product?.description || "Producto",
    variantId: row.variant_id || "",
    size: variant?.size || "",
    type: typeMap[row.movement_type] || "ajuste",
    quantity: Number(row.quantity_delta || 0),
    stockAfter: Number(row.stock_after || 0),
    note: row.note || "",
    unitCost: Number(row.unit_cost || 0),
  };
}

function cloudSinceTimestamp(days) {
  const date = new Date();
  date.setDate(date.getDate() - Math.max(1, Number(days || 1)));
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function configuredCloudInitialDays(kind) {
  const settings = businessSettings();
  const fallback = kind === "expenses" ? CLOUD_INITIAL_EXPENSE_DAYS : CLOUD_INITIAL_SALES_DAYS;
  const raw = kind === "expenses" ? settings.cloudInitialExpenseDays : settings.cloudInitialSalesDays;
  const days = Number(raw ?? fallback);
  if (!Number.isFinite(days) || days < 0) return fallback;
  return Math.round(days);
}

function cloudModeCovers(currentMode, requestedMode) {
  return (CLOUD_OPERATIONAL_MODES[currentMode] || 0) >= (CLOUD_OPERATIONAL_MODES[requestedMode] || 0);
}

function cloudModeForView(viewId) {
  return ["salesHistory", "customers", "expenses", "reports"].includes(viewId) ? "full" : "initial";
}

async function ensureCloudDataForView(viewId) {
  if (!cloudEnabledWithSession()) return false;
  const mode = cloudModeForView(viewId);
  if (cloudModeCovers(cloudOperationalMode, mode) || cloudOperationalLoadPromise) return false;
  try {
    renderAuthState(mode === "full" ? "Cargando historial completo..." : "Actualizando datos...");
    await loadCloudOperationalData({ mode, force: false });
    render();
    renderAuthState(mode === "full" ? "Historial completo cargado." : "Datos actualizados.");
    return true;
  } catch (error) {
    console.warn("Cloud lazy load failed", error);
    renderAuthState(`No pude cargar esta seccion: ${error.message || "error de Supabase"}`);
    return false;
  }
}

async function loadCloudOperationalData({ mode = "initial", force = true } = {}) {
  if (!cloudEnabledWithSession()) return false;
  const requestedMode = cloudModeCovers(cloudOperationalMode, "full") && mode === "initial" ? "full" : mode;
  if (!force && cloudModeCovers(cloudOperationalMode, requestedMode)) return true;
  if (cloudOperationalLoadPromise) return cloudOperationalLoadPromise;

  cloudOperationalLoadPromise = (async () => {
    const salesQuery = supabaseClient
      .from("sales")
      .select("*,sale_items(*),payments(*)")
      .is("archived_at", null)
      .order("sold_at", { ascending: false });

    const salesDays = configuredCloudInitialDays("sales");
    const expenseDays = configuredCloudInitialDays("expenses");

    const scopedSalesQuery = requestedMode === "full" || salesDays === 0
      ? salesQuery
      : salesQuery.or(`sold_at.gte.${cloudSinceTimestamp(salesDays)},payment_status.neq.paid`);

    const expensesQuery = supabaseClient
      .from("expenses")
      .select("*")
      .is("archived_at", null)
      .order("expense_at", { ascending: false });

    const scopedExpensesQuery = requestedMode === "full" || expenseDays === 0
      ? expensesQuery
      : expensesQuery.gte("expense_at", cloudSinceTimestamp(expenseDays));

  const [{ data: customers, error: customersError }, { data: sales, error: salesError }, { data: expenses, error: expensesError }, { data: stock, error: stockError }, { data: initialPayments, error: paymentsError }] = await Promise.all([
    supabaseClient.from("customers").select("*").is("archived_at", null).order("created_at", { ascending: false }),
    scopedSalesQuery,
    scopedExpensesQuery,
    supabaseClient.from("stock_movements").select("*").order("created_at", { ascending: false }).limit(STOCK_HISTORY_LIMIT),
    supabaseClient.from("payments").select("*").is("sale_id", null).order("paid_at", { ascending: false }),
  ]);
  if (customersError) throw new Error(`clientes: ${customersError.message}`);
  if (salesError) throw new Error(`ventas: ${salesError.message}`);
  if (expensesError) throw new Error(`gastos: ${expensesError.message}`);
  if (stockError) throw new Error(`stock: ${stockError.message}`);
  if (paymentsError) throw new Error(`pagos: ${paymentsError.message}`);

  const initialPaymentsByCustomer = new Map();
  (initialPayments || []).forEach((payment) => {
    if (!payment.customer_id) return;
    const list = initialPaymentsByCustomer.get(payment.customer_id) || [];
    list.push(normalizeCloudPayment(payment));
    initialPaymentsByCustomer.set(payment.customer_id, list);
  });
  state.customers = (customers || []).map((customer) => normalizeCloudCustomer(customer, initialPaymentsByCustomer.get(customer.id) || []));
  const customersById = new Map(state.customers.map((customer) => [customer.id, customer]));
  state.sales = (sales || []).map(normalizeCloudSale).map((sale) => ({
    ...sale,
    customerName: customersById.get(sale.customerId)?.name || "",
    reference: customersById.get(sale.customerId)?.name || "",
  }));
  state.expenses = (expenses || [])
    .filter((expense) => expense.category !== "CompraMercaderia")
    .map(normalizeCloudExpense);
  state.purchases = (expenses || [])
    .filter((expense) => expense.category === "CompraMercaderia")
    .map((expense) => ({
      id: expense.id,
      date: isoDateFromTimestamp(expense.expense_at || expense.created_at),
      supplier: expense.note || "Compra de Mercadería",
      category: "CompraMercaderia",
      behavior: "variable",
      area: "local",
      amount: Number(expense.amount || 0),
      notes: expense.note || "",
      stockEntryId: expense.operation_id || "",
    }));
  state.stockHistory = (stock || []).map(normalizeCloudStockMovement).reverse();
  cloudOperationalMode = requestedMode;
  persistStateLocalOnly();
  return true;
  })();

  try {
    return await cloudOperationalLoadPromise;
  } finally {
    cloudOperationalLoadPromise = null;
  }
}

async function loadCloudBusinessSettings() {
  if (!cloudEnabledWithSession()) return false;
  const { data, error } = await supabaseClient
    .from("business_settings")
    .select("business_name, whatsapp_number, default_whatsapp_message, size_availability_mode, out_of_stock_product_mode")
    .eq("id", "main")
    .maybeSingle();
  if (error) throw new Error(`configuración: ${error.message}`);
  if (!data) return false;
  state.catalogSettings = catalogSettings({
    catalogSettings: {
      businessName: data.business_name,
      whatsappNumber: data.whatsapp_number,
      defaultWhatsappMessage: data.default_whatsapp_message,
      sizeAvailabilityMode: data.size_availability_mode,
      outOfStockProductMode: data.out_of_stock_product_mode,
    },
  });
  return true;
}

async function loadCloudData({ mode = "initial", force = false } = {}) {
  await loadCloudBusinessSettings();
  await loadCloudProductCatalog();
  await loadCloudOperationalData({ mode, force });
  persistStateLocalOnly();
  return true;
}

async function saveCloudCustomerRecord(existing, payload) {
  if (!cloudEnabledWithSession()) return { id: existing?.id || uid("customer"), ...payload };
  const row = {
    name: payload.name,
    dni: normalizeCustomerDni(payload.dni || ""),
    phone: payload.phone || "",
    city: normalizeProvince(payload.province || ""),
    notes: payload.notes || "",
    initial_debt: Math.max(0, Number(payload.initialDebt || 0)),
    updated_by: supabaseSession.user.id,
  };
  const query = existing?.id && isUuid(existing.id)
    ? supabaseClient.from("customers").update(row).eq("id", existing.id).select("*").single()
    : supabaseClient.from("customers").insert({ ...row, created_by: supabaseSession.user.id }).select("*").single();
  const { data, error } = await query;
  if (error) throw new Error(`guardar cliente: ${error.message}`);
  return normalizeCloudCustomer(data, existing?.initialDebtPayments || []);
}

async function ensureCloudCustomer(customer) {
  if (!customer || !cloudEnabledWithSession()) return customer || null;
  if (isUuid(customer.id)) return customer;
  const saved = await saveCloudCustomerRecord(null, customer);
  const previousId = customer.id;
  Object.assign(customer, saved);
  state.carts.forEach((cart) => {
    if (cart.customerId === previousId) cart.customerId = saved.id;
  });
  return customer;
}

function cloudSaleItemsFromCart(cart) {
  return (cart.items || []).map((item) => {
    const product = state.products.find((entry) => entry.id === item.productId);
    if (!product || !isUuid(product.id)) {
      throw new Error(`El item "${item.description || "Manual"}" no está vinculado a un producto de Supabase.`);
    }
    const variant = item.size
      ? normalizeProductSizeVariants(product.sizeVariants).find((entry) => entry.size === item.size)
      : null;
    if (product.tracksStock && !variant?.id) {
      throw new Error(`El producto ${product.description} requiere una variedad/talle válido.`);
    }
    return {
      product_id: product.id,
      variant_id: variant?.id || null,
      quantity: Number(item.quantity || 1),
      unit_price: Number(item.unitPrice || product.price || 0),
      unit_cost: Number(item.unitCost || product.cost || 0),
    };
  });
}

async function ensureCloudManualProduct() {
  if (!cloudEnabledWithSession()) throw new Error("Ingresá con tu usuario BlackShoes para usar ventas manuales.");
  const { data, error } = await supabaseClient.rpc("ensure_manual_product");
  if (error) throw new Error(`crear producto manual: ${error.message}`);
  return data;
}

async function cloudSaleItemsFromCartAsync(cart) {
  const manualProductId = (cart.items || []).some((item) => item.manual || !item.productId)
    ? await ensureCloudManualProduct()
    : null;
  return (cart.items || []).map((item) => {
    if (item.manual || !item.productId) {
      return {
        product_id: manualProductId,
        variant_id: null,
        quantity: Number(item.quantity || 1),
        unit_price: Number(item.unitPrice || 0),
        unit_cost: Number(item.unitCost || 0),
      };
    }
    return cloudSaleItemsFromCart({ items: [item] })[0];
  });
}

async function saveCloudLocalSale(cart, customer) {
  if (!cloudEnabledWithSession()) throw new Error("Ingresá con tu usuario BlackShoes para registrar ventas.");
  const items = await cloudSaleItemsFromCartAsync(cart);
  const { data, error } = await supabaseClient.rpc("create_sale", {
    p_operation_id: cloudOperationId(),
    p_customer_id: customer?.id && isUuid(customer.id) ? customer.id : null,
    p_paid_amount: cartPaidAmount(cart),
    p_payment_method: cart.paymentMethod || "",
    p_manual_total: cart.manualTotalEnabled ? cartTotal(cart) : null,
    p_notes: cart.reference || "",
    p_items: items,
  });
  if (error) throw new Error(`registrar venta: ${error.message}`);
  return data;
}

async function saveCloudCustomerPayment({ customer, sale, amount, method, note }) {
  if (!cloudEnabledWithSession()) throw new Error("Ingresá con tu usuario BlackShoes para registrar pagos.");
  const { data, error } = await supabaseClient.rpc("register_customer_payment", {
    p_operation_id: cloudOperationId(),
    p_customer_id: customer?.id && isUuid(customer.id) ? customer.id : null,
    p_sale_id: sale?.id && isUuid(sale.id) ? sale.id : null,
    p_amount: amount,
    p_method: method || "efectivo",
    p_note: note || "",
  });
  if (error) throw new Error(`registrar pago: ${error.message}`);
  return data;
}

async function saveCloudExpenseRecord(payload) {
  if (!cloudEnabledWithSession()) return payload;
  const row = {
    operation_id: cloudOperationId(),
    expense_at: cloudTimestampFromDate(payload.date),
    category: payload.category || "Otros",
    amount: Number(payload.amount || 0),
    payment_method: payload.paymentMethod || "",
    note: payload.concept || payload.notes || "",
    created_by: supabaseSession.user.id,
  };
  const { data, error } = await supabaseClient.from("expenses").insert(row).select("*").single();
  if (error) throw new Error(`guardar gasto: ${error.message}`);
  return normalizeCloudExpense(data);
}

async function saveCloudStockEntry(entry) {
  if (!cloudEnabledWithSession()) throw new Error("Ingresá con tu usuario BlackShoes para cargar stock.");
  const product = state.products.find((item) => item.id === entry.productId);
  if (!product || !isUuid(product.id)) throw new Error("Producto de Supabase no encontrado.");
  const variant = entry.size
    ? normalizeProductSizeVariants(product.sizeVariants).find((item) => item.size === entry.size)
    : null;
  if (!variant?.id) throw new Error(`No encontré la variedad ${entry.size || ""} de ${product.description}.`);
  const quantity = Number(entry.quantity || 0);
  const unitCost = entry.unitCost !== null && entry.unitCost !== undefined && Number.isFinite(Number(entry.unitCost))
    ? Number(entry.unitCost)
    : Number(product.cost || 0);
  const note = `${entry.note || "Reposicion de Mercaderia"}${entry.size ? ` - Talle ${entry.size}` : ""}`;
  const { error } = await supabaseClient.rpc("register_stock_movement", {
    p_operation_id: cloudOperationId(),
    p_variant_id: variant.id,
    p_quantity_delta: quantity,
    p_movement_type: "purchase",
    p_unit_cost: unitCost,
    p_note: note,
  });
  if (error) throw new Error(`cargar stock: ${error.message}`);
  if (entry.unitCost !== null && entry.unitCost !== undefined && Number.isFinite(Number(entry.unitCost))) {
    const nextCost = Number(entry.unitCost);
    const nextPrice = entry.priceAction === "recalculate"
      ? Math.round(nextCost + nextCost * (Number(product.margin || 0) / 100))
      : Number(product.price || 0);
    const { error: productError } = await supabaseClient
      .from("products")
      .update({ cost: nextCost, price: nextPrice, updated_by: supabaseSession.user.id })
      .eq("id", product.id);
    if (productError) throw new Error(`actualizar costo/precio: ${productError.message}`);
  }
  await saveCloudExpenseRecord({
    date: entry.date,
    concept: stockMovementPurchaseNote(quantity, unitCost, note),
    category: "CompraMercaderia",
    amount: Math.round(unitCost * quantity),
  });
}

async function archiveCloudRecord(kind, id) {
  if (!cloudEnabledWithSession() || !isUuid(id)) return false;
  const functionsByKind = {
    sale: "cancel_sale",
    customer: "archive_customer",
    expense: "archive_expense",
    product: "archive_product",
  };
  const fn = functionsByKind[kind];
  if (!fn) return false;
  const argNames = {
    sale: "p_sale_id",
    customer: "p_customer_id",
    expense: "p_expense_id",
    product: "p_product_id",
  };
  const { error } = await supabaseClient.rpc(fn, { [argNames[kind]]: id });
  if (error) throw new Error(error.message);
  return true;
}

async function saveCloudCatalogSettings(settings) {
  if (!cloudEnabledWithSession()) throw new Error("Ingresá con tu usuario BlackShoes para guardar catálogo.");
  const { error } = await supabaseClient
    .from("business_settings")
    .update({
      business_name: settings.businessName,
      whatsapp_number: settings.whatsappNumber,
      default_whatsapp_message: settings.defaultWhatsappMessage,
      size_availability_mode: settings.sizeAvailabilityMode,
      out_of_stock_product_mode: settings.outOfStockProductMode,
      updated_by: supabaseSession.user.id,
    })
    .eq("id", "main");
  if (error) throw new Error(`guardar configuración: ${error.message}`);
}

function catalogProductUrl(product) {
  return new URL(`catalogo/producto.html?slug=${encodeURIComponent(productCatalogSlug(product))}`, window.location.href.replace(/index\.html$/i, "")).href;
}

function normalizeState(rawState) {
  const next = { ...emptyDataState(), ...repairPersistedText(rawState) };
  next.offline = !navigator.onLine;
  next.localSyncPending = Boolean(next.localSyncPending);
  next.systemMigrationPending = Boolean(next.systemMigrationPending);
  next.pendingRemoteChanges = normalizePendingRemoteChanges(next.pendingRemoteChanges);
  next.deletedRecords = normalizeDeletedRecords(next.deletedRecords);
  if (!next.businessSettings?.blackshoesPercentagesResetV2) {
    next.businessSettings = {
      ...businessSettings({ businessSettings: next.businessSettings || {} }),
      tiendaNubeCommissionRate: 0,
      mercadoPagoCommissionRate: 0,
      pagoNubeCommissionRate: 0,
      onlineCostInsumos: 0,
      onlineCostAccesorios: 0,
      promoDiscounts: { ...defaultBusinessSettings.promoDiscounts },
      blackshoesPercentagesResetV1: true,
      blackshoesPercentagesResetV2: true,
    };
  }
  if (next.activeView === "merchandise") next.activeView = "expenses";
  if (next.activeView === "cashClose") next.activeView = "dashboard";
  if (next.activeView === "settings") next.activeView = "reports";
  next.reportPeriod = next.reportPeriod || "month";
  next.reportScope = ["total", "local", "web"].includes(next.reportScope) ? next.reportScope : "total";
  next.marginTrendOrder = ["chronological", "marginDesc", "marginAsc"].includes(next.marginTrendOrder) ? next.marginTrendOrder : "chronological";
  next.reportCustomFrom = normalizeDateInput(next.reportCustomFrom) || monthAgoIso();
  next.reportCustomTo = normalizeDateInput(next.reportCustomTo) || todayIso();
  next.selectedMonth = currentMonthKey();
  next.userTabPermissions = normalizeUserTabPermissions(next.userTabPermissions);
  next.customerFilters = { query: "", sort: "alpha", ...(next.customerFilters || {}) };
  if (!["alpha", "amount"].includes(next.customerFilters.sort)) next.customerFilters.sort = "alpha";
  const shouldApplyCleanExpenseDefault = !next.expenseFilters?.cleanDefaultApplied;
  next.expenseFilters = {
    ...defaultExpenseFilters(),
    ...(next.expenseFilters || {}),
  };
  if (shouldApplyCleanExpenseDefault) {
    next.expenseFilters.type = "expense";
    next.expenseFilters.commissions = "hide";
    next.expenseFilters.cleanDefaultApplied = true;
  }
  if (!["all", "expense", "purchase"].includes(next.expenseFilters.type)) next.expenseFilters.type = "expense";
  if (!["all", "hide"].includes(next.expenseFilters.commissions)) next.expenseFilters.commissions = "hide";
  next.onlineFilters = { sort: "orderDesc", query: "", order: "", store: "all", ...(next.onlineFilters || {}) };
  if (!["dateDesc", "dateAsc", "orderAsc", "orderDesc"].includes(next.onlineFilters.sort)) next.onlineFilters.sort = "orderDesc";
  if (next.onlineFilters.sort === "dateDesc") next.onlineFilters.sort = "orderDesc";
  if (!["all", "insumos", "accesorios"].includes(next.onlineFilters.store)) next.onlineFilters.store = "all";
  next.onlineOrderSequence = onlineOrderSequenceFromState(next);
  next.customers = (next.customers || []).map((customer) => ({
    ...customer,
    dni: normalizeCustomerDni(customer.dni),
    initialDebt: Math.max(0, Number(customer.initialDebt || 0)),
    initialDebtPayments: normalizeSaleDebtPayments(customer.initialDebtPayments),
    province: normalizeProvince(customer.province),
  }));
  next.salesHistoryPage = Number(next.salesHistoryPage || 1);
  next.onlinePage = Number(next.onlinePage || 1);
  next.expensesPage = Number(next.expensesPage || 1);
  next.productPage = Number(next.productPage || 1);
  next.customerPage = Number(next.customerPage || 1);
  next.stockHistoryPage = Number(next.stockHistoryPage || 1);
  next.activityLogPage = Number(next.activityLogPage || 1);
  next.activityLogFilters = { user: "all", type: "all", query: "", ...(next.activityLogFilters || {}) };
  next.salesHistoryFilters = {
    order: "",
    period: "all",
    from: "",
    to: "",
    channel: "all",
    payment: "all",
    ...(next.salesHistoryFilters || {}),
  };
  next.productFilters = { query: "", sort: "recent", category: "all", subcategory: "all", stock: "all", published: "all", ...(next.productFilters || {}) };
  if (!next.productRecentDefaultApplied) {
    next.productFilters.sort = "recent";
    next.productRecentDefaultApplied = true;
  }
  if (!["alphaAsc", "alphaDesc", "recent"].includes(next.productFilters.sort)) next.productFilters.sort = "recent";
  next.onlineDraftLines = (next.onlineDraftLines || []).map((line) => {
    const category = canonicalProductCategory(line.category);
    return { ...line, category, subcategory: saleLineSubcategory(category, line.subcategory) };
  });
  next.historicalMonthlyDetails = { ...(next.historicalMonthlyDetails || {}) };
  next.customProductCategories = normalizeCustomProductCategories(next.customProductCategories);
  next.catalogSettings = catalogSettings(next);
  next.userLastSeen = normalizeUserLastSeen(next.userLastSeen);
  if (next.historicalCategoryImportId !== HISTORICAL_CATEGORY_IMPORT_ID) {
    Object.entries(importedHistoricalMonthlyDetails).forEach(([monthKey, detail]) => {
      next.historicalMonthlyDetails[monthKey] = structuredClone(detail);
    });
    next.historicalCategoryImportId = HISTORICAL_CATEGORY_IMPORT_ID;
  }
  next.paymentMethods = demoState().paymentMethods;
  next.products = (next.products || []).map((product) => ({
    ...product,
    barcode: normalizeProductBarcode(product),
    description: normalizeProductDescription(product.description),
    catalogDescription: String(product.catalogDescription || "").trim(),
    color: normalizeProductDescription(product.color || ""),
    category: canonicalProductCategory(product.category),
    subcategory: product.subcategory || "",
    unit: normalizeProductDescription(product.unit || "Unidad"),
    cost: Number(product.cost || 0),
    margin: Number(product.margin || 0),
    promoPrice: Number(product.promoPrice || 0),
    wholesalePrice: Number(product.wholesalePrice || 0),
    tracksStock: Boolean(product.tracksStock),
    stock: product.tracksStock ? Number(product.stock || 0) : null,
    published: Boolean(product.published),
    featured: Boolean(product.featured),
    isNew: Boolean(product.isNew),
    imageUrls: normalizeProductImageUrls(product.imageUrls),
    sizeVariants: normalizeProductSizeVariants(product.sizeVariants),
  })).map((product) => ({
    ...product,
    stock: product.sizeVariants.length ? productSizeStockTotal(product) : product.stock,
  }));
  if (next.accessoryPriceProductsImportId !== ACCESSORY_PRICE_PRODUCTS_IMPORT_ID) {
    const usedCodes = new Set(next.products.map((product) => String(product.code || "").toUpperCase()));
    const additions = accessoryPriceProducts().filter((product) => !usedCodes.has(product.code));
    next.products.push(...additions);
    if (additions.length) next.systemMigrationPending = true;
    next.accessoryPriceProductsImportId = ACCESSORY_PRICE_PRODUCTS_IMPORT_ID;
  }
  next.sales = (next.sales || []).map((sale) => ({
    ...sale,
    items: (sale.items || []).map((item) => {
      const category = canonicalSaleItemCategory(item, sale);
      return { ...item, category, subcategory: saleLineSubcategory(category, item.subcategory) };
    }),
    onlineLines: (sale.onlineLines || []).map((line) => {
      const category = canonicalProductCategory(line.category);
      return { ...line, category, subcategory: saleLineSubcategory(category, line.subcategory) };
    }),
    saleType: sale.saleType || "minorista",
    paymentMethod: sale.paymentMethod === "mp" ? "qr" : sale.paymentMethod || "",
    skipPaymentAdjustment: Boolean(sale.skipPaymentAdjustment),
    manualTotalEnabled: Boolean(sale.manualTotalEnabled),
    manualTotal: sale.manualTotal ?? "",
    paymentPlatform: sale.channel === "online" ? canonicalOnlinePaymentPlatform(sale.paymentPlatform, sale.paymentMethod) : sale.paymentPlatform,
    onlineStore: sale.channel === "online" ? sale.onlineStore || sale.store || "insumos" : sale.onlineStore,
    onlinePromo: sale.onlinePromo || "base",
    grossAmount: sale.channel === "online" ? onlineGrossAmountFromRecord(sale) : Number(sale.grossAmount || 0),
    discountAmount: sale.channel === "online" ? onlineDiscountAmountFromRecord(sale) : Number(sale.discountAmount || 0),
    onlineCostRate: sale.channel === "online" ? Number(sale.onlineCostRate ?? onlineCostRate(sale.onlineStore || sale.store || "insumos", sale.onlinePromo || "base")) : sale.onlineCostRate,
    onlineCost: sale.channel === "online" ? Number(sale.onlineCost ?? onlineEstimatedCost(onlineGrossAmountFromRecord(sale), sale.onlineStore || sale.store || "insumos", sale.grossAmount != null || sale.subtotalAmount != null ? "base" : sale.onlinePromo || "base")) : sale.onlineCost,
    shippingAmount: Number(sale.shippingAmount || 0),
    collectedTotal: Number(sale.collectedTotal ?? (Number(sale.total || 0) + Number(sale.shippingAmount || 0))),
    customerId: sale.customerId || "",
    customerName: sale.customerName || "",
    customerDni: normalizeCustomerDni(sale.customerDni),
    paidAmount: sale.channel === "local" ? saleInitialPaidAmount(sale) : Number(sale.paidAmount ?? sale.total ?? 0),
    debtPayments: normalizeSaleDebtPayments(sale.debtPayments),
  })).filter((sale) => sale.id !== "demo-local-mp");
  next.carts = (next.carts || []).map((cart) => ({
    ...cart,
    items: (cart.items || []).map((item) => {
      const category = canonicalSaleItemCategory(item, cart);
      return { ...item, category, subcategory: saleLineSubcategory(category, item.subcategory) };
    }),
    saleType: cart.saleType || "minorista",
    paymentMethod: cart.paymentMethod === "mp" ? "qr" : cart.paymentMethod || "",
    skipPaymentAdjustment: Boolean(cart.skipPaymentAdjustment),
    manualTotalEnabled: Boolean(cart.manualTotalEnabled),
    manualTotal: cart.manualTotal ?? "",
    customerId: cart.customerId || "",
    partialPaymentEnabled: Boolean(cart.partialPaymentEnabled),
    paidAmount: cart.paidAmount ?? "",
  }));
  next.onlineOrders = (next.onlineOrders || []).map((order) => ({
    ...order,
    store: order.store || "insumos",
    lines: (order.lines || []).map((line) => {
      const category = canonicalProductCategory(line.category);
      return { ...line, category, subcategory: saleLineSubcategory(category, line.subcategory) };
    }),
    paymentMethod: order.paymentMethod || "",
    paymentPlatform: canonicalOnlinePaymentPlatform(order.paymentPlatform, order.paymentMethod),
    promo: order.promo || "base",
    grossAmount: onlineGrossAmountFromRecord(order),
    discountAmount: onlineDiscountAmountFromRecord(order),
    saleAmount: Number(order.saleAmount ?? order.total ?? onlineDiscountedSaleAmount(onlineGrossAmountFromRecord(order), onlineDiscountAmountFromRecord(order))),
    shippingAmount: Number(order.shippingAmount || 0),
    collectedTotal: Number(order.collectedTotal ?? (Number(order.saleAmount ?? order.total ?? onlineDiscountedSaleAmount(onlineGrossAmountFromRecord(order), onlineDiscountAmountFromRecord(order))) + Number(order.shippingAmount || 0))),
    total: Number(order.saleAmount ?? order.total ?? onlineDiscountedSaleAmount(onlineGrossAmountFromRecord(order), onlineDiscountAmountFromRecord(order))),
    afipDone: Boolean(order.afipDone),
    costRate: Number(order.costRate ?? onlineCostRate(order.store || "insumos", order.grossAmount != null || order.subtotalAmount != null ? "base" : order.promo || "base")),
    estimatedCost: Number(order.estimatedCost ?? onlineEstimatedCost(onlineGrossAmountFromRecord(order), order.store || "insumos", order.grossAmount != null || order.subtotalAmount != null ? "base" : order.promo || "base")),
    customerId: order.customerId || "",
    customerName: order.customerName || "",
    customerDni: normalizeCustomerDni(order.customerDni),
  }));
  next.arcaDoneOrders = normalizeArcaDoneOrders(next.arcaDoneOrders, next.onlineOrders);
  syncOnlineArcaFlagsByOrderNumber(next);
  const normalizedWorkshop = normalizeWorkshopOrders(next.workshopOrders);
  next.workshopOrders = normalizedWorkshop.orders;
  if (normalizedWorkshop.changed) next.systemMigrationPending = true;
  next.onlineResolvedMissingOrders = normalizedOnlineResolvedMissingOrders(next.onlineResolvedMissingOrders);
  next.purchases = (next.purchases || []).map((purchase) => ({
    ...purchase,
    category: canonicalProductCategory(purchase.category),
    area: canonicalExpenseArea(purchase.area),
  }));
  next.expenses = (next.expenses || []).map((expense) => ({
    ...expense,
    area: canonicalExpenseArea(expense.area),
  }));
  next.businessSettings = businessSettings(next);
  if (Number(next.businessSettings.mercadoPagoCommissionRate || 0) === 0) {
    next.businessSettings.mercadoPagoCommissionRate = MERCADO_PAGO_COMMISSION_RATE_WITH_IVA;
    next.systemMigrationPending = true;
  }
  next.monthlyClosures = (next.monthlyClosures || []).map((closure) => ({ ...closure }));
  if (next.historicalResultsImportId !== HISTORICAL_RESULTS_IMPORT_ID) {
    const existingMonthKeys = new Set(next.monthlyClosures.map((closure) => closure.monthKey));
    importedHistoricalMonthlyClosures.forEach((closure) => {
      if (!existingMonthKeys.has(closure.monthKey)) next.monthlyClosures.push({ ...closure });
    });
    next.monthlyClosures.sort((a, b) => String(b.monthKey).localeCompare(String(a.monthKey)));
    next.historicalResultsImportId = HISTORICAL_RESULTS_IMPORT_ID;
  }
  next.monthlyClosuresPage = Number(next.monthlyClosuresPage || 1);
  next.fixedExpenseTemplates = normalizeFixedExpenseTemplates(next.fixedExpenseTemplates);
  linkOnlineRecords(next);
  assignLocalOrderNumbers(next);
  next.stockHistory = (next.stockHistory || []).slice(-STOCK_HISTORY_LIMIT);
  next.products.filter((product) => product.tracksStock).forEach((product) => {
    const hasHistory = next.stockHistory.some((item) => item.productId === product.id);
    if (!hasHistory) {
      next.stockHistory.push({
        id: `stock-inicial-${product.id}`,
        date: todayIso(),
        productId: product.id,
        productCode: product.code,
        productName: product.description,
        type: "ajuste",
        quantity: Number(product.stock || 0),
        stockAfter: Number(product.stock || 0),
        note: "Stock Inicial Cargado",
      });
    }
  });
  next.stockHistory = next.stockHistory.slice(-STOCK_HISTORY_LIMIT);
  next.activityLog = (next.activityLog || [])
    .map((entry) => ({
      id: entry.id || uid("activity"),
      at: entry.at || entry.createdAt || new Date().toISOString(),
      user: entry.user || "Sin usuario",
      email: entry.email || "",
      type: entry.type || "general",
      action: entry.action || "Movimiento",
      detail: entry.detail || "",
    }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, ACTIVITY_LOG_LIMIT);
  return next;
}

function saveState() {
  localChangeRevision += 1;
  markDirtyRemoteChanges(lastDirtyComparisonState, state);
  lastDirtyComparisonState = cloneStateForDirtyComparison(state);
  const shouldQueueRemoteSave = !REMOTE_SYNC_DISABLED && (hasPendingRemoteChanges(state.pendingRemoteChanges) || state.systemMigrationPending);
  businessStateDirty = shouldQueueRemoteSave;
  state.localSyncPending = shouldQueueRemoteSave;
  localStorage.setItem(ACTIVE_STORE_KEY, JSON.stringify(state));
  if (shouldQueueRemoteSave) queueRemoteStateSave();
}

function saveUiState() {
  localStorage.setItem(ACTIVE_STORE_KEY, JSON.stringify(state));
}

function persistStateLocalOnly() {
  localStorage.setItem(ACTIVE_STORE_KEY, JSON.stringify(state));
}

function markLocalSyncPending() {
  businessStateDirty = true;
  state.localSyncPending = true;
  state.offline = !navigator.onLine;
  persistStateLocalOnly();
  renderConnection();
}

function cachedSupabaseProfile() {
  try {
    return JSON.parse(localStorage.getItem(SUPABASE_PROFILE_CACHE_KEY) || "null");
  } catch {
    return null;
  }
}

function initSupabaseClient() {
  if ((!CLOUD_DATA_ENABLED && REMOTE_SYNC_DISABLED) || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;
  if (supabaseClient || !window.supabase?.createClient) return supabaseClient;
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return supabaseClient;
}

function renderAuthState(message = "") {
  const authModal = document.getElementById("authModal");
  const authMessage = document.getElementById("authMessage");
  const authError = document.getElementById("authError");
  const logoutButton = document.getElementById("logoutButton");
  const mobileLogoutButton = document.getElementById("mobileLogoutButton");
  const remoteLabel = document.getElementById("remoteSyncLabel");
  const authRequired = (CLOUD_DATA_ENABLED || !REMOTE_SYNC_DISABLED) && !supabaseSession;
  document.body.classList.toggle("auth-locked", authRequired);
  if (authModal) {
    authModal.classList.toggle("open", authRequired);
    authModal.setAttribute("aria-hidden", authRequired ? "false" : "true");
  }
  if (logoutButton) logoutButton.hidden = !(CLOUD_DATA_ENABLED || !REMOTE_SYNC_DISABLED) || !supabaseSession;
  if (mobileLogoutButton) mobileLogoutButton.hidden = !(CLOUD_DATA_ENABLED || !REMOTE_SYNC_DISABLED) || !supabaseSession;
  if (authMessage && message) authMessage.textContent = message;
  if (authError && supabaseSession) {
    authError.classList.add("is-hidden");
    authError.textContent = "";
  }
  if (remoteLabel) {
    remoteLabel.hidden = false;
    remoteLabel.textContent = CLOUD_DATA_ENABLED
      ? (!supabaseSession ? "Sesion cerrada" : (message || "Supabase conectado"))
      : REMOTE_SYNC_DISABLED
      ? "Supabase desactivado"
      : !supabaseSession
      ? "Sesion cerrada"
      : remoteSaveInProgress
        ? "Guardando"
        : (message || "Sesion iniciada");
  }
}

function signOut() {
  supabaseClient?.auth.signOut();
  supabaseSession = null;
  renderAuthState("Sesión cerrada.");
}

function showAuthError(message) {
  const authError = document.getElementById("authError");
  if (!authError) return;
  authError.textContent = message;
  authError.classList.remove("is-hidden");
}

function pendingApprovalError() {
  const error = new Error("Tu usuario queda pendiente de aprobacion del administrador.");
  error.code = "PENDING_APPROVAL";
  return error;
}

async function ensureSupabaseProfile() {
  if (!supabaseClient || !supabaseSession?.user) return null;
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", supabaseSession.user.id)
    .maybeSingle();
  if (data) {
    if (data.active === false) {
      supabaseProfile = data;
      localStorage.removeItem(SUPABASE_PROFILE_CACHE_KEY);
      throw pendingApprovalError();
    }
    supabaseProfile = data;
    localStorage.setItem(SUPABASE_PROFILE_CACHE_KEY, JSON.stringify(data));
    return data;
  }
  if (error && error.code !== "PGRST116") throw new Error(`profiles: ${error.message}`);
  const fallbackProfile = {
    id: supabaseSession.user.id,
    name: supabaseSession.user.email,
    role: "local",
    active: false,
  };
  const inserted = await supabaseClient.from("profiles").insert(fallbackProfile).select("*").single();
  if (inserted.error) throw new Error(`profiles insert: ${inserted.error.message}`);
  supabaseProfile = inserted.data;
  localStorage.removeItem(SUPABASE_PROFILE_CACHE_KEY);
  throw pendingApprovalError();
}

async function refreshSupabaseProfiles({ renderAfter = true } = {}) {
  if (!supabaseClient || !supabaseSession || !isAdminProfile()) {
    supabaseProfiles = supabaseProfile ? [supabaseProfile] : [];
    if (renderAfter) renderSettings();
    return supabaseProfiles;
  }
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id,name,role,active")
    .order("name", { ascending: true });
  if (error) {
    console.warn("Supabase profiles list failed", error);
    if (renderAfter) alert(`No pude leer usuarios: ${error.message}`);
    return supabaseProfiles;
  }
  supabaseProfiles = data || [];
  if (renderAfter) renderSettings();
  return supabaseProfiles;
}

async function updateCurrentUserLastSeen() {
  if (!supabaseClient || !supabaseSession || !supabaseProfile || !navigator.onLine) return;
  const actor = currentActivityUser();
  if (!actor.email) return;
  const entry = { email: actor.email, user: actor.user, at: new Date().toISOString() };
  state.userLastSeen = normalizeUserLastSeen({ ...(state.userLastSeen || {}), [actor.email]: entry });
  persistStateLocalOnly();
  try {
    const { data, error } = await supabaseClient
      .from("app_records")
      .select("payload")
      .eq("collection", SUPABASE_SETTINGS_COLLECTION)
      .eq("record_id", SUPABASE_SETTINGS_RECORD_ID)
      .maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    const payload = {
      ...remoteSettingsSnapshot(state),
      ...(data?.payload || {}),
    };
    payload.userLastSeen = normalizeUserLastSeen({ ...(payload.userLastSeen || {}), [actor.email]: entry });
    const { error: saveError } = await supabaseClient
      .from("app_records")
      .upsert({
        collection: SUPABASE_SETTINGS_COLLECTION,
        record_id: SUPABASE_SETTINGS_RECORD_ID,
        payload,
        created_by: supabaseSession.user.id,
        updated_by: supabaseSession.user.id,
        updated_at: new Date().toISOString(),
        deleted_at: null,
      }, { onConflict: "collection,record_id" });
    if (saveError) throw saveError;
  } catch (error) {
    console.warn("Supabase last seen update failed", error);
  }
}

function localUiSnapshot() {
  return {
    activeView: state.activeView,
    activeCartId: state.activeCartId,
    carts: JSON.parse(JSON.stringify(state.carts || [])),
    onlineDraftLines: JSON.parse(JSON.stringify(state.onlineDraftLines || [])),
    productFilters: { ...(state.productFilters || {}) },
    customerFilters: { ...(state.customerFilters || {}) },
    expenseFilters: { ...(state.expenseFilters || {}) },
    onlineFilters: { ...(state.onlineFilters || {}) },
    salesHistoryFilters: { ...(state.salesHistoryFilters || {}) },
    activityLogFilters: { ...(state.activityLogFilters || {}) },
    reportPeriod: state.reportPeriod,
    reportScope: state.reportScope,
    reportCustomFrom: state.reportCustomFrom,
    reportCustomTo: state.reportCustomTo,
    marginTrendOrder: state.marginTrendOrder,
    selectedMonth: state.selectedMonth,
    salesHistoryPage: state.salesHistoryPage,
    onlinePage: state.onlinePage,
    expensesPage: state.expensesPage,
    productPage: state.productPage,
    customerPage: state.customerPage,
    stockHistoryPage: state.stockHistoryPage,
    monthlyClosuresPage: state.monthlyClosuresPage,
    activityLogPage: state.activityLogPage,
    customerInfoPage: state.customerInfoPage,
  };
}

function restoreLocalUiSnapshot(snapshot = {}) {
  if (!snapshot) return;
  Object.assign(state, snapshot);
}

async function loadRemoteState() {
  if (!supabaseClient || !supabaseSession) return false;
  const uiSnapshot = localUiSnapshot();
  const recordState = await loadRemoteRecordState();
  const legacyState = await fetchRemoteStateValue();
  if (recordState) {
    const nextState = normalizeState(legacyState ? mergeDataStates(legacyState, recordState) : recordState);
    if (!hasOperationalRemoteData(nextState)) {
      lastRemoteSaveMessage = `Supabase solo devolvio configuracion/historicos (${stateSummaryText(nextState)}). No cargue datos vacios.`;
      return false;
    }
    state = nextState;
    restoreLocalUiSnapshot(uiSnapshot);
    clearPendingRemoteChanges(state);
    localStorage.setItem(ACTIVE_STORE_KEY, JSON.stringify(state));
    businessStateDirty = false;
    lastDirtyComparisonState = cloneStateForDirtyComparison(state);
    return true;
  }
  if (!legacyState) return false;
  const nextState = normalizeState(legacyState);
  if (!hasOperationalRemoteData(nextState)) {
    lastRemoteSaveMessage = `Supabase no devolvio productos, clientes ni ventas (${stateSummaryText(nextState)}).`;
    return false;
  }
  state = nextState;
  restoreLocalUiSnapshot(uiSnapshot);
  clearPendingRemoteChanges(state);
  localStorage.setItem(ACTIVE_STORE_KEY, JSON.stringify(state));
  businessStateDirty = false;
  lastDirtyComparisonState = cloneStateForDirtyComparison(state);
  return true;
}

function remoteSettingsSnapshot(value = {}) {
  return {
    businessSettings: value.businessSettings || {},
    fixedExpenseTemplates: value.fixedExpenseTemplates || [],
    userTabPermissions: value.userTabPermissions || {},
    historicalMonthlyDetails: value.historicalMonthlyDetails || {},
    historicalCategoryImportId: value.historicalCategoryImportId || "",
    historicalResultsImportId: value.historicalResultsImportId || "",
    onlineResolvedMissingOrders: value.onlineResolvedMissingOrders || [],
    onlineOrderSequence: value.onlineOrderSequence || {},
    customProductCategories: normalizeCustomProductCategories(value.customProductCategories),
    userLastSeen: normalizeUserLastSeen(value.userLastSeen),
    deletedRecords: normalizeDeletedRecords(value.deletedRecords),
  };
}

function applyRemoteSettings(target, settings = {}) {
  target.businessSettings = settings.businessSettings || target.businessSettings;
  target.fixedExpenseTemplates = settings.fixedExpenseTemplates || target.fixedExpenseTemplates;
  target.userTabPermissions = settings.userTabPermissions || target.userTabPermissions;
  target.historicalMonthlyDetails = settings.historicalMonthlyDetails || target.historicalMonthlyDetails;
  target.historicalCategoryImportId = settings.historicalCategoryImportId || target.historicalCategoryImportId;
  target.historicalResultsImportId = settings.historicalResultsImportId || target.historicalResultsImportId;
  target.onlineResolvedMissingOrders = settings.onlineResolvedMissingOrders || target.onlineResolvedMissingOrders;
  target.onlineOrderSequence = settings.onlineOrderSequence || target.onlineOrderSequence;
  target.customProductCategories = normalizeCustomProductCategories(settings.customProductCategories || target.customProductCategories);
  target.userLastSeen = normalizeUserLastSeen(settings.userLastSeen || target.userLastSeen);
  target.deletedRecords = normalizeDeletedRecords(settings.deletedRecords || target.deletedRecords);
}

function remoteRecordRowsFromState(value = {}) {
  const rows = [{
    collection: SUPABASE_SETTINGS_COLLECTION,
    record_id: SUPABASE_SETTINGS_RECORD_ID,
    payload: remoteSettingsSnapshot(value),
    created_by: supabaseSession.user.id,
    updated_by: supabaseSession.user.id,
    updated_at: new Date().toISOString(),
    deleted_at: null,
  }];
  SUPABASE_RECORD_COLLECTIONS.forEach(({ collection, stateKey }) => {
    (value[stateKey] || []).forEach((record) => {
      if (!record?.id) return;
      rows.push({
        collection,
        record_id: record.id,
        payload: record,
        created_by: supabaseSession.user.id,
        updated_by: supabaseSession.user.id,
        updated_at: new Date().toISOString(),
        deleted_at: null,
      });
    });
    Object.entries(value.deletedRecords?.[collection] || {}).forEach(([recordId, deletedAt]) => {
      rows.push({
        collection,
        record_id: recordId,
        payload: { id: recordId, deletedAt, __deleted: true },
        created_by: supabaseSession.user.id,
        updated_by: supabaseSession.user.id,
        updated_at: deletedAt || new Date().toISOString(),
        deleted_at: deletedAt || new Date().toISOString(),
      });
    });
  });
  return rows;
}

function remoteRecordRowsFromPendingChanges(value = {}, pendingChanges = value.pendingRemoteChanges) {
  const pending = normalizePendingRemoteChanges(pendingChanges);
  const rows = [];
  if (pending.settings) {
    rows.push({
      collection: SUPABASE_SETTINGS_COLLECTION,
      record_id: SUPABASE_SETTINGS_RECORD_ID,
      payload: remoteSettingsSnapshot(value),
      created_by: supabaseSession.user.id,
      updated_by: supabaseSession.user.id,
      updated_at: new Date().toISOString(),
      deleted_at: null,
    });
  }
  SUPABASE_RECORD_COLLECTIONS.forEach(({ collection, stateKey }) => {
    const records = recordMapById(value[stateKey]);
    Object.entries(pending.records[collection] || {}).forEach(([recordId, action]) => {
      if (action === "delete") {
        const deletedAt = value.deletedRecords?.[collection]?.[recordId] || new Date().toISOString();
        rows.push({
          collection,
          record_id: recordId,
          payload: { id: recordId, deletedAt, __deleted: true },
          created_by: supabaseSession.user.id,
          updated_by: supabaseSession.user.id,
          updated_at: deletedAt,
          deleted_at: deletedAt,
        });
        return;
      }
      const record = records.get(recordId);
      if (!record) return;
      rows.push({
        collection,
        record_id: record.id,
        payload: record,
        created_by: supabaseSession.user.id,
        updated_by: supabaseSession.user.id,
        updated_at: new Date().toISOString(),
        deleted_at: null,
      });
    });
  });
  return rows;
}

function stateFromRemoteRecordRows(rows = []) {
  const next = emptyDataState();
  SUPABASE_RECORD_COLLECTIONS.forEach(({ stateKey }) => {
    next[stateKey] = [];
  });
  next.deletedRecords = normalizeDeletedRecords();
  rows.forEach((row) => {
    const payload = row.payload || {};
    if (row.collection === SUPABASE_SETTINGS_COLLECTION && row.record_id === SUPABASE_SETTINGS_RECORD_ID) {
      applyRemoteSettings(next, payload);
      return;
    }
    const config = SUPABASE_RECORD_COLLECTIONS.find((item) => item.collection === row.collection);
    if (!config) return;
    if (row.deleted_at || payload.__deleted) {
      next.deletedRecords[row.collection] = next.deletedRecords[row.collection] || {};
      next.deletedRecords[row.collection][row.record_id] = row.deleted_at || row.updated_at || payload.deletedAt || new Date().toISOString();
      return;
    }
    const record = { ...payload, id: payload.id || row.record_id };
    next[config.stateKey].push(record);
  });
  SUPABASE_RECORD_COLLECTIONS.forEach(({ collection, stateKey }) => {
    next[stateKey] = (next[stateKey] || []).filter((record) => shouldKeepMergedRecord(record, collection, next.deletedRecords));
  });
  return normalizeState(next);
}

async function loadRemoteRecordState() {
  try {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseClient
        .from("app_records")
        .select("collection,record_id,payload,updated_at,deleted_at")
        .order("updated_at", { ascending: true })
        .range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    if (!rows.length) return null;
    return stateFromRemoteRecordRows(rows);
  } catch (error) {
    console.warn("Supabase app_records read failed; app_config fallback enabled", error);
    lastRemoteSaveMessage = `No pude leer app_records: ${error.message || "error de Supabase"}`;
    return null;
  }
}

async function saveRemoteRecordRows(rows) {
  try {
    for (let index = 0; index < rows.length; index += 250) {
      const batch = rows.slice(index, index + 250);
      const { error } = await supabaseClient
        .from("app_records")
        .upsert(batch, { onConflict: "collection,record_id" });
      if (error) throw error;
    }
    return true;
  } catch (error) {
    console.warn("Supabase app_records save failed", error);
    return false;
  }
}

async function saveRemoteRecords(value) {
  return saveRemoteRecordRows(remoteRecordRowsFromState(value));
}

async function savePendingRemoteRecords(value, pendingChanges = value.pendingRemoteChanges) {
  const rows = remoteRecordRowsFromPendingChanges(value, pendingChanges);
  if (!rows.length) return true;
  return saveRemoteRecordRows(rows);
}

function stateCriticalScore(value = {}) {
  return Number(value.customers?.length || 0) * 10
    + Number(value.sales?.length || 0) * 20
    + Number(value.expenses?.length || 0) * 8
    + Number(value.purchases?.length || 0) * 6
    + Number(value.workshopOrders?.length || 0) * 6
    + Number(value.onlineOrders?.length || 0) * 6
    + Number(value.monthlyClosures?.length || 0) * 4;
}

function stateDataSummary(value = {}) {
  return {
    customers: value.customers?.length || 0,
    products: value.products?.length || 0,
    sales: value.sales?.length || 0,
    expenses: value.expenses?.length || 0,
    purchases: value.purchases?.length || 0,
    workshopOrders: value.workshopOrders?.length || 0,
    onlineOrders: value.onlineOrders?.length || 0,
    stockHistory: value.stockHistory?.length || 0,
    monthlyClosures: value.monthlyClosures?.length || 0,
  };
}

function stateSummaryText(value = {}) {
  const summary = stateDataSummary(value);
  return `productos ${summary.products}, clientes ${summary.customers}, ventas ${summary.sales}, online ${summary.onlineOrders}, gastos ${summary.expenses}`;
}

function hasOperationalRemoteData(value = {}) {
  return Number(value.customers?.length || 0) > 0
    || Number(value.sales?.length || 0) > 0
    || Number(value.onlineOrders?.length || 0) > 0
    || Number(value.expenses?.length || 0) > 0
    || Number(value.purchases?.length || 0) > 0
    || Number(value.workshopOrders?.length || 0) > 0
    || Number(value.stockHistory?.length || 0) > 0;
}

function hasLocalRepairData(value = {}) {
  return Number(value.customers?.length || 0) > 0
    || Number(value.sales?.length || 0) > 0
    || Number(value.expenses?.length || 0) > 0
    || Number(value.purchases?.length || 0) > 0
    || Number(value.workshopOrders?.length || 0) > 0
    || Number(value.onlineOrders?.length || 0) > 0
    || Number(value.stockHistory?.length || 0) > 0;
}

function isSuspiciousStateOverwrite(remoteState, localState) {
  if (!remoteState || !localState) return false;
  const remoteScore = stateCriticalScore(remoteState);
  const localScore = stateCriticalScore(localState);
  const remoteProducts = remoteState.products?.length || 0;
  const localProducts = localState.products?.length || 0;
  if (remoteScore >= 40 && localScore <= Math.max(8, remoteScore * 0.25)) return true;
  if (remoteProducts >= 80 && localProducts <= Math.max(20, remoteProducts * 0.25)) return true;
  return false;
}

async function fetchRemoteStateValue() {
  const { data, error } = await supabaseClient
    .from("app_config")
    .select("value")
    .eq("key", SUPABASE_STATE_KEY)
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw new Error(`app_config leer previo: ${error.message}`);
  return data?.value || null;
}

async function pruneRemoteStateBackups() {
  const { data, error } = await supabaseClient
    .from("app_config")
    .select("key,updated_at")
    .like("key", `${SUPABASE_BACKUP_KEY_PREFIX}%`)
    .order("updated_at", { ascending: false });
  if (error || !Array.isArray(data) || data.length <= SUPABASE_MAX_BACKUPS) return;
  const oldKeys = data.slice(SUPABASE_MAX_BACKUPS).map((item) => item.key);
  if (oldKeys.length) await supabaseClient.from("app_config").delete().in("key", oldKeys);
}

async function createRemoteStateBackup(remoteState, reason = "auto") {
  if (!remoteState) return true;
  const key = `${SUPABASE_BACKUP_KEY_PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const { error } = await supabaseClient.from("app_config").upsert({
    key,
    value: {
      ...remoteState,
      backupMeta: {
        reason,
        createdAt: new Date().toISOString(),
        summary: stateDataSummary(remoteState),
      },
    },
    updated_by: supabaseSession.user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
  if (error) {
    console.warn("Supabase backup failed", error);
    return false;
  }
  pruneRemoteStateBackups().catch((backupError) => console.warn("Supabase backup prune failed", backupError));
  return true;
}

async function listRemoteStateBackups() {
  if (!supabaseClient || !supabaseSession) return [];
  const { data, error } = await supabaseClient
    .from("app_config")
    .select("key,value,updated_at")
    .like("key", `${SUPABASE_BACKUP_KEY_PREFIX}%`)
    .order("updated_at", { ascending: false })
    .limit(SUPABASE_MAX_BACKUPS);
  if (error) throw new Error(`respaldos: ${error.message}`);
  return data || [];
}

function backupReasonLabel(reason = "") {
  if (reason === "before-save") return "Antes de guardar";
  if (reason === "before-restore") return "Antes de restaurar";
  return reason || "Automatico";
}

function backupDateLabel(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function backupSummaryLabel(summary = {}) {
  return [
    `${summary.sales || 0} ventas local`,
    `${summary.onlineOrders || 0} ventas online`,
    `${summary.products || 0} productos`,
    `${summary.customers || 0} clientes`,
  ].join(" · ");
}

function renderRemoteBackupsTable(backups = []) {
  const table = document.getElementById("remoteBackupsTable");
  if (!table) return;
  if (!backups.length) {
    table.innerHTML = `<tr><td colspan="4">Todavia no hay respaldos automaticos.</td></tr>`;
    return;
  }
  table.innerHTML = backups.map((backup) => {
    const meta = backup.value?.backupMeta || {};
    const createdAt = meta.createdAt || backup.updated_at;
    return `
      <tr>
        <td><strong>${htmlAttr(backupDateLabel(createdAt))}</strong></td>
        <td>${htmlAttr(backupReasonLabel(meta.reason))}</td>
        <td><small>${htmlAttr(backupSummaryLabel(meta.summary || stateDataSummary(backup.value || {})))}</small></td>
        <td class="row-actions"><button class="tiny-action danger-action" data-restore-remote-backup="${htmlAttr(backup.key)}" type="button">Restaurar</button></td>
      </tr>
    `;
  }).join("");
}

async function openRemoteBackupsModal() {
  const modal = document.getElementById("remoteBackupsModal");
  const table = document.getElementById("remoteBackupsTable");
  if (!modal || !table) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  table.innerHTML = `<tr><td colspan="4">Cargando respaldos...</td></tr>`;
  try {
    await pruneRemoteStateBackups();
    renderRemoteBackupsTable(await listRemoteStateBackups());
  } catch (error) {
    table.innerHTML = `<tr><td colspan="4">No pude leer respaldos: ${htmlAttr(error.message)}</td></tr>`;
  }
}

function closeRemoteBackupsModal() {
  const modal = document.getElementById("remoteBackupsModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function statePreparedForBackupRestore(backupState = {}, currentRemoteState = {}) {
  const next = normalizeState(backupState);
  delete next.backupMeta;
  const deletedRecords = normalizeDeletedRecords(next.deletedRecords);
  const deletedAt = new Date().toISOString();
  SUPABASE_RECORD_COLLECTIONS.forEach(({ collection, stateKey }) => {
    const restoredIds = new Set((next[stateKey] || []).map((record) => record.id).filter(Boolean));
    (currentRemoteState[stateKey] || []).forEach((record) => {
      if (!record?.id || restoredIds.has(record.id)) return;
      deletedRecords[collection] = deletedRecords[collection] || {};
      deletedRecords[collection][record.id] = deletedAt;
    });
  });
  next.deletedRecords = deletedRecords;
  next.localSyncPending = false;
  next.systemMigrationPending = false;
  next.offline = false;
  return normalizeState(next);
}

async function restoreRemoteBackup(backupKey) {
  if (!supabaseClient || !supabaseSession || !backupKey) return;
  renderAuthState("Restaurando respaldo...");
  try {
    const { data, error } = await supabaseClient
      .from("app_config")
      .select("value")
      .eq("key", backupKey)
      .maybeSingle();
    if (error || !data?.value) throw new Error(error?.message || "No encontre ese respaldo.");
    const previousRecordState = await loadRemoteRecordState();
    const previousLegacyState = await fetchRemoteStateValue();
    const currentRemoteState = previousRecordState && previousLegacyState
      ? mergeDataStates(previousLegacyState, previousRecordState)
      : previousRecordState || previousLegacyState || state;
    const backedUp = await createRemoteStateBackup(currentRemoteState, "before-restore");
    if (!backedUp) throw new Error("No pude crear el respaldo de seguridad previo a restaurar.");
    const restoredState = statePreparedForBackupRestore(data.value, currentRemoteState);
    const recordsSaved = await saveRemoteRecords(restoredState);
    if (!recordsSaved) throw new Error("No pude guardar los registros restaurados.");
    const { error: configError } = await supabaseClient.from("app_config").upsert({
      key: SUPABASE_STATE_KEY,
      value: restoredState,
      updated_by: supabaseSession.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    if (configError) throw new Error(configError.message);
    const uiSnapshot = localUiSnapshot();
    state = normalizeState(restoredState);
    restoreLocalUiSnapshot(uiSnapshot);
    clearPendingRemoteChanges(state);
    businessStateDirty = false;
    remoteSavePending = false;
    persistStateLocalOnly();
    lastDirtyComparisonState = cloneStateForDirtyComparison(state);
    await pruneRemoteStateBackups();
    closeRemoteBackupsModal();
    render();
    renderAuthState("Respaldo restaurado.");
    showActionToast("Respaldo restaurado.");
  } catch (error) {
    console.warn("Restore backup failed", error);
    renderAuthState(`No pude restaurar respaldo: ${error.message}`);
    showActionToast("No pude restaurar el respaldo.");
  }
}

function primaryPublishSummary(value = {}) {
  const summary = stateDataSummary(value);
  const lines = [
    `Productos: ${summary.products}`,
    `Clientes: ${summary.customers}`,
    `Ventas local: ${summary.sales}`,
    `Gastos: ${summary.expenses}`,
    `Compras: ${summary.purchases}`,
    `Stock: ${summary.stockHistory}`,
  ];
  if (MODULE_FLAGS.onlineSales) lines.splice(3, 0, `Ventas online: ${summary.onlineOrders}`);
  if (MODULE_FLAGS.workshop) lines.splice(lines.length - 1, 0, `Taller: ${summary.workshopOrders}`);
  return lines.join(" · ");
}

async function publishLocalStateAsPrimary() {
  if (REMOTE_SYNC_DISABLED && CLOUD_DATA_ENABLED) {
    showActionToast("La base nueva usa tablas separadas. No se sube estado completo.");
    renderAuthState("Modo Supabase granular activo.");
    return;
  }
  if (!isAdminProfile()) {
    showActionToast("Solo admin puede subir la base principal.");
    return;
  }
  if (!supabaseClient || !supabaseSession || !navigator.onLine) {
    showActionToast("Necesitás conexión y sesión iniciada.");
    return;
  }
  const snapshot = normalizeState(JSON.parse(JSON.stringify({
    ...state,
    localSyncPending: false,
    systemMigrationPending: false,
    offline: false,
  })));
  if (!hasLocalRepairData(snapshot)) {
    showActionToast("Esta PC no tiene datos operativos para subir.");
    renderAuthState("Esta PC no tiene ventas, clientes ni gastos para subir como base.");
    return;
  }
  logActivity("backup", "Subio base principal", primaryPublishSummary(state));
  snapshot.activityLog = normalizeState(state).activityLog;
  remoteSaveInProgress = true;
  renderAuthState("Subiendo esta PC como base principal...");
  try {
    const previousRecordState = await loadRemoteRecordState();
    const previousLegacyState = await fetchRemoteStateValue();
    const previousRemoteState = previousRecordState && previousLegacyState
      ? mergeDataStates(previousLegacyState, previousRecordState)
      : previousRecordState || previousLegacyState;
    if (previousRemoteState) {
      const backedUp = await createRemoteStateBackup(previousRemoteState, "before-primary-publish");
      if (!backedUp) throw new Error("No pude crear respaldo previo.");
    }
    const preparedState = statePreparedForBackupRestore(snapshot, previousRemoteState || {});
    const recordsSaved = await saveRemoteRecords(preparedState);
    if (!recordsSaved) throw new Error("No pude guardar registros separados.");
    const { error } = await supabaseClient.from("app_config").upsert({
      key: SUPABASE_STATE_KEY,
      value: preparedState,
      updated_by: supabaseSession.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    state = normalizeState(preparedState);
    clearPendingRemoteChanges(state);
    businessStateDirty = false;
    remoteSavePending = false;
    persistStateLocalOnly();
    lastDirtyComparisonState = cloneStateForDirtyComparison(state);
    await pruneRemoteStateBackups();
    persistStateLocalOnly();
    render();
    renderAuthState("Base principal subida a Supabase.");
    showActionToast("Base principal subida.");
  } catch (error) {
    console.warn("Primary publish failed", error);
    state.localSyncPending = true;
    persistStateLocalOnly();
    renderAuthState(`No pude subir base principal: ${error.message}`);
    showActionToast("No pude subir la base principal.");
  } finally {
    remoteSaveInProgress = false;
    renderConnection();
  }
}

function confirmPublishLocalStateAsPrimary() {
  const summary = primaryPublishSummary(state);
  openConfirmModal({
    title: "Subir esta PC como base principal",
    message: `Esto reemplaza la base online de Supabase con los datos de esta PC. Se crea respaldo previo. Revisá: ${summary}.`,
    confirmText: "Subir Base",
    danger: true,
    onConfirm: publishLocalStateAsPrimary,
  });
}

async function saveRemoteStateNow() {
  lastRemoteSaveMessage = "";
  if (!supabaseClient || !supabaseSession || !remoteHydrationDone || !navigator.onLine) {
    if (supabaseSession && remoteHydrationDone) markLocalSyncPending();
    return false;
  }
  const pendingChanges = normalizePendingRemoteChanges(state.pendingRemoteChanges);
  const hasQueuedRemoteChanges = hasPendingRemoteChanges(pendingChanges);
  const shouldSaveFullSnapshot = Boolean(state.systemMigrationPending && !hasQueuedRemoteChanges);
  if (!hasQueuedRemoteChanges && !shouldSaveFullSnapshot) {
    businessStateDirty = false;
    state.localSyncPending = false;
    persistStateLocalOnly();
    renderAuthState();
    return true;
  }
  if (remoteSaveInProgress) {
    remoteSavePending = true;
    return false;
  }
  remoteSaveInProgress = true;
  const saveRevision = localChangeRevision;
  renderAuthState();
  let localSnapshot = normalizeState(JSON.parse(JSON.stringify({ ...state, localSyncPending: false, systemMigrationPending: false, offline: false })));
  localSnapshot.sales = (localSnapshot.sales || []).map((sale) => ({ ...sale, syncStatus: "synced" }));
  const localChangedSnapshot = JSON.parse(JSON.stringify(localSnapshot));
  let previousRemoteState = null;
  let mergedSnapshot = null;
  try {
    const previousRecordState = await loadRemoteRecordState();
    const previousLegacyState = await fetchRemoteStateValue();
    previousRemoteState = previousRecordState && previousLegacyState
      ? mergeDataStates(previousLegacyState, previousRecordState)
      : previousRecordState || previousLegacyState;
    if (!hasLocalRepairData(localSnapshot) && previousRemoteState && !hasOperationalRemoteData(previousRemoteState)) {
      remoteSaveInProgress = false;
      state.localSyncPending = true;
      persistStateLocalOnly();
      lastRemoteSaveMessage = "Guardado frenado: no hay base operativa para subir.";
      renderAuthState(lastRemoteSaveMessage);
      showActionToast("Guardado frenado para proteger datos.");
      return false;
    }
    mergedSnapshot = previousRemoteState
      ? normalizeState(JSON.parse(JSON.stringify({
        ...mergeDataStates(previousRemoteState, localChangedSnapshot),
        localSyncPending: false,
        systemMigrationPending: false,
        offline: false,
      })))
      : localChangedSnapshot;
    mergedSnapshot = applyPendingRemoteChangesToState(mergedSnapshot, localChangedSnapshot, pendingChanges);
    mergedSnapshot.sales = (mergedSnapshot.sales || []).map((sale) => ({ ...sale, syncStatus: "synced" }));
    if (isSuspiciousStateOverwrite(previousRemoteState, mergedSnapshot)) {
      remoteSaveInProgress = false;
      state.localSyncPending = true;
      persistStateLocalOnly();
      const remoteSummary = stateDataSummary(previousRemoteState);
      const localSummary = stateDataSummary(mergedSnapshot);
      const message = `Guardado bloqueado: local ${localSummary.sales} ventas/${localSummary.customers} clientes, remoto ${remoteSummary.sales} ventas/${remoteSummary.customers} clientes.`;
      lastRemoteSaveMessage = message;
      renderAuthState(message);
      showActionToast("Guardado bloqueado para proteger datos.");
      return false;
    }
    const remoteSerialized = previousRemoteState ? JSON.stringify(previousRemoteState) : "";
    const nextSerialized = JSON.stringify(mergedSnapshot);
    if (previousRemoteState && remoteSerialized !== nextSerialized && (hasQueuedRemoteChanges || shouldSaveFullSnapshot)) {
      const backedUp = await createRemoteStateBackup(previousRemoteState, "before-save");
      if (!backedUp) {
        remoteSaveInProgress = false;
        state.localSyncPending = true;
        persistStateLocalOnly();
        lastRemoteSaveMessage = "Guardado frenado: no pude crear respaldo previo.";
        renderAuthState("Guardado frenado: no pude crear respaldo previo.");
        showActionToast("No se guardó: falló el respaldo previo.");
        return false;
      }
    }
    const recordsSaved = shouldSaveFullSnapshot
      ? await saveRemoteRecords(mergedSnapshot)
      : await savePendingRemoteRecords(localChangedSnapshot, pendingChanges);
    if (!recordsSaved && previousRemoteState) {
      remoteSaveInProgress = false;
      state.localSyncPending = true;
      persistStateLocalOnly();
      lastRemoteSaveMessage = "Guardado frenado: no pude guardar registros separados.";
      renderAuthState("Guardado frenado: no pude guardar registros separados.");
      showActionToast("No se guardó: falló el guardado por registros.");
      return false;
    }
  } catch (backupError) {
    remoteSaveInProgress = false;
    state.localSyncPending = true;
    persistStateLocalOnly();
    console.warn("Supabase pre-save guard failed", backupError);
    lastRemoteSaveMessage = "Guardado frenado: no pude verificar respaldo.";
    renderAuthState("Guardado frenado: no pude verificar respaldo.");
    showActionToast("No se guardó: no pude verificar respaldo.");
    return false;
  }
  remoteSaveInProgress = false;
  if (localChangeRevision !== saveRevision) {
    state.localSyncPending = hasPendingRemoteChanges(state.pendingRemoteChanges) || state.systemMigrationPending;
    businessStateDirty = state.localSyncPending;
    persistStateLocalOnly();
    lastDirtyComparisonState = cloneStateForDirtyComparison(state);
    if (remoteSavePending || state.localSyncPending) {
      remoteSavePending = false;
      await saveRemoteStateNow();
    }
    return true;
  }
  state = normalizeState({
    ...(mergedSnapshot || localSnapshot),
    localSyncPending: false,
    systemMigrationPending: false,
    offline: false,
  });
  clearPendingRemoteChanges(state);
  state.sales.forEach((sale) => {
    if (sale.syncStatus === "pending") sale.syncStatus = "synced";
  });
  businessStateDirty = false;
  persistStateLocalOnly();
  lastDirtyComparisonState = cloneStateForDirtyComparison(state);
  if (remoteSavePending) {
    remoteSavePending = false;
    await saveRemoteStateNow();
  }
  return true;
}

function queueRemoteStateSave() {
  if (REMOTE_SYNC_DISABLED) return;
  if (!supabaseClient || !supabaseSession || !remoteHydrationDone) return;
  if (!navigator.onLine) {
    markLocalSyncPending();
    return;
  }
  window.clearTimeout(queueRemoteStateSave.timer);
  queueRemoteStateSave.timer = window.setTimeout(() => {
    saveRemoteStateNow();
  }, 450);
}

async function syncWithSupabase({ preferRemote = false } = {}) {
  if (REMOTE_SYNC_DISABLED && CLOUD_DATA_ENABLED) {
    if (!cloudEnabledWithSession()) {
      renderAuthState("Ingresá para leer datos de Supabase.");
      return false;
    }
    try {
      await loadCloudData({ mode: "full", force: true });
      state.localSyncPending = false;
      state.systemMigrationPending = false;
      clearPendingRemoteChanges(state);
      state.sales = (state.sales || []).map((sale) => ({ ...sale, syncStatus: "synced" }));
      businessStateDirty = false;
      persistStateLocalOnly();
      render();
      renderAuthState("Datos actualizados desde Supabase.");
      return true;
    } catch (error) {
      console.warn("Cloud data refresh failed", error);
      renderAuthState(`No pude actualizar datos: ${error.message || "error de Supabase"}`);
      return false;
    }
  }
  if (!supabaseClient || !supabaseSession) {
    renderAuthState("Ingresá para sincronizar con Supabase.");
    return false;
  }
  try {
    let saved = true;
    if (preferRemote) {
      if (state.localSyncPending && hasLocalRepairData(state)) {
        saved = await saveRemoteStateNow();
        if (!saved) renderAuthState(lastRemoteSaveMessage || "Hay cambios locales pendientes. Revisá antes de sincronizar.");
      } else {
        if (state.localSyncPending && !hasLocalRepairData(state)) {
          state.localSyncPending = false;
          businessStateDirty = false;
          persistStateLocalOnly();
        }
        const loaded = await loadRemoteState();
        if (!loaded) {
          saved = false;
          lastRemoteSaveMessage = lastRemoteSaveMessage || "No pude descargar datos de Supabase. No se guardó nada desde este dispositivo.";
        }
        else if (state.systemMigrationPending) saved = await saveRemoteStateNow();
      }
    } else if (businessStateDirty || state.localSyncPending || state.systemMigrationPending) {
      saved = await saveRemoteStateNow();
    } else {
      const loaded = await loadRemoteState();
      if (!loaded) {
        saved = false;
        lastRemoteSaveMessage = lastRemoteSaveMessage || "No pude descargar datos de Supabase. No se guardó nada desde este dispositivo.";
      }
    }
    render();
    renderAuthState(saved ? "Sincronización lista." : (lastRemoteSaveMessage || "Sin conexión. Queda pendiente."));
    return saved;
  } catch (error) {
    console.warn("Supabase sync failed", error);
    markLocalSyncPending();
    renderAuthState("No se pudo sincronizar. La app sigue guardando localmente.");
    return false;
  }
}

function canAutoDownloadRemoteState() {
  return Boolean(
    !REMOTE_SYNC_DISABLED
    && supabaseClient
    && supabaseSession
    && remoteHydrationDone
    && navigator.onLine
    && !businessStateDirty
    && !state.localSyncPending
    && !state.systemMigrationPending
  );
}

async function autoDownloadRemoteState({ force = false } = {}) {
  if (!canAutoDownloadRemoteState() || autoRemoteRefreshInProgress) return false;
  const now = Date.now();
  if (!force && now - lastAutoRemoteRefreshAt < 15000) return false;
  autoRemoteRefreshInProgress = true;
  lastAutoRemoteRefreshAt = now;
  try {
    const loaded = await loadRemoteState();
    if (loaded) {
      state.offline = false;
      persistStateLocalOnly();
      render();
      renderAuthState("Datos actualizados.");
    }
    return loaded;
  } catch (error) {
    console.warn("Supabase auto refresh failed", error);
    return false;
  } finally {
    autoRemoteRefreshInProgress = false;
  }
}

async function handleAuthSubmit(event, mode = "signin") {
  event.preventDefault();
  const form = document.getElementById("authForm");
  const data = formDataObject(form);
  const email = String(data.email || "").trim();
  const password = String(data.password || "").trim();
  if (!email || !password) {
    showAuthError("Completá email y contraseña.");
    return;
  }
  try {
    initSupabaseClient();
    const result = mode === "signup"
      ? await supabaseClient.auth.signUp({ email, password })
      : await supabaseClient.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    supabaseSession = result.data.session;
    if (!supabaseSession) {
      renderAuthState("Revisá tu email para confirmar la cuenta. Despues queda pendiente de aprobacion.");
      return;
    }
    await completeSupabaseLogin({ openDashboard: true });
  } catch (error) {
    showAuthError(error.message || "No se pudo ingresar.");
  }
}

async function completeSupabaseLogin({ preferRemote = true, openDashboard = false } = {}) {
  try {
    await ensureSupabaseProfile();
    if (REMOTE_SYNC_DISABLED && CLOUD_DATA_ENABLED) {
      remoteHydrationDone = true;
      await loadCloudData({ mode: "initial", force: false });
      await refreshSupabaseProfiles({ renderAfter: false });
      render();
      renderAuthState("Supabase conectado.");
      applyNavigationPermissions();
      if (openDashboard) setView(canViewTab("dashboard") ? "dashboard" : firstAllowedView());
      else if (!canViewTab(state.activeView)) setView(firstAllowedView());
      return;
    }
    remoteHydrationDone = true;
    const hadLocalOperationalData = hasLocalRepairData(state);
    const synced = await syncWithSupabase({ preferRemote });
    await refreshSupabaseProfiles({ renderAfter: false });
    if (!synced && preferRemote) {
      if (hadLocalOperationalData) {
        remoteHydrationDone = true;
        markLocalSyncPending();
        render();
        renderAuthState("Supabase esta incompleto. Tocá Sincronizar desde esta PC para repararlo.");
        showActionToast("Datos locales protegidos. Sincronizá desde esta PC.");
        applyNavigationPermissions();
        if (openDashboard) setView(canViewTab("dashboard") ? "dashboard" : firstAllowedView());
        else if (!canViewTab(state.activeView)) setView(firstAllowedView());
        return;
      }
      remoteHydrationDone = false;
      const message = lastRemoteSaveMessage || "No pude descargar datos de Supabase.";
      await supabaseClient?.auth.signOut();
      supabaseSession = null;
      supabaseProfile = null;
      supabaseProfiles = [];
      renderAuthState(message);
      showAuthError(message);
      applyNavigationPermissions();
      return;
    }
    await updateCurrentUserLastSeen();
    renderAuthState("Sesión iniciada.");
    applyNavigationPermissions();
    if (openDashboard) setView(canViewTab("dashboard") ? "dashboard" : firstAllowedView());
    else if (!canViewTab(state.activeView)) setView(firstAllowedView());
  } catch (error) {
    console.warn("Supabase login setup failed", error);
    if (error.code === "PENDING_APPROVAL") {
      await supabaseClient?.auth.signOut();
      supabaseSession = null;
      supabaseProfile = null;
      supabaseProfiles = [];
      remoteHydrationDone = false;
      localStorage.removeItem(SUPABASE_PROFILE_CACHE_KEY);
      renderAuthState("Usuario pendiente de aprobacion.");
      applyNavigationPermissions();
      showAuthError("Tu usuario quedo pendiente. Un administrador tiene que aprobarlo desde Configuracion.");
      return;
    }
    const cachedProfile = cachedSupabaseProfile();
    if (supabaseSession && cachedProfile && stateCriticalScore(state) > 0) {
      supabaseProfile = cachedProfile;
      supabaseProfiles = [cachedProfile];
      remoteHydrationDone = true;
      markLocalSyncPending();
      render();
      renderAuthState("Sin conexión. Trabajando local.");
      if (openDashboard) setView(canViewTab("dashboard") ? "dashboard" : firstAllowedView());
      else if (!canViewTab(state.activeView)) setView(firstAllowedView());
      return;
    }
    showAuthError(`Entraste, pero Supabase respondió: ${error.message || "falta ajustar permisos"}.`);
  }
}

async function initializeSupabaseAuth() {
  if (REMOTE_SYNC_DISABLED && !CLOUD_DATA_ENABLED) {
    remoteHydrationDone = true;
    renderAuthState("Supabase desactivado");
    applyNavigationPermissions();
    renderConnection();
    return;
  }
  if (!initSupabaseClient()) {
    renderAuthState("No se pudo cargar Supabase. Revisá la conexión.");
    return;
  }
  const { data } = await supabaseClient.auth.getSession();
  supabaseSession = data.session;
  if (supabaseSession) await completeSupabaseLogin({ preferRemote: true });
  else renderAuthState();
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    supabaseSession = session;
    if (session) completeSupabaseLogin({ preferRemote: true });
    else {
      supabaseProfile = null;
      supabaseProfiles = [];
      remoteHydrationDone = false;
      renderAuthState();
      applyNavigationPermissions();
    }
  });
}

function setView(viewId) {
  const requestedView = viewId;
  const nextView = canViewTab(requestedView) ? requestedView : firstAllowedView();
  if (nextView === "reports" && state.activeView !== "reports") {
    state.reportScope = "total";
    state.reportPeriod = "month";
  }
  state.activeView = nextView;
  saveUiState();
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === nextView));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === nextView));
  const active = document.querySelector(`.nav-item[data-view="${nextView}"]`);
  const viewTitles = { settings: "Configuración" };
  document.getElementById("viewTitle").textContent = active ? active.textContent : (viewTitles[nextView] || "Resumen");
  const localSummary = document.getElementById("localSummary");
  const onlineSummary = document.getElementById("onlineSummary");
  if (localSummary) localSummary.hidden = nextView !== "pos" || !canViewFeature("hideLocalMonthlyTotal");
  if (onlineSummary) onlineSummary.hidden = !MODULE_FLAGS.onlineSales || nextView !== "online";
  render();
  ensureCloudDataForView(nextView);
  autoDownloadRemoteState({ force: true });
}

function openSettingsPasswordModal() {
  if (supabaseSession && !isAdminProfile()) return;
  if (!supabaseSession) {
    setView("settings");
    return;
  }
  const modal = document.getElementById("settingsPasswordModal");
  const form = document.getElementById("settingsPasswordForm");
  const error = document.getElementById("settingsPasswordError");
  if (!modal || !form) return;
  form.reset();
  if (error) error.classList.add("is-hidden");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  setTimeout(() => document.getElementById("settingsPasswordInput")?.focus(), 0);
}

function closeSettingsPasswordModal() {
  const modal = document.getElementById("settingsPasswordModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function submitSettingsPassword(form) {
  if (supabaseSession && !isAdminProfile()) return;
  const password = String(new FormData(form).get("password") || "").trim();
  const error = document.getElementById("settingsPasswordError");
  if (password !== "admin") {
    if (error) error.classList.remove("is-hidden");
    return;
  }
  closeSettingsPasswordModal();
  setView("settings");
}

function createEmptyCart() {
  return {
    id: uid("cart"),
    reference: "",
    customerId: "",
    createdAt: new Date().toISOString(),
    items: [],
    saleType: "minorista",
    paymentMethod: "",
    skipPaymentAdjustment: false,
    manualTotalEnabled: false,
    manualTotal: "",
    partialPaymentEnabled: false,
    paidAmount: "",
    syncStatus: state.offline ? "pending" : "synced",
  };
}

function addCart() {
  const cart = createEmptyCart();
  state.carts.push(cart);
  state.activeCartId = cart.id;
  saveUiState();
  render();
}

function openFreshCartAfterFinalize() {
  const reusableCart = state.carts.find((cart) =>
    !String(cart.reference || "").trim()
    && !cart.customerId
    && !cart.paymentMethod
    && !cart.items.length
  );
  if (reusableCart) {
    state.activeCartId = reusableCart.id;
    return;
  }
  const cart = createEmptyCart();
  state.carts.push(cart);
  state.activeCartId = cart.id;
}

function activeCart() {
  if (!state.carts.length) return null;
  const found = state.carts.find((cart) => cart.id === state.activeCartId);
  return found || state.carts[0];
}

function cartSubtotal(cart) {
  return cart.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

function normalizeSaleDebtPayments(payments = []) {
  return (Array.isArray(payments) ? payments : [])
    .map((payment) => ({
      id: payment.id || uid("debt-pay"),
      date: normalizeDateInput(payment.date) || todayIso(),
      amount: Math.max(0, Number(payment.amount || 0)),
      paymentMethod: payment.paymentMethod || "efectivo",
      notes: String(payment.notes || "").trim(),
      createdAt: payment.createdAt || new Date().toISOString(),
    }))
    .filter((payment) => payment.amount > 0);
}

function saleInitialPaidAmount(sale = {}) {
  if (sale.channel !== "local") return Number(sale.total || 0);
  const total = Number(sale.total || 0);
  const paid = sale.paidAmount == null ? total : Number(sale.paidAmount || 0);
  return Math.min(total, Math.max(0, paid));
}

function saleDebtPaidAmount(sale = {}) {
  return sum(normalizeSaleDebtPayments(sale.debtPayments), (payment) => payment.amount);
}

function saleTotalPaidAmount(sale = {}) {
  return Math.min(Number(sale.total || 0), saleInitialPaidAmount(sale) + saleDebtPaidAmount(sale));
}

function saleOutstandingDebt(sale = {}) {
  if (sale.channel !== "local") return 0;
  return Math.max(0, Number(sale.total || 0) - saleTotalPaidAmount(sale));
}

function cartPaidAmount(cart = {}) {
  const total = cartTotal(cart);
  if (!cart.partialPaymentEnabled) return total;
  if (cart.paidAmount === "" || cart.paidAmount == null) return 0;
  return Math.min(total, Math.max(0, Number(cart.paidAmount || 0)));
}

function cartOutstandingDebt(cart = {}) {
  return Math.max(0, cartTotal(cart) - cartPaidAmount(cart));
}

function saleTypeAdjustment(saleType) {
  return 0;
}

function saleTypeName(saleType) {
  return "Minorista";
}

function paymentAdjustment(methodId, saleType = "minorista") {
  return 0;
}

function workshopPaymentAdjustment(methodId) {
  return 0;
}

function paymentMethodName(methodId) {
  if (methodId === "web") return "Web";
  if (onlinePaymentMethods.includes(methodId)) return methodId;
  return state.paymentMethods.find((method) => method.id === methodId)?.name || "Sin Medio";
}

function paymentMethodOptionLabel(method, saleType = "minorista", skipPaymentAdjustment = false) {
  return method.name;
}

function businessSettings(target = typeof state === "undefined" ? null : state) {
  const settings = target?.businessSettings || {};
  const merged = {
    ...defaultBusinessSettings,
    ...settings,
    promoDiscounts: { ...defaultBusinessSettings.promoDiscounts, ...(settings.promoDiscounts || {}) },
  };
  merged.cloudInitialSalesDays = [0, 30, 60, 90, 180, 365].includes(Number(merged.cloudInitialSalesDays))
    ? Number(merged.cloudInitialSalesDays)
    : defaultBusinessSettings.cloudInitialSalesDays;
  merged.cloudInitialExpenseDays = [0, 30, 60, 90, 180, 365].includes(Number(merged.cloudInitialExpenseDays))
    ? Number(merged.cloudInitialExpenseDays)
    : defaultBusinessSettings.cloudInitialExpenseDays;
  return merged;
}

function catalogSettings(target = typeof state === "undefined" ? null : state) {
  const settings = target?.catalogSettings || {};
  return {
    ...defaultCatalogSettings,
    ...settings,
    businessName: String(settings.businessName || defaultCatalogSettings.businessName).trim() || BUSINESS_NAME,
    whatsappNumber: String(settings.whatsappNumber || defaultCatalogSettings.whatsappNumber).replace(/[^\d+]/g, ""),
    defaultWhatsappMessage: String(settings.defaultWhatsappMessage || defaultCatalogSettings.defaultWhatsappMessage).trim(),
    sizeAvailabilityMode: ["show-unavailable", "hide-unavailable"].includes(settings.sizeAvailabilityMode) ? settings.sizeAvailabilityMode : "show-unavailable",
    outOfStockProductMode: ["show", "hide"].includes(settings.outOfStockProductMode) ? settings.outOfStockProductMode : "show",
  };
}

function platformCommissionRate(platform, target = typeof state === "undefined" ? null : state) {
  const settings = businessSettings(target);
  if (platform === "mercadoPago") return Number(settings.mercadoPagoCommissionRate || 0) / 100;
  if (platform === "pagoNube") return Number(settings.pagoNubeCommissionRate || 0) / 100;
  return 0;
}

function onlineStoreName(store) {
  return store === "accesorios" ? "Canal 2" : "Canal 1";
}

function isOnlineInsumosOrder(order) {
  return (order?.store || "insumos") === "insumos";
}

function onlinePromoLabel(promo) {
  return onlinePromoOptions[promo]?.label || "Sin Promo";
}

function onlineCostRate(store, promo = "base") {
  const settings = businessSettings();
  const discount = settings.promoDiscounts[promo] ?? onlinePromoOptions[promo]?.discount ?? 0;
  const chargedRatio = Math.max(0.01, 1 - discount / 100);
  const configuredCost = store === "accesorios" ? settings.onlineCostAccesorios : settings.onlineCostInsumos;
  const baseCost = Number.isFinite(Number(configuredCost)) ? Number(configuredCost) : (onlineBaseCosts[store] || onlineBaseCosts.insumos) * 100;
  return (baseCost / 100) / chargedRatio;
}

function onlineEstimatedCost(total, store, promo) {
  return Math.round(Number(total || 0) * onlineCostRate(store, promo));
}

function onlineDiscountedSaleAmount(grossAmount = 0, discountAmount = 0) {
  return Math.max(0, Number(grossAmount || 0) - Math.max(0, Number(discountAmount || 0)));
}

function onlineGrossAmountFromRecord(record = {}) {
  return Number(record.grossAmount ?? record.subtotalAmount ?? record.saleGrossAmount ?? record.saleAmount ?? record.total ?? 0);
}

function onlineDiscountAmountFromRecord(record = {}) {
  return Math.max(0, Number(record.discountAmount ?? record.discount ?? 0));
}

function itemUnitCost(item) {
  const ownCost = Number(item.unitCost || 0);
  if (ownCost > 0) return ownCost;
  const product = state.products.find((entry) => entry.id === item.productId);
  const productCost = Number(product?.cost || 0);
  if (productCost > 0) return productCost;
  return Number(item.unitPrice || 0) * missingProductCostFallbackRate;
}

function saleMerchandiseCost(sale) {
  if (sale.channel === "online") {
    const hasGross = sale.grossAmount != null || sale.subtotalAmount != null;
    return Number(sale.onlineCost ?? onlineEstimatedCost(hasGross ? onlineGrossAmountFromRecord(sale) : sale.total, sale.onlineStore || sale.store || "insumos", hasGross ? "base" : sale.onlinePromo || "base"));
  }
  return sum(sale.items || [], (item) => {
    if (item.manual) return 0;
    return itemUnitCost(item) * Number(item.quantity || 1);
  });
}

function saleMissingCostItems(sale) {
  return 0;
}

function saleProductReportMeta(item = {}) {
  const product = item.productId ? state.products.find((entry) => entry.id === item.productId) : null;
  const code = String(product?.code || item.productCode || item.code || "").trim();
  const description = String(item.description || product?.description || "Producto").trim();
  const key = product?.id || item.productId || (code ? `code:${normalizeTextKey(code)}` : `name:${normalizeTextKey(description)}`);
  return {
    key,
    label: code ? `${code} - ${description}` : description,
  };
}

function onlineLineKey(lines = []) {
  return [...lines]
    .map((line) => `${String(line.category || "").trim().toLowerCase()}|${Number(line.quantity || 0)}`)
    .sort()
    .join(";");
}

function sameOnlineLines(left = [], right = []) {
  return onlineLineKey(left) === onlineLineKey(right);
}

function findOnlineOrderForSale(sale, orders = state.onlineOrders) {
  if (!sale || sale.channel !== "online") return null;
  return orders.find((order) => order.id === sale.onlineOrderId || order.saleId === sale.id) || orders.find((order) =>
    order.date === sale.date
    && order.store === (sale.onlineStore || sale.store || "insumos")
    && order.province === sale.province
    && Number(order.total || 0) === Number(sale.total || 0)
    && sameOnlineLines(order.lines, sale.onlineLines)
  ) || null;
}

function findSaleForOnlineOrder(order, sales = state.sales) {
  if (!order) return null;
  return sales.find((sale) => sale.id === order.saleId || sale.onlineOrderId === order.id) || sales.find((sale) =>
    sale.channel === "online"
    && sale.date === order.date
    && (sale.onlineStore || sale.store || "insumos") === order.store
    && sale.province === order.province
    && Number(sale.total || 0) === Number(order.total || 0)
    && sameOnlineLines(sale.onlineLines, order.lines)
  ) || null;
}

function linkOnlineRecords(target = state) {
  (target.onlineOrders || []).forEach((order) => {
    const sale = findSaleForOnlineOrder(order, target.sales || []);
    if (!sale) return;
    order.saleId = sale.id;
    sale.onlineOrderId = order.id;
    sale.orderNumber = order.orderNumber;
    sale.grossAmount = onlineGrossAmountFromRecord(order);
    sale.discountAmount = onlineDiscountAmountFromRecord(order);
    sale.total = onlineOrderSaleAmount(order);
    sale.shippingAmount = onlineOrderShippingAmount(order);
    sale.collectedTotal = onlineOrderCollectedTotal(order);
    order.paymentPlatform = canonicalOnlinePaymentPlatform(order.paymentPlatform, order.paymentMethod);
    sale.paymentPlatform = order.paymentPlatform;
  });
}

function formatCostRate(rate) {
  return Number(rate || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

function lastOnlineOrderEntry(source = state) {
  const orders = source.onlineOrders || [];
  if (orders.length) return orders[orders.length - 1];
  const sales = (source.sales || []).filter((sale) => sale.channel === "online");
  return sales[sales.length - 1] || null;
}

function lastOnlineDate() {
  return normalizeDateInput(lastOnlineOrderEntry()?.date) || todayIso();
}

function onlineOrderSequenceFromState(source = state) {
  const orderNumbers = [
    source.onlineOrderSequence?.orderNumber,
    source.onlineOrderSequence?.prefix && Number(source.onlineOrderSequence?.number)
      ? `${source.onlineOrderSequence.prefix}${String(source.onlineOrderSequence.number).padStart(Number(source.onlineOrderSequence.width || 1), "0")}`
      : "",
    ...(source.onlineOrders || []).map((order) => order.orderNumber),
    ...(source.sales || [])
      .filter((sale) => sale.channel === "online")
      .map((sale) => sale.orderNumber),
  ];
  const parsedOrders = orderNumbers
    .map((orderNumber) => String(orderNumber || "").trim().match(/^(.*?)(\d+)$/))
    .filter(Boolean)
    .map((match) => ({
      prefix: match[1],
      number: Number(match[2]),
      width: match[2].length,
    }));
  if (!parsedOrders.length) return null;
  const lastOrder = parsedOrders.reduce((best, current) => (current.number > best.number ? current : best), parsedOrders[0]);
  return {
    ...lastOrder,
    orderNumber: `${lastOrder.prefix}${String(lastOrder.number).padStart(lastOrder.width, "0")}`,
  };
}

function nextOnlineOrderNumber() {
  const lastEntry = lastOnlineOrderEntry(state);
  const lastOrder = parseOnlineOrderNumber(lastEntry?.orderNumber) || onlineOrderSequenceFromState(state);
  if (!lastOrder) return "TN-0001";
  return `${lastOrder.prefix}${String(lastOrder.number + 1).padStart(lastOrder.width, "0")}`;
}

function parseOnlineOrderNumber(value) {
  const match = String(value || "").trim().match(/^(.*?)(\d+)$/);
  if (!match) return null;
  return {
    prefix: match[1],
    number: Number(match[2]),
    width: match[2].length,
    label: `${match[1]}${match[2]}`,
  };
}

function onlineOrderNumberKey(value) {
  const parsed = parseOnlineOrderNumber(value);
  if (parsed) return `${normalizeTextKey(parsed.prefix)}::${parsed.number}`;
  return normalizeTextKey(value);
}

function onlineOrderArcaKey(order = {}) {
  const parsed = parseOnlineOrderNumber(order.orderNumber);
  if (parsed && Number.isFinite(parsed.number)) return `number::${parsed.number}`;
  return onlineOrderNumberKey(order.orderNumber) || `id:${order.id || ""}`;
}

function normalizeArcaDoneOrders(records = [], onlineOrders = []) {
  const done = new Map();
  const addDone = (entry = {}) => {
    const key = entry.key || entry.id || onlineOrderArcaKey(entry);
    if (!key) return;
    const doneAt = entry.doneAt || entry.afipDoneAt || entry.updatedAt || entry.createdAt || new Date().toISOString();
    const current = done.get(key);
    if (current && Date.parse(current.doneAt || "") >= Date.parse(doneAt || "")) return;
    done.set(key, {
      id: key,
      key,
      orderNumber: entry.orderNumber || current?.orderNumber || "",
      date: entry.date || current?.date || "",
      province: entry.province || current?.province || "",
      doneAt,
      createdAt: current?.createdAt || entry.createdAt || doneAt,
      updatedAt: doneAt,
    });
  };
  (Array.isArray(records) ? records : Object.values(records || {})).forEach(addDone);
  (onlineOrders || []).forEach((order) => {
    if (!isOnlineInsumosOrder(order) || !order.afipDone) return;
    addDone(order);
  });
  return [...done.values()].sort((a, b) =>
    String(b.doneAt || "").localeCompare(String(a.doneAt || ""))
    || String(b.orderNumber || "").localeCompare(String(a.orderNumber || ""), "es", { numeric: true, sensitivity: "base" })
  );
}

function arcaDoneKeySet(target = state) {
  return new Set(normalizeArcaDoneOrders(target.arcaDoneOrders, target.onlineOrders).map((entry) => entry.key));
}

function rememberArcaDoneOrder(order = {}, doneAt = new Date().toISOString()) {
  if (!isOnlineInsumosOrder(order)) return;
  const key = onlineOrderArcaKey(order);
  if (!key) return;
  state.arcaDoneOrders = normalizeArcaDoneOrders([
    ...(state.arcaDoneOrders || []),
    {
      id: key,
      key,
      orderNumber: order.orderNumber || "",
      date: order.date || "",
      province: order.province || "",
      doneAt,
      createdAt: doneAt,
      updatedAt: doneAt,
    },
  ], state.onlineOrders);
}

function syncOnlineArcaFlagsByOrderNumber(target = state) {
  const doneByOrder = new Map();
  target.arcaDoneOrders = normalizeArcaDoneOrders(target.arcaDoneOrders, target.onlineOrders);
  (target.arcaDoneOrders || []).forEach((entry) => {
    if (!entry?.key) return;
    doneByOrder.set(entry.key, { afipDoneAt: entry.doneAt || entry.updatedAt || entry.createdAt || new Date().toISOString() });
  });
  (target.onlineOrders || []).forEach((order) => {
    if (!isOnlineInsumosOrder(order)) return;
    const key = onlineOrderArcaKey(order);
    if (!key || !order.afipDone) return;
    const current = doneByOrder.get(key);
    const doneAt = order.afipDoneAt || order.updatedAt || order.createdAt || "";
    if (!current || Date.parse(doneAt || "") > Date.parse(current.afipDoneAt || "")) {
      doneByOrder.set(key, { afipDoneAt: doneAt });
    }
  });
  (target.onlineOrders || []).forEach((order) => {
    if (!isOnlineInsumosOrder(order)) return;
    const key = onlineOrderArcaKey(order);
    const done = doneByOrder.get(key);
    if (!done) return;
    order.afipDone = true;
    order.afipDoneAt = order.afipDoneAt || done.afipDoneAt || order.updatedAt || order.createdAt || new Date().toISOString();
  });
}

function rememberOnlineOrderNumber(value) {
  const parsed = parseOnlineOrderNumber(value);
  if (!parsed) return;
  const current = onlineOrderSequenceFromState(state);
  if (current && current.number > parsed.number) return;
  state.onlineOrderSequence = {
    prefix: parsed.prefix,
    number: parsed.number,
    width: parsed.width,
    orderNumber: `${parsed.prefix}${String(parsed.number).padStart(parsed.width, "0")}`,
  };
}

function onlineMissingOrderKey(prefix, number) {
  return `${prefix}::${number}`;
}

function normalizedOnlineResolvedMissingOrders(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const parsed = parseOnlineOrderNumber(row.orderNumber || row.label || `${row.prefix || ""}${row.number || ""}`);
      if (!parsed) return null;
      return {
        prefix: parsed.prefix,
        number: parsed.number,
        width: parsed.width,
        orderNumber: `${parsed.prefix}${String(parsed.number).padStart(parsed.width, "0")}`,
        resolvedAt: row.resolvedAt || new Date().toISOString(),
      };
    })
    .filter(Boolean);
}

function onlineResolvedMissingKeys() {
  return new Set((state.onlineResolvedMissingOrders || []).map((row) => onlineMissingOrderKey(row.prefix, row.number)));
}

function missingOnlineOrderNumbers() {
  const groups = new Map();
  state.onlineOrders.filter(isOnlineInsumosOrder).forEach((order) => {
    const parsed = parseOnlineOrderNumber(order.orderNumber);
    if (!parsed || !Number.isFinite(parsed.number)) return;
    if (!groups.has(parsed.prefix)) groups.set(parsed.prefix, { width: parsed.width, numbers: new Set() });
    const group = groups.get(parsed.prefix);
    group.width = Math.max(group.width, parsed.width);
    group.numbers.add(parsed.number);
  });
  const resolved = onlineResolvedMissingKeys();
  const missing = [];
  groups.forEach((group, prefix) => {
    const numbers = [...group.numbers].sort((a, b) => a - b);
    for (let index = 1; index < numbers.length; index += 1) {
      const previous = numbers[index - 1];
      const current = numbers[index];
      for (let number = previous + 1; number < current; number += 1) {
        const key = onlineMissingOrderKey(prefix, number);
        if (resolved.has(key)) continue;
        missing.push({
          key,
          prefix,
          number,
          width: group.width,
          orderNumber: `${prefix}${String(number).padStart(group.width, "0")}`,
          between: `${prefix}${String(previous).padStart(group.width, "0")} y ${prefix}${String(current).padStart(group.width, "0")}`,
        });
      }
    }
  });
  return missing.sort((a, b) => a.prefix.localeCompare(b.prefix, "es", { sensitivity: "base" }) || a.number - b.number);
}

function onlinePaymentOptions(selected = "") {
  return [`<option value="" ${selected ? "" : "selected"}>Medio de Pago</option>`]
    .concat(onlinePaymentMethods.map((method) => `<option value="${htmlAttr(method)}" ${selected === method ? "selected" : ""}>${method}</option>`))
    .join("");
}

function canonicalOnlinePaymentPlatform(platform = "", paymentMethod = "") {
  const method = String(paymentMethod || "").toLowerCase();
  if (method === "transferencia") return "transfer";
  if (method === "mercado pago") return "mercadoPago";
  const value = String(platform || "").trim();
  if (onlinePaymentPlatforms[value]) return value;
  return "mercadoPago";
}

function onlinePaymentPlatformLabel(platform = "") {
  return onlinePaymentPlatforms[canonicalOnlinePaymentPlatform(platform)]?.label || "Mercado Pago";
}

function onlinePaymentPlatformOptions(selected = "") {
  const value = String(selected || "").trim();
  return [`<option value="" ${value ? "" : "selected"}>Plataforma</option>`]
    .concat(Object.entries(onlinePaymentPlatforms)
    .map(([id, platform]) => `<option value="${id}" ${id === value ? "selected" : ""}>${platform.label}</option>`)
    )
    .join("");
}

function onlineSaleCollectedTotal(sale) {
  return Number(sale.collectedTotal ?? (Number(sale.total || 0) + Number(sale.shippingAmount || 0)));
}

function tiendaNubeCommissionAmount(sale) {
  const platform = onlinePaymentPlatforms[canonicalOnlinePaymentPlatform(sale.paymentPlatform, sale.paymentMethod)];
  if (platform?.skipTiendaNubeCommission) return 0;
  return Math.round(onlineSaleCollectedTotal(sale) * (Number(businessSettings().tiendaNubeCommissionRate || 0) / 100));
}

function platformCommissionAmount(sale) {
  const platform = canonicalOnlinePaymentPlatform(sale.paymentPlatform, sale.paymentMethod);
  return Math.round(onlineSaleCollectedTotal(sale) * platformCommissionRate(platform));
}

function htmlAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function showActionToast(message) {
  const toast = document.getElementById("actionToast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("open");
  window.clearTimeout(showActionToast.timer);
  showActionToast.timer = window.setTimeout(() => {
    toast.classList.remove("open");
  }, 2600);
}

function profileDisplayName(profile) {
  return String(profile?.name || profile?.email || "").trim();
}

function profileEmailKey(profileOrEmail) {
  const value = typeof profileOrEmail === "string" ? profileOrEmail : profileDisplayName(profileOrEmail);
  return String(value || "").trim().toLowerCase();
}

function currentActivityUser() {
  const email = profileDisplayName(supabaseProfile) || supabaseSession?.user?.email || "";
  return {
    user: email || "Sin usuario",
    email: profileEmailKey(email),
  };
}

function activityTypeLabel(type = "general") {
  const labels = {
    product: "Productos",
    stock: "Stock",
    sale: "Ventas",
    online: "Ventas Online",
    customer: "Clientes",
    workshop: "Taller",
    expense: "Gastos",
    settings: "Configuracion",
    users: "Usuarios",
    backup: "Respaldo",
    cash: "Caja",
    closure: "Cierres",
    general: "General",
  };
  return labels[type] || type;
}

function logActivity(type, action, detail = "") {
  if (!state) return;
  const actor = currentActivityUser();
  state.activityLog = [
    {
      id: uid("activity"),
      at: new Date().toISOString(),
      type,
      action,
      detail,
      user: actor.user,
      email: actor.email,
    },
    ...(state.activityLog || []),
  ].slice(0, ACTIVITY_LOG_LIMIT);
  state.activityLogPage = 1;
}

function activityLogUsers() {
  const users = new Map();
  (state.activityLog || []).forEach((entry) => {
    const key = entry.email || profileEmailKey(entry.user);
    if (key) users.set(key, entry.user || key);
  });
  return [...users.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), "es", { sensitivity: "base" }));
}

function activityLogTypeOptions(selected = "all") {
  const types = [...new Set((state.activityLog || []).map((entry) => entry.type || "general"))]
    .sort((a, b) => activityTypeLabel(a).localeCompare(activityTypeLabel(b), "es", { sensitivity: "base" }));
  return [
    `<option value="all">Todos los tipos</option>`,
    ...types.map((type) => `<option value="${htmlAttr(type)}" ${type === selected ? "selected" : ""}>${htmlAttr(activityTypeLabel(type))}</option>`),
  ].join("");
}

function renderActivityLogFilters() {
  const userFilter = document.getElementById("activityUserFilter");
  const typeFilter = document.getElementById("activityTypeFilter");
  const searchFilter = document.getElementById("activitySearchFilter");
  const filters = state.activityLogFilters || { user: "all", type: "all", query: "" };
  if (userFilter) {
    userFilter.innerHTML = [
      `<option value="all">Todos los usuarios</option>`,
      ...activityLogUsers().map(([email, user]) => `<option value="${htmlAttr(email)}" ${email === filters.user ? "selected" : ""}>${htmlAttr(user)}</option>`),
    ].join("");
  }
  if (typeFilter) typeFilter.innerHTML = activityLogTypeOptions(filters.type || "all");
  if (searchFilter) searchFilter.value = filters.query || "";
}

function filteredActivityLog() {
  const filters = state.activityLogFilters || { user: "all", type: "all", query: "" };
  const query = String(filters.query || "").trim().toLowerCase();
  return (state.activityLog || [])
    .filter((entry) => filters.user === "all" || (entry.email || profileEmailKey(entry.user)) === filters.user)
    .filter((entry) => filters.type === "all" || entry.type === filters.type)
    .filter((entry) => !query || [entry.user, activityTypeLabel(entry.type), entry.action, entry.detail].some((value) => String(value || "").toLowerCase().includes(query)))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

function formatActivityDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function renderActivityLogTable() {
  renderActivityLogFilters();
  const table = document.getElementById("activityLogTable");
  const pagination = document.getElementById("activityLogPagination");
  if (!table) return;
  const rows = filteredActivityLog();
  const totalPages = Math.max(1, Math.ceil(rows.length / ACTIVITY_LOG_PAGE_SIZE));
  const current = Math.min(Math.max(1, Number(state.activityLogPage || 1)), totalPages);
  const start = (current - 1) * ACTIVITY_LOG_PAGE_SIZE;
  const pageRows = rows.slice(start, start + ACTIVITY_LOG_PAGE_SIZE);
  state.activityLogPage = current;
  table.innerHTML = pageRows.map((entry) => `
    <tr>
      <td>${formatActivityDate(entry.at)}</td>
      <td><strong>${htmlAttr(entry.user || "Sin usuario")}</strong></td>
      <td>${htmlAttr(activityTypeLabel(entry.type))}</td>
      <td>${htmlAttr(entry.action || "-")}</td>
      <td>${htmlAttr(entry.detail || "-")}</td>
    </tr>
  `).join("") || `<tr><td colspan="5">No hay movimientos para esos filtros.</td></tr>`;
  if (pagination) pagination.innerHTML = activityLogPaginationControls(current, totalPages, rows.length);
}

function openActivityLogModal() {
  renderActivityLogTable();
  const modal = document.getElementById("activityLogModal");
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeActivityLogModal() {
  const modal = document.getElementById("activityLogModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function normalizeTabList(tabs, role = "local") {
  const fallback = defaultTabsByRole[role] || defaultTabsByRole.local;
  const source = Array.isArray(tabs) && tabs.length ? tabs : fallback;
  const unique = [...new Set(source)].filter((tab) => allPermissionTabIds.includes(tab));
  return unique.length ? unique : ["dashboard"];
}

function normalizeUserTabPermissions(value = {}) {
  return Object.entries(value || {}).reduce((acc, [email, config]) => {
    const key = profileEmailKey(email);
    if (!key) return acc;
    const role = String(config?.role || "local").trim() || "local";
    const hiddenFeatures = Array.isArray(config?.hiddenFeatures)
      ? config.hiddenFeatures.filter((feature) => allPermissionFeatureIds.includes(feature))
      : [];
    acc[key] = {
      tabs: normalizeTabList(config?.tabs, role),
      hiddenFeatures,
    };
    return acc;
  }, {});
}

function isAdminProfile(profile = supabaseProfile) {
  if (!supabaseSession) return true;
  return profile?.role === "admin";
}

function isFullAccessRole(role) {
  return role === "admin" || role === "dueno";
}

function tabsForProfile(profile = supabaseProfile) {
  if (isAdminProfile(profile) || isFullAccessRole(profile?.role)) return allPermissionTabIds;
  const emailKey = profileEmailKey(profile);
  const configured = state.userTabPermissions?.[emailKey]?.tabs;
  return normalizeTabList(configured, profile?.role || "local");
}

function canViewTab(viewId) {
  if (!isModuleViewEnabled(viewId)) return false;
  if (viewId === "settings") return isAdminProfile();
  if (!supabaseSession || !supabaseProfile) return true;
  return tabsForProfile().includes(viewId);
}

function canViewFeature(featureId, profile = supabaseProfile) {
  if (!allPermissionFeatureIds.includes(featureId) || isAdminProfile(profile) || isFullAccessRole(profile?.role)) return true;
  if (!supabaseSession || !profile) return true;
  const emailKey = profileEmailKey(profile);
  const hiddenFeatures = state.userTabPermissions?.[emailKey]?.hiddenFeatures || [];
  return !hiddenFeatures.includes(featureId);
}

function firstAllowedView() {
  return tabsForProfile()[0] || "dashboard";
}

function isModuleViewEnabled(viewId) {
  if (viewId === "online") return MODULE_FLAGS.onlineSales;
  if (viewId === "workshop") return MODULE_FLAGS.workshop;
  return true;
}

function applyNavigationPermissions() {
  const admin = isAdminProfile();
  const allowed = new Set(admin ? allPermissionTabIds : tabsForProfile());
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.hidden = !isModuleViewEnabled(item.dataset.view) || (supabaseSession && !allowed.has(item.dataset.view));
  });
  document.querySelectorAll("[data-module]").forEach((item) => {
    item.hidden = !MODULE_FLAGS[item.dataset.module];
  });
  const settingsButton = document.getElementById("openSettingsButton");
  if (settingsButton) settingsButton.hidden = supabaseSession && !admin;
}

function normalizeTextKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeProductDescription(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text
    .toLocaleLowerCase("es-AR")
    .replace(/(^|[\s\-/\.])([a-záéíóúñü])/giu, (_, prefix, letter) => `${prefix}${letter.toLocaleUpperCase("es-AR")}`);
}

function normalizeCustomerName(value) {
  return normalizeProductDescription(value);
}

function normalizeCustomerDni(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 11);
}

function formatCustomerDni(value) {
  const digits = normalizeCustomerDni(value);
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatDniInput(input) {
  if (!input) return;
  input.value = formatCustomerDni(input.value);
}

function parseMoneyInput(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const amount = Number(normalized || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function formatMoneyInputValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const amount = parseMoneyInput(raw);
  if (!Number.isFinite(amount)) return "";
  return Math.round(amount).toLocaleString("es-AR");
}

function formatMoneyInput(input) {
  if (!input) return;
  const formatted = formatMoneyInputValue(input.value);
  input.value = formatted;
  try {
    input.setSelectionRange(input.value.length, input.value.length);
  } catch {
    // Some readonly inputs do not expose selection ranges.
  }
}

function prepareMoneyInput(input) {
  if (!input) return;
  if (input.type === "number") input.type = "text";
  input.inputMode = "numeric";
  input.autocomplete = "one-time-code";
  input.dataset.moneyInput = "true";
  formatMoneyInput(input);
}

function formatAllMoneyInputs(root = document) {
  root.querySelectorAll?.(".money-field input").forEach(prepareMoneyInput);
}

function formDataObject(form) {
  const data = Object.fromEntries(new FormData(form));
  form?.querySelectorAll?.(".money-field input[name]").forEach((input) => {
    const raw = String(input.value || "").trim();
    data[input.name] = raw ? parseMoneyInput(raw) : "";
  });
  return data;
}

function normalizeProvince(value) {
  const raw = String(value || "").trim();
  const key = normalizeTextKey(raw).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!key) return "";
  if (["caba", "capital federal", "ciudad autonoma de buenos aires"].includes(key)) return "Buenos Aires";
  return argentineProvinces.find((province) => normalizeTextKey(province).normalize("NFD").replace(/[\u0300-\u036f]/g, "") === key) || raw;
}

function repairMojibakeText(value) {
  if (typeof value !== "string") return value;
  const replacements = [
    ["\u00c3\u0192\u00c2\u00a1", "á"], ["\u00c3\u0192\u00c2\u00a9", "é"], ["\u00c3\u0192\u00c2\u00ad", "í"], ["\u00c3\u0192\u00c2\u00b3", "ó"], ["\u00c3\u0192\u00c2\u00ba", "ú"], ["\u00c3\u0192\u00c2\u00b1", "ñ"],
    ["\u00c3\u00a1", "á"], ["\u00c3\u00a9", "é"], ["\u00c3\u00ad", "í"], ["\u00c3\u00b3", "ó"], ["\u00c3\u00ba", "ú"], ["\u00c3\u00b1", "ñ"],
    ["\u00c3\u0081", "Á"], ["\u00c3\u0089", "É"], ["\u00c3\u008d", "Í"], ["\u00c3\u0093", "Ó"], ["\u00c3\u009a", "Ú"], ["\u00c3\u0091", "Ñ"],
    ["\u00c2\u00b7", "·"], ["\u00c3\u0097", "×"],
  ];
  let repaired = value;
  for (let index = 0; index < 3; index += 1) {
    const before = repaired;
    replacements.forEach(([bad, good]) => {
      repaired = repaired.split(bad).join(good);
    });
    if (before === repaired) break;
  }
  return repaired;
}

function repairPersistedText(value) {
  if (typeof value === "string") return repairMojibakeText(value);
  if (Array.isArray(value)) return value.map(repairPersistedText);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, repairPersistedText(item)]));
  }
  return value;
}

function findCustomerByName(name) {
  const key = normalizeTextKey(name);
  if (!key) return null;
  const matches = state.customers.filter((customer) => normalizeTextKey(customer.name) === key);
  return matches.length === 1 ? matches[0] : null;
}

function findCustomerByDni(dni, { excludeId = "" } = {}) {
  const cleanDni = normalizeCustomerDni(dni);
  if (!cleanDni) return null;
  return state.customers.find((customer) => customer.id !== excludeId && normalizeCustomerDni(customer.dni) === cleanDni) || null;
}

function duplicateCustomerGroup(customer) {
  const key = normalizeTextKey(customer?.name);
  if (!key) return [];
  return state.customers
    .filter((item) => normalizeTextKey(item.name) === key)
    .sort((a, b) => idTimestamp(a.id) - idTimestamp(b.id) || String(a.id).localeCompare(String(b.id)));
}

function customerDuplicateLabel(customer) {
  const group = duplicateCustomerGroup(customer);
  if (group.length <= 1) return "";
  const index = Math.max(0, group.findIndex((item) => item.id === customer.id));
  return `Ficha ${index + 1}/${group.length}`;
}

function customerMetaLabel(customer, { includeFallbackPhone = false } = {}) {
  const duplicate = customerDuplicateLabel(customer);
  const dni = customer.dni ? `DNI ${formatCustomerDni(customer.dni)}` : "";
  const phone = customer.phone || (includeFallbackPhone ? "Sin Teléfono" : "");
  return [duplicate, dni, phone, customer.province].filter(Boolean).join(" - ");
}

function customerDisplayLabel(customer) {
  const dni = customer.dni ? `DNI ${formatCustomerDni(customer.dni)}` : "";
  return [customer.name, customerDuplicateLabel(customer), dni, customer.phone, customer.province].filter(Boolean).join(" - ");
}

function customerSuggestionDetail(customer) {
  const dni = customer.dni ? `DNI ${formatCustomerDni(customer.dni)}` : "";
  const phone = customer.phone || "Sin Teléfono";
  const province = customer.province || "Sin Provincia";
  const notes = String(customer.notes || "").trim();
  return {
    meta: [dni, phone, province].filter(Boolean).join(" · "),
    note: notes ? `Nota: ${notes}` : "",
  };
}

function findCustomerByDetails(name, data = {}) {
  const key = normalizeTextKey(name);
  const dni = normalizeCustomerDni(data.dni);
  if (dni) {
    const dniMatch = findCustomerByDni(dni);
    if (dniMatch) return dniMatch;
  }
  if (!key) return null;
  const matches = state.customers.filter((customer) => normalizeTextKey(customer.name) === key);
  if (!matches.length) return null;
  const phoneKey = normalizeTextKey(data.phone);
  if (phoneKey) {
    const phoneMatch = matches.find((customer) => normalizeTextKey(customer.phone) === phoneKey);
    if (phoneMatch) return phoneMatch;
  }
  const province = normalizeProvince(data.province);
  if (province) {
    const provinceMatches = matches.filter((customer) => normalizeProvince(customer.province) === province);
    if (provinceMatches.length === 1) return provinceMatches[0];
  }
  return matches.length === 1 ? matches[0] : null;
}

function assignExactCustomerToCart(cart, name) {
  const customer = findCustomerByDni(name) || findCustomerByDetails(name);
  if (!cart || !customer) return null;
  cart.customerId = customer.id;
  cart.reference = customer.name;
  return customer;
}

function assignCustomerDniToOnlineForm(form, dni) {
  const cleanDni = normalizeCustomerDni(dni);
  if (!form || !cleanDni) return null;
  const customer = findCustomerByDni(cleanDni);
  if (!customer) return null;
  const dniInput = document.getElementById("onlineCustomerDni");
  const nameInput = document.getElementById("onlineClientLookup");
  const provinceInput = document.getElementById("onlineProvince");
  if (dniInput) dniInput.value = formatCustomerDni(customer.dni || cleanDni);
  if (nameInput) nameInput.value = customer.name || "";
  if (provinceInput && customer.province) provinceInput.value = customer.province;
  form.elements.customerId.value = customer.id;
  form.dataset.customerReviewedName = customer.name || "";
  return customer;
}

function assignExactCustomerToOnlineForm(form, name, data = {}) {
  const customer = findCustomerByDetails(name, data);
  const nameInput = document.getElementById("onlineClientLookup");
  if (!form || !customer) return null;
  const dniInput = document.getElementById("onlineCustomerDni");
  if (dniInput) dniInput.value = formatCustomerDni(customer.dni || "");
  if (nameInput) nameInput.value = customer.name;
  form.elements.customerId.value = customer.id;
  const provinceInput = document.getElementById("onlineProvince");
  if (customer.province && provinceInput) provinceInput.value = customer.province;
  form.dataset.customerReviewedName = customer.name;
  return customer;
}

function findOrCreateCustomer(name, data = {}) {
  const cleanName = normalizeCustomerName(name);
  const cleanDni = normalizeCustomerDni(data.dni);
  const dniMatch = cleanDni ? findCustomerByDni(cleanDni) : null;
  if (dniMatch) {
    if (cleanName && !dniMatch.name) dniMatch.name = cleanName;
    if (data.phone && !dniMatch.phone) dniMatch.phone = data.phone;
    if (data.province && !dniMatch.province) dniMatch.province = normalizeProvince(data.province);
    return dniMatch;
  }
  if (!cleanName) return null;
  const found = findCustomerByDetails(cleanName, data);
  if (found) {
    if (cleanDni && !found.dni) found.dni = cleanDni;
    if (data.phone && !found.phone) found.phone = data.phone;
    if (data.province && !found.province) found.province = normalizeProvince(data.province);
    return found;
  }
  const customer = {
    id: uid("customer"),
    name: cleanName,
    dni: cleanDni,
    phone: data.phone || "",
    province: normalizeProvince(data.province),
    notes: data.notes || "",
  };
  state.customers.push(customer);
  return customer;
}

function customerProvinceOptions(selected = "") {
  const selectedProvince = normalizeProvince(selected);
  return [`<option value="" ${selectedProvince ? "" : "selected"}>Provincia</option>`]
    .concat(argentineProvinces.map((province) => `<option value="${htmlAttr(province)}" ${province === selectedProvince ? "selected" : ""}>${province}</option>`))
    .join("");
}

function customerOptions() {
  return state.customers
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((customer) => `<option value="${htmlAttr(customer.name)}" label="${htmlAttr(customerDisplayLabel(customer))}"></option>`)
    .join("");
}

function customerInlineSuggestionRows(query, { dniOnly = false, nameOrDniOnly = false } = {}) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) return [];
  if (dniOnly) {
    const dniQuery = normalizeCustomerDni(cleanQuery);
    if (!dniQuery) return [];
    return state.customers
      .filter((customer) => normalizeCustomerDni(customer.dni).includes(dniQuery))
      .sort((a, b) => {
        const left = normalizeCustomerDni(a.dni);
        const right = normalizeCustomerDni(b.dni);
        const leftStarts = left.startsWith(dniQuery) ? 0 : 1;
        const rightStarts = right.startsWith(dniQuery) ? 0 : 1;
        return leftStarts - rightStarts || String(a.name).localeCompare(String(b.name));
      })
      .slice(0, 8);
  }
  if (nameOrDniOnly) {
    const queryKey = normalizeCustomerSearchKey(cleanQuery);
    const dniQuery = normalizeCustomerDni(cleanQuery);
    return state.customers
      .filter((customer) => {
        const name = normalizeCustomerSearchKey(customer.name);
        const dni = normalizeCustomerDni(customer.dni);
        return Boolean((queryKey && name.includes(queryKey)) || (dniQuery && dni.includes(dniQuery)));
      })
      .sort((a, b) => {
        const leftName = normalizeCustomerSearchKey(a.name);
        const rightName = normalizeCustomerSearchKey(b.name);
        const leftDni = normalizeCustomerDni(a.dni);
        const rightDni = normalizeCustomerDni(b.dni);
        const leftStarts = (queryKey && leftName.startsWith(queryKey)) || (dniQuery && leftDni.startsWith(dniQuery)) ? 0 : 1;
        const rightStarts = (queryKey && rightName.startsWith(queryKey)) || (dniQuery && rightDni.startsWith(dniQuery)) ? 0 : 1;
        return leftStarts - rightStarts || String(a.name).localeCompare(String(b.name));
      })
      .slice(0, 8);
  }
  return customerPickerResults(cleanQuery, "cart").slice(0, 8);
}

function renderCustomerInlineSuggestions(inputId, panelId) {
  const input = document.getElementById(inputId);
  const panel = document.getElementById(panelId);
  if (!input || !panel) return;
  const isLocalCustomerSearch = inputId === "cartReference";
  const customers = customerInlineSuggestionRows(input.value, {
    dniOnly: inputId === "onlineCustomerDni",
    nameOrDniOnly: isLocalCustomerSearch,
  });
  panel.classList.toggle("open", customers.length > 0);
  panel.innerHTML = customers.map((customer) => {
    const detail = isLocalCustomerSearch ? {
      meta: [customer.dni ? `DNI ${formatCustomerDni(customer.dni)}` : "", customer.province || "Sin Provincia"].filter(Boolean).join(" · "),
      note: String(customer.notes || "").trim() ? `Nota: ${String(customer.notes || "").trim()}` : "",
    } : customerSuggestionDetail(customer);
    return `
      <button type="button" data-inline-customer="${customer.id}" data-inline-target="${inputId}">
        <strong>${customer.name}${customerDuplicateLabel(customer) ? ` <span class="customer-duplicate-badge">${customerDuplicateLabel(customer)}</span>` : ""}</strong>
        <small>${htmlAttr(detail.meta)}</small>
        ${detail.note ? `<small class="customer-suggestion-note">${htmlAttr(detail.note)}</small>` : ""}
      </button>
    `;
  }).join("");
}

function closeCustomerInlineSuggestions() {
  document.querySelectorAll(".customer-inline-suggestions.open").forEach((panel) => {
    panel.classList.remove("open");
    panel.innerHTML = "";
  });
}

function unlockBrowserAutofillField(input) {
  if (!input?.matches?.("[data-no-browser-autofill]")) return;
  input.readOnly = false;
}

function lockBrowserAutofillField(input) {
  if (!input?.matches?.("[data-no-browser-autofill]")) return;
  input.readOnly = false;
}

function lockAllBrowserAutofillFields() {
  document.querySelectorAll("[data-no-browser-autofill]").forEach(lockBrowserAutofillField);
}

function provinceInlineSuggestionRows(query) {
  const cleanQuery = normalizeCustomerSearchKey(query);
  if (!cleanQuery) return [];
  return argentineProvinces
    .filter((province) => normalizeCustomerSearchKey(province).startsWith(cleanQuery) || normalizeCustomerSearchKey(province).includes(cleanQuery))
    .slice(0, 10);
}

function renderProvinceInlineSuggestions(inputId, panelId) {
  const input = document.getElementById(inputId);
  const panel = document.getElementById(panelId);
  if (!input || !panel) return;
  const provinces = provinceInlineSuggestionRows(input.value);
  panel.classList.toggle("open", provinces.length > 0);
  panel.innerHTML = provinces.map((province) => `
    <button type="button" data-inline-province="${htmlAttr(province)}" data-inline-target="${inputId}">
      <strong>${province}</strong>
    </button>
  `).join("");
}

function selectInlineProvince(province, targetId) {
  const input = document.getElementById(targetId);
  if (!input) return;
  input.value = normalizeProvince(province);
  closeCustomerInlineSuggestions();
}

function selectInlineCustomer(customerId, targetId) {
  const customer = state.customers.find((item) => item.id === customerId);
  if (!customer) return;
  if (targetId === "onlineClientLookup" || targetId === "onlineCustomerDni") {
    const form = document.getElementById("onlineForm");
    const nameInput = document.getElementById("onlineClientLookup");
    const dniInput = document.getElementById("onlineCustomerDni");
    if (form) {
      if (dniInput) dniInput.value = formatCustomerDni(customer.dni || "");
      if (nameInput) nameInput.value = customer.name;
      form.elements.customerId.value = customer.id;
      const provinceInput = document.getElementById("onlineProvince");
      if (customer.province && provinceInput) provinceInput.value = customer.province;
      form.dataset.customerReviewedName = customer.name;
    }
    closeCustomerInlineSuggestions();
    return;
  }
  if (targetId === "cartReference") {
    const cart = activeCart();
    if (cart) {
      cart.customerId = customer.id;
      cart.reference = customer.name;
    }
    saveUiState();
    closeCustomerInlineSuggestions();
    renderPos();
  }
  if (targetId === "workshopClientLookup") {
    const nameInput = document.getElementById("workshopClientLookup");
    const phoneInput = document.getElementById("workshopPhoneEntry");
    if (nameInput) nameInput.value = customer.name;
    if (phoneInput && customer.phone) phoneInput.value = customer.phone;
    closeCustomerInlineSuggestions();
  }
}

function openCustomerPickerModal(cartId, mode = "cart", initialSearch = "") {
  const modal = document.getElementById("customerPickerModal");
  const search = document.getElementById("customerPickerSearch");
  const cartInput = document.getElementById("customerPickerCartId");
  const modeInput = document.getElementById("customerPickerMode");
  if (!modal || !search || !cartInput) return;
  cartInput.value = cartId;
  if (modeInput) modeInput.value = mode;
  search.value = initialSearch;
  const title = document.getElementById("customerPickerTitle");
  const cancel = document.getElementById("cancelCustomerPickerModal");
  const finalizeMode = mode === "finalize" || mode === "onlineFinalize";
  if (title) title.textContent = finalizeMode ? "Confirmar Cliente" : "Elegir Cliente";
  if (cancel) cancel.textContent = finalizeMode ? "Cancelar Venta" : "Cancelar";
  renderCustomerPickerList();
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  search.focus();
  if (initialSearch) search.select();
}

function closeCustomerPickerModal() {
  const modal = document.getElementById("customerPickerModal");
  if (!modal) return;
  const wasOpen = modal.classList.contains("open");
  const mode = document.getElementById("customerPickerMode")?.value || "cart";
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  const title = document.getElementById("customerPickerTitle");
  const cancel = document.getElementById("cancelCustomerPickerModal");
  if (title) title.textContent = "Elegir Cliente";
  if (cancel) cancel.textContent = "Cancelar";
  if (wasOpen && mode === "cart") renderPos();
}

function customerPickerMatches(customer, query) {
  if (!query) return true;
  const dniQuery = normalizeCustomerDni(query);
  if (dniQuery && normalizeCustomerDni(customer.dni).includes(dniQuery)) return true;
  return [customer.name, customer.dni, customer.phone, customer.province]
    .some((value) => normalizeTextKey(value).includes(query));
}

function normalizeCustomerSearchKey(value) {
  return normalizeTextKey(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j];
  }
  return previous[right.length];
}

function customerSearchTolerance(value) {
  const length = String(value || "").length;
  if (length <= 4) return 1;
  if (length <= 10) return 2;
  return 3;
}

function customerSimilarityScore(customer, query) {
  const q = normalizeCustomerSearchKey(query);
  if (!q) return 0;
  const name = normalizeCustomerSearchKey(customer.name);
  const province = normalizeCustomerSearchKey(customer.province);
  const dniDigits = normalizeCustomerDni(customer.dni);
  const phoneDigits = String(customer.phone || "").replace(/\D/g, "");
  const queryDigits = String(query || "").replace(/\D/g, "");
  if (queryDigits && dniDigits) {
    if (dniDigits === queryDigits) return 0;
    if (dniDigits.startsWith(queryDigits) || dniDigits.includes(queryDigits)) return 1;
  }
  if (queryDigits && phoneDigits.includes(queryDigits)) return 1;
  if (!name) return Number.POSITIVE_INFINITY;
  if (name === q) return 0;
  if (name.startsWith(q)) return 2;
  if (name.includes(q)) return 3;
  if (province && province.includes(q)) return 25;

  const wholeDistance = levenshteinDistance(name, q);
  if (wholeDistance <= customerSearchTolerance(q)) return 8 + wholeDistance;

  const queryTokens = q.split(" ").filter(Boolean);
  const nameTokens = name.split(" ").filter(Boolean);
  if (!queryTokens.length) return Number.POSITIVE_INFINITY;

  let score = 12;
  for (const queryToken of queryTokens) {
    let best = Number.POSITIVE_INFINITY;
    for (const nameToken of nameTokens) {
      if (nameToken === queryToken) {
        best = Math.min(best, 0);
      } else if (nameToken.startsWith(queryToken) || queryToken.startsWith(nameToken)) {
        best = Math.min(best, 1);
      } else {
        const tokenDistance = levenshteinDistance(nameToken, queryToken);
        if (tokenDistance <= customerSearchTolerance(queryToken)) {
          best = Math.min(best, 2 + tokenDistance);
        }
      }
    }
    if (!Number.isFinite(best)) return Number.POSITIVE_INFINITY;
    score += best;
  }
  return score;
}

function customerFinalizeScoreLimit(query) {
  const tokens = normalizeCustomerSearchKey(query).split(" ").filter(Boolean);
  if (tokens.length >= 2) return 16;
  const length = tokens[0]?.length || 0;
  if (length >= 5) return 9;
  return 6;
}

function customerPickerResults(query, mode = "cart") {
  if (mode === "finalize" || mode === "onlineFinalize") {
    const limit = customerFinalizeScoreLimit(query);
    return state.customers
      .map((customer) => ({ customer, score: customerSimilarityScore(customer, query) }))
      .filter((item) => Number.isFinite(item.score) && item.score <= limit)
      .sort((a, b) => a.score - b.score || String(a.customer.name).localeCompare(String(b.customer.name)))
      .map((item) => item.customer);
  }
  return state.customers
    .filter((customer) => customerPickerMatches(customer, normalizeTextKey(query)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function renderCustomerPickerList() {
  const list = document.getElementById("customerPickerList");
  const query = document.getElementById("customerPickerSearch")?.value || "";
  const mode = document.getElementById("customerPickerMode")?.value || "cart";
  if (!list) return;
  const customers = customerPickerResults(query, mode).slice(0, 12);
  list.innerHTML = customers.map((customer) => {
    const detail = customerSuggestionDetail(customer);
    return `
      <button class="customer-picker-row" data-pick-customer="${customer.id}" type="button">
        <span>
          <strong>${customer.name}${customerDuplicateLabel(customer) ? ` <span class="customer-duplicate-badge">${customerDuplicateLabel(customer)}</span>` : ""}</strong>
          <small>${htmlAttr(detail.meta)}</small>
          ${detail.note ? `<small class="customer-suggestion-note">${htmlAttr(detail.note)}</small>` : ""}
        </span>
        <small class="customer-picker-side">${htmlAttr(customer.province || "")}</small>
      </button>
    `;
  }).join("") || `<div class="empty-state compact-empty">No hay Clientes cargados para esa búsqueda.</div>`;
}

function selectCustomerForTarget(customerId) {
  const customer = state.customers.find((item) => item.id === customerId);
  const mode = document.getElementById("customerPickerMode")?.value || "cart";
  if (mode === "online" || mode === "onlineFinalize") {
    const nameInput = document.getElementById("onlineClientLookup");
    const dniInput = document.getElementById("onlineCustomerDni");
    const idInput = document.getElementById("onlineCustomerId");
    const provinceInput = document.getElementById("onlineProvince");
    if (!customer || !nameInput || !idInput) return;
    if (dniInput) dniInput.value = formatCustomerDni(customer.dni || "");
    nameInput.value = customer.name;
    idInput.value = customer.id;
    if (provinceInput && customer.province) provinceInput.value = customer.province;
    const form = document.getElementById("onlineForm");
    if (form) form.dataset.customerReviewedName = customer.name;
    closeCustomerPickerModal();
    if (mode === "onlineFinalize") form?.requestSubmit();
    return;
  }
  const cartId = document.getElementById("customerPickerCartId")?.value;
  const cart = state.carts.find((item) => item.id === cartId) || activeCart();
  if (!customer || !cart) return;
  cart.customerId = customer.id;
  cart.reference = customer.name;
  saveUiState();
  closeCustomerPickerModal();
  if (mode === "finalize") {
    confirmFinalizeCart(cart.id);
    return;
  }
  renderPos();
}

function stockTypeLabel(type) {
  return { entrada: "Entrada", venta: "Venta", ajuste: "Ajuste" }[type] || type;
}

function cartTotal(cart) {
  const subtotal = cartSubtotal(cart);
  if (cart.manualTotalEnabled && cart.manualTotal !== "" && cart.manualTotal != null) {
    const manualTotal = Number(cart.manualTotal || 0);
    if (Number.isFinite(manualTotal) && manualTotal >= 0) return Math.round(manualTotal);
  }
  return Math.round(subtotal);
}

function workshopDeliveryTotal(order, paymentMethod = "efectivo") {
  const subtotal = Number(order?.price || 0);
  const adjustment = workshopPaymentAdjustment(paymentMethod);
  return Math.round(subtotal + subtotal * (adjustment / 100));
}

function productByQuery(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const candidates = [q, q.split(" - ")[0].trim()].filter(Boolean);
  return state.products.find((product) =>
    [product.code, product.barcode, product.description].some((value) => {
      const productValue = String(value || "").toLowerCase();
      return candidates.some((candidate) => productValue.includes(candidate));
    })
  );
}

function productByCodeQuery(query) {
  const code = String(query || "").trim().split(" - ")[0].trim().toLowerCase();
  if (!code) return null;
  return state.products.find((product) => String(product.code || "").trim().toLowerCase() === code);
}

function posProductCodeMatches(query = "") {
  const code = String(query || "").trim().toLowerCase();
  if (!code || productByCodeQuery(code)) return [];
  return state.products
    .filter((product) => String(product.code || "").trim().toLowerCase().startsWith(code))
    .sort((a, b) => String(a.code || "").localeCompare(String(b.code || ""), undefined, { numeric: true }))
    .slice(0, 12);
}

function renderPosProductCodeSuggestions() {
  const input = document.getElementById("productSearch");
  const panel = document.getElementById("posProductSuggestions");
  if (!input || !panel) return;
  const products = posProductCodeMatches(input.value);
  panel.classList.toggle("open", products.length > 0);
  panel.innerHTML = products.map((product) => {
    const categoryLabel = `${product.category}${product.subcategory ? ` / ${product.subcategory}` : ""}`;
    return `
      <button type="button" data-select-pos-product="${htmlAttr(product.code)}">
        <strong>${htmlAttr(product.code)}</strong>
        <small>${htmlAttr(product.description)} · ${htmlAttr(categoryLabel)} · ${money(product.price)}</small>
      </button>
    `;
  }).join("");
}

function closePosProductCodeSuggestions() {
  const panel = document.getElementById("posProductSuggestions");
  if (!panel) return;
  panel.classList.remove("open");
  panel.innerHTML = "";
}

function selectPosProductCode(code) {
  const input = document.getElementById("productSearch");
  if (input) input.value = code;
  closePosProductCodeSuggestions();
  updateLocalAccessorySubcategorySelect({ focusIfAvailable: true });
  updatePosSizeSelect({ focusIfAvailable: true });
}

function posSizeOptions(product, selected = "") {
  if (!productHasSizeVariants(product)) return '<option value="">Talle</option>';
  return [
    '<option value="">Talle</option>',
    ...productAvailableSizeVariants(product).map((variant) => (
      `<option value="${htmlAttr(variant.size)}" ${variant.size === selected ? "selected" : ""}>${htmlAttr(variant.size)}</option>`
    )),
  ].join("");
}

function updatePosSizeSelect({ focusIfAvailable = false } = {}) {
  const select = document.getElementById("productSize");
  const input = document.getElementById("productSearch");
  if (!select || !input) return;
  const product = productByCodeQuery(input.value);
  const enabled = Boolean(productHasSizeVariants(product));
  select.innerHTML = posSizeOptions(product, select.value);
  select.disabled = !enabled;
  select.classList.toggle("is-active", enabled);
  if (enabled && focusIfAvailable && document.activeElement === input) select.focus();
}

function productSearchOptions(products = state.products) {
  return products.map((product) => {
    const categoryLabel = `${product.category}${product.subcategory ? ` / ${product.subcategory}` : ""}`;
    const label = `${product.description} - ${categoryLabel} - ${money(product.price)}`;
    return `<option value="${htmlAttr(`${product.code} - ${product.description}`)}" label="${htmlAttr(label)}"></option>`;
  }).join("");
}

function productColorOptions(selectedColor = "") {
  const selected = normalizeProductDescription(selectedColor || "");
  return [
    `<option value="">Color</option>`,
    ...commonProductColors.map((color) => `<option value="${htmlAttr(color)}" ${categoryKey(color) === categoryKey(selected) ? "selected" : ""}>${htmlAttr(color)}</option>`),
  ].join("");
}

function productCategories() {
  const configured = normalizeCustomProductCategories(state.customProductCategories).filter((entry) => entry.active !== false);
  return [...new Set([
    ...baseProductCategories,
    ...configured.map((entry) => entry.category),
  ])].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}

function categoryKey(category) {
  return String(category || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function canonicalCategory(category) {
  const value = String(category || "").trim();
  if (!value) return "";
  const key = categoryKey(value);
  return categoryAliases[key] || baseProductCategories.find((item) => categoryKey(item) === key) || value;
}

function canonicalProductCategory(category) {
  const value = canonicalCategory(category);
  return value === "Taller" || value === "Manual" ? "Accesorios" : value;
}

function canonicalSaleItemCategory(item, sale) {
  const value = canonicalCategory(item.category);
  if (value === "Taller" && sale.source !== "taller") return "Manual";
  return value;
}

function canonicalSubcategory(category, subcategory) {
  const value = String(subcategory || "").trim();
  if (!value) return "";
  const options = productSubcategories(category);
  return options.find((item) => categoryKey(item) === categoryKey(value)) || value;
}

function saleLineSubcategory(category, subcategory = "") {
  const saleCategory = canonicalCategory(category);
  if (saleCategory && categoryKey(subcategory) === categoryKey(saleCategory)) return "";
  const cleanSubcategory = canonicalSubcategory(saleCategory, subcategory);
  if (cleanSubcategory) return cleanSubcategory;
  return "";
}

function isReportableSaleCategory(category) {
  const saleCategory = canonicalCategory(category);
  return Boolean(saleCategory) && saleCategory !== "Manual";
}

function productSubcategories(category = "all") {
  const selectedCategory = category === "all" ? "all" : canonicalProductCategory(category);
  if (selectedCategory === "all") return [];
  const baseSubcategories = baseProductSubcategories[selectedCategory] || [];
  const configuredSubcategories = normalizeCustomProductCategories(state.customProductCategories)
    .filter((entry) => entry.active !== false)
    .filter((entry) => canonicalProductCategory(entry.category) === selectedCategory)
    .map((entry) => entry.subcategory)
    .filter(Boolean);
  return [
    ...new Set([
      ...baseSubcategories,
      ...configuredSubcategories,
      ...state.products
        .filter((product) => selectedCategory === "all" || canonicalProductCategory(product.category) === selectedCategory)
        .map((product) => product.subcategory)
        .filter(Boolean),
    ]),
  ].sort((a, b) => a.localeCompare(b, "es"));
}

function isAccessoryCategory(category) {
  return false;
}

function accessoryPriceCode(price) {
  const value = Number(price || 0);
  if (!Number.isFinite(value) || value <= 0) return "A";
  const thousands = Math.max(10, Math.floor(value / 1000));
  return `A${thousands}`;
}

function accessoryPriceProducts() {
  return [];
}

function prefixForCategory(category, subcategory = "") {
  const normalizedCategory = canonicalProductCategory(category);
  if (normalizedCategory === "Categoria 1") {
    return "A";
  }
  const configured = normalizeCustomProductCategories(state.customProductCategories);
  const exactConfigured = configured.find((entry) =>
    canonicalProductCategory(entry.category) === normalizedCategory
    && entry.subcategory
    && categoryKey(entry.subcategory) === categoryKey(subcategory)
  );
  if (exactConfigured) return exactConfigured.prefix;
  const categoryConfigured = configured.find((entry) =>
    canonicalProductCategory(entry.category) === normalizedCategory
    && !entry.subcategory
  );
  if (categoryConfigured) return categoryConfigured.prefix;
  if (categoryPrefixes[normalizedCategory]) return categoryPrefixes[normalizedCategory];
  const reserved = new Set([
    ...Object.values(categoryPrefixes),
    ...configured.map((entry) => entry.prefix),
  ]);
  return firstAvailableCategoryPrefix(category || "Otro", reserved);
}

function nextProductCode(category, subcategory = "") {
  if (isAccessoryCategory(category)) {
    return accessoryPriceCode(document.getElementById("productPrice")?.value);
  }
  const prefix = prefixForCategory(category, subcategory);
  const usedCodes = new Set(state.products.map((product) => String(product.code || "").toUpperCase()));
  for (let index = 1; index <= 999; index += 1) {
    const code = `${prefix}${String(index).padStart(3, "0")}`;
    if (!usedCodes.has(code)) return code;
  }
  return `${prefix}${Date.now().toString().slice(-4)}`;
}

function barcodeFromCode(code) {
  return code ? `BASE-${String(code).trim().toUpperCase()}` : "";
}

function normalizeProductBarcode(product) {
  const current = String(product.barcode || "").trim();
  if (!current || /^779000\d+$/i.test(current)) return barcodeFromCode(product.code);
  return current;
}

function renderProductCategoryOptions(selectedCategory = null) {
  const select = document.getElementById("productCategory");
  if (!select) return;
  const selected = selectedCategory ?? select.value ?? "";
  select.innerHTML = [
    `<option value="" ${selected ? "" : "selected"} disabled>Elegí una Categoría</option>`,
    ...productCategories().map((category) => `<option value="${category}" ${category === selected ? "selected" : ""}>${category}</option>`),
  ].join("");
}

function renderProductSubcategoryOptions(selectedCategory = null, selectedSubcategory = "") {
  const select = document.getElementById("productSubcategory");
  if (!select) return;
  const category = selectedCategory ?? document.getElementById("productCategory")?.value ?? "";
  if (isAccessoryCategory(category)) {
    select.innerHTML = `<option value="">Se carga en la venta</option>`;
    select.disabled = true;
    return;
  }
  const subcategories = category ? productSubcategories(category) : [];
  if (selectedSubcategory && !subcategories.includes(selectedSubcategory)) subcategories.push(selectedSubcategory);
  select.innerHTML = [
    `<option value="">Sin Subcategoría</option>`,
    ...subcategories.map((subcategory) => `<option value="${htmlAttr(subcategory)}" ${subcategory === selectedSubcategory ? "selected" : ""}>${htmlAttr(subcategory)}</option>`),
  ].join("");
  select.disabled = subcategories.length === 0;
}

function updateProductCode() {
  const category = document.getElementById("productCategory")?.value;
  const subcategory = document.getElementById("productSubcategory")?.value;
  const code = document.getElementById("productCode");
  const locked = isAccessoryCategory(category);
  const hint = document.getElementById("productCodeHint");
  if (code) {
    code.readOnly = locked;
    code.classList.toggle("locked-input", locked);
  }
  if (hint) hint.classList.toggle("is-hidden", !locked);
  if (code && !category) {
    code.value = "";
    updateProductBarcode();
    return;
  }
  if (code && category) {
    if (locked || !code.value) code.value = nextProductCode(category, subcategory);
    updateProductBarcode();
  }
}

function updateProductBarcode() {
  const barcode = document.getElementById("productBarcode");
  const code = document.getElementById("productCode")?.value;
  if (barcode) barcode.value = barcodeFromCode(code);
}

function updateProductPrice() {
  const cost = parseMoneyInput(document.getElementById("productCost")?.value || 0);
  const margin = Number(document.getElementById("productMargin")?.value || 0);
  const price = document.getElementById("productPrice");
  if (price) {
    price.value = cost ? Math.round(cost + cost * (margin / 100)) : "";
    formatMoneyInput(price);
  }
  if (isAccessoryCategory(document.getElementById("productCategory")?.value)) updateProductCode();
}

function updateProductMarginFromPrice() {
  const cost = parseMoneyInput(document.getElementById("productCost")?.value || 0);
  const priceInput = document.getElementById("productPrice");
  const marginInput = document.getElementById("productMargin");
  const price = parseMoneyInput(priceInput?.value || 0);
  if (!cost || !priceInput?.value || !marginInput) {
    if (isAccessoryCategory(document.getElementById("productCategory")?.value)) updateProductCode();
    return;
  }
  const margin = ((price - cost) / cost) * 100;
  const rounded = Math.round(margin * 10) / 10;
  marginInput.value = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  if (isAccessoryCategory(document.getElementById("productCategory")?.value)) updateProductCode();
}

function updateProductStockInput() {
  const tracksStock = document.getElementById("productTracksStock")?.checked;
  const form = document.getElementById("productForm");
  const stock = document.getElementById("productStock");
  const stockField = document.getElementById("productStockField");
  const stockLabel = document.getElementById("productStockLabel");
  if (!stock) return;
  stock.disabled = !tracksStock;
  stock.readOnly = true;
  if (!tracksStock) stock.value = "0";
  if (form) form.classList.remove("editing-stock-product");
  if (stockField) stockField.classList.add("is-hidden");
  if (stockLabel) stockLabel.textContent = "Stock Total";
  renderProductVariantBuilder();
  refreshProductStockActions(false);
}

function syncProductSizeStockInput() {
  const sizeInput = document.getElementById("productSizeVariants");
  const stockInput = document.getElementById("productStock");
  const tracksInput = document.getElementById("productTracksStock");
  const variants = normalizeProductSizeVariants(sizeInput?.value || "");
  if (!variants.length || !stockInput || !tracksInput) return;
  if (tracksInput.checked) stockInput.value = productSizeStockTotal({ sizeVariants: variants });
  updateProductStockInput();
}

function productVariantRowsFromDom() {
  return [...document.querySelectorAll("[data-product-variant-row]")].map((row) => ({
    size: row.querySelector("[data-variant-size]")?.value || "",
    stock: row.querySelector("[data-variant-stock]")?.value || 0,
  }));
}

function syncProductVariantInputFromRows() {
  const input = document.getElementById("productSizeVariants");
  const stockInput = document.getElementById("productStock");
  productVariantDraft = productVariantRowsFromDom().map((variant) => ({
    size: normalizeProductDescription(variant.size || "").toUpperCase(),
    stock: Math.max(0, Math.floor(Number(variant.stock || 0))),
  }));
  const variants = normalizeProductSizeVariants(productVariantDraft);
  if (input) input.value = variants.map((variant) => `${variant.size}: ${variant.stock}`).join("\n");
  if (stockInput) stockInput.value = productSizeStockTotal({ sizeVariants: variants });
  return variants;
}

function productVariantSizeControl(variant) {
  const options = productSuggestedSizes();
  const selected = String(variant.size || "").toUpperCase();
  if (!options.length) {
    return `<input data-variant-size value="${htmlAttr(selected)}" placeholder="Ej. M" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" data-no-browser-autofill>`;
  }
  const allOptions = options.includes(selected) || !selected ? options : [...options, selected];
  return `
    <select data-variant-size>
      <option value="">Talle</option>
      ${allOptions.map((size) => `<option value="${htmlAttr(size)}" ${size === selected ? "selected" : ""}>${htmlAttr(size)}</option>`).join("")}
    </select>
  `;
}

function renderProductVariantBuilder() {
  const builder = document.getElementById("productVariantBuilder");
  const list = document.getElementById("productVariantList");
  const input = document.getElementById("productSizeVariants");
  const tracksStock = document.getElementById("productTracksStock")?.checked;
  if (!builder || !list || !input) return;
  builder.classList.toggle("is-hidden", !tracksStock);
  if (!tracksStock) return;
  const variants = productVariantDraft;
  list.innerHTML = variants.length ? variants.map((variant, index) => `
    <div class="product-variant-row" data-product-variant-row>
      <label>
        <span>Talle</span>
        ${productVariantSizeControl(variant)}
      </label>
      <label>
        <span>Stock</span>
        <input data-variant-stock type="number" min="0" step="1" value="${Number(variant.stock || 0)}" autocomplete="one-time-code" data-no-browser-autofill>
      </label>
      <button type="button" data-remove-product-variant="${index}" aria-label="Eliminar variedad">x</button>
    </div>
  `).join("") : `<div class="product-variant-empty">Todavía no hay variedades. Usá Crear Variedad para cargar un talle.</div>`;
}

function addProductVariant() {
  const input = document.getElementById("productSizeVariants");
  if (!input) return;
  syncProductVariantInputFromRows();
  productVariantDraft.push({ size: nextSuggestedProductSize(), stock: 0 });
  renderProductVariantBuilder();
  document.querySelector("#productVariantList [data-product-variant-row]:last-child [data-variant-size]")?.focus();
}

function removeProductVariant(index) {
  const input = document.getElementById("productSizeVariants");
  if (!input) return;
  syncProductVariantInputFromRows();
  productVariantDraft.splice(Number(index), 1);
  renderProductVariantBuilder();
  syncProductVariantInputFromRows();
}

function currentEditedStockProduct() {
  const editingId = document.getElementById("editingProductId")?.value || "";
  const product = state.products.find((item) => item.id === editingId);
  return product?.tracksStock ? product : null;
}

function refreshProductStockActions(show = Boolean(currentEditedStockProduct())) {
  const product = currentEditedStockProduct();
  const actions = document.getElementById("productStockActions");
  const counter = document.getElementById("productStockCounter");
  const stockInput = document.getElementById("productStock");
  const costInput = document.getElementById("productStockAddCost");
  if (!actions) return;
  actions.classList.toggle("is-hidden", !show || !product);
  if (!product) return;
  const stock = Number(product.stock || 0);
  if (counter) counter.textContent = String(stock);
  if (stockInput) stockInput.value = stock;
  if (costInput && costInput.value === "" && Number(product.cost || 0) > 0) {
    costInput.value = Number(product.cost || 0);
    formatMoneyInput(costInput);
  }
}

function syncEditedProductStockFields(product) {
  const form = document.getElementById("productForm");
  if (!product || !form) return;
  form.stock.value = Number(product.stock || 0);
  form.cost.value = Number(product.cost || 0) || "";
  form.price.value = Number(product.price || 0) || "";
  refreshProductStockActions(true);
}

function stockMovementPurchaseNote(quantity, unitCost, note, extra = "") {
  return `${quantity} unidades - ${money(unitCost)} c/u - ${note || "Movimiento de stock"}${extra}`;
}

function addMerchandisePurchaseRecord({ product, amount, quantity, unitCost, note, date = todayIso(), stockEntryId = "" }) {
  state.purchases.push({
    id: uid("purchase"),
    date,
    supplier: `Compra de Mercaderia: ${product.description}`,
    category: "CompraMercaderia",
    behavior: "variable",
    area: "local",
    amount: Math.round(amount),
    notes: stockMovementPurchaseNote(quantity, unitCost, note),
    stockEntryId: stockEntryId || uid("stock-entry"),
    productId: product.id,
  });
}

function addInitialStockPurchaseRecord(product, date = todayIso()) {
  const quantity = Number(product?.stock || 0);
  const unitCost = Math.max(0, Number(product?.cost || 0));
  if (!product || quantity <= 0) return;
  addMerchandisePurchaseRecord({
    product,
    amount: quantity * unitCost,
    quantity,
    unitCost,
    note: "Stock inicial",
    date,
  });
}

function addStockControlLiquidationRecord(product, quantity, unitCost) {
  const safeQuantity = Number(quantity || 0);
  const safeUnitCost = Math.max(0, Number(unitCost || 0));
  const amount = safeQuantity * safeUnitCost;
  if (!product || safeQuantity <= 0) return;
  state.purchases.push({
    id: uid("purchase"),
    date: todayIso(),
    supplier: `Liquidacion de stock: ${product.description}`,
    category: "CompraMercaderia",
    behavior: "variable",
    area: "local",
    amount: -Math.round(amount),
    notes: `Liquidacion de stock por desactivar control - ${safeQuantity} unidades - ${money(safeUnitCost)} c/u`,
    stockEntryId: uid("stock-liquidation"),
    productId: product.id,
  });
}

function isStockControlLiquidation(purchase) {
  return String(purchase?.stockEntryId || "").startsWith("stock-liquidation");
}

function isAutomaticStockPurchase(purchase) {
  const stockEntryId = String(purchase?.stockEntryId || "");
  return stockEntryId.startsWith("stock-entry") || stockEntryId.startsWith("stock-liquidation");
}

function purchaseExpenseDetail(purchase) {
  const detail = purchase.notes || "Compra cargada manualmente";
  if (!purchase.productId || isStockControlLiquidation(purchase)) return detail;
  return detail
    .replace(/\s-\sCosto actualizado/g, "")
    .replace(/\s-\sUltimo costo actualizado/g, "")
    .replace(/\s-\sPrecio recalculado/g, "");
}

function productStockAddDraft(product) {
  if (!product?.tracksStock) return null;
  const quantityInput = document.getElementById("productStockAddQuantity");
  const costInput = document.getElementById("productStockAddCost");
  const noteInput = document.getElementById("productStockAddNote");
  const quantity = Number(quantityInput?.value || 0);
  if (quantity <= 0) return null;
  const rawCost = String(costInput?.value || "").trim();
  const hasCost = rawCost !== "";
  const unitCost = hasCost ? parseMoneyInput(rawCost) : Number(product.cost || 0);
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    alert("El Costo Unitario no es valido.");
    return false;
  }
  return {
    quantity,
    hasCost,
    unitCost,
    note: noteInput?.value || "Reposicion de Mercaderia",
  };
}

function recalculatedProductPrice(product, unitCost, marginOverride = null) {
  const margin = marginOverride === null ? Number(product.margin || 0) : Number(marginOverride || 0);
  return Math.round(Number(unitCost || 0) + Number(unitCost || 0) * (margin / 100));
}

function marginFromProductPrice(unitCost, price) {
  const cost = Number(unitCost || 0);
  if (cost <= 0) return 0;
  return Math.round(((Number(price || 0) - cost) / cost) * 1000) / 10;
}

function clearProductStockAddFields() {
  const quantityInput = document.getElementById("productStockAddQuantity");
  const noteInput = document.getElementById("productStockAddNote");
  if (quantityInput) quantityInput.value = "";
  if (noteInput) noteInput.value = "";
}

function applyProductStockDraft(product, draft, { updateCost = false, updatePrice = false, price = null, margin = null } = {}) {
  if (!product || !draft) return;
  product.stock = Number(product.stock || 0) + draft.quantity;
  if (updateCost && draft.hasCost) {
    product.cost = draft.unitCost;
    if (updatePrice) {
      if (Number.isFinite(Number(margin))) product.margin = Number(margin);
      product.price = Number.isFinite(Number(price)) ? Number(price) : recalculatedProductPrice(product, draft.unitCost, product.margin);
    }
  }
  addStockHistory(product, "entrada", draft.quantity, product.stock, draft.note, todayIso());
  addMerchandisePurchaseRecord({
    product,
    amount: draft.unitCost * draft.quantity,
    quantity: draft.quantity,
    unitCost: draft.unitCost,
    note: draft.note,
  });
  logActivity("stock", "Agrego stock", `${product.code} - ${product.description}: +${draft.quantity}`);
  clearProductStockAddFields();
}

function applyEditedProductStockReduce() {
  const product = currentEditedStockProduct();
  if (!product) {
    alert("Guarda el producto con Control de Stock antes de mover unidades.");
    return;
  }
  const quantityInput = document.getElementById("productStockReduceQuantity");
  const giftInput = document.getElementById("productStockReduceGift");
  const noteInput = document.getElementById("productStockReduceNote");
  const quantity = Number(quantityInput?.value || 0);
  const currentStock = Number(product.stock || 0);
  const unitCost = Number(product.cost || 0);
  const isGift = Boolean(giftInput?.checked);
  const note = noteInput?.value || (isGift ? "Regalo / muestra" : "Correccion de stock");
  if (quantity <= 0) return;
  if (quantity > currentStock) {
    alert("No podes reducir mas unidades que el stock actual.");
    return;
  }
  product.stock = currentStock - quantity;
  addStockHistory(product, "ajuste", -quantity, product.stock, note, todayIso());
  if (!isGift) {
    addMerchandisePurchaseRecord({
      product,
      amount: -(unitCost * quantity),
      quantity,
      unitCost,
      note: `${note} - Devolucion de costo por reduccion de stock`,
    });
  }
  if (quantityInput) quantityInput.value = "";
  if (giftInput) giftInput.checked = false;
  if (noteInput) noteInput.value = "";
  logActivity("stock", "Redujo stock", `${product.code} - ${product.description}: -${quantity}. ${note}`);
  saveState();
  render();
  syncEditedProductStockFields(product);
}

function openProductModal(productId = null) {
  const product = productId ? state.products.find((item) => item.id === productId) : null;
  if (product && isAccessoryCategory(product.category)) {
    showActionToast("Los accesorios quedan bloqueados. Solo se pueden eliminar.");
    return;
  }
  const modal = document.getElementById("productModal");
  const form = document.getElementById("productForm");
  form.reset();
  form.editingProductId.value = product?.id || "";
  document.getElementById("productModalTitle").textContent = product ? "Editar Producto" : "Nuevo Producto";
  document.getElementById("saveProductButton").textContent = product ? "Guardar Cambios" : "Guardar Producto";
  renderProductCategoryOptions(product?.category || "");
  renderProductSubcategoryOptions(product?.category || "", product?.subcategory || "");
  form.color.innerHTML = productColorOptions(product?.color || "");
  productImageDraft = normalizeProductImageUrls(product?.imageUrls || []);
  productVariantDraft = normalizeProductSizeVariants(product?.sizeVariants || []);
  if (product) {
    form.description.value = product.description || "";
    form.category.value = product.category || productCategories()[0];
    form.subcategory.value = product.subcategory || "";
    form.code.value = product.code || "";
    if (form.barcode) form.barcode.value = product.barcode || barcodeFromCode(product.code);
    form.cost.value = product.cost || "";
    form.margin.value = product.margin || 0;
    form.price.value = product.price || "";
    form.promoPrice.value = product.promoPrice || "";
    if (form.wholesalePrice) form.wholesalePrice.value = product.wholesalePrice || "";
    if (form.sizeVariants) form.sizeVariants.value = serializeProductSizeVariants(product);
    form.imageUrls.value = productImageDraft.join("\n");
    form.catalogDescription.value = product.catalogDescription || "";
    form.published.checked = Boolean(product.published);
    if (form.featured) form.featured.checked = Boolean(product.featured);
    if (form.isNew) form.isNew.checked = Boolean(product.isNew);
    form.tracksStock.checked = Boolean(product.tracksStock);
    form.stock.value = Number(product.stock || 0);
  } else {
    form.margin.value = 50;
    form.stock.value = 0;
    form.code.value = "";
    if (form.barcode) form.barcode.value = "";
    if (form.sizeVariants) form.sizeVariants.value = "";
    form.imageUrls.value = "";
    if (form.wholesalePrice) form.wholesalePrice.value = "";
    updateProductPrice();
  }
  renderProductImagePreview();
  updateProductStockInput();
  updateProductCode();
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  formatAllMoneyInputs(form);
  setTimeout(() => form.description.focus(), 0);
}

function closeProductModal() {
  const modal = document.getElementById("productModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.getElementById("productModalTitle").textContent = "Nuevo Producto";
  document.getElementById("saveProductButton").textContent = "Guardar Producto";
  document.getElementById("productForm").editingProductId.value = "";
  productImageDraft = [];
  productVariantDraft = [];
  renderProductImagePreview();
  renderProductVariantBuilder();
}

function productLabel(product) {
  return `${product.code} - ${product.description}`;
}

function stockEntryProductLabel(product) {
  return `${product.code} - ${product.description}${product.barcode ? ` (${product.barcode})` : ""}`;
}

function renderProductOptions(selectId, products, includeAll = false) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const options = includeAll ? [`<option value="all">Todos</option>`] : [];
  options.push(...products.map((product) => `<option value="${product.id}">${productLabel(product)}</option>`));
  select.innerHTML = options.join("");
}

function renderCategorySelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = productCategories().map((category) => `<option value="${category}">${category}</option>`).join("");
}

function renderPriceUpdateCategorySelect() {
  const select = document.getElementById("priceUpdateCategory");
  if (!select) return;
  const categories = productCategories().filter((category) => !isAccessoryCategory(category));
  select.innerHTML = categories.map((category) => `<option value="${category}">${category}</option>`).join("");
}

function renderProductFilters() {
  const query = document.getElementById("productSearchFilter");
  const sort = document.getElementById("productSortFilter");
  const category = document.getElementById("productCategoryFilter");
  const subcategory = document.getElementById("productSubcategoryFilter");
  const stock = document.getElementById("productStockFilter");
  const published = document.getElementById("productPublishedFilter");
  if (query) query.value = state.productFilters.query || "";
  if (sort) sort.value = state.productFilters.sort || "alphaAsc";
  if (category) {
    const categories = productCategories();
    let selected = state.productFilters.category || "all";
    if (selected !== "all" && !categories.includes(selected)) {
      selected = "all";
      state.productFilters.category = "all";
    }
    category.innerHTML = [
      `<option value="all">Todas las Categorías</option>`,
      ...categories.map((item) => `<option value="${item}" ${item === selected ? "selected" : ""}>${item}</option>`),
    ].join("");
  }
  if (subcategory) {
    const subcategories = productSubcategories(state.productFilters.category || "all");
    let selected = state.productFilters.subcategory || "all";
    if (selected !== "all" && !subcategories.includes(selected)) {
      selected = "all";
      state.productFilters.subcategory = "all";
    }
    subcategory.innerHTML = [
      `<option value="all">Todas las Subcategorías</option>`,
      ...subcategories.map((item) => `<option value="${htmlAttr(item)}" ${item === selected ? "selected" : ""}>${htmlAttr(item)}</option>`),
    ].join("");
    subcategory.disabled = subcategories.length === 0;
  }
  if (stock) stock.value = state.productFilters.stock || "all";
  if (published) published.value = state.productFilters.published || "all";
}

function filteredProducts() {
  const filters = state.productFilters || {};
  const query = String(filters.query || "").trim().toLowerCase();
  const products = state.products
    .filter((product) => !query || [product.code, product.barcode, product.description].some((value) => String(value || "").toLowerCase().includes(query)))
    .filter((product) => !filters.category || filters.category === "all" || product.category === filters.category)
    .filter((product) => !filters.subcategory || filters.subcategory === "all" || product.subcategory === filters.subcategory)
    .filter((product) => {
      if (filters.stock === "tracked") return product.tracksStock;
      if (filters.stock === "untracked") return !product.tracksStock;
      return true;
    })
    .filter((product) => {
      if (filters.published === "published") return product.published;
      if (filters.published === "unpublished") return !product.published;
      return true;
    });
  return products.sort((a, b) => compareProducts(a, b, filters.sort || "alphaAsc"));
}

function productRecentValue(product) {
  const direct = Date.parse(product.updatedAt || product.createdAt || "");
  if (Number.isFinite(direct)) return direct;
  const idMatch = String(product.id || "").match(/(\d{10,})/);
  return idMatch ? Number(idMatch[1]) : 0;
}

function productCodeCompare(a, b) {
  const codeCompare = String(a.code || "").localeCompare(String(b.code || ""), "es", { sensitivity: "base", numeric: true });
  const nameCompare = String(a.description || "").localeCompare(String(b.description || ""), "es", { sensitivity: "base", numeric: true });
  return codeCompare || nameCompare;
}

function compareProducts(a, b, sort = "alphaAsc") {
  const codeOrder = productCodeCompare(a, b);
  if (sort === "alphaDesc") return -codeOrder;
  if (sort === "recent") return productRecentValue(b) - productRecentValue(a) || codeOrder;
  return codeOrder;
}

function productsForPriceUpdate() {
  const scope = document.getElementById("priceUpdateScope")?.value || "all";
  if (scope === "category") {
    const category = document.getElementById("priceUpdateCategory")?.value;
    return state.products.filter((product) => product.category === category && !isAccessoryCategory(product.category));
  }
  return state.products.filter((product) => !isAccessoryCategory(product.category));
}

function updatePriceUpdatePreview() {
  const scope = document.getElementById("priceUpdateScope")?.value || "all";
  document.querySelector(".price-category-field")?.classList.toggle("is-hidden", scope !== "category");
  const products = productsForPriceUpdate();
  const preview = document.getElementById("priceUpdatePreview");
  if (preview) preview.textContent = `Se modificarán ${products.length} ${products.length === 1 ? "Producto" : "Productos"}.`;
}

function openPriceUpdateModal() {
  const form = document.getElementById("priceUpdateForm");
  form.reset();
  renderPriceUpdateCategorySelect();
  updatePriceUpdatePreview();
  const modal = document.getElementById("priceUpdateModal");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closePriceUpdateModal() {
  const modal = document.getElementById("priceUpdateModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

async function commitProductFormSave({ existing, updatedProduct, stockDraft = null, updateStockCost = false, updateStockPrice = false, now = new Date().toISOString() }) {
  try {
    if (CLOUD_DATA_ENABLED) {
      if (!cloudEnabledWithSession()) {
        showAuthError("Ingresá con tu usuario BlackShoes para guardar productos en Supabase.");
        renderAuthState("Ingresá para guardar en Supabase.");
        return;
      }
      updatedProduct = await saveCloudProductRecord(existing, updatedProduct);
    }
  } catch (error) {
    console.warn("Cloud product save failed", error);
    alert(`No pude guardar el producto en Supabase: ${error.message || "error desconocido"}`);
    return;
  }
  if (existing) {
    const wasTracked = Boolean(existing.tracksStock);
    const previousStock = Number(existing.stock || 0);
    const previousCost = Number(existing.cost || 0);
    Object.assign(existing, updatedProduct);
    existing.createdAt = existing.createdAt || now;
    existing.updatedAt = now;
    if (!wasTracked && existing.tracksStock) {
      addInitialStockPurchaseRecord(existing);
      addStockHistory(existing, "ajuste", Number(existing.stock || 0), Number(existing.stock || 0), "Se Activó Control de Stock");
    } else if (wasTracked && !existing.tracksStock) {
      addStockHistory(existing, "ajuste", -previousStock, 0, "Se Desactivó Control de Stock");
      addStockControlLiquidationRecord(existing, previousStock, previousCost);
    } else if (existing.tracksStock && previousStock !== Number(existing.stock || 0)) {
      addStockHistory(existing, "ajuste", Number(existing.stock || 0) - previousStock, Number(existing.stock || 0), "Ajuste Manual de Stock");
    }
    if (stockDraft && existing.tracksStock) {
      applyProductStockDraft(existing, stockDraft, {
        updateCost: updateStockCost,
        updatePrice: updateStockPrice,
        price: updatedProduct.price,
        margin: updatedProduct.margin,
      });
    }
    logActivity("product", "Edito producto", `${existing.code} - ${existing.description}`);
  } else {
    const product = { id: updatedProduct.id || uid("product"), ...updatedProduct, createdAt: updatedProduct.createdAt || now, updatedAt: updatedProduct.updatedAt || now };
    state.products.push(product);
    if (product.tracksStock) {
      addStockHistory(product, "ajuste", product.stock, product.stock, "Stock Inicial");
      addInitialStockPurchaseRecord(product);
    }
    logActivity("product", "Creo producto", `${product.code} - ${product.description}`);
  }
  saveState();
  closeProductModal();
  render();
}

function openStockCostUpdateModal(payload) {
  pendingProductStockCostSave = payload;
  const modal = document.getElementById("stockCostUpdateModal");
  const message = document.getElementById("stockCostUpdateMessage");
  const panel = document.getElementById("stockCostPricePanel");
  const currentPrice = document.getElementById("stockCostCurrentPrice");
  const marginInput = document.getElementById("stockCostMargin");
  const recalculatedPrice = document.getElementById("stockCostRecalculatedPrice");
  const updatePrice = document.getElementById("stockCostUpdatePrice");
  const acceptButton = document.getElementById("stockCostAcceptCost");
  if (!modal || !message || !panel || !currentPrice || !marginInput || !recalculatedPrice || !acceptButton) return;
  const product = payload.existing;
  const draft = payload.stockDraft;
  const margin = Number(payload.updatedProduct.margin || product.margin || 0);
  message.textContent = `El costo actual es ${money(product.cost)} y el nuevo costo cargado es ${money(draft.unitCost)}.`;
  currentPrice.textContent = money(product.price);
  marginInput.value = Number.isInteger(margin) ? String(margin) : String(Math.round(margin * 10) / 10);
  recalculatedPrice.value = recalculatedProductPrice(product, draft.unitCost, margin);
  if (updatePrice) updatePrice.checked = true;
  panel.classList.add("is-hidden");
  acceptButton.textContent = "Si, actualizar costo";
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  formatAllMoneyInputs(modal);
}

function syncStockCostPriceFields(changedField = "margin") {
  if (!pendingProductStockCostSave) return;
  const marginInput = document.getElementById("stockCostMargin");
  const priceInput = document.getElementById("stockCostRecalculatedPrice");
  const unitCost = Number(pendingProductStockCostSave.stockDraft?.unitCost || 0);
  if (!marginInput || !priceInput) return;
  if (changedField === "price") {
    const margin = marginFromProductPrice(unitCost, parseMoneyInput(priceInput.value || 0));
    marginInput.value = Number.isInteger(margin) ? String(margin) : String(margin);
    return;
  }
  priceInput.value = recalculatedProductPrice(pendingProductStockCostSave.existing, unitCost, Number(marginInput.value || 0));
  formatMoneyInput(priceInput);
}

function closeStockCostUpdateModal() {
  pendingProductStockCostSave = null;
  const modal = document.getElementById("stockCostUpdateModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

async function saveProductKeepingOldCost() {
  if (!pendingProductStockCostSave) return;
  const payload = pendingProductStockCostSave;
  pendingProductStockCostSave = null;
  await commitProductFormSave(payload);
  closeStockCostUpdateModal();
}

async function saveProductUpdatingCost() {
  if (!pendingProductStockCostSave) return;
  const panel = document.getElementById("stockCostPricePanel");
  const acceptButton = document.getElementById("stockCostAcceptCost");
  if (panel?.classList.contains("is-hidden")) {
    panel.classList.remove("is-hidden");
    if (acceptButton) acceptButton.textContent = "Guardar con nuevo costo";
    return;
  }
  const payload = pendingProductStockCostSave;
  const updatePrice = Boolean(document.getElementById("stockCostUpdatePrice")?.checked);
  if (updatePrice) {
    payload.updatedProduct.margin = Number(document.getElementById("stockCostMargin")?.value || payload.updatedProduct.margin || 0);
    payload.updatedProduct.price = parseMoneyInput(document.getElementById("stockCostRecalculatedPrice")?.value || payload.updatedProduct.price || 0);
  }
  pendingProductStockCostSave = null;
  await commitProductFormSave({ ...payload, updateStockCost: true, updateStockPrice: updatePrice });
  closeStockCostUpdateModal();
}

function applyPriceUpdate(percent) {
  const products = productsForPriceUpdate();
  products.forEach((product) => {
    product.price = Math.round(Number(product.price || 0) * (1 + percent / 100));
  });
  logActivity("product", "Modifico precios", `${products.length} productos (${percent}%)`);
  saveState();
  render();
}

function stockTrackedProducts() {
  return state.products.filter((product) => product.tracksStock);
}

function stockEntrySizeOptions(product = selectedStockEntryProduct(), selected = "") {
  if (!product) return `<option value="">Elegí un producto</option>`;
  const variants = normalizeProductSizeVariants(product.sizeVariants);
  if (!variants.length) return `<option value="">Sin variedad</option>`;
  return [
    `<option value="">Elegí talle</option>`,
    ...variants.map((variant) => `
      <option value="${htmlAttr(variant.size)}" ${variant.size === selected ? "selected" : ""}>
        ${htmlAttr(variant.size)} · Stock actual ${Number(variant.stock || 0)}
      </option>
    `),
  ].join("");
}

function updateStockEntrySizeOptions(product = selectedStockEntryProduct(), selected = "") {
  const select = document.getElementById("stockEntrySize");
  if (!select) return;
  select.innerHTML = stockEntrySizeOptions(product, selected || select.value);
  select.disabled = !product || !productHasSizeVariants(product);
  if (!product || !productHasSizeVariants(product)) select.value = "";
}

function renderStockEntryProductOptions(query = "") {
  const list = document.getElementById("stockEntryProductOptions");
  if (!list) return;
  const value = String(query || "").trim().toLowerCase();
  if (!value) {
    list.innerHTML = "";
    return;
  }
  list.innerHTML = stockTrackedProducts()
    .filter((product) => {
      const label = stockEntryProductLabel(product).toLowerCase();
      return label.includes(value)
        || [product.code, product.barcode, product.description].some((field) => String(field || "").toLowerCase().includes(value));
    })
    .slice(0, 20)
    .map((product) => `<option value="${stockEntryProductLabel(product)}"></option>`)
    .join("");
}

function exactStockEntryProduct(query) {
  const value = String(query || "").trim().toLowerCase();
  if (!value) return null;
  return stockTrackedProducts().find((product) => {
    const label = stockEntryProductLabel(product).toLowerCase();
    return label === value || [product.code, product.barcode, product.description].some((field) => String(field || "").toLowerCase() === value);
  }) || null;
}

function selectedStockEntryProduct() {
  const productId = document.getElementById("stockEntryProduct")?.value || "";
  const query = document.getElementById("stockEntryProductSearch")?.value || "";
  return state.products.find((item) => item.id === productId) || findStockEntryProduct(query);
}

function updateStockEntryCurrentPrice(product = null) {
  const input = document.getElementById("stockEntryCurrentPrice");
  const marginInput = document.getElementById("stockEntryCurrentMargin");
  if (!input) return;
  const selectedProduct = product || selectedStockEntryProduct();
  updateStockEntrySizeOptions(selectedProduct);
  if (!selectedProduct) {
    input.value = "";
    if (marginInput) marginInput.value = "";
    return;
  }
  if (marginInput) {
    const margin = Number(selectedProduct.margin || 0);
    marginInput.value = Number.isInteger(margin) ? String(margin) : String(Math.round(margin * 10) / 10);
  }
  const unitCostRaw = String(document.getElementById("stockEntryUnitCost")?.value || "").trim();
  const priceAction = document.getElementById("stockEntryPriceAction")?.value || "keep";
  const unitCostValue = parseMoneyInput(unitCostRaw);
  const hasUnitCost = unitCostRaw !== "" && Number.isFinite(unitCostValue);
  if (priceAction === "recalculate" && hasUnitCost) {
    const unitCost = unitCostValue;
    const margin = Number(selectedProduct.margin || 0);
    input.value = Math.round(unitCost + unitCost * (margin / 100));
    formatMoneyInput(input);
    return;
  }
  input.value = Math.round(Number(selectedProduct.price || 0));
  formatMoneyInput(input);
}

function findStockEntryProduct(query) {
  const value = String(query || "").trim().toLowerCase();
  if (!value) return null;
  return exactStockEntryProduct(query) || stockTrackedProducts().find((product) =>
    [product.code, product.barcode, product.description].some((field) => String(field || "").toLowerCase().includes(value))
  );
}

function historyProductOptions() {
  const map = new Map();
  state.products.forEach((product) => map.set(product.id, product));
  state.stockHistory.forEach((item) => {
    if (!map.has(item.productId)) {
      map.set(item.productId, {
        id: item.productId,
        code: item.productCode,
        description: item.productName,
        barcode: "",
      });
    }
  });
  return [...map.values()].filter((product) => product.id);
}

function renderStockHistoryProductOptions(query = "") {
  const list = document.getElementById("stockHistoryProductOptions");
  if (!list) return;
  const value = String(query || "").trim().toLowerCase();
  if (!value) {
    list.innerHTML = "";
    return;
  }
  list.innerHTML = historyProductOptions()
    .filter((product) => {
      const label = stockEntryProductLabel(product).toLowerCase();
      return label.includes(value)
        || [product.code, product.barcode, product.description].some((field) => String(field || "").toLowerCase().includes(value));
    })
    .slice(0, 20)
    .map((product) => `<option value="${stockEntryProductLabel(product)}"></option>`)
    .join("");
}

function findStockHistoryProduct(query) {
  const value = String(query || "").trim().toLowerCase();
  if (!value) return null;
  return historyProductOptions().find((product) => {
    const label = stockEntryProductLabel(product).toLowerCase();
    return label === value || [product.code, product.barcode, product.description].some((field) => String(field || "").toLowerCase() === value);
  });
}

function addStockHistory(product, type, quantity, stockAfter, note, date = todayIso()) {
  state.stockHistory.push({
    id: uid("stock"),
    date,
    productId: product.id,
    productCode: product.code,
    productName: product.description,
    type,
    quantity: Number(quantity || 0),
    stockAfter: Number(stockAfter || 0),
    note: note || "",
  });
  state.stockHistory = state.stockHistory.slice(-STOCK_HISTORY_LIMIT);
}

function renderStockEntryDraft() {
  const preview = document.getElementById("stockEntryPreview");
  const confirmButton = document.getElementById("confirmStockEntryBatch");
  if (!preview) return;
  if (confirmButton) confirmButton.disabled = stockEntryDraft.length === 0;
  preview.innerHTML = stockEntryDraft.length ? `
    <div class="table-wrap stock-entry-table">
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th>Talle</th>
            <th>Cantidad</th>
            <th>Costo</th>
            <th>Precio</th>
            <th>Detalle</th>
            <th class="row-actions-head" aria-label="Eliminar"></th>
          </tr>
        </thead>
        <tbody>
          ${stockEntryDraft.map((entry, index) => `
            <tr>
              <td><strong>${entry.productCode}</strong><br><small>${entry.productName}</small></td>
              <td>${entry.size || "-"}</td>
              <td>${entry.quantity}</td>
              <td>${entry.unitCost !== null && entry.unitCost !== undefined ? money(entry.unitCost) : "-"}</td>
              <td>${entry.unitCost !== null && entry.unitCost !== undefined ? entry.priceAction === "recalculate" ? "Recalcular" : "Igual" : "-"}</td>
              <td>${entry.note || "-"}</td>
              <td class="row-actions">
                <button class="tiny-action danger-action" data-remove-stock-entry="${index}" type="button">Eliminar</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  ` : `<div class="empty-state compact-empty">Agregá la mercadería a la lista y después confirmá todo junto.</div>`;
}

function openStockEntryModal() {
  const form = document.getElementById("stockEntryForm");
  form.reset();
  form.note.value = "Reposición de Mercadería";
  stockEntryDraft = [];
  renderStockEntryProductOptions();
  updateStockEntryCurrentPrice();
  renderStockEntryDraft();
  const modal = document.getElementById("stockEntryModal");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  formatAllMoneyInputs(modal);
  setTimeout(() => document.getElementById("stockEntryProductSearch")?.focus(), 0);
}

function closeStockEntryModal() {
  const modal = document.getElementById("stockEntryModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  stockEntryDraft = [];
}

function addStockEntryDraftFromForm(form) {
  const data = formDataObject(form);
  const entryDate = todayIso();
  const product = state.products.find((item) => item.id === data.productId) || findStockEntryProduct(data.productQuery);
  const quantity = Number(data.quantity || 0);
  const size = String(data.size || "").trim().toUpperCase();
  const hasUnitCost = String(data.unitCost || "").trim() !== "";
  const unitCost = hasUnitCost ? parseMoneyInput(data.unitCost || 0) : null;
  if (!product || !product.tracksStock) {
    alert("Elegí un Producto con Control de Stock.");
    return false;
  }
  if (productHasSizeVariants(product) && !size) {
    alert("Elegí la variedad/talle para cargar mercadería.");
    return false;
  }
  if (hasUnitCost && (!Number.isFinite(unitCost) || unitCost < 0)) {
    alert("El Costo Unitario no es válido.");
    return false;
  }
  if (quantity <= 0) return false;
  stockEntryDraft.push({
    productId: product.id,
    productCode: product.code,
    productName: product.description,
    size,
    quantity,
    unitCost,
    priceAction: data.priceAction || "keep",
    date: entryDate,
    note: data.note || "Reposición de Mercadería",
  });
  const currentNote = form.note.value;
  form.elements.productQuery.value = "";
  form.elements.productId.value = "";
  if (form.elements.size) form.elements.size.value = "";
  form.elements.quantity.value = "";
  form.elements.unitCost.value = "";
  form.elements.priceAction.value = "keep";
  updateStockEntryCurrentPrice();
  form.note.value = currentNote || "Reposición de Mercadería";
  renderStockEntryDraft();
  document.getElementById("stockEntryProductSearch")?.focus();
  return true;
}

async function confirmStockEntryBatch() {
  if (!stockEntryDraft.length) return;
  const draftCount = stockEntryDraft.length;
  const totalUnits = sum(stockEntryDraft, (entry) => Number(entry.quantity || 0));
  if (CLOUD_DATA_ENABLED) {
    try {
      if (!cloudEnabledWithSession()) {
        showAuthError("Ingresá con tu usuario BlackShoes para cargar mercadería en Supabase.");
        renderAuthState("Ingresá para guardar en Supabase.");
        return;
      }
      for (const entry of stockEntryDraft) {
        await saveCloudStockEntry(entry);
      }
      logActivity("stock", "Agrego mercaderia", `${draftCount} productos / ${totalUnits} unidades`);
      stockEntryDraft = [];
      await loadCloudData();
      saveState();
      closeStockEntryModal();
      render();
      showActionToast("Mercadería guardada en Supabase.");
      return;
    } catch (error) {
      console.warn("Cloud stock entry failed", error);
      alert(`No pude cargar la mercadería en Supabase: ${error.message || "error desconocido"}`);
      return;
    }
  }
  stockEntryDraft.forEach((entry) => {
    const product = state.products.find((item) => item.id === entry.productId);
    if (!product || !product.tracksStock) return;
    const quantity = Number(entry.quantity || 0);
    const hasEntryCost = entry.unitCost !== null && entry.unitCost !== undefined && Number.isFinite(Number(entry.unitCost));
    const movementCost = hasEntryCost ? Number(entry.unitCost) : Number(product.cost || 0);
    const unitCost = movementCost;
    if (entry.size && productHasSizeVariants(product)) {
      product.sizeVariants = normalizeProductSizeVariants(product.sizeVariants).map((variant) =>
        variant.size === entry.size ? { ...variant, stock: Number(variant.stock || 0) + quantity } : variant
      );
      product.stock = productSizeStockTotal(product);
    } else {
      product.stock = Number(product.stock || 0) + quantity;
    }
    if (hasEntryCost) {
      product.cost = Number(entry.unitCost);
      if (entry.priceAction === "recalculate") {
        const margin = Number(product.margin || 0);
        product.price = Math.round(product.cost + product.cost * (margin / 100));
      }
    }
    const movementNote = `${entry.note || "Reposicion de Mercaderia"}${entry.size ? ` - Talle ${entry.size}` : ""}`;
    addStockHistory(product, "entrada", quantity, product.stock, movementNote, entry.date);
    const purchaseNote = stockMovementPurchaseNote(quantity, unitCost, movementNote);
    state.purchases.push({
      id: uid("purchase"),
      date: entry.date,
      supplier: `Compra de Mercadería: ${product.description}`,
      category: "CompraMercaderia",
      behavior: "variable",
      area: "local",
      amount: Math.round(movementCost * quantity),
      stockEntryId: entry.id || uid("stock-entry"),
      notes: purchaseNote,
      productId: product.id,
    });
  });
  logActivity("stock", "Agrego mercaderia", `${draftCount} productos / ${totalUnits} unidades`);
  stockEntryDraft = [];
  saveState();
  closeStockEntryModal();
  render();
}

function renderStockHistoryFilters() {
  renderStockHistoryProductOptions();
}

function renderStockHistoryTable() {
  const productId = document.getElementById("stockHistoryProduct")?.value || "all";
  const productQuery = String(document.getElementById("stockHistoryProductSearch")?.value || "").trim().toLowerCase();
  const type = document.getElementById("stockHistoryType")?.value || "all";
  const from = normalizeDateInput(document.getElementById("stockHistoryFrom")?.value);
  const to = normalizeDateInput(document.getElementById("stockHistoryTo")?.value);
  const rows = state.stockHistory
    .filter((item) => {
      if (productId !== "all") return item.productId === productId;
      if (!productQuery) return true;
      return [item.productCode, item.productName].some((field) => String(field || "").toLowerCase().includes(productQuery));
    })
    .filter((item) => type === "all" || item.type === type)
    .filter((item) => !from || item.date >= from)
    .filter((item) => !to || item.date <= to)
    .slice()
    .reverse();
  const totalPages = Math.max(1, Math.ceil(rows.length / STOCK_HISTORY_PAGE_SIZE));
  const current = Math.min(Math.max(1, Number(state.stockHistoryPage || 1)), totalPages);
  const start = (current - 1) * STOCK_HISTORY_PAGE_SIZE;
  const pageRows = rows.slice(start, start + STOCK_HISTORY_PAGE_SIZE);
  state.stockHistoryPage = current;
  document.getElementById("stockHistoryTable").innerHTML = pageRows.map((item) => `
    <tr>
      <td>${formatDateShort(item.date)}</td>
      <td><strong>${item.productCode}</strong><br><small>${item.productName}</small></td>
      <td>${stockTypeLabel(item.type)}</td>
      <td>${item.quantity > 0 ? "+" : ""}${item.quantity}</td>
      <td>${item.stockAfter}</td>
      <td>${item.note || "-"}</td>
    </tr>
  `).join("") || `<tr><td colspan="6">Sin Movimientos para esos Filtros.</td></tr>`;
  const pagination = document.getElementById("stockHistoryPagination");
  if (pagination) pagination.innerHTML = stockHistoryPaginationControls(current, totalPages, rows.length);
}

function openStockHistoryModal() {
  state.stockHistoryPage = 1;
  renderStockHistoryFilters();
  setDateInput(document.getElementById("stockHistoryFrom"), monthAgoIso());
  setDateInput(document.getElementById("stockHistoryTo"), todayIso());
  renderStockHistoryTable();
  const modal = document.getElementById("stockHistoryModal");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeStockHistoryModal() {
  const modal = document.getElementById("stockHistoryModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function openManualItemModal() {
  const form = document.getElementById("manualItemForm");
  form.reset();
  form.description.value = "Manual";
  const modal = document.getElementById("manualItemModal");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  formatAllMoneyInputs(modal);
  document.getElementById("manualItemDescription").focus();
}

function closeManualItemModal() {
  const modal = document.getElementById("manualItemModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function addProductToCart(cartId, productId, quantity = 1, size = "") {
  const product = state.products.find((item) => item.id === productId);
  const cart = state.carts.find((item) => item.id === cartId);
  if (!product || !cart) return;
  const selectedSize = String(size || "").trim().toUpperCase();
  if (productHasSizeVariants(product) && !selectedSize) {
    alert("Elegí el talle para este producto.");
    return;
  }
  const sizeVariant = productHasSizeVariants(product)
    ? normalizeProductSizeVariants(product.sizeVariants).find((variant) => variant.size === selectedSize)
    : null;
  if (sizeVariant && product.tracksStock) {
    const inCart = sum(cart.items.filter((item) => item.productId === productId && item.size === selectedSize), (item) => item.quantity || 0);
    if (Number(sizeVariant.stock || 0) < inCart + quantity) {
      alert(`No hay stock suficiente para el talle ${selectedSize}.`);
      return;
    }
  }
  const itemSubcategory = "";
  const existing = cart.items.find((item) =>
    item.productId === productId
    && String(item.subcategory || "") === String(itemSubcategory || "")
    && String(item.size || "") === selectedSize
  );
  if (existing) {
    existing.quantity += quantity;
    if (!existing.unitCost) existing.unitCost = Number(product.cost || 0);
  } else {
    cart.items.push({
      productId: product.id,
      code: product.code,
      description: product.description,
      category: product.category,
      subcategory: itemSubcategory,
      size: selectedSize,
      quantity,
      unitPrice: product.price,
      unitCost: Number(product.cost || 0),
      tracksStock: product.tracksStock,
    });
  }
  saveUiState();
  render();
}

function addManualItem(cartId, description, price, category = "Manual") {
  const cart = state.carts.find((item) => item.id === cartId);
  if (!cart || !description || !price) return;
  cart.items.push({
    manual: true,
    description,
    category,
    quantity: 1,
    unitPrice: Number(price),
    tracksStock: false,
  });
  saveUiState();
  render();
}

function updateCartItem(cartId, index, delta) {
  const cart = state.carts.find((item) => item.id === cartId);
  if (!cart) return;
  const item = cart.items[index];
  if (!item) return;
  if (delta > 0 && item.productId && item.size) {
    const product = state.products.find((entry) => entry.id === item.productId);
    const variant = normalizeProductSizeVariants(product?.sizeVariants).find((entry) => entry.size === item.size);
    if (product?.tracksStock && variant && Number(variant.stock || 0) < Number(item.quantity || 0) + delta) {
      alert(`No hay stock suficiente para el talle ${item.size}.`);
      return;
    }
  }
  item.quantity += delta;
  if (item.quantity <= 0) cart.items.splice(index, 1);
  saveUiState();
  render();
}

function removeCartItem(cartId, index) {
  const cart = state.carts.find((item) => item.id === cartId);
  if (!cart || !cart.items[index]) return;
  cart.items.splice(index, 1);
  saveUiState();
  render();
}

async function finalizeCart(cartId) {
  const cart = state.carts.find((item) => item.id === cartId);
  if (!cart || cart.items.length === 0) return;
  if (!cart.paymentMethod) {
    alert("Elegí un Medio de Pago para finalizar la venta.");
    return;
  }
  const customer = state.customers.find((item) => item.id === cart.customerId) || null;
  const total = cartTotal(cart);
  const paidAmount = cartPaidAmount(cart);
  const debtAmount = Math.max(0, total - paidAmount);
  if (debtAmount > 0 && !customer) {
    alert("Para dejar deuda pendiente, primero asociá la venta a un cliente.");
    return;
  }
  const sale = {
    id: uid("sale"),
    localOrderNumber: nextLocalOrderNumber(),
    date: todayIso(),
    channel: "local",
    source: "mostrador",
    total,
    paidAmount,
    debtPayments: [],
    syncStatus: state.offline ? "pending" : "synced",
    saleType: "minorista",
    paymentMethod: cart.paymentMethod,
    skipPaymentAdjustment: false,
    manualTotalEnabled: Boolean(cart.manualTotalEnabled),
    manualTotal: cart.manualTotalEnabled ? total : "",
    items: cart.items.map((item) => ({ ...item })),
    reference: cart.reference,
    customerId: customer?.id || "",
    customerName: customer?.name || cart.reference || "",
  };
  if (CLOUD_DATA_ENABLED) {
    try {
      if (!cloudEnabledWithSession()) {
        showAuthError("Ingresá con tu usuario BlackShoes para registrar ventas en Supabase.");
        renderAuthState("Ingresá para guardar en Supabase.");
        return;
      }
      const cloudCustomer = customer ? await ensureCloudCustomer(customer) : null;
      cart.customerId = cloudCustomer?.id || "";
      await saveCloudLocalSale(cart, cloudCustomer);
      state.salesHistoryPage = 1;
      state.carts = state.carts.filter((item) => item.id !== cartId);
      openFreshCartAfterFinalize();
      logActivity("sale", "Registro venta local", `${money(sale.total)}`);
      await loadCloudData();
      saveState();
      render();
      showActionToast("Venta registrada en Supabase.");
      return;
    } catch (error) {
      console.warn("Cloud sale save failed", error);
      alert(`No pude registrar la venta en Supabase: ${error.message || "error desconocido"}`);
      return;
    }
  }
  sale.items.forEach((item) => {
    if (!item.productId || !item.tracksStock) return;
    const product = state.products.find((entry) => entry.id === item.productId);
    if (product && typeof product.stock === "number") {
      if (item.size && productHasSizeVariants(product)) {
        product.sizeVariants = normalizeProductSizeVariants(product.sizeVariants).map((variant) =>
          variant.size === item.size ? { ...variant, stock: Math.max(0, Number(variant.stock || 0) - Number(item.quantity || 0)) } : variant
        );
        product.stock = productSizeStockTotal(product);
      } else {
        product.stock -= item.quantity;
      }
      addStockHistory(product, "venta", -item.quantity, product.stock, `Venta Local ${sale.id}${item.size ? ` - Talle ${item.size}` : ""}`, sale.date);
    }
  });
  state.sales.push(sale);
  state.salesHistoryPage = 1;
  state.carts = state.carts.filter((item) => item.id !== cartId);
  openFreshCartAfterFinalize();
  logActivity("sale", "Registro venta local", `${saleOrder(sale)} - ${money(sale.total)}`);
  saveState();
  render();
}

function localAccessorySubcategoryOptions(selected = "") {
  return [
    `<option value="">Subcategoría</option>`,
    ...productSubcategories("Categoria 1").map((subcategory) => `<option value="${htmlAttr(subcategory)}" ${subcategory === selected ? "selected" : ""}>${htmlAttr(subcategory)}</option>`),
  ].join("");
}

function updateLocalAccessorySubcategorySelect({ focusIfAvailable = false } = {}) {
  const select = document.getElementById("localAccessorySubcategory");
  const input = document.getElementById("productSearch");
  if (!select || !input) return;
  const product = productByCodeQuery(input.value);
  const enabled = Boolean(product && isAccessoryCategory(product.category));
  select.innerHTML = localAccessorySubcategoryOptions(select.value);
  select.disabled = !enabled;
  select.classList.toggle("is-active", enabled);
  if (enabled && focusIfAvailable && document.activeElement === input) select.focus();
}

function startLocalSaleConfirmation(cartId) {
  const cart = state.carts.find((item) => item.id === cartId);
  if (!cart || cart.items.length === 0) return;
  const customerName = String(cart.reference || "").trim();
  if (!customerName) {
    cart.customerId = "";
    confirmFinalizeCart(cartId);
    return;
  }
  const linkedCustomer = state.customers.find((customer) => customer.id === cart.customerId);
  if (linkedCustomer && normalizeTextKey(linkedCustomer.name) === normalizeTextKey(customerName)) {
    cart.reference = linkedCustomer.name;
    confirmFinalizeCart(cartId);
    return;
  }
  const exactCustomer = assignExactCustomerToCart(cart, customerName);
  if (exactCustomer) {
    saveUiState();
    confirmFinalizeCart(cartId);
    return;
  }
  const matches = customerPickerResults(customerName, "finalize");
  if (matches.length) {
    openCustomerPickerModal(cartId, "finalize", customerName);
    return;
  }
  openCustomerRegisterModal({
    title: "Registrar cliente",
    message: `No encontre a ${customerName}. Si lo registras, queda asociado a esta venta.`,
    name: customerName,
    onRegister: (customerData) => {
      const customer = findOrCreateCustomer(customerData.name || customerName, { phone: customerData.phone });
      if (customer) {
        cart.customerId = customer.id;
        cart.reference = customer.name;
        saveUiState();
      }
      confirmFinalizeCart(cartId);
    },
    onSkip: () => {
      cart.customerId = "";
      cart.reference = customerName;
      saveUiState();
      confirmFinalizeCart(cartId);
    },
  });
}

function confirmOnlineCustomerBeforeSubmit(form, data) {
  const customerName = String(document.getElementById("onlineClientLookup")?.value || data.clientLookup || "").trim();
  const customerDni = normalizeCustomerDni(document.getElementById("onlineCustomerDni")?.value || data.customerDni);
  const provinceValue = normalizeProvince(document.getElementById("onlineProvince")?.value || data.provinceLookup || "");
  const customerIdInput = form.elements.customerId;
  const dniCustomer = customerDni ? assignCustomerDniToOnlineForm(form, customerDni) : null;
  if (dniCustomer) return true;
  if (!customerName) {
    if (customerIdInput) customerIdInput.value = "";
    delete form.dataset.customerReviewedName;
    return true;
  }
  const linked = state.customers.find((customer) => customer.id === data.customerId);
  if (linked && normalizeTextKey(linked.name) === normalizeTextKey(customerName)) return true;
  if (normalizeTextKey(form.dataset.customerReviewedName) === normalizeTextKey(customerName)) return true;
  if (assignExactCustomerToOnlineForm(form, customerName, { province: provinceValue })) return true;

  const matches = customerPickerResults(customerName, "onlineFinalize");
  if (matches.length) {
    openCustomerPickerModal("", "onlineFinalize", customerName);
    return false;
  }

  openCustomerRegisterModal({
    title: "Registrar cliente",
    message: `No encontre a ${customerName}. Si lo registras, queda asociado a esta venta online.`,
    name: customerName,
    dni: customerDni,
    province: provinceValue,
    onRegister: (customerData) => {
      const customer = findOrCreateCustomer(customerData.name || customerName, { dni: customerData.dni || customerDni, phone: customerData.phone, province: customerData.province || provinceValue });
      if (customer) {
        const dniInput = document.getElementById("onlineCustomerDni");
        const nameInput = document.getElementById("onlineClientLookup");
        if (dniInput) dniInput.value = formatCustomerDni(customer.dni || "");
        if (nameInput) nameInput.value = customer.name;
        form.elements.customerId.value = customer.id;
        const provinceInput = document.getElementById("onlineProvince");
        if (customer.province && provinceInput) provinceInput.value = customer.province;
        form.dataset.customerReviewedName = customer.name;
      }
      form.requestSubmit();
    },
    onSkip: () => {
      if (customerIdInput) customerIdInput.value = "";
      const nameInput = document.getElementById("onlineClientLookup");
      if (nameInput) nameInput.value = customerName;
      form.dataset.customerReviewedName = customerName;
      form.requestSubmit();
    },
  });
  return false;
}

function confirmFinalizeCart(cartId) {
  const cart = state.carts.find((item) => item.id === cartId);
  if (!cart || cart.items.length === 0) return;
  if (!cart.paymentMethod) {
    alert("Elegí un Medio de Pago para finalizar la venta.");
    return;
  }
  const itemCount = sum(cart.items, (item) => item.quantity || 1);
  const customer = state.customers.find((item) => item.id === cart.customerId);
  const customerText = customer ? customerDisplayLabel(customer) : cart.reference || "Sin cliente asociado";
  const debt = cartOutstandingDebt(cart);
  if (debt > 0 && !customer) {
    alert("Para dejar deuda pendiente, primero asociá la venta a un cliente.");
    return;
  }
  openConfirmModal({
    title: "Confirmar venta",
    message: `Total: ${money(cartTotal(cart))}. Pagado: ${money(cartPaidAmount(cart))}. Deuda: ${money(debt)}. Medio: ${paymentMethodName(cart.paymentMethod)}. Articulos: ${itemCount}. Cliente: ${customerText}.`,
    confirmText: "Confirmar Venta",
    onConfirm: () => finalizeCart(cartId),
  });
}

function cancelCart(cartId) {
  state.carts = state.carts.filter((item) => item.id !== cartId);
  state.activeCartId = state.carts[0]?.id || null;
  saveUiState();
  render();
}

async function deleteSale(saleId, options = {}) {
  const sale = state.sales.find((item) => item.id === saleId);
  if (!sale) return false;
  if (!options.skipConfirm) {
    openConfirmModal({
      title: "Eliminar venta",
      message: `Se eliminara la venta ${saleOrder(sale)} del historial.`,
      confirmText: "Eliminar",
      danger: true,
      onConfirm: () => deleteSale(saleId, { ...options, skipConfirm: true }),
    });
    return false;
  }
  if (CLOUD_DATA_ENABLED && isUuid(saleId)) {
    try {
      if (!cloudEnabledWithSession()) {
        showAuthError("Ingresá con tu usuario BlackShoes para anular ventas en Supabase.");
        renderAuthState("Ingresá para guardar en Supabase.");
        return false;
      }
      await archiveCloudRecord("sale", saleId);
      if (!options.skipLog) logActivity("sale", "Anulo venta", `${saleOrder(sale)} - ${money(sale.total)}`);
      await loadCloudData();
      saveState();
      if (!options.skipRender) render();
      showActionToast("Venta anulada en Supabase.");
      return true;
    } catch (error) {
      console.warn("Cloud sale cancel failed", error);
      alert(`No pude anular la venta en Supabase: ${error.message || "error desconocido"}`);
      return false;
    }
  }
  (sale.items || []).forEach((item) => {
    const product = state.products.find((entry) => entry.id === item.productId);
    const hadStockMovement = state.stockHistory.some((movement) =>
      movement.productId === item.productId && movement.type === "venta" && String(movement.note || "").includes(sale.id)
    );
    if (product && product.tracksStock && hadStockMovement) {
      if (item.size && productHasSizeVariants(product)) {
        product.sizeVariants = normalizeProductSizeVariants(product.sizeVariants).map((variant) =>
          variant.size === item.size ? { ...variant, stock: Number(variant.stock || 0) + Number(item.quantity || 0) } : variant
        );
        product.stock = productSizeStockTotal(product);
      } else {
        product.stock = Number(product.stock || 0) + Number(item.quantity || 0);
      }
      addStockHistory(product, "ajuste", Number(item.quantity || 0), product.stock, `Venta Eliminada ${saleOrder(sale)}`, todayIso());
    }
  });
  if (!options.skipLinkedOnline && sale.channel === "online") {
    const linkedOrder = findOnlineOrderForSale(sale);
    if (linkedOrder) rememberDeletedRecord("onlineOrders", linkedOrder.id);
    state.onlineOrders = state.onlineOrders.filter((order) => order.id !== linkedOrder?.id && order.saleId !== sale.id);
  }
  rememberDeletedRecord("sales", saleId);
  state.sales = state.sales.filter((item) => item.id !== saleId);
  state.salesHistoryPage = 1;
  if (!options.skipLog) logActivity("sale", "Elimino venta", `${saleOrder(sale)} - ${money(sale.total)}`);
  if (!options.skipRender) {
    saveState();
    render();
  }
  return true;
}

function deleteOnlineOrder(orderId) {
  const order = state.onlineOrders.find((item) => item.id === orderId);
  if (!order) return;
  openConfirmModal({
    title: "Eliminar venta online",
    message: `Se eliminara la venta online ${order.orderNumber}.`,
    confirmText: "Eliminar",
    danger: true,
    onConfirm: () => {
      const linkedSale = findSaleForOnlineOrder(order);
      rememberDeletedRecord("onlineOrders", orderId);
      state.onlineOrders = state.onlineOrders.filter((item) => item.id !== orderId);
      state.onlinePage = 1;
      if (linkedSale) deleteSale(linkedSale.id, { skipConfirm: true, skipLinkedOnline: true, skipRender: true, skipLog: true });
      logActivity("online", "Elimino venta online", `${order.orderNumber} - ${money(onlineOrderSaleAmount(order))}`);
      saveState();
      render();
    },
  });
}

function workshopDeliveryPaymentOptions(selected = "efectivo") {
  return state.paymentMethods
    .map((method) => `<option value="${method.id}" ${method.id === selected ? "selected" : ""}>${method.name}</option>`)
    .join("");
}

function updateWorkshopDeliveryPreview() {
  const orderId = document.getElementById("workshopDeliveryOrderId")?.value || "";
  const paymentMethod = document.getElementById("workshopDeliveryPayment")?.value || "efectivo";
  const preview = document.getElementById("workshopDeliveryPreview");
  const order = state.workshopOrders.find((item) => item.id === orderId);
  if (!preview || !order) return;
  const subtotal = Number(order.price || 0);
  const total = workshopDeliveryTotal(order, paymentMethod);
  preview.textContent = `Precio taller: ${money(subtotal)}. Medio: ${paymentMethodName(paymentMethod)}. Total a cobrar: ${money(total)}.`;
}

function openWorkshopDeliveryModal(orderId) {
  const order = state.workshopOrders.find((item) => item.id === orderId);
  if (!order || order.paid) return;
  const modal = document.getElementById("workshopDeliveryModal");
  const form = document.getElementById("workshopDeliveryForm");
  const payment = document.getElementById("workshopDeliveryPayment");
  if (!modal || !form || !payment) return;
  form.reset();
  form.orderId.value = order.id;
  payment.innerHTML = workshopDeliveryPaymentOptions("efectivo");
  document.getElementById("workshopDeliveryTitle").textContent = `Entregar ${order.number}`;
  updateWorkshopDeliveryPreview();
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  setTimeout(() => payment.focus(), 0);
}

function closeWorkshopDeliveryModal() {
  const modal = document.getElementById("workshopDeliveryModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.getElementById("workshopDeliveryForm")?.reset();
  document.getElementById("workshopDeliveryTitle").textContent = "Entregar Pedido";
}

function completeWorkshop(orderId, paymentMethod = "efectivo") {
  const order = state.workshopOrders.find((item) => item.id === orderId);
  if (!order || order.paid) return;
  if (!state.paymentMethods.some((method) => method.id === paymentMethod)) {
    alert("Elegi un Medio de Pago valido.");
    return;
  }
  order.status = "entregado";
  order.paid = true;
  order.paymentMethod = paymentMethod;
  order.totalPaid = workshopDeliveryTotal(order, paymentMethod);
  order.updatedAt = new Date().toISOString();
  const customer = findOrCreateCustomer(order.customer, { phone: order.phone, type: "taller" });
  order.customerId = customer?.id || "";
  const sale = {
    id: uid("sale"),
    localOrderNumber: nextLocalOrderNumber(),
    date: todayIso(),
    channel: "local",
    source: "taller",
    total: order.totalPaid,
    syncStatus: state.offline ? "pending" : "synced",
    saleType: "minorista",
    paymentMethod,
    reference: order.customer,
    customerId: customer?.id || "",
    customerName: customer?.name || order.customer,
    items: [{ manual: true, description: `Taller ${order.number}: ${order.description}`, category: "Taller", quantity: 1, unitPrice: Number(order.price) }],
  };
  order.saleId = sale.id;
  state.sales.push(sale);
  state.salesHistoryPage = 1;
  logActivity("workshop", "Entrego pedido taller", `${order.number} - ${money(order.totalPaid)}`);
  saveState();
  render();
}

function findWorkshopSale(order) {
  if (!order) return null;
  return state.sales.find((sale) => sale.id === order.saleId)
    || state.sales.find((sale) =>
      sale.channel === "local"
      && sale.source === "taller"
      && (sale.items || []).some((item) => String(item.description || "").includes(`Taller ${order.number}:`))
    );
}

function deleteWorkshopOrder(orderId, confirmed = false) {
  const order = state.workshopOrders.find((item) => item.id === orderId);
  if (!order) return;
  const message = order.paid
    ? `Se eliminara el pedido ${order.number} y tambien la venta registrada en el Historial de Ventas.`
    : `Se eliminara el pedido ${order.number}.`;
  if (!confirmed) {
    openConfirmModal({
      title: "Eliminar pedido",
      message,
      confirmText: "Eliminar",
      danger: true,
      onConfirm: () => deleteWorkshopOrder(orderId, true),
    });
    return;
  }
  const linkedSale = order.paid ? findWorkshopSale(order) : null;
  if (linkedSale) deleteSale(linkedSale.id, { skipConfirm: true, skipRender: true, skipLog: true });
  rememberDeletedRecord("workshopOrders", orderId);
  state.workshopOrders = state.workshopOrders.filter((item) => item.id !== orderId);
  state.salesHistoryPage = 1;
  logActivity("workshop", "Elimino pedido taller", order.number);
  saveState();
  render();
}

function editWorkshopPrice(orderId) {
  const order = state.workshopOrders.find((item) => item.id === orderId);
  if (!order || order.paid) return;
  const modal = document.getElementById("workshopPriceModal");
  const form = document.getElementById("workshopPriceForm");
  if (!modal || !form) return;
  form.reset();
  form.elements.orderId.value = order.id;
  form.elements.price.value = Number(order.price || 0);
  document.getElementById("workshopPriceTitle").textContent = `Editar Precio ${order.number}`;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  formatAllMoneyInputs(modal);
  setTimeout(() => form.elements.price.focus(), 0);
}

function closeWorkshopPriceModal() {
  const modal = document.getElementById("workshopPriceModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.getElementById("workshopPriceForm")?.reset();
}

function saveWorkshopPrice(orderId, price) {
  const order = state.workshopOrders.find((item) => item.id === orderId);
  if (!order || order.paid) return false;
  const nextPrice = Number(price || 0);
  if (!Number.isFinite(nextPrice) || nextPrice < 0) return false;
  order.price = Math.round(nextPrice);
  order.updatedAt = new Date().toISOString();
  logActivity("workshop", "Edito precio taller", `${order.number} - ${money(order.price)}`);
  saveState();
  renderWorkshop();
  return true;
}

function updateExpenseFormType() {
  const form = document.getElementById("expenseForm");
  if (!form) return;
  const category = form.elements.category.value || "Alquiler";
  const rule = expenseCategoryRules[category] || expenseCategoryRules.Servicios;
  const submit = document.getElementById("expenseSubmitButton");
  form.elements.entryType.value = rule.type;
  form.elements.behavior.value = rule.behavior;
  if (submit) submit.textContent = rule.type === "purchase" ? "+ Registrar Mercadería" : "+ Registrar Gasto";
}

function expenseCategoryLabel(category) {
  const labels = { Envios: "Envíos", CompraMercaderia: "Compra de Mercadería", Mercaderia: "Costo de Mercadería", DiferenciaCaja: "Diferencia de Caja" };
  return labels[category] || category;
}

function expenseCountsInResult(expense) {
  const rule = expenseCategoryRules[expense.category];
  return (rule?.type || "expense") === "expense";
}

function expenseTypeLabel(type) {
  return type === "purchase" ? "Mercadería" : "Operativo";
}

function expenseBehaviorLabel(behavior) {
  return behavior === "fijo" ? "Fijo" : "Variable";
}

function canonicalExpenseArea(area) {
  if (area === "general") return "general";
  if (area === "web" || area === "online") return "web";
  return "local";
}

function expenseAreaLabel(area) {
  const labels = { fisico: "Local", local: "Local", online: "Web", web: "Web", general: "General" };
  return labels[canonicalExpenseArea(area)] || "Local";
}

function normalizeFixedExpenseTemplates(templates = []) {
  const saved = new Map((templates || []).map((template) => [template.id, template]));
  const normalizedDefaults = defaultFixedExpenseTemplates.map((template) => {
    const previous = saved.get(template.id) || {};
    return {
      ...template,
      ...previous,
      concept: previous.concept || template.concept,
      category: expenseCategoryRules[previous.category] ? previous.category : template.category,
      area: canonicalExpenseArea(previous.area || template.area),
      amount: Number(previous.amount || 0),
      disabled: Boolean(previous.disabled),
    };
  });
  const customTemplates = (templates || [])
    .filter((template) => template.id && !legacyFixedExpenseTemplateIds.has(template.id) && !defaultFixedExpenseTemplates.some((item) => item.id === template.id))
    .map((template) => ({
      id: template.id,
      concept: String(template.concept || "").trim() || "Gasto fijo",
      category: expenseCategoryRules[template.category] ? template.category : "Servicios",
      area: canonicalExpenseArea(template.area || "general"),
      amount: Number(template.amount || 0),
      disabled: Boolean(template.disabled),
    }));
  return [...normalizedDefaults, ...customTemplates];
}

function expenseTypeClass(type) {
  return type === "purchase" ? "merchandise" : "operative";
}

function expenseCategoriesFromData() {
  const manualExpenseCategories = state.expenses.map((expense) => expense.category).filter(Boolean);
  const purchaseCategories = state.purchases.map((purchase) => purchase.category).filter(Boolean);
  return [...new Set([...Object.keys(expenseCategoryRules), ...manualExpenseCategories, ...purchaseCategories, "Mercaderia"])];
}

function inferExpenseCategory(expense) {
  const concept = String(expense.concept || "").toLowerCase();
  if (concept.includes("alquiler")) return "Alquiler";
  if (concept.includes("publicidad") || concept.includes("instagram") || concept.includes("marketing")) return "Marketing";
  if (concept.includes("comision") || concept.includes("comisión")) return "Comisiones";
  if (concept.includes("impuesto")) return "Impuestos";
  return expense.category || "Servicios";
}

function expenseIsCommission(expense) {
  const source = String(expense.source || "");
  const concept = String(expense.concept || "").toLowerCase();
  return source.startsWith("commission-")
    || expense.category === "Comisiones"
    || concept.includes("comision")
    || concept.includes("comisión");
}

function renderExpenseCategoryOptions() {
  const categorySelect = document.getElementById("expenseCategorySelect");
  const categoryFilter = document.getElementById("expenseCategoryFilter");
  const formCategories = Object.keys(expenseCategoryRules).filter((category) => expenseCategoryRules[category].showInForm !== false);
  const categories = expenseCategoriesFromData();
  if (categorySelect) {
    const selected = categorySelect.value || "Alquiler";
    categorySelect.innerHTML = formCategories
      .map((category) => `<option value="${htmlAttr(category)}" ${category === selected ? "selected" : ""}>${expenseCategoryLabel(category)}</option>`)
      .join("");
  }
  if (categoryFilter) {
    const selected = state.expenseFilters?.category || "all";
    categoryFilter.innerHTML = [
      `<option value="all">Todas</option>`,
      ...categories.map((category) => `<option value="${htmlAttr(category)}" ${category === selected ? "selected" : ""}>${expenseCategoryLabel(category)}</option>`),
    ].join("");
  }
}

function renderExpensePeriodOptions() {
  const yearFilter = document.getElementById("expenseYearFilter");
  const monthFilter = document.getElementById("expenseMonthFilter");
  if (!yearFilter) return;
  const currentYear = String(new Date().getFullYear());
  const currentMonth = String(new Date().getMonth() + 1).padStart(2, "0");
  const years = [
    ...new Set([
      currentYear,
      ...expenseRows()
        .map((entry) => String(entry.date || "").slice(0, 4))
        .filter(Boolean),
    ]),
  ].sort((a, b) => Number(b) - Number(a));
  const selectedYear = state.expenseFilters?.year || currentYear;
  yearFilter.innerHTML = years
    .map((year) => `<option value="${year}" ${year === selectedYear ? "selected" : ""}>${year}</option>`)
    .join("");
  if (monthFilter) monthFilter.value = state.expenseFilters?.month || currentMonth;
}

function saleCostConcept(sale) {
  if (sale.channel === "online") return `Costo venta online ${sale.orderNumber || saleOrder(sale)}`;
  return `Costo venta local ${saleOrder(sale)}`;
}

function saleCostDetail(sale) {
  if (sale.channel === "online") {
    const store = onlineStoreName(sale.onlineStore || sale.store);
    return sale.onlinePromo && sale.onlinePromo !== "base" ? `${store} · ${onlinePromoLabel(sale.onlinePromo)}` : store;
  }
  return "Productos vendidos en Local";
}

function expenseRowOrder(record, index = 0) {
  return idTimestamp(record?.id) || Date.parse(record?.createdAt || "") || index;
}

function expenseRows() {
  const manualExpenses = state.expenses.map((expense, index) => ({
    key: `expense:${expense.id}`,
    source: "expense",
    id: expense.id,
    date: expense.date,
    type: "expense",
    category: inferExpenseCategory(expense),
    behavior: expense.kind || "variable",
    area: canonicalExpenseArea(expense.area),
    concept: expense.concept,
    detail: expense.source === "cash-close" ? "Ajuste automático de Cierre de Caja" : expense.source === "fixed-monthly" ? "Gasto fijo mensual" : "Gasto cargado manualmente",
    amount: Number(expense.amount || 0),
    affectsResult: expenseCountsInResult(expense),
    deletable: expense.source !== "cash-close",
    rowOrder: expenseRowOrder(expense, index),
  }));
  const purchases = state.purchases.map((purchase, index) => {
    const automatic = isAutomaticStockPurchase(purchase);
    return {
      key: `purchase:${purchase.id}`,
      source: "purchase",
      id: purchase.id,
      date: purchase.date,
      type: "purchase",
      category: purchase.category || "Mercaderia",
      behavior: purchase.behavior || "variable",
      area: canonicalExpenseArea(purchase.area),
      concept: purchase.supplier,
      detail: purchaseExpenseDetail(purchase),
      amount: Number(purchase.amount || 0),
      affectsResult: false,
      deletable: !automatic,
      editableAmount: isStockControlLiquidation(purchase),
      automatic,
      rowOrder: expenseRowOrder(purchase, index),
    };
  });
  const saleCosts = state.sales
    .map((sale, index) => ({
      key: `sale-cost:${sale.id}`,
      source: "sale-cost",
      id: sale.id,
      date: sale.date,
      type: "purchase",
      category: "Mercaderia",
      behavior: "variable",
      area: sale.channel === "online" ? "web" : "local",
      concept: saleCostConcept(sale),
      detail: saleCostDetail(sale),
      amount: saleMerchandiseCost(sale),
      affectsResult: true,
      deletable: false,
      rowOrder: expenseRowOrder(sale, index),
    }))
    .filter((entry) => entry.amount > 0);
  return [...manualExpenses, ...purchases, ...saleCosts, ...onlineCommissionExpenseRows()];
}

function onlineCommissionExpenseRows(sourceSales = state.sales) {
  return sourceSales
    .filter((sale) => sale.channel === "online")
    .flatMap((sale, index) => {
      const platform = canonicalOnlinePaymentPlatform(sale.paymentPlatform, sale.paymentMethod);
      const rows = [];
      const tiendaNubeAmount = tiendaNubeCommissionAmount(sale);
      const platformAmount = platformCommissionAmount(sale);
      if (tiendaNubeAmount > 0) {
        rows.push({
          key: `commission-tn:${sale.id}`,
          source: "commission-tn",
          id: sale.id,
          date: sale.date,
          type: "expense",
          category: "Comisiones",
          behavior: "variable",
          area: "web",
          concept: `Comisión Tienda Nube ${sale.orderNumber || saleOrder(sale)}`,
          detail: `${Number(businessSettings().tiendaNubeCommissionRate || 0)}% automático sobre el total cobrado`,
          amount: tiendaNubeAmount,
          affectsResult: true,
          deletable: false,
          automatic: true,
          rowOrder: expenseRowOrder(sale, index) + 0.2,
        });
      }
      if (platformAmount > 0) {
        rows.push({
          key: `commission-platform:${sale.id}`,
          source: "commission-platform",
          id: sale.id,
          date: sale.date,
          type: "expense",
          category: "Comisiones",
          behavior: "variable",
          area: "web",
          concept: `Comisión ${onlinePaymentPlatformLabel(platform)} ${sale.orderNumber || saleOrder(sale)}`,
          detail: "Comisión automática de plataforma de pago",
          amount: platformAmount,
          affectsResult: true,
          deletable: false,
          automatic: true,
          rowOrder: expenseRowOrder(sale, index) + 0.1,
        });
      }
      return rows;
    });
}

function operatingExpenseRows() {
  return [...state.expenses, ...onlineCommissionExpenseRows()];
}

function filteredExpenseRows() {
  const filters = state.expenseFilters || {};
  filters.area = "all";
  const query = String(filters.query || "").trim().toLowerCase();
  const year = filters.year || String(new Date().getFullYear());
  const month = filters.month || String(new Date().getMonth() + 1).padStart(2, "0");
  const category = filters.category || "all";
  const type = filters.type || "all";
  const behavior = filters.behavior || "all";
  const area = filters.area || "all";
  const commissions = filters.commissions || "all";
  return expenseRows()
    .filter((entry) => !query || [entry.concept, entry.category, entry.detail, expenseAreaLabel(entry.area)].some((value) => String(value || "").toLowerCase().includes(query)))
    .filter((entry) => String(entry.date || "").slice(0, 4) === year)
    .filter((entry) => month === "all" || String(entry.date || "").slice(5, 7) === month)
    .filter((entry) => category === "all" || entry.category === category)
    .filter((entry) => type === "all" || entry.type === type)
    .filter((entry) => behavior === "all" || entry.behavior === behavior)
    .filter((entry) => area === "all" || canonicalExpenseArea(entry.area) === area)
    .filter((entry) => commissions !== "hide" || !expenseIsCommission(entry))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.rowOrder || 0) - Number(a.rowOrder || 0));
}

function deleteExpenseMovement(key) {
  const [source, id] = String(key || "").split(":");
  const entry = expenseRows().find((item) => item.key === key);
  if (!entry || !entry.deletable) return;
  openConfirmModal({
    title: "Eliminar gasto",
    message: `Se eliminará ${entry.concept} por ${money(entry.amount)}.`,
    confirmText: "Eliminar",
    danger: true,
    onConfirm: async () => {
      if (CLOUD_DATA_ENABLED && isUuid(id)) {
        try {
          if (!cloudEnabledWithSession()) {
            showAuthError("Ingresá con tu usuario BlackShoes para archivar gastos en Supabase.");
            renderAuthState("Ingresá para guardar en Supabase.");
            return;
          }
          await archiveCloudRecord("expense", id);
          logActivity("expense", "Archivo gasto", `${entry.concept} - ${money(entry.amount)}`);
          await loadCloudOperationalData();
          saveState();
          render();
          showActionToast("Gasto archivado en Supabase.");
          return;
        } catch (error) {
          console.warn("Cloud expense archive failed", error);
          alert(`No pude archivar el gasto en Supabase: ${error.message || "error desconocido"}`);
          return;
        }
      }
      if (source === "expense") {
        rememberDeletedRecord("expenses", id);
        state.expenses = state.expenses.filter((item) => item.id !== id);
      }
      if (source === "purchase") {
        rememberDeletedRecord("purchases", id);
        state.purchases = state.purchases.filter((item) => item.id !== id);
      }
      logActivity("expense", "Elimino gasto", `${entry.concept} - ${money(entry.amount)}`);
      saveState();
      render();
    },
  });
}

function updateExpenseMovementAmount(key, amount) {
  const [source, id] = String(key || "").split(":");
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return;
  if (!unlockedExpenseAmounts.has(key)) return;
  let updated = false;
  if (source === "purchase") {
    const purchase = state.purchases.find((item) => item.id === id);
    if (purchase && isStockControlLiquidation(purchase)) {
      purchase.amount = value;
      updated = true;
    }
  }
  if (!updated) return;
  const entry = expenseRows().find((item) => item.key === key);
  logActivity("expense", "Edito importe liquidacion", `${entry?.concept || "Liquidacion de stock"} - ${money(value)}`);
  saveState();
  renderExpenses();
}

function renderExpenseAmountCell(entry) {
  if (!entry.editableAmount) return `<strong>${money(entry.amount)}</strong>`;
  const unlocked = unlockedExpenseAmounts.has(entry.key);
  const stateClass = unlocked ? "unlocked" : "locked";
  const lockLabel = unlocked ? "Desbloqueado" : "Bloqueado";
  const lockIcon = unlocked ? "&#128275;" : "&#128274;";
  return `
    <div class="expense-amount-edit ${stateClass}">
      <div class="money-field expense-amount-field">
        <span>$</span>
        <input data-expense-amount="${htmlAttr(entry.key)}" type="number" step="1" value="${Number(entry.amount || 0)}" ${unlocked ? "" : "disabled"}>
      </div>
      <button class="expense-lock-button" data-toggle-expense-lock="${htmlAttr(entry.key)}" type="button" title="${lockLabel}" aria-label="${lockLabel} importe">${lockIcon}</button>
    </div>
  `;
}

function reportPeriodRange() {
  const now = new Date();
  if (state.reportPeriod === "today") {
    return {
      from: new Date(`${todayIso()}T00:00:00`),
      to: new Date(`${todayIso()}T23:59:59`),
    };
  }
  if (state.reportPeriod === "all") return { from: new Date("2000-01-01"), to: null };
  if (state.reportPeriod === "year") return { from: new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()), to: null };
  if (state.reportPeriod === "custom") {
    const from = normalizeDateInput(state.reportCustomFrom) || monthAgoIso();
    const to = normalizeDateInput(state.reportCustomTo) || todayIso();
    const fromDate = new Date(`${from}T00:00:00`);
    const toDate = new Date(`${to}T23:59:59`);
    return {
      from: fromDate <= toDate ? fromDate : new Date(`${to}T00:00:00`),
      to: fromDate <= toDate ? toDate : new Date(`${from}T23:59:59`),
    };
  }
  return {
    from: new Date(`${currentMonthStartIso()}T00:00:00`),
    to: new Date(`${currentMonthEndIso()}T23:59:59`),
  };
}

function inPeriod(date) {
  const current = new Date(`${date}T00:00:00`);
  const range = reportPeriodRange();
  return current >= range.from && (!range.to || current <= range.to);
}

function sum(list, selector) {
  return list.reduce((total, item) => total + Number(selector(item) || 0), 0);
}

function saleBucket(sale) {
  if (sale.channel === "local") return "local";
  if (sale.onlineStore === "accesorios" || sale.store === "accesorios") return "accesorios";
  return "insumos";
}

function reportSaleMatchesScope(sale) {
  if (state.reportScope === "local") return sale.channel === "local";
  if (state.reportScope === "web") return sale.channel === "online";
  return true;
}

function reportExpenseMatchesScope(expense) {
  const area = canonicalExpenseArea(expense.area);
  if (state.reportScope === "local") return area === "local" || area === "general";
  if (state.reportScope === "web") return area === "web" || area === "general";
  return true;
}

function reportExpenseAmount(expense) {
  const amount = Number(expense.amount || 0);
  const area = canonicalExpenseArea(expense.area);
  if ((state.reportScope === "local" || state.reportScope === "web") && area === "general") return amount / 2;
  return amount;
}

function historicalClosureForMonth(monthKey) {
  return (state.monthlyClosures || []).find((closure) => closure.monthKey === monthKey && closure.source === "historical-import");
}

function closureIsInReportPeriod(closure) {
  return inPeriod(`${closure.monthKey || currentMonthKey()}-01`);
}

function closureScopeMetrics(closure, scope = state.reportScope || "total") {
  const localIncome = Number(closure.localIncome || 0);
  const webAccesorios = Number(closure.webAccesoriosIncome || 0);
  const webInsumos = Number(closure.webInsumosIncome ?? Math.max(0, Number(closure.webIncome || 0) - webAccesorios));
  const webIncome = Number(closure.webIncome ?? (webAccesorios + webInsumos));
  const fixedLocal = Number(closure.fixedExpensesLocal || 0);
  const fixedWeb = Number(closure.fixedExpensesWeb || 0);
  const variableLocal = Number(closure.variableExpensesLocal || 0);
  const variableWeb = Number(closure.variableExpensesWeb || 0);
  const merchandiseLocal = Number(closure.merchandiseCostLocal || 0);
  const merchandiseWeb = Number(closure.merchandiseCostWeb || 0);
  const metrics = scope === "local"
    ? {
      income: localIncome,
      localIncome,
      webIncome: 0,
      webInsumos: 0,
      webAccesorios: 0,
      fixedExpenses: fixedLocal,
      variableExpenses: variableLocal,
      merchandiseCost: merchandiseLocal,
    }
    : scope === "web"
      ? {
        income: webIncome,
        localIncome: 0,
        webIncome,
        webInsumos,
        webAccesorios,
        fixedExpenses: fixedWeb,
        variableExpenses: variableWeb,
        merchandiseCost: merchandiseWeb,
      }
      : {
        income: localIncome + webIncome,
        localIncome,
        webIncome,
        webInsumos,
        webAccesorios,
        fixedExpenses: fixedLocal + fixedWeb,
        variableExpenses: variableLocal + variableWeb,
        merchandiseCost: merchandiseLocal + merchandiseWeb,
      };
  metrics.expenseTotal = metrics.fixedExpenses + metrics.variableExpenses;
  metrics.costs = metrics.expenseTotal + metrics.merchandiseCost;
  metrics.margin = metrics.income - metrics.costs;
  metrics.shipping = Number(closure.shipping || 0);
  return metrics;
}

function historicalClosuresInReportPeriod() {
  return (state.monthlyClosures || [])
    .filter((closure) => closure.source === "historical-import" && closure.monthKey && closureIsInReportPeriod(closure));
}

function addToNumberMap(target, source = {}) {
  Object.entries(source || {}).forEach(([label, value]) => {
    const key = canonicalProductCategory(label);
    target[key] = (target[key] || 0) + Number(value || 0);
  });
}

function addToProvinceMap(target, source = {}) {
  Object.entries(source || {}).forEach(([province, count]) => {
    if (!target[province]) target[province] = { amount: 0, count: 0 };
    target[province].count += Number(count || 0);
  });
}

function historicalDetailsInReportPeriod() {
  return Object.entries(state.historicalMonthlyDetails || {})
    .filter(([monthKey]) => inPeriod(`${monthKey}-01`))
    .map(([monthKey, detail]) => ({ monthKey, detail }));
}

function historicalDetailValues() {
  return Object.values(state.historicalMonthlyDetails || {});
}

function historicalAverageCategoryMap(scope = state.reportScope || "total") {
  const details = historicalDetailValues();
  const totals = {};
  details.forEach((detail) => {
    if (scope !== "web") addToNumberMap(totals, detail.localCategories);
    if (scope !== "local") addToNumberMap(totals, detail.webCategories);
  });
  const divisor = Math.max(1, details.length);
  return Object.fromEntries(Object.entries(totals).map(([label, value]) => [label, value / divisor]));
}

function historicalAverageProvinceMap() {
  const details = historicalDetailValues();
  const totals = {};
  details.forEach((detail) => {
    Object.entries(detail.provinces || {}).forEach(([province, count]) => {
      totals[province] = (totals[province] || 0) + Number(count || 0);
    });
  });
  const divisor = Math.max(1, details.length);
  return Object.fromEntries(Object.entries(totals).map(([label, value]) => [label, value / divisor]));
}

function reportComparisonMonthSpan() {
  if (state.reportPeriod === "month") return 1;
  if (state.reportPeriod === "year") return 12;
  return 0;
}

function reportComparisonLabel() {
  if (state.reportPeriod === "year") return "Prom. anual";
  return "Prom. mensual";
}

function assignLocalOrderNumbers(target = state) {
  const usedNumbers = new Set();
  const localSales = (target.sales || []).filter((sale) => sale.channel === "local");
  localSales.forEach((sale) => {
    const orderNumber = Number(sale.localOrderNumber || 0);
    if (orderNumber > 0) {
      sale.localOrderNumber = orderNumber;
      usedNumbers.add(orderNumber);
    }
  });
  let nextNumber = 1;
  localSales.forEach((sale) => {
    if (sale.localOrderNumber) return;
    while (usedNumbers.has(nextNumber)) nextNumber += 1;
    sale.localOrderNumber = nextNumber;
    usedNumbers.add(nextNumber);
  });
}

function nextLocalOrderNumber() {
  const numbers = state.sales
    .filter((sale) => sale.channel === "local")
    .map((sale) => Number(sale.localOrderNumber || 0))
    .filter((number) => number > 0);
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

function saleOrder(sale) {
  if (sale.orderNumber) return sale.orderNumber;
  if (sale.channel === "local") return `#${String(sale.localOrderNumber || 0).padStart(4, "0")}`;
  return "#0000";
}

function saleChannelLabel(sale) {
  if (sale.channel === "online" && !MODULE_FLAGS.onlineSales) return "Local";
  if (sale.source === "taller" && !MODULE_FLAGS.workshop) return "Local";
  if (sale.channel === "online") return saleBucket(sale) === "accesorios" ? "Online Canal 2" : "Online Canal 1";
  if (sale.source === "taller") return "Taller";
  return "Local";
}

function saleModuleEnabled(sale) {
  if (sale.channel === "online") return MODULE_FLAGS.onlineSales;
  if (sale.source === "taller") return MODULE_FLAGS.workshop;
  return true;
}

function hasMultipleVisibleSalesChannels() {
  return MODULE_FLAGS.onlineSales || state.sales.some((sale) => sale.channel === "online" && saleModuleEnabled(sale));
}

function salesHistoryPaymentOptions(selected = "all") {
  const names = new Set(["all"]);
  state.paymentMethods.forEach((method) => names.add(method.name));
  if (MODULE_FLAGS.onlineSales) onlinePaymentMethods.forEach((method) => names.add(method));
  state.sales
    .filter(saleModuleEnabled)
    .forEach((sale) => names.add(paymentMethodName(sale.paymentMethod || (sale.channel === "online" ? "web" : ""))));
  return Array.from(names).map((name) => {
    const label = name === "all" ? "Todos los Medios" : name;
    return `<option value="${htmlAttr(name)}" ${selected === name ? "selected" : ""}>${label}</option>`;
  }).join("");
}

function salesHistoryDateRange(filters) {
  if (filters.period === "week") return { from: daysAgoIso(7), to: todayIso() };
  if (filters.period === "month") return { from: currentMonthStartIso(), to: currentMonthEndIso() };
  if (filters.period === "custom") return { from: normalizeDateInput(filters.from), to: normalizeDateInput(filters.to) };
  return { from: "", to: "" };
}

function saleMatchesHistoryChannel(sale, channel) {
  if (channel === "all") return true;
  if (channel === "local") return sale.channel === "local" && sale.source !== "taller";
  if (channel === "taller") return sale.source === "taller";
  if (channel === "online") return sale.channel === "online";
  if (channel === "online-insumos") return sale.channel === "online" && saleBucket(sale) === "insumos";
  if (channel === "online-accesorios") return sale.channel === "online" && saleBucket(sale) === "accesorios";
  return true;
}

function filteredSalesHistory() {
  const filters = state.salesHistoryFilters || {};
  filters.channel = "all";
  const query = String(filters.order || "").trim().toLowerCase();
  const payment = filters.payment || "all";
  const { from, to } = salesHistoryDateRange(filters);
  return state.sales.filter((sale) => {
    const order = saleOrder(sale).toLowerCase();
    const method = paymentMethodName(sale.paymentMethod || (sale.channel === "online" ? "web" : ""));
    return saleModuleEnabled(sale)
      && (!query || order.includes(query))
      && (!from || sale.date >= from)
      && (!to || sale.date <= to)
      && saleMatchesHistoryChannel(sale, filters.channel || "all")
      && (payment === "all" || method === payment);
  });
}

function salesHistorySort(left, right) {
  const dateCompare = String(right.date || "").localeCompare(String(left.date || ""));
  if (dateCompare) return dateCompare;
  const orderCompare = saleOrder(right).localeCompare(saleOrder(left), "es", { numeric: true, sensitivity: "base" });
  if (orderCompare) return orderCompare;
  return idTimestamp(right.id) - idTimestamp(left.id);
}

function saleDetailLines(sale) {
  if (sale.channel === "online") return sale.onlineLines || [];
  return sale.items || [];
}

function saleItemCount(sale) {
  return sum(saleDetailLines(sale), (item) => item.quantity || 1);
}

function saleDetailText(sale) {
  const lines = saleDetailLines(sale);
  if (!lines.length) return "Sin Detalle";
  return lines
    .map((item) => `${item.description || item.category || "Artículo"} ×${item.quantity || 1}`)
    .join(", ");
}

function saleInfoField(label, value) {
  const text = value === "" || value == null ? "-" : value;
  return `
    <div class="sale-info-card">
      <span>${htmlAttr(label)}</span>
      <strong>${htmlAttr(text)}</strong>
    </div>
  `;
}

function saleCustomerForInfo(sale, linkedOrder = null) {
  if (sale.customerId) return state.customers.find((customer) => customer.id === sale.customerId) || null;
  const dni = normalizeCustomerDni(sale.customerDni || linkedOrder?.customerDni);
  if (dni) return findCustomerByDni(dni);
  const nameKey = normalizeTextKey(sale.customerName || linkedOrder?.customerName || sale.reference);
  if (!nameKey) return null;
  return state.customers.find((customer) => normalizeTextKey(customer.name) === nameKey) || null;
}

function saleInfoLineTotal(item) {
  const quantity = Number(item.quantity || 1);
  if (item.total != null) return Number(item.total || 0);
  return quantity * Number(item.unitPrice || item.price || 0);
}

function saleInfoItemRows(sale) {
  const lines = saleDetailLines(sale);
  if (!lines.length) return `<tr><td colspan="6">Sin detalle de productos.</td></tr>`;
  return lines.map((item) => {
    const product = item.productId ? state.products.find((entry) => entry.id === item.productId) : null;
    const code = product?.code || item.productCode || item.code || "";
    const description = item.description || product?.description || item.category || "Artículo";
    const quantity = Number(item.quantity || 1);
    const unitPrice = Number(item.unitPrice || item.price || 0);
    const total = saleInfoLineTotal(item);
    return `
      <tr>
        <td><strong>${htmlAttr(code || "-")}</strong><br><small>${htmlAttr(description)}</small></td>
        <td>${htmlAttr(item.category || product?.category || "-")}</td>
        <td>${htmlAttr(item.subcategory || product?.subcategory || "-")}</td>
        <td>${quantity}</td>
        <td>${unitPrice ? money(unitPrice) : "-"}</td>
        <td>${total ? money(total) : "-"}</td>
      </tr>
    `;
  }).join("");
}

function saleInfoAmountFields(sale, linkedOrder = null) {
  if (sale.channel !== "online") {
    return [
      saleInfoField("Subtotal", money(saleBaseSubtotal(sale))),
      saleInfoField("Total venta", money(sale.total)),
      saleInfoField("Pagado", money(saleTotalPaidAmount(sale))),
      saleInfoField("Deuda pendiente", money(saleOutstandingDebt(sale))),
      saleInfoField("Costo mercadería", money(saleMerchandiseCost(sale))),
    ].join("");
  }
  const grossAmount = onlineGrossAmountFromRecord({ ...(linkedOrder || {}), ...sale });
  const discountAmount = onlineDiscountAmountFromRecord({ ...(linkedOrder || {}), ...sale });
  const shippingAmount = Number(sale.shippingAmount ?? linkedOrder?.shippingAmount ?? linkedOrder?.shipping ?? 0);
  const saleAmount = onlineDiscountedSaleAmount(grossAmount, discountAmount);
  const collectedTotal = onlineSaleCollectedTotal({ ...(linkedOrder || {}), ...sale, total: saleAmount, shippingAmount });
  const costRate = Number(sale.onlineCostRate ?? linkedOrder?.costRate ?? onlineCostRate(sale.onlineStore || sale.store || linkedOrder?.store || "insumos", "base"));
  return [
    saleInfoField("Importe", money(grossAmount)),
    saleInfoField("Envío", money(shippingAmount)),
    saleInfoField("Descuento", money(discountAmount)),
    saleInfoField("Venta real", money(saleAmount)),
    saleInfoField("Total cobrado", money(collectedTotal)),
    saleInfoField(`Costo ${formatCostRate(costRate)}`, money(saleMerchandiseCost(sale))),
  ].join("");
}

function openSaleInfoModal(saleId) {
  const sale = state.sales.find((item) => item.id === saleId);
  const modal = document.getElementById("saleInfoModal");
  const content = document.getElementById("saleInfoContent");
  if (!sale || !modal || !content) return;
  const linkedOrder = sale.channel === "online" ? findOnlineOrderForSale(sale) : null;
  const customer = saleCustomerForInfo(sale, linkedOrder);
  const customerName = sale.customerName || linkedOrder?.customerName || customer?.name || sale.reference || "-";
  const customerDni = normalizeCustomerDni(sale.customerDni || linkedOrder?.customerDni || customer?.dni);
  const province = sale.province || linkedOrder?.province || customer?.province || "-";
  const paymentMethod = paymentMethodName(sale.paymentMethod || (sale.channel === "online" ? "web" : ""));
  const paymentPlatform = sale.channel === "online" ? onlinePaymentPlatformLabel(sale.paymentPlatform || linkedOrder?.paymentPlatform) : "";
  content.innerHTML = `
    <div class="sale-info-grid">
      ${saleInfoField("Orden", saleOrder(sale))}
      ${saleInfoField("Fecha", formatDateShort(sale.date))}
      ${saleInfoField("Canal", saleChannelLabel(sale))}
      ${saleInfoField("Cliente", customerName)}
      ${saleInfoField("DNI", customerDni ? formatCustomerDni(customerDni) : "-")}
      ${saleInfoField("Provincia", province)}
      ${saleInfoField("Medio de pago", paymentMethod)}
      ${sale.channel === "online" ? saleInfoField("Plataforma", paymentPlatform) : ""}
      ${sale.channel === "online" ? saleInfoField("Tienda", onlineStoreName(sale.onlineStore || sale.store || linkedOrder?.store || "insumos")) : ""}
      ${saleInfoAmountFields(sale, linkedOrder)}
    </div>
    <div class="sale-info-section">
      <h3>Productos / Categorías</h3>
      <div class="table-wrap sale-info-items">
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Categoría</th>
              <th>Subcategoría</th>
              <th>Cantidad</th>
              <th>Precio</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>${saleInfoItemRows(sale)}</tbody>
        </table>
      </div>
    </div>
  `;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeSaleInfoModal() {
  const modal = document.getElementById("saleInfoModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function saleBaseSubtotal(sale) {
  if (sale.channel === "online") return Number(sale.total || 0);
  return sum(saleDetailLines(sale), (item) => Number(item.quantity || 1) * Number(item.unitPrice || 0));
}

function salePaymentDetail(sale) {
  return "";
}

function receiptItems(sale) {
  const lines = saleDetailLines(sale);
  if (sale.channel === "online") {
    return lines.length ? lines.map((item) => {
      const quantity = Number(item.quantity || 1);
      const unitPrice = Math.round(Number(sale.total || 0) / Math.max(1, quantity));
      return { quantity, description: item.category || "Venta Online", unitPrice, total: unitPrice * quantity };
    }) : [{ quantity: 1, description: "Venta Online", unitPrice: Number(sale.total || 0), total: Number(sale.total || 0) }];
  }
  return lines.map((item) => ({
    quantity: Number(item.quantity || 1),
    description: item.description || item.category || "Artículo",
    unitPrice: Number(item.unitPrice || 0),
    total: Number(item.quantity || 1) * Number(item.unitPrice || 0),
  }));
}

function receiptSubtotal(sale) {
  return sum(receiptItems(sale), (item) => item.total);
}

function receiptDiscount(sale) {
  return Math.max(0, receiptSubtotal(sale) - Number(sale.total || 0));
}

function pdfSafeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pdfEscape(value) {
  return pdfSafeText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function pdfMoney(value) {
  return `$ ${Math.round(Number(value || 0)).toLocaleString("es-AR")}`;
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function loadLogoForPdf() {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      try {
        resolve({ width: canvas.width, height: canvas.height, bytes: dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.92)) });
      } catch (error) {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = "";
  });
}

function buildPdf(parts, image) {
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [0];
  let length = 0;
  const pushString = (value) => {
    const bytes = encoder.encode(value);
    chunks.push(bytes);
    length += bytes.length;
  };
  const pushBytes = (bytes) => {
    chunks.push(bytes);
    length += bytes.length;
  };
  const addObject = (id, bodyParts) => {
    offsets[id] = length;
    pushString(`${id} 0 obj\n`);
    bodyParts.forEach((part) => (typeof part === "string" ? pushString(part) : pushBytes(part)));
    pushString("\nendobj\n");
  };

  pushString("%PDF-1.4\n");
  addObject(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  addObject(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  const resourceImage = image ? " /XObject << /Logo 6 0 R >>" : "";
  addObject(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >>${resourceImage} >> /Contents ${image ? "7" : "6"} 0 R >>`]);
  addObject(4, ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]);
  addObject(5, ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"]);
  let contentId = 6;
  if (image) {
    addObject(6, [
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
      image.bytes,
      "\nendstream",
    ]);
    contentId = 7;
  }
  addObject(contentId, [`<< /Length ${encoder.encode(parts).length} >>\nstream\n${parts}\nendstream`]);

  const xrefOffset = length;
  const totalObjects = contentId;
  pushString(`xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= totalObjects; id += 1) pushString(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  pushString(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return new Blob(chunks, { type: "application/pdf" });
}

async function downloadSaleReceipt(saleId) {
  const sale = state.sales.find((item) => item.id === saleId);
  if (!sale) return;
  const logo = await loadLogoForPdf();
  const commands = [];
  const line = (x1, y1, x2, y2, width = 1) => commands.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  const rect = (x, y, w, h, fill = false) => commands.push(`${x} ${y} ${w} ${h} re ${fill ? "f" : "S"}`);
  const text = (value, x, y, size = 10, bold = false) => commands.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${pdfEscape(value)}) Tj ET`);
  const right = (value, x, y, size = 10, bold = false) => {
    const safe = pdfSafeText(value);
    text(safe, x - safe.length * size * 0.46, y, size, bold);
  };
  const items = receiptItems(sale);
  const subtotal = receiptSubtotal(sale);
  const discount = receiptDiscount(sale);
  const total = Number(sale.total || 0);

  if (logo) {
    commands.push(`q 120 0 0 50 42 755 cm /Logo Do Q`);
  } else {
    text("SISTEMA BASE", 48, 765, 24, true);
  }
  text("Comprobante", 48, 742, 11, true);
  text("Recibo de Ventas", 310, 770, 26, true);
  text(`Orden: ${saleOrder(sale)}`, 420, 742, 11, true);
  text(`Fecha: ${formatDateShort(sale.date)}`, 420, 724, 10);

  rect(40, 625, 515, 88);
  text("Cliente:", 58, 690, 10, true);
  text("Direccion: Iturraspe 2012", 58, 670, 10, true);
  text("Ciudad: San Francisco", 58, 650, 10, true);
  text("Provincia: Cordoba", 310, 650, 10, true);
  text("Código postal: 2400", 310, 670, 10, true);

  const top = 590;
  commands.push("0.92 0.98 0.88 rg");
  rect(40, top, 515, 24, true);
  commands.push("0 0 0 RG 0 0 0 rg");
  rect(40, top, 515, 24);
  text("Cant.", 58, top + 8, 10, true);
  text("Elemento/Descripcion", 145, top + 8, 10, true);
  text("Precio/Unidad", 390, top + 8, 10, true);
  text("Total", 500, top + 8, 10, true);
  [100, 375, 465].forEach((x) => line(x, top, x, top + 24));

  let y = top - 22;
  const rowHeight = 22;
  const rowsToDraw = Math.max(12, items.length);
  for (let index = 0; index < rowsToDraw; index += 1) {
    rect(40, y, 515, rowHeight);
    [100, 375, 465].forEach((x) => line(x, y, x, y + rowHeight));
    const item = items[index];
    if (item) {
      text(item.quantity, 62, y + 7, 9);
      text(pdfSafeText(item.description).slice(0, 58), 108, y + 7, 9);
      right(pdfMoney(item.unitPrice), 455, y + 7, 9);
      right(pdfMoney(item.total), 545, y + 7, 9);
    }
    y -= rowHeight;
  }

  const totalsY = y - 6;
  text(`Medio de Pago: ${paymentMethodName(sale.paymentMethod || (sale.channel === "online" ? "web" : ""))}`, 48, totalsY + 52, 10);
  text("SUBTOTAL", 375, totalsY + 52, 10, true);
  right(pdfMoney(subtotal), 545, totalsY + 52, 10);
  text("DESCUENTO", 375, totalsY + 32, 10, true);
  right(pdfMoney(discount), 545, totalsY + 32, 10);
  text("TOTAL", 375, totalsY + 8, 12, true);
  right(pdfMoney(total), 545, totalsY + 8, 12, true);
  rect(465, totalsY, 90, 74);
  line(465, totalsY + 24, 555, totalsY + 24);
  line(465, totalsY + 48, 555, totalsY + 48);

  text("Todas las devoluciones y cambios deben estar acompanados por este comprobante", 48, 80, 10, true);

  const pdf = buildPdf(commands.join("\n"), logo);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(pdf);
  link.download = `comprobante-${saleOrder(sale).replace(/[^a-zA-Z0-9-]/g, "")}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function availableMonthKeys() {
  const keys = new Set([currentMonthKey()]);
  for (let offset = 1; offset <= 11; offset += 1) {
    const date = new Date();
    date.setMonth(date.getMonth() - offset);
    keys.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }
  state.sales.forEach((sale) => keys.add(monthKeyFromDate(sale.date)));
  operatingExpenseRows().forEach((expense) => keys.add(monthKeyFromDate(expense.date)));
  (state.monthlyClosures || []).forEach((closure) => {
    if (closure.monthKey) keys.add(closure.monthKey);
  });
  return Array.from(keys).sort().reverse();
}

function availableYearKeys() {
  const years = new Set(availableMonthKeys().map((key) => key.slice(0, 4)));
  years.add(String(new Date().getFullYear()));
  return Array.from(years).sort((a, b) => Number(b) - Number(a));
}

function renderMonthSelector() {
  const monthSelect = document.getElementById("monthPickerMonth");
  const yearSelect = document.getElementById("monthPickerYear");
  const legacySelector = document.getElementById("monthSelector");
  const months = availableMonthKeys();
  if (!months.includes(state.selectedMonth)) state.selectedMonth = months[0] || currentMonthKey();
  const [selectedYear, selectedMonth] = state.selectedMonth.split("-");
  if (monthSelect) {
    monthSelect.innerHTML = Array.from({ length: 12 }, (_, index) => {
      const value = String(index + 1).padStart(2, "0");
      const label = new Intl.DateTimeFormat("es-AR", { month: "long" }).format(new Date(2026, index, 1));
      return `<option value="${value}" ${value === selectedMonth ? "selected" : ""}>${label.charAt(0).toUpperCase() + label.slice(1)}</option>`;
    }).join("");
  }
  if (yearSelect) {
    const years = availableYearKeys();
    if (!years.includes(selectedYear)) years.unshift(selectedYear);
    yearSelect.innerHTML = years.map((year) => `<option value="${year}" ${year === selectedYear ? "selected" : ""}>${year}</option>`).join("");
  }
  if (legacySelector) {
    legacySelector.innerHTML = months
      .map((key) => `<option value="${key}" ${key === state.selectedMonth ? "selected" : ""}>${monthLabel(key)}</option>`)
      .join("");
  }
}

function render() {
  applyNavigationPermissions();
  renderConnection();
  renderDashboard();
  renderPos();
  renderSalesHistory();
  renderCatalog();
  renderCustomers();
  renderWorkshop();
  renderOnline();
  renderExpenses();
  renderReports();
  renderSettings();
  renderMonthlyClosures();
  formatAllMoneyInputs();
  lockAllBrowserAutofillFields();
}

function renderConnection() {
  state.offline = !navigator.onLine;
  document.getElementById("offlineToggle").checked = state.offline;
  document.getElementById("connectionLabel").textContent = state.offline ? "Offline" : "Online";
  const pending = state.sales.filter((sale) => sale.syncStatus === "pending").length + (state.localSyncPending ? 1 : 0);
  document.getElementById("pendingLabel").textContent = `${pending} Pendientes`;
  renderAuthState();
}

function renderDashboard() {
  state.selectedMonth = state.selectedMonth || currentMonthKey();
  renderMonthSelector();
  const todaySales = state.sales.filter((sale) => sale.date === todayIso());
  const monthSales = state.sales.filter((sale) => monthKeyFromDate(sale.date) === state.selectedMonth);
  const monthExpenses = operatingExpenseRows().filter((expense) => monthKeyFromDate(expense.date) === state.selectedMonth && expenseCountsInResult(expense));
  const historicalMonth = historicalClosureForMonth(state.selectedMonth);
  const historicalMetrics = historicalMonth ? closureScopeMetrics(historicalMonth, "total") : null;
  const todayLocalRevenue = sum(todaySales.filter((sale) => sale.channel === "local"), (sale) => sale.total);
  const todayOnlineRevenue = sum(todaySales.filter((sale) => sale.channel === "online"), (sale) => sale.total);
  const monthlyRevenue = sum(monthSales, (sale) => sale.total) + Number(historicalMetrics?.income || 0);
  const monthlyExpenses = sum(monthExpenses, (expense) => expense.amount) + Number(historicalMetrics?.expenseTotal || 0);
  const monthlyMerchandiseCost = sum(monthSales, (sale) => saleMerchandiseCost(sale)) + Number(historicalMetrics?.merchandiseCost || 0);
  const receivablesTotal = sum(state.sales.filter((sale) => sale.channel === "local"), (sale) => saleOutstandingDebt(sale))
    + sum(state.customers, customerInitialDebtOutstanding);
  document.getElementById("todayRevenue").textContent = money(todayLocalRevenue);
  document.getElementById("todayOnlineRevenue").textContent = money(todayOnlineRevenue);
  document.getElementById("monthRevenue").textContent = money(monthlyRevenue);
  document.getElementById("receivablesTotal").textContent = money(receivablesTotal);
  document.getElementById("monthResult").textContent = money(monthlyRevenue - monthlyExpenses - monthlyMerchandiseCost);
  renderTodayPaymentSummary(todaySales.filter((sale) => sale.channel === "local"));
  renderMonthlyChart();
}

function renderTodayPaymentSummary(todaySales) {
  const summary = todaySales.reduce((acc, sale) => {
    const method = sale.paymentMethod || "sin-medio";
    if (!acc[method]) acc[method] = { method, count: 0, total: 0 };
    acc[method].count += 1;
    acc[method].total += saleInitialPaidAmount(sale);
    return acc;
  }, {});
  const rows = Object.values(summary).sort((a, b) => b.total - a.total);
  document.getElementById("todayPaymentTotal").textContent = money(sum(rows, (row) => row.total));
  document.getElementById("todayPaymentSummary").innerHTML = rows.length
    ? rows.map((row) => `
      <div class="payment-summary-row">
        <div>
          <strong>${paymentMethodName(row.method)}</strong>
          <small>${row.count} ${row.count === 1 ? "Venta" : "Ventas"}</small>
        </div>
        <span>${money(row.total)}</span>
      </div>
    `).join("")
    : `<div class="empty-state">Todavía no hay Ventas Locales registradas hoy.</div>`;
}

function renderMonthlyChart() {
  const chart = document.getElementById("monthlyChart");
  const monthDate = parseMonthKey(state.selectedMonth);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const monthNumber = month + 1;
  const days = new Date(year, month + 1, 0).getDate();
  const daily = Array.from({ length: days }, (_, index) => {
    const day = index + 1;
    const date = `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const sales = state.sales.filter((sale) => sale.date === date && saleModuleEnabled(sale));
    const local = sum(sales.filter((sale) => saleBucket(sale) === "local"), (sale) => sale.total);
    const insumos = sum(sales.filter((sale) => saleBucket(sale) === "insumos"), (sale) => sale.total);
    const accesorios = sum(sales.filter((sale) => saleBucket(sale) === "accesorios"), (sale) => sale.total);
    return { day, local, insumos, accesorios, total: local + insumos + accesorios };
  });
  const max = niceChartMax(Math.max(1, ...daily.map((item) => item.total)));
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((ratio) => max * ratio);
  const bars = daily.map((item) => {
    const localHeight = item.local ? Math.max(2, (item.local / max) * 270) : 0;
    const insumosHeight = item.insumos ? Math.max(2, (item.insumos / max) * 270) : 0;
    const accesoriosHeight = item.accesorios ? Math.max(2, (item.accesorios / max) * 270) : 0;
    return `
      <div class="day-bar" title="${item.day}: Ventas ${money(item.total)}">
        <div class="stacked-bar">
          <div class="bar-accesorios" style="height:${accesoriosHeight}px"></div>
          <div class="bar-insumos" style="height:${insumosHeight}px"></div>
          <div class="bar-local" style="height:${localHeight}px"></div>
        </div>
        <span>${item.day}/${monthNumber}</span>
      </div>
    `;
  }).join("");
  chart.innerHTML = `
    <div class="chart-axis" aria-hidden="true">
      ${ticks.map((value) => `<span>${shortMoney(value)}</span>`).join("")}
    </div>
    <div class="chart-plot">
      <div class="chart-grid" aria-hidden="true">
        ${ticks.map((_, index) => `<span style="top:${index * 25}%"></span>`).join("")}
      </div>
      <div class="chart-bars">${bars}</div>
    </div>
  `;
}

function renderPos() {
  const monthLocalSales = state.sales.filter((sale) => sale.channel === "local" && monthKeyFromDate(sale.date) === currentMonthKey());
  const totalLocal = sum(monthLocalSales, (sale) => sale.total);
  const localSummary = document.getElementById("localSummary");
  if (localSummary) {
    const canSeeMonthlyTotal = canViewFeature("hideLocalMonthlyTotal");
    localSummary.hidden = state.activeView !== "pos" || !canSeeMonthlyTotal;
    localSummary.innerHTML = canSeeMonthlyTotal
      ? `<div class="summary-row online-total-card"><span>Ventas Local del Mes</span><strong>${money(totalLocal)}</strong></div>`
      : "";
  }
  const tabs = document.getElementById("cartTabs");
  if (!state.carts.length) {
    tabs.innerHTML = "";
    document.getElementById("cartWorkspace").innerHTML = `<div class="empty-state">No hay Ventas Abiertas. Usá + Nueva Venta para empezar un carrito.</div>`;
  } else {
    const cart = activeCart();
    tabs.innerHTML = state.carts.map((item, index) => `
      <button class="cart-tab ${item.id === cart.id ? "active" : ""}" data-cart-id="${item.id}">
        Venta ${index + 1} · ${item.items.length} Ítems · ${money(cartTotal(item))}
      </button>
    `).join("");
    renderCartWorkspace(cart);
  }
}

function renderSalesHistory() {
  const table = document.getElementById("salesHistoryTable");
  if (!table) return;
  renderSalesHistoryFilters();
  const sales = filteredSalesHistory().slice().sort(salesHistorySort);
  const totalPages = Math.max(1, Math.ceil(sales.length / SALES_HISTORY_PAGE_SIZE));
  const current = Math.min(Math.max(1, Number(state.salesHistoryPage || 1)), totalPages);
  const start = (current - 1) * SALES_HISTORY_PAGE_SIZE;
  const pageRows = sales.slice(start, start + SALES_HISTORY_PAGE_SIZE);
  state.salesHistoryPage = current;
  table.innerHTML = pageRows.map((sale) => {
    const count = saleItemCount(sale);
    const detail = saleDetailText(sale);
    return `
      <tr>
        <td><strong class="order-code">${saleOrder(sale)}</strong></td>
        <td>${formatDateShort(sale.date)}</td>
        <td><span class="pill">${saleChannelLabel(sale)}</span></td>
        <td>
          <strong>${count} ${count === 1 ? "Artículo" : "Artículos"}</strong>
          <small>${detail}</small>
        </td>
        <td>${paymentMethodName(sale.paymentMethod || (sale.channel === "online" ? "web" : ""))}</td>
        <td>
          <strong>${money(sale.total)}</strong>
        </td>
        <td class="row-actions sale-actions">
          <button class="tiny-action" data-sale-info="${sale.id}" type="button">Info</button>
          <button class="tiny-action" data-sale-edit="${sale.id}" type="button">Editar</button>
          <button class="tiny-action" data-sale-receipt="${sale.id}" type="button">Comprobante</button>
          <button class="tiny-action danger-action" data-sale-delete="${sale.id}" type="button">Eliminar</button>
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="7">Todavía no hay Ventas registradas.</td></tr>`;
  document.getElementById("salesHistoryPagination").innerHTML = salesHistoryPaginationControls(current, totalPages, sales.length);
}

function renderSalesHistoryFilters() {
  const filters = state.salesHistoryFilters;
  const orderInput = document.getElementById("salesHistoryOrderFilter");
  const periodInput = document.getElementById("salesHistoryPeriodFilter");
  const fromInput = document.getElementById("salesHistoryFrom");
  const toInput = document.getElementById("salesHistoryTo");
  const paymentInput = document.getElementById("salesHistoryPaymentFilter");
  if (orderInput) orderInput.value = filters.order || "";
  if (periodInput) periodInput.value = filters.period || "all";
  if (fromInput) {
    fromInput.value = normalizeDateInput(filters.from) || "";
    fromInput.classList.toggle("is-hidden", filters.period !== "custom");
  }
  if (toInput) {
    toInput.value = normalizeDateInput(filters.to) || "";
    toInput.classList.toggle("is-hidden", filters.period !== "custom");
  }
  if (paymentInput) paymentInput.innerHTML = salesHistoryPaymentOptions(filters.payment || "all");
}

function cartItemMetaLabel(item) {
  const product = item.productId ? state.products.find((entry) => entry.id === item.productId) : null;
  const code = product?.code || item.code || "";
  const category = [item.category, item.subcategory].filter(Boolean).join(" / ");
  return [code, category, item.size ? `Talle ${item.size}` : "", item.manual ? "Manual" : ""].filter(Boolean).join(" · ");
}

function renderCartWorkspace(cart) {
  const methods = saleLocalPaymentOptions(cart.paymentMethod || "");
  const linkedCustomer = state.customers.find((customer) => customer.id === cart.customerId);
  const subtotal = cartSubtotal(cart);
  const total = cartTotal(cart);
  const paid = cartPaidAmount(cart);
  const debt = cartOutstandingDebt(cart);
  const manualTotalValue = cart.manualTotal !== "" && cart.manualTotal != null ? Number(cart.manualTotal || 0) : subtotal;
  const rows = cart.items.map((item, index) => `
    <tr>
      <td data-label="Item">${item.description}<br><small>${htmlAttr(cartItemMetaLabel(item))}</small></td>
      <td data-label="Precio">${money(item.unitPrice)}</td>
      <td data-label="Cantidad">
        <span class="qty-control">
          <button data-qty="${index}" data-delta="-1">-</button>
          <span>${item.quantity}</span>
          <button data-qty="${index}" data-delta="1">+</button>
        </span>
      </td>
      <td data-label="Total">${money(item.quantity * item.unitPrice)}</td>
      <td class="row-actions">
        <button class="remove-line" data-remove-item="${index}" type="button" title="Eliminar Producto">&times;</button>
      </td>
    </tr>
  `).join("");
  document.getElementById("cartWorkspace").innerHTML = `
    <div class="cart-layout">
      <div>
        <div class="pos-entry-row">
          <div class="customer-sale-field">
            <input id="cartReference" value="${htmlAttr(cart.reference || "")}" placeholder="Cliente o DNI" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" data-no-browser-autofill>
            <div class="customer-inline-suggestions" id="cartCustomerSuggestions"></div>
            ${linkedCustomer ? `<small>Vinculado a ${htmlAttr(customerDisplayLabel(linkedCustomer))}</small>` : ""}
          </div>
          <div class="product-code-field">
            <input id="productSearch" placeholder="Código" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" data-no-browser-autofill>
            <div class="product-code-suggestions" id="posProductSuggestions"></div>
          </div>
          <select id="productSize" disabled><option value="">Talle</option></select>
          <input id="productQty" type="number" min="1" value="1" aria-label="Cantidad">
          <button class="primary" id="addProductCart">Agregar Producto</button>
          <button class="secondary" id="addManualItem">Agregar Manual</button>
        </div>
        <div class="table-wrap local-cart-wrap" style="margin-top:14px">
          <table class="pos-cart-table">
            <thead><tr><th>Item</th><th>Precio</th><th>Cantidad</th><th>Total</th><th class="row-actions-head" aria-label="Eliminar"></th></tr></thead>
            <tbody>${rows || `<tr><td colspan="5">Todavía no hay Productos en esta Venta.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <aside class="sale-total">
        <span>Subtotal</span>
        <strong>${money(cartSubtotal(cart))}</strong>
        <label>Medio de Pago
          <select id="cartPayment">${methods}</select>
        </label>
        <label class="manual-total-check">
          <input id="cartManualTotalEnabled" type="checkbox" ${cart.manualTotalEnabled ? "checked" : ""}>
          <span>Editar total final</span>
        </label>
        <label class="manual-total-field ${cart.manualTotalEnabled ? "" : "is-hidden"}">Total final manual
          <div class="money-field"><span>$</span><input id="cartManualTotal" type="number" min="0" step="1" value="${Number(manualTotalValue || 0)}" aria-label="Total final manual"></div>
        </label>
        <span>Total Final</span>
        <strong id="cartFinalTotalValue">${money(total)}</strong>
        <label class="manual-total-check">
          <input id="cartPartialPaymentEnabled" type="checkbox" ${cart.partialPaymentEnabled ? "checked" : ""}>
          <span>Pago parcial</span>
        </label>
        <label class="manual-total-field ${cart.partialPaymentEnabled ? "" : "is-hidden"}">Importe pagado
          <div class="money-field"><span>$</span><input id="cartPaidAmount" type="number" min="0" step="1" value="${Number(paid || 0)}" aria-label="Importe pagado"></div>
        </label>
        <small class="sale-debt-preview ${debt > 0 ? "" : "is-hidden"}">Deuda pendiente: ${money(debt)}</small>
        <button class="primary" id="finalizeCart">Cobrar y Finalizar</button>
        <button class="danger" id="cancelCart">Cancelar Venta</button>
      </aside>
    </div>
  `;
}

function updateCartPaymentPreview(cart = activeCart()) {
  if (!cart) return;
  const total = cartTotal(cart);
  const totalNode = document.getElementById("cartFinalTotalValue");
  const paidInput = document.getElementById("cartPaidAmount");
  if (totalNode) totalNode.textContent = money(total);
  if (paidInput && (!cart.partialPaymentEnabled || cart.paidAmount === "" || cart.paidAmount == null)) {
    paidInput.value = Number(cart.partialPaymentEnabled ? cartPaidAmount(cart) : total || 0);
    formatMoneyInput(paidInput);
  }
  const debt = cartOutstandingDebt(cart);
  const preview = document.querySelector(".sale-debt-preview");
  if (preview) {
    preview.textContent = `Deuda pendiente: ${money(debt)}`;
    preview.classList.toggle("is-hidden", debt <= 0);
  }
}

function renderCatalog() {
  renderProductCategoryOptions();
  renderProductSubcategoryOptions();
  renderProductFilters();
  const products = filteredProducts();
  const totalPages = Math.max(1, Math.ceil(products.length / PRODUCT_PAGE_SIZE));
  const current = Math.min(Math.max(1, Number(state.productPage || 1)), totalPages);
  const start = (current - 1) * PRODUCT_PAGE_SIZE;
  const pageProducts = products.slice(start, start + PRODUCT_PAGE_SIZE);
  state.productPage = current;
  document.getElementById("productsTable").innerHTML = pageProducts.map((product) => `
    <tr>
      <td><strong>${product.code}</strong></td>
      <td>${product.description}<br><small>${product.unit}</small></td>
      <td>${product.category}${product.subcategory ? `<br><small>${htmlAttr(product.subcategory)}</small>` : ""}</td>
      <td>${product.color || "-"}</td>
      <td>${money(product.price)}${product.promoPrice ? `<br><small>Promo ${money(product.promoPrice)}</small>` : ""}</td>
      <td>${product.tracksStock ? product.stock : "Sin Control"}${productHasSizeVariants(product) ? `<br><small>${htmlAttr(serializeProductSizeVariants(product).replace(/\n/g, " / "))}</small>` : ""}</td>
      <td>${product.published ? "Publicado" : "No publicado"}</td>
      <td class="row-actions">
        <button class="tiny-action" data-open-catalog-product="${product.id}" type="button" title="Abrir URL publica">Ver</button>
        ${isAccessoryCategory(product.category) ? `<small class="locked-product-note">Bloqueado</small>` : `<button class="tiny-action" data-edit-product="${product.id}" type="button" title="Editar Producto">Editar</button>`}
        <button class="tiny-action danger-action" data-delete-product="${product.id}" type="button" title="Eliminar Producto">Eliminar</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="8">No hay Productos para esos Filtros.</td></tr>`;
  const pagination = document.getElementById("productsPagination");
  if (pagination) pagination.innerHTML = productPaginationControls(current, totalPages, products.length);
}

function openCatalogProduct(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;
  window.open(catalogProductUrl(product), "_blank", "noopener");
}

function openPublicCatalog() {
  window.open(new URL("catalogo", window.location.href.replace(/index\.html$/i, "")).href, "_blank", "noopener");
}

function salesForCustomer(customer) {
  const nameKey = normalizeTextKey(customer.name);
  const dni = normalizeCustomerDni(customer.dni);
  const canFallbackByName = duplicateCustomerGroup(customer).length <= 1;
  return state.sales.filter((sale) => {
    if (sale.customerId === customer.id) return true;
    if (dni && normalizeCustomerDni(sale.customerDni) === dni) return true;
    if (sale.customerId || !canFallbackByName) return false;
    return [sale.customerName, sale.reference].some((value) => normalizeTextKey(value) === nameKey);
  });
}

function workshopOrdersForCustomer(customer) {
  const nameKey = normalizeTextKey(customer.name);
  const canFallbackByName = duplicateCustomerGroup(customer).length <= 1;
  return state.workshopOrders.filter((order) => order.customerId === customer.id || (!order.customerId && canFallbackByName && normalizeTextKey(order.customer) === nameKey));
}

function debtSalesForCustomer(customer) {
  return salesForCustomer(customer)
    .filter((sale) => sale.channel === "local" && saleOutstandingDebt(sale) > 0)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

function customerInitialDebtPaid(customer = {}) {
  return sum(normalizeSaleDebtPayments(customer.initialDebtPayments), (payment) => payment.amount);
}

function customerInitialDebtOutstanding(customer = {}) {
  return Math.max(0, Number(customer.initialDebt || 0) - customerInitialDebtPaid(customer));
}

function customerDebtTotal(customer) {
  return customerInitialDebtOutstanding(customer) + sum(debtSalesForCustomer(customer), (sale) => saleOutstandingDebt(sale));
}

function customerStats(customer) {
  const sales = salesForCustomer(customer);
  const localSales = sales.filter((sale) => sale.channel === "local");
  const webSales = sales.filter((sale) => sale.channel === "online");
  const total = sum(sales, (sale) => sale.total);
  const localTotal = sum(localSales, (sale) => sale.total);
  const webTotal = sum(webSales, (sale) => sale.total);
  const lastDate = sales.map((sale) => sale.date).sort().at(-1) || "";
  return {
    total,
    salesCount: sales.length,
    localTotal,
    webTotal,
    lastDate,
    ticket: sales.length ? total / sales.length : 0,
    workshopCount: workshopOrdersForCustomer(customer).length,
    debt: customerDebtTotal(customer),
  };
}

function filteredCustomers() {
  const query = normalizeTextKey(state.customerFilters?.query);
  const dniQuery = normalizeCustomerDni(state.customerFilters?.query);
  const sortMode = state.customerFilters?.sort || "alpha";
  return state.customers
    .filter((customer) => !query || (dniQuery && normalizeCustomerDni(customer.dni).includes(dniQuery)) || [customer.name, customer.dni, customer.phone].some((field) => normalizeTextKey(field).includes(query)))
    .sort((a, b) => {
      const nameSort = String(a.name || "").localeCompare(String(b.name || ""), "es", { sensitivity: "base" });
      if (sortMode === "amount") return customerStats(b).total - customerStats(a).total || nameSort;
      return nameSort || customerStats(b).total - customerStats(a).total;
    });
}

function clearCustomerForm() {
  const form = document.getElementById("customerForm");
  if (!form) return;
  form.reset();
  form.elements.customerId.value = "";
  document.getElementById("cancelCustomerEdit").hidden = true;
  document.getElementById("saveCustomerButton").textContent = "Guardar Cliente";
}

function editCustomer(customerId) {
  openCustomerEditModal(customerId);
}

function openCustomerEditModal(customerId) {
  const customer = state.customers.find((item) => item.id === customerId);
  const modal = document.getElementById("customerEditModal");
  const form = document.getElementById("customerEditForm");
  if (!customer || !modal || !form) return;
  form.elements.customerId.value = customer.id;
  form.elements.name.value = customer.name || "";
  form.elements.dni.value = formatCustomerDni(customer.dni || "");
  form.elements.phone.value = customer.phone || "";
  form.elements.initialDebt.value = Number(customer.initialDebt || 0) || "";
  form.elements.province.innerHTML = customerProvinceOptions(customer.province || "");
  form.elements.province.value = normalizeProvince(customer.province);
  form.elements.notes.value = customer.notes || "";
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  setTimeout(() => form.elements.name?.focus(), 0);
}

function closeCustomerEditModal() {
  const modal = document.getElementById("customerEditModal");
  const form = document.getElementById("customerEditForm");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  form?.reset();
}

async function submitCustomerEditModal(form) {
  const data = formDataObject(form);
  const customer = state.customers.find((item) => item.id === data.customerId);
  const name = normalizeCustomerName(data.name);
  if (!customer || !name) return;
  const dni = normalizeCustomerDni(data.dni);
  const dniOwner = findCustomerByDni(dni, { excludeId: customer.id });
  if (dniOwner) {
    alert(`Ese DNI ya está cargado en ${dniOwner.name}.`);
    return;
  }
  const payload = {
    name,
    dni,
    phone: data.phone || "",
    initialDebt: Math.max(0, Number(data.initialDebt || 0)),
    province: normalizeProvince(data.province),
    notes: data.notes || "",
  };
  try {
    if (CLOUD_DATA_ENABLED) {
      if (!cloudEnabledWithSession()) {
        showAuthError("Ingresá con tu usuario BlackShoes para guardar clientes en Supabase.");
        renderAuthState("Ingresá para guardar en Supabase.");
        return;
      }
      const saved = await saveCloudCustomerRecord(customer, payload);
      Object.assign(customer, saved);
      await loadCloudOperationalData();
    } else {
      Object.assign(customer, payload);
    }
  } catch (error) {
    console.warn("Cloud customer edit failed", error);
    alert(`No pude guardar el cliente en Supabase: ${error.message || "error desconocido"}`);
    return;
  }
  logActivity("customer", "Edito cliente", customer.name);
  closeCustomerEditModal();
  saveState();
  render();
  showActionToast("Cliente actualizado.");
}

function deleteCustomer(customerId) {
  const customer = state.customers.find((item) => item.id === customerId);
  if (!customer) return;
  openConfirmModal({
    title: "Eliminar cliente",
    message: `Se eliminará la ficha de ${customer.name}. Las ventas quedan guardadas en el historial.`,
    confirmText: "Eliminar",
    danger: true,
    onConfirm: async () => {
      if (CLOUD_DATA_ENABLED && isUuid(customerId)) {
        try {
          if (!cloudEnabledWithSession()) {
            showAuthError("Ingresá con tu usuario BlackShoes para archivar clientes en Supabase.");
            renderAuthState("Ingresá para guardar en Supabase.");
            return;
          }
          await archiveCloudRecord("customer", customerId);
          logActivity("customer", "Archivo cliente", customer.name);
          await loadCloudOperationalData();
          clearCustomerForm();
          saveState();
          render();
          showActionToast("Cliente archivado en Supabase.");
          return;
        } catch (error) {
          console.warn("Cloud customer archive failed", error);
          alert(`No pude archivar el cliente en Supabase: ${error.message || "error desconocido"}`);
          return;
        }
      }
      rememberDeletedRecord("customers", customerId);
      state.customers = state.customers.filter((item) => item.id !== customerId);
      state.sales.forEach((sale) => {
        if (sale.customerId === customerId) sale.customerId = "";
      });
      state.workshopOrders.forEach((order) => {
        if (order.customerId === customerId) order.customerId = "";
      });
      clearCustomerForm();
      logActivity("customer", "Elimino cliente", customer.name);
      saveState();
      render();
    },
  });
}

function renderCustomers() {
  const table = document.getElementById("customersTable");
  if (!table) return;
  const search = document.getElementById("customerSearch");
  const sortFilter = document.getElementById("customerSortFilter");
  const province = document.getElementById("customerProvince");
  if (search) search.value = state.customerFilters?.query || "";
  if (sortFilter) sortFilter.value = state.customerFilters?.sort || "alpha";
  if (province) province.innerHTML = customerProvinceOptions(province.value);
  const customers = filteredCustomers();
  const page = pageItemsBySize(customers, state.customerPage, CUSTOMER_PAGE_SIZE);
  state.customerPage = page.current;
  const totalCustomers = state.customers.length;
  const activeCustomers = state.customers.filter((customer) => customerStats(customer).salesCount > 0).length;
  const totalSales = sum(state.customers, (customer) => customerStats(customer).total);
  const totalDebt = sum(state.customers, (customer) => customerStats(customer).debt);
  document.getElementById("customerSummary").innerHTML = `
    <div class="summary-row"><span>Clientes</span><strong>${totalCustomers}</strong></div>
    <div class="summary-row"><span>Con Compras</span><strong>${activeCustomers}</strong></div>
    <div class="summary-row"><span>Total Asociado</span><strong>${money(totalSales)}</strong></div>
    <div class="summary-row"><span>Deuda Pendiente</span><strong>${money(totalDebt)}</strong></div>
  `;
  const header = table.closest("table")?.querySelector("thead tr");
  if (header) {
    header.innerHTML = `
      <th>Cliente</th>
      <th>Ventas</th>
      <th>Total Comprado</th>
      <th>Deuda</th>
      <th>Ticket Promedio</th>
      <th class="row-actions-head" aria-label="Acciones"></th>
    `;
  }
  table.innerHTML = page.rows.map((customer) => {
    const stats = customerStats(customer);
    const note = String(customer.notes || "").trim();
    return `
      <tr>
        <td>
          <strong>${htmlAttr(customer.name)}${customerDuplicateLabel(customer) ? ` <span class="customer-duplicate-badge">${customerDuplicateLabel(customer)}</span>` : ""}</strong><br>
          <small>${htmlAttr(customerMetaLabel(customer, { includeFallbackPhone: true }))}</small>
          ${note ? `<br><small class="customer-note-line">${htmlAttr(note)}</small>` : ""}
        </td>
        <td>${stats.salesCount}</td>
        <td>${money(stats.total)}</td>
        <td><strong class="${stats.debt > 0 ? "debt-amount" : ""}">${money(stats.debt)}</strong></td>
        <td>${money(stats.ticket)}</td>
        <td class="row-actions">
          <button class="tiny-action" data-info-customer="${customer.id}" type="button">+ Info</button>
          <button class="tiny-action" data-edit-customer="${customer.id}" type="button">Editar</button>
          <button class="tiny-action danger-action" data-delete-customer="${customer.id}" type="button">Eliminar</button>
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="6">Todavía no hay Clientes para esos Filtros.</td></tr>`;
  const pagination = document.getElementById("customersPagination");
  if (pagination) pagination.innerHTML = sizedPaginationControls("customers", page.current, page.totalPages, customers.length, CUSTOMER_PAGE_SIZE, "clientes");
}

function openCustomerInfoModal(customerId) {
  const customer = state.customers.find((item) => item.id === customerId);
  const modal = document.getElementById("customerInfoModal");
  const title = document.getElementById("customerInfoTitle");
  const meta = document.getElementById("customerInfoMeta");
  if (!customer || !modal || !title) return;
  state.customerInfoCustomerId = customer.id;
  state.customerInfoPage = 1;
  title.textContent = `Ventas de ${customer.name}`;
  if (meta) {
    const detail = customerMetaLabel(customer, { includeFallbackPhone: true });
    meta.textContent = detail;
    meta.classList.toggle("is-hidden", !detail);
  }
  renderCustomerInfoSales();
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function renderCustomerInfoSales() {
  const customer = state.customers.find((item) => item.id === state.customerInfoCustomerId);
  const table = document.getElementById("customerInfoSales");
  const pagination = document.getElementById("customerInfoPagination");
  if (!customer || !table) return;
  renderCustomerDebtPanel(customer);
  const sales = salesForCustomer(customer)
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const totalPages = Math.max(1, Math.ceil(sales.length / CUSTOMER_INFO_PAGE_SIZE));
  const current = Math.min(Math.max(1, Number(state.customerInfoPage || 1)), totalPages);
  const start = (current - 1) * CUSTOMER_INFO_PAGE_SIZE;
  const rows = sales.slice(start, start + CUSTOMER_INFO_PAGE_SIZE);
  state.customerInfoPage = current;
  table.innerHTML = rows.map((sale) => `
    <tr>
      <td>${formatDateShort(sale.date)}</td>
      <td><span class="pill">${saleChannelLabel(sale)}</span></td>
      <td><strong class="order-code">${saleOrder(sale)}</strong></td>
      <td>${paymentMethodName(sale.paymentMethod || (sale.channel === "online" ? "web" : ""))}</td>
      <td>${htmlAttr(saleDetailText(sale))}</td>
      <td><strong>${money(sale.total)}</strong>${saleOutstandingDebt(sale) > 0 ? `<br><small class="debt-amount">Debe ${money(saleOutstandingDebt(sale))}</small>` : ""}</td>
    </tr>
  `).join("") || `<tr><td colspan="6">Todavía no hay ventas asociadas a este cliente.</td></tr>`;
  if (pagination) pagination.innerHTML = customerInfoPaginationControls(current, totalPages, sales.length);
}

function customerDebtPaymentOptions(selected = "efectivo") {
  return state.paymentMethods
    .map((method) => `<option value="${method.id}" ${method.id === selected ? "selected" : ""}>${method.name}</option>`)
    .join("");
}

function renderCustomerDebtPanel(customer) {
  const panel = document.getElementById("customerDebtPanel");
  const form = document.getElementById("customerDebtPaymentForm");
  const customerInput = document.getElementById("customerDebtCustomerId");
  const saleSelect = document.getElementById("customerDebtSaleSelect");
  const dateInput = document.getElementById("customerDebtPaymentDate");
  const methodSelect = document.getElementById("customerDebtPaymentMethod");
  if (!panel || !form || !saleSelect) return;
  const debtSales = debtSalesForCustomer(customer);
  const initialDebtOutstanding = customerInitialDebtOutstanding(customer);
  const totalDebt = initialDebtOutstanding + sum(debtSales, (sale) => saleOutstandingDebt(sale));
  const salePayments = salesForCustomer(customer)
    .flatMap((sale) => normalizeSaleDebtPayments(sale.debtPayments).map((payment) => ({ ...payment, sourceLabel: saleOrder(sale) })));
  const initialPayments = normalizeSaleDebtPayments(customer.initialDebtPayments)
    .map((payment) => ({ ...payment, sourceLabel: "Deuda inicial" }));
  const payments = [...salePayments, ...initialPayments]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  panel.innerHTML = `
    <div class="customer-debt-summary ${totalDebt > 0 ? "has-debt" : ""}">
      <span>Deuda pendiente</span>
      <strong>${money(totalDebt)}</strong>
    </div>
    ${payments.length ? `
      <div class="customer-payment-history">
        <strong>Pagos registrados</strong>
        ${payments.slice(0, 5).map((payment) => `
          <small>${formatDateShort(payment.date)} · ${money(payment.amount)} · ${paymentMethodName(payment.paymentMethod)} · ${payment.sourceLabel}</small>
        `).join("")}
      </div>
    ` : ""}
  `;
  form.hidden = totalDebt <= 0;
  if (customerInput) customerInput.value = customer.id;
  if (dateInput && !dateInput.value) setDateInput(dateInput, todayIso());
  if (methodSelect) methodSelect.innerHTML = customerDebtPaymentOptions(methodSelect.value || "efectivo");
  saleSelect.innerHTML = [
    initialDebtOutstanding > 0 ? `<option value="initial">Deuda inicial (${money(initialDebtOutstanding)})</option>` : "",
    ...debtSales.map((sale) => `
    <option value="${sale.id}">${saleOrder(sale)} (${money(saleOutstandingDebt(sale))})</option>
  `),
  ].filter(Boolean).join("");
}

async function registerCustomerDebtPayment(form) {
  const data = formDataObject(form);
  const customer = state.customers.find((item) => item.id === data.customerId);
  const isInitialDebt = data.saleId === "initial";
  const sale = isInitialDebt ? null : state.sales.find((item) => item.id === data.saleId);
  if (!customer || (!isInitialDebt && (!sale || sale.channel !== "local"))) return;
  const date = normalizeDateInput(data.date) || todayIso();
  const amount = Math.max(0, Number(data.amount || 0));
  const outstanding = isInitialDebt ? customerInitialDebtOutstanding(customer) : saleOutstandingDebt(sale);
  if (amount <= 0) {
    alert("Ingresá un importe válido.");
    return;
  }
  if (amount > outstanding) {
    alert(`El pago supera la deuda pendiente de ${money(outstanding)}.`);
    return;
  }
  if (CLOUD_DATA_ENABLED) {
    try {
      if (!cloudEnabledWithSession()) {
        showAuthError("Ingresá con tu usuario BlackShoes para registrar pagos en Supabase.");
        renderAuthState("Ingresá para guardar en Supabase.");
        return;
      }
      const cloudCustomer = await ensureCloudCustomer(customer);
      await saveCloudCustomerPayment({
        customer: cloudCustomer,
        sale: isInitialDebt ? null : sale,
        amount,
        method: data.paymentMethod || "efectivo",
        note: isInitialDebt ? (data.notes || "Pago de deuda inicial") : (data.notes || `Pago ${saleOrder(sale)}`),
      });
      await loadCloudOperationalData();
      form.reset();
      form.elements.customerId.value = cloudCustomer.id;
      setDateInput(form.elements.date, todayIso());
      saveState();
      renderCustomers();
      renderCustomerInfoSales();
      renderDashboard();
      showActionToast("Pago registrado en Supabase.");
      return;
    } catch (error) {
      console.warn("Cloud customer payment failed", error);
      alert(`No pude registrar el pago en Supabase: ${error.message || "error desconocido"}`);
      return;
    }
  }
  const payment = {
    id: uid("debt-pay"),
    date,
    amount,
    paymentMethod: data.paymentMethod || "efectivo",
    notes: data.notes || "",
    createdAt: new Date().toISOString(),
  };
  if (isInitialDebt) {
    customer.initialDebtPayments = normalizeSaleDebtPayments([...(customer.initialDebtPayments || []), payment]);
    logActivity("customer", "Registro pago de deuda", `${customer.name} - Deuda inicial - ${money(amount)}`);
  } else {
    sale.debtPayments = normalizeSaleDebtPayments([...(sale.debtPayments || []), payment]);
    sale.updatedAt = new Date().toISOString();
    logActivity("customer", "Registro pago de deuda", `${customer.name} - ${saleOrder(sale)} - ${money(amount)}`);
  }
  form.reset();
  form.elements.customerId.value = customer.id;
  setDateInput(form.elements.date, todayIso());
  saveState();
  renderCustomers();
  renderCustomerInfoSales();
  renderDashboard();
  showActionToast("Pago registrado.");
}

function closeCustomerInfoModal() {
  const modal = document.getElementById("customerInfoModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  state.customerInfoCustomerId = "";
  state.customerInfoPage = 1;
}

function cashCloseDailySummary(date) {
  const sales = state.sales.filter((sale) => sale.channel === "local" && sale.date === date);
  const byPayment = sales.reduce((acc, sale) => {
    const method = sale.paymentMethod || "sin-medio";
    if (!acc[method]) acc[method] = { method, count: 0, total: 0 };
    acc[method].count += 1;
    acc[method].total += saleInitialPaidAmount(sale);
    return acc;
  }, {});
  return {
    sales,
    byPayment: Object.values(byPayment).sort((a, b) => b.total - a.total),
    total: sum(sales, (sale) => saleInitialPaidAmount(sale)),
    expectedCash: sum(sales.filter((sale) => sale.paymentMethod === "efectivo"), (sale) => saleInitialPaidAmount(sale)),
  };
}

function cashCloseDifference() {
  const date = normalizeDateInput(state.cashCloseDate) || todayIso();
  const summary = cashCloseDailySummary(date);
  const counted = parseMoneyInput(document.getElementById("cashCloseCounted")?.value || 0);
  const withdrawals = parseMoneyInput(document.getElementById("cashCloseWithdrawals")?.value || 0);
  return counted + withdrawals - summary.expectedCash;
}

function updateCashCloseDifferencePreview() {
  const node = document.getElementById("cashCloseDifference");
  if (!node) return;
  const difference = cashCloseDifference();
  node.textContent = signedMoney(difference);
  node.classList.toggle("negative", difference < 0);
  node.classList.toggle("positive", difference > 0);
}

function cashClosureExpensePayload(closure) {
  const difference = Number(closure.difference || 0);
  if (!difference) return null;
  return {
    date: closure.date,
    concept: difference < 0 ? "Faltante de Caja" : "Sobrante de Caja",
    category: "DiferenciaCaja",
    kind: "variable",
    area: "local",
    amount: difference < 0 ? Math.abs(difference) : -Math.abs(difference),
    source: "cash-close",
    cashClosureId: closure.id,
  };
}

function upsertCashClosureAdjustment(closure) {
  state.expenses = state.expenses.filter((expense) => expense.cashClosureId !== closure.id);
  const payload = cashClosureExpensePayload(closure);
  if (!payload) return;
  const expense = { id: uid("expense"), ...payload };
  closure.expenseId = expense.id;
  state.expenses.push(expense);
}

function deleteCashClosure(closureId) {
  const closure = state.cashClosures.find((item) => item.id === closureId);
  if (!closure) return;
  openConfirmModal({
    title: "Eliminar cierre",
    message: `Se eliminará el cierre del ${formatDateShort(closure.date)} y su ajuste automático de caja.`,
    confirmText: "Eliminar",
    danger: true,
    onConfirm: () => {
      rememberDeletedRecord("cashClosures", closureId);
      state.cashClosures = state.cashClosures.filter((item) => item.id !== closureId);
      state.expenses = state.expenses.filter((expense) => expense.cashClosureId !== closureId);
      logActivity("cash", "Elimino cierre de caja", formatDateShort(closure.date));
      saveState();
      render();
    },
  });
}

function renderCashClose() {
  const dateInput = document.getElementById("cashCloseDate");
  const table = document.getElementById("cashCloseTable");
  if (!dateInput || !table) return;
  const selectedDate = normalizeDateInput(state.cashCloseDate) || todayIso();
  state.cashCloseDate = selectedDate;
  dateInput.value = selectedDate;
  const summary = cashCloseDailySummary(selectedDate);
  const existing = state.cashClosures.find((closure) => closure.date === selectedDate);
  document.getElementById("cashCloseTotal").textContent = money(summary.total);
  document.getElementById("cashCloseExpected").textContent = money(summary.expectedCash);
  document.getElementById("cashCloseCount").textContent = String(summary.sales.length);
  document.getElementById("cashClosePaymentSummary").innerHTML = summary.byPayment.length
    ? summary.byPayment.map((row) => `
      <div class="payment-summary-row">
        <div>
          <strong>${paymentMethodName(row.method)}</strong>
          <small>${row.count} ${row.count === 1 ? "Venta" : "Ventas"}</small>
        </div>
        <span>${money(row.total)}</span>
      </div>
    `).join("")
    : `<div class="empty-state compact-empty">Todavía no hay Ventas Locales para esta Fecha.</div>`;
  document.getElementById("cashCloseCounted").value = existing ? Number(existing.countedCash || 0) : "";
  document.getElementById("cashCloseWithdrawals").value = existing ? Number(existing.withdrawals || 0) : 0;
  document.getElementById("cashCloseNotes").value = existing?.notes || "";
  updateCashCloseDifferencePreview();
  const closures = state.cashClosures.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  table.innerHTML = closures.map((closure) => {
    const negative = Number(closure.difference || 0) < 0;
    return `
      <tr>
        <td>${formatDateShort(closure.date)}</td>
        <td>${money(closure.totalLocal)}</td>
        <td>${money(closure.expectedCash)}</td>
        <td>${money(closure.countedCash)}</td>
        <td>${money(closure.withdrawals)}</td>
        <td><strong class="${negative ? "text-danger" : "text-positive"}">${signedMoney(closure.difference)}</strong></td>
        <td>${closure.notes || "-"}</td>
        <td class="row-actions">
          <button class="tiny-action danger-action" data-delete-cash-close="${closure.id}" type="button">Eliminar</button>
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="8">Todavía no hay Cierres de Caja registrados.</td></tr>`;
}

function renderWorkshop() {
  const statusLabels = { en_taller: "En Taller", listo: "Listo", entregado: "Entregado" };
  const query = String(document.getElementById("workshopSearch")?.value || "").trim().toLowerCase();
  const orders = state.workshopOrders
    .filter((order) => !query || [order.customer, order.number].some((field) => String(field || "").toLowerCase().includes(query)))
    .slice()
    .reverse();
  document.getElementById("workshopList").innerHTML = orders.map((order) => `
    <div class="record workshop-record">
      <div class="record-head">
        <div class="workshop-record-detail">
          <strong>${order.number} · ${order.customer}</strong>
          <p class="muted">${order.description}</p>
          <small>${formatDateShort(order.date)} · ${order.phone || "Sin Teléfono"}</small>
        </div>
        <div class="workshop-record-side">
          <span class="pill ${order.paid ? "green" : ""}">${statusLabels[order.status]}</span>
          <strong class="workshop-record-price">${money(order.price)}</strong>
          ${order.paid ? `<small class="workshop-paid-meta">${paymentMethodName(order.paymentMethod || "efectivo")} · Cobrado ${money(order.totalPaid || order.price)}</small>` : ""}
          <div class="workshop-action-row">
            ${order.paid ? "" : `
              <button class="tiny-action" data-edit-workshop-price="${order.id}" type="button">Editar Precio</button>
              <button class="primary" data-complete-workshop="${order.id}" type="button">Entregar</button>
            `}
            <button class="tiny-action danger-action" data-delete-workshop="${order.id}" type="button">Eliminar</button>
          </div>
        </div>
      </div>
    </div>
  `).join("") || `<div class="empty-state compact-empty">No hay pedidos de Taller para esa búsqueda.</div>`;
}

function renderOnlineFormHelpers() {
  const payment = document.getElementById("onlinePayment");
  const platform = document.getElementById("onlinePaymentPlatform");
  if (payment) payment.innerHTML = onlinePaymentOptions(payment.value);
  if (platform) platform.innerHTML = onlinePaymentPlatformOptions(platform.value);
  renderOnlineCategorySuggestions();
  renderOnlineLineSubcategoryOptions();
}

function renderOnlineCategorySuggestions() {
  const input = document.getElementById("onlineLineCategory");
  const panel = document.getElementById("onlineCategorySuggestions");
  if (!input || !panel) return;
  const query = categoryKey(input.value);
  const categories = productCategories()
    .filter((category) => !query || categoryKey(category).startsWith(query))
    .sort((a, b) => a.localeCompare(b, "es"));
  panel.innerHTML = categories.length
    ? categories.map((category) => `<button type="button" data-select-online-category="${htmlAttr(category)}">${htmlAttr(category)}</button>`).join("")
    : `<span>No hay coincidencias</span>`;
  panel.classList.toggle("open", document.activeElement === input || Boolean(query));
}

function syncOnlinePaymentPlatform() {
  const payment = document.getElementById("onlinePayment");
  const platform = document.getElementById("onlinePaymentPlatform");
  if (!payment || !platform) return;
  if (payment.value === "Transferencia") platform.value = "transfer";
  if (payment.value === "Mercado Pago") platform.value = "mercadoPago";
}

function renderOnlineLineSubcategoryOptions() {
  const categoryInput = document.getElementById("onlineLineCategory");
  const subcategorySelect = document.getElementById("onlineLineSubcategory");
  if (!subcategorySelect) return;
  const category = canonicalProductCategory(categoryInput?.value);
  const subcategories = category ? productSubcategories(category) : [];
  const selected = subcategorySelect.value;
  subcategorySelect.innerHTML = [
    `<option value="">Sin Subcategoría</option>`,
    ...subcategories.map((subcategory) => `<option value="${htmlAttr(subcategory)}" ${subcategory === selected ? "selected" : ""}>${htmlAttr(subcategory)}</option>`),
  ].join("");
  subcategorySelect.disabled = subcategories.length === 0;
}

function renderOnlineDraftLines() {
  const preview = document.getElementById("onlineLinesPreview");
  const counter = document.getElementById("onlineDraftCounter");
  const itemCount = state.onlineDraftLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  if (counter) counter.textContent = `Articulos: ${itemCount}`;
  if (!preview) return;
  preview.innerHTML = state.onlineDraftLines.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Categoría</th><th>Subcategoría</th><th>Cantidad</th><th class="row-actions-head" aria-label="Eliminar"></th></tr></thead>
        <tbody>
          ${state.onlineDraftLines.map((line, index) => `
            <tr>
              <td>${line.category}</td>
              <td>${line.subcategory || "-"}</td>
              <td><input class="online-line-qty-input" data-online-line-qty="${index}" type="number" min="1" step="1" value="${Number(line.quantity || 1)}" aria-label="Cantidad"></td>
              <td class="row-actions"><button class="remove-line" data-remove-online-line="${index}" type="button" title="Eliminar Categoría">&times;</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  ` : `<div class="empty-state compact-empty">Agregá las Categorías vendidas en esta Venta.</div>`;
}

function updateOnlineDraftLineQuantity(index, value) {
  const line = state.onlineDraftLines[index];
  if (!line) return;
  const quantity = Math.max(1, Math.floor(Number(value || 1)));
  line.quantity = quantity;
  saveUiState();
  const counter = document.getElementById("onlineDraftCounter");
  if (counter) {
    const itemCount = state.onlineDraftLines.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    counter.textContent = `Articulos: ${itemCount}`;
  }
}

function updateOnlineCostPreview() {
  const form = document.getElementById("onlineForm");
  const preview = document.getElementById("onlineCostPreview");
  if (!form || !preview) return;
  const data = formDataObject(form);
  const grossAmount = Number(data.saleAmount ?? data.total ?? 0);
  const discountAmount = Math.min(grossAmount, Math.max(0, Number(data.discountAmount || 0)));
  const saleAmount = onlineDiscountedSaleAmount(grossAmount, discountAmount);
  const shippingAmount = Number(data.shippingAmount || 0);
  const store = data.store || "insumos";
  const paymentPlatform = data.paymentPlatform ? canonicalOnlinePaymentPlatform(data.paymentPlatform, data.paymentMethod) : "";
  const rate = onlineCostRate(store, "base");
  const estimated = onlineEstimatedCost(grossAmount, store, "base");
  const previewSale = { total: saleAmount, shippingAmount, collectedTotal: saleAmount + shippingAmount, paymentMethod: data.paymentMethod, paymentPlatform };
  const tiendaNubeCommission = data.paymentMethod && paymentPlatform ? tiendaNubeCommissionAmount(previewSale) : 0;
  const platformCommission = data.paymentMethod && paymentPlatform ? platformCommissionAmount(previewSale) : 0;
  preview.innerHTML = `
    <span>Tienda: <strong>${onlineStoreName(store)}</strong></span>
    <span>Plataforma: <strong>${paymentPlatform ? onlinePaymentPlatformLabel(paymentPlatform) : "Sin seleccionar"}</strong></span>
    <span>Venta real: <strong>${money(saleAmount)}</strong></span>
    ${discountAmount ? `<span>Descuento: <strong>${money(discountAmount)}</strong></span>` : ""}
    <span>Costo calculado: <strong>${formatCostRate(rate)} · ${money(estimated)}</strong></span>
    ${tiendaNubeCommission ? `<span>Comisión Tienda Nube: <strong>${money(tiendaNubeCommission)}</strong></span>` : ""}
    ${platformCommission ? `<span>Comisión plataforma: <strong>${money(platformCommission)}</strong></span>` : ""}
    ${shippingAmount ? `<span>Envío cobrado: <strong>${money(shippingAmount)}</strong> · No afecta resultado</span>` : ""}
  `;
}

function applyOnlineDateDefault() {
  const form = document.getElementById("onlineForm");
  if (!form) return;
  const hasDraft = state.onlineDraftLines.length
    || document.getElementById("onlineCustomerDni")?.value
    || document.getElementById("onlineClientLookup")?.value
    || document.getElementById("onlineProvince")?.value
    || form.elements.saleAmount.value
    || form.elements.discountAmount.value
    || form.elements.shippingAmount.value
    || form.elements.paymentMethod.value
    || form.elements.paymentPlatform.value;
  if (!hasDraft) {
    setDateInput(form.elements.date, lastOnlineDate());
    form.elements.orderNumber.value = nextOnlineOrderNumber();
  }
}

function onlineOrderSaleAmount(order) {
  return Number(order.saleAmount ?? order.total ?? onlineDiscountedSaleAmount(onlineGrossAmountFromRecord(order), onlineDiscountAmountFromRecord(order)));
}

function onlineOrderShippingAmount(order) {
  return Number(order.shippingAmount || 0);
}

function onlineOrderCollectedTotal(order) {
  return Number(order.collectedTotal ?? (onlineOrderSaleAmount(order) + onlineOrderShippingAmount(order)));
}

function afipPendingOrders() {
  syncOnlineArcaFlagsByOrderNumber(state);
  const doneKeys = arcaDoneKeySet(state);
  const listedKeys = new Set();
  return state.onlineOrders
    .filter((order) => {
      if (!isOnlineInsumosOrder(order)) return false;
      const key = onlineOrderArcaKey(order);
      if (order.afipDone || doneKeys.has(key) || listedKeys.has(key)) return false;
      listedKeys.add(key);
      return true;
    })
    .slice()
    .sort((a, b) =>
      String(a.date || "").localeCompare(String(b.date || ""))
      || String(a.orderNumber || "").localeCompare(String(b.orderNumber || ""), "es", { numeric: true, sensitivity: "base" })
      || idTimestamp(a.id) - idTimestamp(b.id)
    );
}

function renderAfipPendingButton() {
  const count = afipPendingOrders().length;
  const node = document.getElementById("afipPendingCount");
  if (node) node.textContent = String(count);
}

function renderOnlineMissingButton() {
  const count = missingOnlineOrderNumbers().length;
  const node = document.getElementById("onlineMissingCount");
  if (node) node.textContent = String(count);
}

function renderOnlineListFilters() {
  const filters = state.onlineFilters || {};
  const sort = document.getElementById("onlineSortFilter");
  const query = document.getElementById("onlineSearchFilter");
  const order = document.getElementById("onlineOrderFilter");
  const store = document.getElementById("onlineStoreFilter");
  if (sort) sort.value = filters.sort || "orderDesc";
  if (query) query.value = filters.query || "";
  if (order) order.value = filters.order || "";
  if (store) store.value = filters.store || "all";
}

function filteredOnlineOrders() {
  const filters = state.onlineFilters || {};
  const query = normalizeTextKey(filters.query || "");
  const orderQuery = normalizeTextKey(filters.order || "");
  const rows = state.onlineOrders
    .filter((order) => !filters.store || filters.store === "all" || String(order.store || "insumos") === filters.store)
    .filter((order) => {
      if (!orderQuery) return true;
      return normalizeTextKey(order.orderNumber).includes(orderQuery);
    })
    .filter((order) => {
      if (!query) return true;
      const lineText = (order.lines || []).map((line) => `${line.category} ${line.subcategory || ""}`).join(" ");
      return [
        order.orderNumber,
        order.customerName,
        order.customerDni,
        order.province,
        order.paymentMethod,
        onlinePaymentPlatformLabel(order.paymentPlatform),
        onlineStoreName(order.store),
        lineText,
      ].some((value) => normalizeTextKey(value).includes(query));
    });
  const sort = filters.sort || "orderDesc";
  return rows.sort((a, b) => {
    if (sort === "dateAsc") return String(a.date || "").localeCompare(String(b.date || "")) || idTimestamp(a.id) - idTimestamp(b.id);
    if (sort === "orderAsc") return String(a.orderNumber || "").localeCompare(String(b.orderNumber || ""), "es", { numeric: true, sensitivity: "base" });
    if (sort === "orderDesc") return String(b.orderNumber || "").localeCompare(String(a.orderNumber || ""), "es", { numeric: true, sensitivity: "base" });
    return String(b.date || "").localeCompare(String(a.date || "")) || idTimestamp(b.id) - idTimestamp(a.id);
  });
}

function renderOnline() {
  renderOnlineFormHelpers();
  renderOnlineListFilters();
  renderOnlineDraftLines();
  applyOnlineDateDefault();
  updateOnlineCostPreview();
  renderAfipPendingButton();
  renderOnlineMissingButton();
  const onlineOrders = filteredOnlineOrders();
  const page = pageItems(onlineOrders, state.onlinePage);
  state.onlinePage = page.current;
  document.getElementById("onlineList").innerHTML = page.rows.map((order) => `
    <div class="record">
      <div class="record-head">
        <div>
          <strong>${order.orderNumber} · ${order.province}${order.customerName ? ` · ${order.customerName}` : ""}</strong>
          ${order.customerDni ? `<small>DNI ${htmlAttr(formatCustomerDni(order.customerDni))}</small>` : ""}
          <p class="muted">${onlineStoreName(order.store)} · ${order.lines.map((line) => `${line.quantity} ${line.category}${line.subcategory ? ` / ${line.subcategory}` : ""}`).join(", ")}</p>
          <small>${formatDateShort(order.date)} · ${order.paymentMethod || "Sin Medio de Pago"} · ${onlinePaymentPlatformLabel(order.paymentPlatform)}</small>
        </div>
        <div class="record-amounts">
          <strong>${money(onlineOrderSaleAmount(order))}</strong>
          <button class="info-dot online-detail-trigger" type="button" aria-label="Ver detalle de la venta online">!
            <span class="online-detail-tooltip">
              <span>Importe: ${money(onlineGrossAmountFromRecord(order))}</span>
              ${onlineDiscountAmountFromRecord(order) ? `<span>Descuento: ${money(onlineDiscountAmountFromRecord(order))}</span>` : ""}
              <span>Envío: ${money(onlineOrderShippingAmount(order))}</span>
              <span>Total cobrado: ${money(onlineOrderCollectedTotal(order))}</span>
              <span>Costo ${formatCostRate(order.costRate)}: ${money(order.estimatedCost)}</span>
              <span>Comisión TN: ${money(tiendaNubeCommissionAmount({ ...order, total: onlineOrderSaleAmount(order) }))}</span>
              <span>ARCA: ${order.afipDone ? "Cargada" : "Pendiente"}</span>
            </span>
          </button>
          <button class="tiny-action" data-online-edit="${order.id}" type="button">Editar</button>
          <button class="tiny-action danger-action" data-online-delete="${order.id}" type="button">Eliminar</button>
        </div>
      </div>
    </div>
  `).join("") || `<div class="empty-state compact-empty">Todavía no hay Ventas Online registradas.</div>`;
  document.getElementById("onlinePagination").innerHTML = paginationControls("online", page.current, page.totalPages, onlineOrders.length);
  const monthOrders = state.onlineOrders.filter((order) => monthKeyFromDate(order.date) === currentMonthKey());
  const totalOnline = sum(monthOrders, (order) => onlineOrderSaleAmount(order));
  document.getElementById("onlineSummary").innerHTML = `
    <div class="summary-row online-total-card"><span>Ventas Online del Mes</span><strong>${money(totalOnline)}</strong></div>
  `;
}

function renderAfipPendingList() {
  const list = document.getElementById("afipPendingList");
  if (!list) return;
  const orders = afipPendingOrders();
  list.innerHTML = orders.map((order) => `
    <label class="afip-pending-row">
      <input type="checkbox" data-afip-order="${order.id}" data-afip-order-key="${htmlAttr(onlineOrderArcaKey(order))}">
      <span>
        <strong>${order.orderNumber || "Sin número"} · ARCA: ${money(onlineOrderCollectedTotal(order))}</strong>
        <small>${formatDateShort(order.date)} · ${order.province || "Sin provincia"}</small>
      </span>
    </label>
  `).join("") || `<div class="empty-state compact-empty">No hay ventas pendientes.</div>`;
}

function openAfipPendingModal() {
  renderAfipPendingList();
  const modal = document.getElementById("afipPendingModal");
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeAfipPendingModal() {
  const modal = document.getElementById("afipPendingModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function confirmAfipPendingOrders() {
  const checked = [...document.querySelectorAll("[data-afip-order]:checked")];
  const ids = checked.map((input) => input.dataset.afipOrder);
  const keys = new Set(checked.map((input) => input.dataset.afipOrderKey).filter(Boolean));
  if (!ids.length && !keys.size) return;
  const now = new Date().toISOString();
  state.onlineOrders.forEach((order) => {
    if (ids.includes(order.id) || keys.has(onlineOrderArcaKey(order))) {
      order.afipDone = true;
      order.afipDoneAt = now;
      order.updatedAt = now;
      rememberArcaDoneOrder(order, now);
    }
  });
  syncOnlineArcaFlagsByOrderNumber(state);
  logActivity("online", "Marco ARCA cargada", `${ids.length} ventas`);
  saveState();
  renderOnline();
  renderAfipPendingList();
}

function renderOnlineMissingList() {
  const list = document.getElementById("onlineMissingList");
  if (!list) return;
  const rows = missingOnlineOrderNumbers();
  list.innerHTML = rows.map((row) => `
    <label class="online-missing-row">
      <input type="checkbox" data-online-missing-key="${htmlAttr(row.key)}">
      <span>
        <strong>${htmlAttr(row.orderNumber)}</strong>
        <small>Falta entre ${htmlAttr(row.between)}. Marcala cuando confirmes que fue cancelada o no corresponde cargarla.</small>
      </span>
    </label>
  `).join("") || `<div class="empty-state compact-empty">No hay números pendientes detectados.</div>`;
}

function openOnlineMissingModal() {
  renderOnlineMissingList();
  const modal = document.getElementById("onlineMissingModal");
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeOnlineMissingModal() {
  const modal = document.getElementById("onlineMissingModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function confirmOnlineMissingResolved() {
  const selected = new Set([...document.querySelectorAll("[data-online-missing-key]:checked")].map((input) => input.dataset.onlineMissingKey));
  if (!selected.size) return;
  const rows = missingOnlineOrderNumbers().filter((row) => selected.has(row.key));
  if (!rows.length) return;
  const existing = onlineResolvedMissingKeys();
  rows.forEach((row) => {
    if (existing.has(row.key)) return;
    state.onlineResolvedMissingOrders.push({
      prefix: row.prefix,
      number: row.number,
      width: row.width,
      orderNumber: row.orderNumber,
      resolvedAt: new Date().toISOString(),
    });
  });
  logActivity("online", "Resolvio numeros pendientes", rows.map((row) => row.orderNumber).join(", "));
  saveState();
  renderOnline();
  renderOnlineMissingList();
}

function renderFixedExpensesTable() {
  const table = document.getElementById("fixedExpensesTable");
  if (!table) return;
  state.fixedExpenseTemplates = normalizeFixedExpenseTemplates(state.fixedExpenseTemplates);
  const activeTemplates = state.fixedExpenseTemplates.filter((template) => !template.disabled);
  table.innerHTML = activeTemplates.map((template) => `
    <tr>
      <td><input type="checkbox" data-fixed-enabled="${htmlAttr(template.id)}"></td>
      <td><strong>${template.concept}</strong></td>
      <td>${expenseCategoryLabel(template.category)}</td>
      <td>
        <div class="money-field fixed-expense-amount">
          <span>$</span>
          <input data-fixed-amount="${htmlAttr(template.id)}" type="number" min="0" step="1" value="">
        </div>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="4">No hay gastos fijos precargados.</td></tr>`;
}

function openFixedExpensesModal() {
  const dateInput = document.getElementById("fixedExpensesDate");
  if (dateInput) dateInput.value = todayIso();
  renderFixedExpensesTable();
  const modal = document.getElementById("fixedExpensesModal");
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeFixedExpensesModal() {
  const modal = document.getElementById("fixedExpensesModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function confirmFixedExpenses() {
  const date = normalizeDateInput(document.getElementById("fixedExpensesDate")?.value);
  if (!date) {
    alert("Elegí una fecha válida.");
    return;
  }
  const key = monthKeyFromDate(date);
  let loaded = 0;
  state.fixedExpenseTemplates.filter((template) => !template.disabled).forEach((template) => {
    const enabled = document.querySelector(`[data-fixed-enabled="${template.id}"]`)?.checked;
    const amount = Number(document.querySelector(`[data-fixed-amount="${template.id}"]`)?.value || 0);
    if (!enabled || amount <= 0) return;
    const existing = state.expenses.find((expense) => expense.source === "fixed-monthly" && expense.fixedTemplateId === template.id && monthKeyFromDate(expense.date) === key);
    const payload = {
      date,
      concept: template.concept,
      category: template.category,
      kind: "fijo",
      area: template.area,
      amount,
      source: "fixed-monthly",
      fixedTemplateId: template.id,
    };
    if (existing) {
      Object.assign(existing, payload);
    } else {
      state.expenses.push({ id: uid("expense"), createdAt: new Date().toISOString(), ...payload });
    }
    loaded += 1;
  });
  if (!loaded) {
    alert("Marcá al menos un gasto fijo con importe mayor a 0.");
    return;
  }
  state.expensesPage = 1;
  logActivity("expense", "Cargo gastos fijos", `${loaded} gastos - ${monthLabel(key)}`);
  saveState();
  closeFixedExpensesModal();
  render();
}

function renderSettings() {
  const form = document.getElementById("businessSettingsForm");
  if (!form) return;
  const settings = businessSettings();
  form.elements.tiendaNubeCommissionRate.value = settings.tiendaNubeCommissionRate;
  form.elements.mercadoPagoCommissionRate.value = settings.mercadoPagoCommissionRate;
  form.elements.pagoNubeCommissionRate.value = settings.pagoNubeCommissionRate;
  form.elements.onlineCostInsumos.value = settings.onlineCostInsumos;
  form.elements.onlineCostAccesorios.value = settings.onlineCostAccesorios;
  const catalogForm = document.getElementById("catalogSettingsForm");
  const catalog = catalogSettings();
  if (catalogForm) {
    catalogForm.elements.businessName.value = catalog.businessName;
    catalogForm.elements.whatsappNumber.value = catalog.whatsappNumber || defaultCatalogSettings.whatsappNumber;
    catalogForm.elements.defaultWhatsappMessage.value = catalog.defaultWhatsappMessage;
    catalogForm.elements.sizeAvailabilityMode.value = catalog.sizeAvailabilityMode;
    catalogForm.elements.outOfStockProductMode.value = catalog.outOfStockProductMode;
  }
  const dataLoadForm = document.getElementById("dataLoadSettingsForm");
  if (dataLoadForm) {
    dataLoadForm.elements.cloudInitialSalesDays.value = String(settings.cloudInitialSalesDays);
    dataLoadForm.elements.cloudInitialExpenseDays.value = String(settings.cloudInitialExpenseDays);
  }
  renderFixedExpenseSettingsTable();
  renderProductCategorySettingsTable();
  renderUserPermissionsTable();
}

function userRoleOptions(selected = "local") {
  return ["admin", "dueno", "local", "web", "taller", "consulta"]
    .map((role) => `<option value="${role}" ${role === selected ? "selected" : ""}>${userRoleLabels[role] || role}</option>`)
    .join("");
}

function renderUserPermissionsTable() {
  const table = document.getElementById("userPermissionsTable");
  if (!table) return;
  if (!isAdminProfile()) {
    table.innerHTML = `<tr><td colspan="5">Solo admin puede configurar permisos.</td></tr>`;
    return;
  }
  const profiles = [...supabaseProfiles];
  if (supabaseProfile && !profiles.some((profile) => profile.id === supabaseProfile.id)) profiles.unshift(supabaseProfile);
  if (!profiles.length) {
    table.innerHTML = `<tr><td colspan="5">Todavia no hay usuarios para configurar.</td></tr>`;
    return;
  }
  table.innerHTML = profiles.map((profile) => {
    const email = profileDisplayName(profile);
    const emailKey = profileEmailKey(profile);
    const role = profile.role || "local";
    const fullAccess = isFullAccessRole(role);
    const active = profile.active !== false;
    const isCurrentUser = profile.id === supabaseProfile?.id;
    const lastSeen = state.userLastSeen?.[emailKey]?.at;
    const selectedTabs = fullAccess ? allPermissionTabIds : normalizeTabList(state.userTabPermissions?.[emailKey]?.tabs, role);
    const hiddenFeatures = fullAccess ? [] : state.userTabPermissions?.[emailKey]?.hiddenFeatures || [];
    return `
      <tr data-user-permission-row="${htmlAttr(emailKey)}" data-user-id="${htmlAttr(profile.id || "")}">
        <td class="permission-user-cell">
          <strong>${htmlAttr(email || "Usuario")}</strong>
          <br><small>${active ? "Aprobado" : "Pendiente"}</small>
        </td>
        <td>
          <label class="permission-status-check">
            <input type="checkbox" data-user-active ${active ? "checked" : ""} ${isCurrentUser ? "disabled" : ""}>
            <span>${active ? "Activo" : "Pendiente"}</span>
          </label>
        </td>
        <td>
          <select data-user-role ${isCurrentUser ? "disabled" : ""}>
            ${userRoleOptions(role)}
          </select>
        </td>
        <td><small>${htmlAttr(lastSeen ? backupDateLabel(lastSeen) : "Sin registro")}</small></td>
        <td>
          <div class="permission-tab-list">
            ${permissionTabs.map((tab) => `
              <label class="permission-tab-check">
                <input type="checkbox" data-user-tab="${htmlAttr(tab.id)}" ${selectedTabs.includes(tab.id) ? "checked" : ""} ${fullAccess ? "disabled" : ""}>
                <span>${htmlAttr(tab.label)}</span>
              </label>
            `).join("")}
            ${permissionFeatureOptions.map((feature) => `
              <label class="permission-tab-check permission-feature-check">
                <input type="checkbox" data-user-hidden-feature="${htmlAttr(feature.id)}" ${hiddenFeatures.includes(feature.id) ? "checked" : ""} ${fullAccess ? "disabled" : ""}>
                <span>${htmlAttr(feature.label)}</span>
              </label>
            `).join("")}
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

async function saveUserPermissionsFromSettings() {
  if (!isAdminProfile()) return;
  const rows = [...document.querySelectorAll("[data-user-permission-row]")];
  const nextPermissions = { ...state.userTabPermissions };
  const profileUpdates = [];
  rows.forEach((row) => {
    const emailKey = row.dataset.userPermissionRow;
    const userId = row.dataset.userId;
    const profile = supabaseProfiles.find((item) => item.id === userId);
    const roleInput = row.querySelector("[data-user-role]");
    const activeInput = row.querySelector("[data-user-active]");
    const role = roleInput?.value || profile?.role || "local";
    const active = activeInput ? activeInput.checked : profile?.active !== false;
    const tabs = [...row.querySelectorAll("[data-user-tab]:checked")].map((input) => input.dataset.userTab);
    const hiddenFeatures = [...row.querySelectorAll("[data-user-hidden-feature]:checked")].map((input) => input.dataset.userHiddenFeature);
    if (isFullAccessRole(role)) {
      delete nextPermissions[emailKey];
    } else {
      nextPermissions[emailKey] = {
        tabs: normalizeTabList(tabs, role),
        hiddenFeatures: hiddenFeatures.filter((feature) => allPermissionFeatureIds.includes(feature)),
      };
    }
    if (userId && profile && userId !== supabaseProfile?.id && (role !== profile.role || active !== (profile.active !== false))) {
      profileUpdates.push({ id: userId, role, active });
    }
  });
  state.userTabPermissions = normalizeUserTabPermissions(nextPermissions);
  logActivity("users", "Guardo permisos", `${rows.length} usuarios configurados`);
  saveState();
  await saveRemoteStateNow();
  if (profileUpdates.length && supabaseClient) {
    for (const update of profileUpdates) {
      const { error } = await supabaseClient.from("profiles").update({
        role: update.role,
        active: update.active,
        updated_at: new Date().toISOString(),
      }).eq("id", update.id);
      if (error) alert(`No pude cambiar el usuario: ${error.message}`);
    }
    await refreshSupabaseProfiles({ renderAfter: false });
  }
  render();
  showActionToast("Permisos guardados.");
}

function expenseCategorySelectOptions(selected = "Servicios") {
  return Object.keys(expenseCategoryRules)
    .filter((category) => expenseCategoryRules[category].showInForm !== false)
    .map((category) => `<option value="${htmlAttr(category)}" ${category === selected ? "selected" : ""}>${expenseCategoryLabel(category)}</option>`)
    .join("");
}

function expenseAreaSelectOptions(selected = "general") {
  return ["local", "web", "general"]
    .map((area) => `<option value="${area}" ${canonicalExpenseArea(selected) === area ? "selected" : ""}>${expenseAreaLabel(area)}</option>`)
    .join("");
}

function renderFixedExpenseSettingsTable() {
  const table = document.getElementById("fixedExpenseSettingsTable");
  if (!table) return;
  state.fixedExpenseTemplates = normalizeFixedExpenseTemplates(state.fixedExpenseTemplates);
  const activeTemplates = state.fixedExpenseTemplates.filter((template) => !template.disabled);
  table.innerHTML = activeTemplates.map((template) => `
    <tr data-fixed-template-row="${htmlAttr(template.id)}">
      <td><input data-fixed-template-field="concept" value="${htmlAttr(template.concept)}"></td>
      <td><select data-fixed-template-field="category">${expenseCategorySelectOptions(template.category)}</select></td>
      <td><div class="money-field"><span>$</span><input data-fixed-template-field="amount" type="number" min="0" step="1" value="${Number(template.amount || 0)}"></div></td>
      <td class="row-actions"><button class="tiny-action danger-action" data-delete-fixed-template="${htmlAttr(template.id)}" type="button">Eliminar</button></td>
    </tr>
  `).join("") || `<tr><td colspan="4">No hay gastos fijos precargados.</td></tr>`;
}

function renderProductCategorySettingsTable() {
  const table = document.getElementById("productCategorySettingsTable");
  if (!table) return;
  state.customProductCategories = normalizeCustomProductCategories(state.customProductCategories);
  if (!state.customProductCategories.length) {
    table.innerHTML = `<tr><td colspan="6">No hay categorias personalizadas.</td></tr>`;
    return;
  }
  table.innerHTML = state.customProductCategories.map((entry) => `
    <tr data-product-category-row="${htmlAttr(entry.id)}">
      <td><input data-product-category-field="sortOrder" type="number" min="0" step="1" value="${Number(entry.sortOrder || 0)}"></td>
      <td><input data-product-category-field="active" type="checkbox" ${entry.active !== false ? "checked" : ""}></td>
      <td><input data-product-category-field="category" value="${htmlAttr(entry.category)}" placeholder="Ej. Cintas" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" data-no-browser-autofill></td>
      <td><input data-product-category-field="subcategory" value="${htmlAttr(entry.subcategory || "")}" placeholder="Opcional" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" data-no-browser-autofill></td>
      <td><input data-product-category-field="prefix" value="${htmlAttr(entry.prefix)}" placeholder="Ej. C" maxlength="1" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" data-no-browser-autofill></td>
      <td class="row-actions"><button class="tiny-action danger-action" data-delete-product-category="${htmlAttr(entry.id)}" type="button">Eliminar</button></td>
    </tr>
  `).join("");
}

function saveProductCategorySettingsFromSettings() {
  const rows = [...document.querySelectorAll("[data-product-category-row]")];
  const entries = rows.map((row) => {
    const field = (name) => row.querySelector(`[data-product-category-field="${name}"]`);
    return {
      id: row.dataset.productCategoryRow,
      category: field("category")?.value || "",
      subcategory: field("subcategory")?.value || "",
      prefix: field("prefix")?.value || "",
      active: Boolean(field("active")?.checked),
      sortOrder: Number(field("sortOrder")?.value || 0),
    };
  });
  const normalized = normalizeCustomProductCategories(entries);
  if (entries.some((entry) => String(entry.category || "").trim() && !normalizeCategoryPrefix(entry.prefix))) {
    alert("Cada categoria personalizada necesita un inicio de codigo.");
    return;
  }
  state.customProductCategories = normalized;
  logActivity("settings", "Guardo categorias", `${normalized.length} categorias personalizadas`);
  saveState();
  render();
  showActionToast("Categorias guardadas.");
}

function addProductCategorySetting() {
  state.customProductCategories = normalizeCustomProductCategories(state.customProductCategories);
  state.customProductCategories.push({
    id: uid("category"),
    category: "Nueva Categoria",
    subcategory: "",
    prefix: "NC",
    active: true,
    sortOrder: state.customProductCategories.length + 1,
  });
  renderProductCategorySettingsTable();
}

function deleteProductCategorySetting(categoryId) {
  state.customProductCategories = normalizeCustomProductCategories(state.customProductCategories)
    .filter((entry) => entry.id !== categoryId);
  renderProductCategorySettingsTable();
}

function saveFixedExpenseTemplatesFromSettings() {
  const rows = [...document.querySelectorAll("[data-fixed-template-row]")];
  const activeIds = new Set(rows.map((row) => row.dataset.fixedTemplateRow));
  state.fixedExpenseTemplates = normalizeFixedExpenseTemplates(state.fixedExpenseTemplates).map((template) => {
    const row = rows.find((item) => item.dataset.fixedTemplateRow === template.id);
    if (!row) return { ...template, disabled: !activeIds.has(template.id) ? template.disabled : false };
    const field = (name) => row.querySelector(`[data-fixed-template-field="${name}"]`);
    return {
      ...template,
      concept: String(field("concept")?.value || "").trim() || template.concept,
      category: field("category")?.value || template.category,
      area: "local",
      amount: Number(field("amount")?.value || 0),
      disabled: false,
    };
  });
  logActivity("settings", "Guardo gastos fijos", `${rows.length} plantillas activas`);
  saveState();
  renderSettings();
  showActionToast("Gastos fijos guardados.");
}

function addFixedExpenseTemplate() {
  state.fixedExpenseTemplates.push({
    id: uid("fixed-template"),
    concept: "Nuevo gasto fijo",
    category: "Servicios",
    area: "local",
    amount: 0,
  });
  logActivity("settings", "Agrego gasto fijo", "Nueva plantilla");
  saveState();
  renderSettings();
}

function deleteFixedExpenseTemplate(templateId) {
  const template = state.fixedExpenseTemplates.find((item) => item.id === templateId);
  if (!template) return;
  template.disabled = true;
  logActivity("settings", "Elimino gasto fijo", template.concept);
  saveState();
  renderSettings();
}

function saveBusinessSettingsFromForm(form) {
  const data = formDataObject(form);
  state.businessSettings = {
    ...businessSettings(),
    tiendaNubeCommissionRate: Number(data.tiendaNubeCommissionRate || 0),
    mercadoPagoCommissionRate: Number(data.mercadoPagoCommissionRate || 0),
    pagoNubeCommissionRate: Number(data.pagoNubeCommissionRate || 0),
    onlineCostInsumos: Number(data.onlineCostInsumos || 0),
    onlineCostAccesorios: Number(data.onlineCostAccesorios || 0),
    promoDiscounts: { ...defaultBusinessSettings.promoDiscounts },
  };
  logActivity("settings", "Guardo porcentajes", "Configuracion de costos y comisiones");
  saveState();
  render();
  showActionToast("Porcentajes guardados.");
}

async function saveDataLoadSettingsFromForm(form) {
  const data = formDataObject(form);
  state.businessSettings = {
    ...businessSettings(),
    cloudInitialSalesDays: Number(data.cloudInitialSalesDays ?? defaultBusinessSettings.cloudInitialSalesDays),
    cloudInitialExpenseDays: Number(data.cloudInitialExpenseDays ?? defaultBusinessSettings.cloudInitialExpenseDays),
  };
  cloudOperationalMode = "none";
  logActivity("settings", "Guardo carga de datos", `Ventas ${state.businessSettings.cloudInitialSalesDays || "todo"} dias - Gastos ${state.businessSettings.cloudInitialExpenseDays || "todo"} dias`);
  saveState();
  if (cloudEnabledWithSession()) {
    try {
      await loadCloudData({ mode: "initial", force: true });
    } catch (error) {
      console.warn("Cloud reload after data settings failed", error);
      renderAuthState(`Guardado. No pude recargar ahora: ${error.message || "error de Supabase"}`);
    }
  }
  render();
  showActionToast("Carga de datos guardada.");
}

async function saveCatalogSettingsFromForm(form) {
  const data = formDataObject(form);
  const nextSettings = catalogSettings({
    catalogSettings: {
      businessName: data.businessName,
      whatsappNumber: data.whatsappNumber,
      defaultWhatsappMessage: data.defaultWhatsappMessage,
      sizeAvailabilityMode: data.sizeAvailabilityMode,
      outOfStockProductMode: data.outOfStockProductMode,
    },
  });
  try {
    if (CLOUD_DATA_ENABLED) {
      if (!cloudEnabledWithSession()) {
        showAuthError("Ingresá con tu usuario BlackShoes para guardar catálogo en Supabase.");
        renderAuthState("Ingresá para guardar en Supabase.");
        return;
      }
      await saveCloudCatalogSettings(nextSettings);
    }
  } catch (error) {
    console.warn("Cloud catalog settings save failed", error);
    alert(`No pude guardar la configuración en Supabase: ${error.message || "error desconocido"}`);
    return;
  }
  state.catalogSettings = nextSettings;
  logActivity("settings", "Guardo catalogo", "Configuracion publica de BlackShoes");
  saveState();
  render();
  showActionToast("Catalogo guardado.");
}

function monthlyClosureMetrics(monthKey = state.selectedMonth || currentMonthKey()) {
  const sales = state.sales.filter((sale) => monthKeyFromDate(sale.date) === monthKey);
  const expenses = operatingExpenseRows().filter((expense) => monthKeyFromDate(expense.date) === monthKey && expenseCountsInResult(expense));
  const historicalMonth = historicalClosureForMonth(monthKey);
  if (historicalMonth && !sales.length && !expenses.length) {
    const historicalMetrics = closureScopeMetrics(historicalMonth, "total");
    return {
      monthKey,
      label: historicalMonth.label || monthLabel(monthKey),
      closedAt: historicalMonth.closedAt || new Date().toISOString(),
      localIncome: historicalMetrics.localIncome,
      webIncome: historicalMetrics.webIncome,
      income: historicalMetrics.income,
      shipping: historicalMetrics.shipping,
      expenseTotal: historicalMetrics.expenseTotal,
      merchandiseCost: historicalMetrics.merchandiseCost,
      result: historicalMetrics.margin,
      salesCount: 0,
      source: historicalMonth.source,
    };
  }
  const localIncome = sum(sales.filter((sale) => sale.channel === "local"), (sale) => sale.total);
  const webIncome = sum(sales.filter((sale) => sale.channel === "online"), (sale) => sale.total);
  const shipping = sum(sales.filter((sale) => sale.channel === "online"), (sale) => Number(sale.shippingAmount || 0));
  const income = localIncome + webIncome;
  const expenseTotal = sum(expenses, (expense) => Number(expense.amount || 0));
  const merchandiseCost = sum(sales, saleMerchandiseCost);
  return {
    monthKey,
    label: monthLabel(monthKey),
    closedAt: new Date().toISOString(),
    localIncome,
    webIncome,
    income,
    shipping,
    expenseTotal,
    merchandiseCost,
    result: income - expenseTotal - merchandiseCost,
    salesCount: sales.length,
  };
}

function closeSelectedMonth() {
  const monthKey = state.selectedMonth || currentMonthKey();
  const metrics = monthlyClosureMetrics(monthKey);
  const existing = state.monthlyClosures.find((closure) => closure.monthKey === monthKey);
  const closure = existing || { id: uid("monthly-close") };
  Object.assign(closure, metrics);
  if (!existing) state.monthlyClosures.push(closure);
  state.monthlyClosures.sort((a, b) => String(b.monthKey).localeCompare(String(a.monthKey)));
  state.monthlyClosuresPage = 1;
  logActivity("closure", existing ? "Actualizo cierre mensual" : "Creo cierre mensual", closure.label || monthLabel(monthKey));
  saveState();
  renderMonthlyClosures();
  renderDashboard();
}

function deleteMonthlyClosure(closureId) {
  const closure = state.monthlyClosures.find((item) => item.id === closureId);
  if (!closure) return;
  openConfirmModal({
    title: "Eliminar cierre mensual",
    message: `Se eliminara el cierre de ${closure.label || monthLabel(closure.monthKey)}. Las ventas y gastos cargados no se modifican.`,
    confirmText: "Eliminar",
    danger: true,
    onConfirm: () => {
      rememberDeletedRecord("monthlyClosures", closureId);
      state.monthlyClosures = state.monthlyClosures.filter((item) => item.id !== closureId);
      logActivity("closure", "Elimino cierre mensual", closure.label || monthLabel(closure.monthKey));
      saveState();
      renderMonthlyClosures();
    },
  });
}

function renderMonthlyClosures() {
  const table = document.getElementById("monthlyClosuresTable");
  const pagination = document.getElementById("monthlyClosuresPagination");
  if (!table) return;
  const rows = [...(state.monthlyClosures || [])].sort((a, b) => String(b.monthKey).localeCompare(String(a.monthKey)));
  const totalPages = Math.max(1, Math.ceil(rows.length / MONTHLY_CLOSURES_PAGE_SIZE));
  const current = Math.min(Math.max(1, Number(state.monthlyClosuresPage || 1)), totalPages);
  const start = (current - 1) * MONTHLY_CLOSURES_PAGE_SIZE;
  const pageRows = rows.slice(start, start + MONTHLY_CLOSURES_PAGE_SIZE);
  state.monthlyClosuresPage = current;
  table.innerHTML = pageRows.length ? pageRows.map((closure) => `
    <tr>
      <td><strong>${htmlAttr(closure.label || monthLabel(closure.monthKey))}</strong><br><small>${formatDateShort(String(closure.closedAt || "").slice(0, 10))}</small></td>
      <td>${money(closure.income)}</td>
      <td>${money(closure.expenseTotal)}</td>
      <td>${money(closure.merchandiseCost)}</td>
      <td><strong>${money(closure.result)}</strong></td>
      <td>${Number(closure.salesCount || 0)}</td>
      <td class="row-actions"><button class="tiny-action danger-action" data-delete-monthly-closure="${closure.id}" type="button">Eliminar</button></td>
    </tr>
  `).join("") : `<tr><td colspan="7">Todavía no hay cierres mensuales guardados.</td></tr>`;
  if (pagination) pagination.innerHTML = monthlyClosuresPaginationControls(current, totalPages, rows.length);
}

function saleLocalPaymentOptions(selected = "") {
  return [`<option value="" ${selected ? "" : "selected"}>Medio de Pago</option>`]
    .concat(state.paymentMethods
    .map((method) => `<option value="${method.id}" ${method.id === selected ? "selected" : ""}>${paymentMethodOptionLabel(method)}</option>`)
    )
    .join("");
}

function salePromoOptions(selected = "base") {
  const settings = businessSettings();
  return Object.entries(onlinePromoOptions)
    .map(([id, promo]) => {
      const discount = settings.promoDiscounts[id] ?? promo.discount ?? 0;
      const label = id === "base" ? promo.label : `${promo.label} (${discount}%)`;
      return `<option value="${id}" ${id === selected ? "selected" : ""}>${label}</option>`;
    })
    .join("");
}

function openSaleEditModal(saleId) {
  const sale = state.sales.find((item) => item.id === saleId);
  const modal = document.getElementById("saleEditModal");
  const form = document.getElementById("saleEditForm");
  if (!sale || !modal || !form) return;
  if (CLOUD_DATA_ENABLED && isUuid(sale.id)) {
    alert("Para corregir una venta guardada en Supabase, anulala y cargala nuevamente. Así stock y pagos quedan correctos.");
    return;
  }
  const linkedOrder = sale.channel === "online" ? findOnlineOrderForSale(sale) : null;
  form.elements.saleId.value = sale.id;
  form.elements.onlineOrderId.value = linkedOrder?.id || sale.onlineOrderId || "";
  form.elements.date.value = normalizeDateInput(sale.date) || todayIso();
  form.elements.orderNumber.value = sale.orderNumber || saleOrder(sale);
  form.elements.total.readOnly = sale.channel === "online";
  if (sale.channel === "online") {
    form.elements.grossAmount.value = Number(sale.grossAmount ?? linkedOrder?.grossAmount ?? sale.total ?? 0);
    form.elements.discountAmount.value = Number(sale.discountAmount ?? linkedOrder?.discountAmount ?? 0);
  }
  form.elements.total.value = Number(sale.total || 0);
  form.elements.shippingAmount.value = Number(sale.shippingAmount || 0);
  form.elements.customerName.value = sale.customerName || "";
  form.elements.province.value = sale.province || "";
  form.elements.paymentMethod.innerHTML = sale.channel === "online"
    ? onlinePaymentOptions(sale.paymentMethod || "")
    : saleLocalPaymentOptions(sale.paymentMethod || "");
  form.elements.paymentPlatform.innerHTML = onlinePaymentPlatformOptions(sale.paymentPlatform || "");
  form.elements.onlineStore.value = sale.onlineStore || sale.store || "insumos";
  form.querySelectorAll(".online-sale-edit-field").forEach((field) => field.classList.toggle("is-hidden", sale.channel !== "online"));
  if (sale.channel === "online") updateSaleEditOnlineTotal();
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  formatAllMoneyInputs(modal);
}

function closeSaleEditModal() {
  const modal = document.getElementById("saleEditModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function updateSaleEditOnlineTotal() {
  const form = document.getElementById("saleEditForm");
  if (!form || !form.elements.grossAmount || !form.elements.discountAmount || !form.elements.total) return;
  const grossAmount = Math.max(0, parseMoneyInput(form.elements.grossAmount.value || 0));
  const discountAmount = Math.min(grossAmount, Math.max(0, parseMoneyInput(form.elements.discountAmount.value || 0)));
  form.elements.total.value = onlineDiscountedSaleAmount(grossAmount, discountAmount);
  formatMoneyInput(form.elements.total);
}

function openOnlineOrderEditModal(orderId) {
  const order = state.onlineOrders.find((item) => item.id === orderId);
  const sale = findSaleForOnlineOrder(order);
  if (!order || !sale) {
    alert("No pude encontrar la venta asociada a esta orden online.");
    return;
  }
  order.saleId = sale.id;
  sale.onlineOrderId = order.id;
  openSaleEditModal(sale.id);
  const form = document.getElementById("saleEditForm");
  if (form?.elements.onlineOrderId) form.elements.onlineOrderId.value = order.id;
}

function syncLinkedOnlineOrderFromSale(sale, explicitOrderId = "") {
  const order = explicitOrderId
    ? state.onlineOrders.find((item) => item.id === explicitOrderId)
    : findOnlineOrderForSale(sale);
  if (!order) return;
  const now = sale.updatedAt || new Date().toISOString();
  order.saleId = sale.id;
  sale.onlineOrderId = order.id;
  order.date = sale.date;
  order.orderNumber = sale.orderNumber || order.orderNumber;
  order.store = sale.onlineStore || sale.store || order.store;
  order.total = Number(sale.total || 0);
  order.grossAmount = Number(sale.grossAmount ?? sale.total ?? 0);
  order.discountAmount = Number(sale.discountAmount || 0);
  order.saleAmount = Number(sale.total || 0);
  order.shippingAmount = Number(sale.shippingAmount || 0);
  order.shipping = Number(sale.shippingAmount || 0);
  order.collectedTotal = onlineSaleCollectedTotal(sale);
  order.paymentMethod = sale.paymentMethod;
  order.paymentPlatform = sale.paymentPlatform;
  order.promo = sale.onlinePromo || "base";
  order.costRate = sale.onlineCostRate;
  order.estimatedCost = sale.onlineCost;
  order.province = sale.province || "";
  order.customerName = sale.customerName || "";
  order.customerDni = sale.customerDni || order.customerDni || "";
  order.updatedAt = now;
}

function saveSaleEdit(form) {
  const data = formDataObject(form);
  const sale = state.sales.find((item) => item.id === data.saleId);
  if (!sale) return;
  if (CLOUD_DATA_ENABLED && isUuid(sale.id)) {
    alert("Para corregir una venta guardada en Supabase, anulala y cargala nuevamente.");
    return;
  }
  const now = new Date().toISOString();
  const date = normalizeDateInput(data.date) || sale.date || todayIso();
  let total = Math.max(0, Number(data.total || 0));
  sale.date = date;
  sale.customerName = String(data.customerName || "").trim();
  sale.updatedAt = now;
  if (sale.channel === "online") {
    const grossAmount = Math.max(0, Number(data.grossAmount || data.total || 0));
    const discountAmount = Math.min(grossAmount, Math.max(0, Number(data.discountAmount || 0)));
    total = onlineDiscountedSaleAmount(grossAmount, discountAmount);
    const shippingAmount = Math.max(0, Number(data.shippingAmount || 0));
    const paymentPlatform = canonicalOnlinePaymentPlatform(data.paymentPlatform, data.paymentMethod);
    sale.orderNumber = String(data.orderNumber || sale.orderNumber || "").trim();
    sale.total = total;
    sale.grossAmount = grossAmount;
    sale.discountAmount = discountAmount;
    sale.shippingAmount = shippingAmount;
    sale.collectedTotal = total + shippingAmount;
    sale.paymentMethod = data.paymentMethod || sale.paymentMethod || "web";
    sale.paymentPlatform = paymentPlatform;
    sale.onlineStore = data.onlineStore || sale.onlineStore || "insumos";
    sale.store = sale.onlineStore;
    sale.onlinePromo = "base";
    sale.onlineCostRate = onlineCostRate(sale.onlineStore, "base");
    sale.onlineCost = onlineEstimatedCost(grossAmount, sale.onlineStore, "base");
    sale.province = normalizeProvince(data.province);
    syncLinkedOnlineOrderFromSale(sale, data.onlineOrderId);
    rememberOnlineOrderNumber(sale.orderNumber);
  } else {
    sale.total = total;
    const method = state.paymentMethods.some((item) => item.id === data.paymentMethod) ? data.paymentMethod : sale.paymentMethod || "efectivo";
    sale.paymentMethod = method;
    const parsedOrder = String(data.orderNumber || "").match(/\d+/);
    if (parsedOrder) sale.localOrderNumber = Number(parsedOrder[0]);
  }
  logActivity(sale.channel === "online" ? "online" : "sale", "Edito venta", `${saleOrder(sale)} - ${money(sale.total)}`);
  saveState();
  closeSaleEditModal();
  render();
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xlsxColumnName(index) {
  let number = index + 1;
  let name = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    number = Math.floor((number - 1) / 26);
  }
  return name;
}

function xlsxSheetName(name) {
  return String(name || "Hoja").replace(/[\[\]\*\?\/\\:]/g, " ").slice(0, 31) || "Hoja";
}

function xlsxCell(value, rowIndex, columnIndex) {
  const reference = `${xlsxColumnName(columnIndex)}${rowIndex + 1}`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function xlsxWorksheet(rows) {
  const sheetRows = rows.map((row, rowIndex) =>
    `<row r="${rowIndex + 1}">${row.map((cell, columnIndex) => xlsxCell(cell, rowIndex, columnIndex)).join("")}</row>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRows}</sheetData>
</worksheet>`;
}

function bytesFromString(value) {
  return new TextEncoder().encode(value);
}

function concatBytes(parts) {
  const total = parts.reduce((amount, part) => amount + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function uintBytes(value, length) {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = (value >>> (index * 8)) & 0xff;
  }
  return bytes;
}

let zipCrcTable = null;

function crc32(bytes) {
  if (!zipCrcTable) {
    zipCrcTable = Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      return value >>> 0;
    });
  }
  let crc = 0xffffffff;
  bytes.forEach((byte) => {
    crc = zipCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDateParts(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = (date.getFullYear() - 1980) << 9 | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function createZipBlob(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, day } = zipDateParts();
  files.forEach((file) => {
    const nameBytes = bytesFromString(file.name);
    const dataBytes = typeof file.content === "string" ? bytesFromString(file.content) : file.content;
    const crc = crc32(dataBytes);
    const localHeader = concatBytes([
      uintBytes(0x04034b50, 4),
      uintBytes(20, 2),
      uintBytes(0, 2),
      uintBytes(0, 2),
      uintBytes(time, 2),
      uintBytes(day, 2),
      uintBytes(crc, 4),
      uintBytes(dataBytes.length, 4),
      uintBytes(dataBytes.length, 4),
      uintBytes(nameBytes.length, 2),
      uintBytes(0, 2),
      nameBytes,
    ]);
    const centralHeader = concatBytes([
      uintBytes(0x02014b50, 4),
      uintBytes(20, 2),
      uintBytes(20, 2),
      uintBytes(0, 2),
      uintBytes(0, 2),
      uintBytes(time, 2),
      uintBytes(day, 2),
      uintBytes(crc, 4),
      uintBytes(dataBytes.length, 4),
      uintBytes(dataBytes.length, 4),
      uintBytes(nameBytes.length, 2),
      uintBytes(0, 2),
      uintBytes(0, 2),
      uintBytes(0, 2),
      uintBytes(0, 2),
      uintBytes(0, 4),
      uintBytes(offset, 4),
      nameBytes,
    ]);
    localParts.push(localHeader, dataBytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  });
  const centralDirectory = concatBytes(centralParts);
  const endRecord = concatBytes([
    uintBytes(0x06054b50, 4),
    uintBytes(0, 2),
    uintBytes(0, 2),
    uintBytes(files.length, 2),
    uintBytes(files.length, 2),
    uintBytes(centralDirectory.length, 4),
    uintBytes(offset, 4),
    uintBytes(0, 2),
  ]);
  return new Blob([concatBytes([...localParts, centralDirectory, endRecord])], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function xlsxWorkbookBlob(sheets) {
  const safeSheets = sheets.map((sheet, index) => ({ ...sheet, name: xlsxSheetName(sheet.name), id: index + 1 }));
  const workbookSheets = safeSheets.map((sheet) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${sheet.id}" r:id="rId${sheet.id}"/>`).join("");
  const workbookRels = safeSheets.map((sheet) => `<Relationship Id="rId${sheet.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheet.id}.xml"/>`).join("");
  const worksheetOverrides = safeSheets.map((sheet) => `<Override PartName="/xl/worksheets/sheet${sheet.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const now = new Date().toISOString();
  const files = [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${worksheetOverrides}
</Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
    },
    {
      name: "docProps/core.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${BUSINESS_NAME} respaldo</dc:title>
  <dc:creator>${BUSINESS_NAME}</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`,
    },
    {
      name: "docProps/app.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>${BUSINESS_NAME}</Application>
</Properties>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${workbookSheets}</sheets>
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}</Relationships>`,
    },
    ...safeSheets.map((sheet) => ({ name: `xl/worksheets/sheet${sheet.id}.xml`, content: xlsxWorksheet(sheet.rows) })),
  ];
  return createZipBlob(files);
}

function downloadBlob(filename, blob) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function textFromBytes(bytes) {
  return new TextDecoder().decode(bytes);
}

function uintFromBytes(bytes, offset, length) {
  let value = 0;
  for (let index = 0; index < length; index += 1) {
    value |= bytes[offset + index] << (index * 8);
  }
  return value >>> 0;
}

async function inflateZipEntry(bytes) {
  if (!("DecompressionStream" in window)) throw new Error("El navegador no puede descomprimir este respaldo.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipTextFiles(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const files = {};
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const signature = uintFromBytes(bytes, offset, 4);
    if (signature !== 0x04034b50) break;
    const method = uintFromBytes(bytes, offset + 8, 2);
    const compressedSize = uintFromBytes(bytes, offset + 18, 4);
    const fileNameLength = uintFromBytes(bytes, offset + 26, 2);
    const extraLength = uintFromBytes(bytes, offset + 28, 2);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error("El archivo de respaldo esta incompleto.");
    const name = textFromBytes(bytes.slice(nameStart, nameStart + fileNameLength));
    const dataBytes = bytes.slice(dataStart, dataEnd);
    if (method === 0) {
      files[name] = textFromBytes(dataBytes);
    } else if (method === 8) {
      files[name] = textFromBytes(await inflateZipEntry(dataBytes));
    } else {
      throw new Error("El respaldo tiene compresion no compatible.");
    }
    offset = dataEnd;
  }
  return files;
}

function worksheetPathForBackup(files) {
  const workbook = files["xl/workbook.xml"] || "";
  const rels = files["xl/_rels/workbook.xml.rels"] || "";
  const sheetMatch = workbook.match(/<sheet\b[^>]*name="Backup JSON"[^>]*r:id="([^"]+)"/)
    || workbook.match(/<sheet\b[^>]*r:id="([^"]+)"[^>]*name="Backup JSON"/);
  if (sheetMatch) {
    const relMatch = rels.match(new RegExp(`<Relationship\\b[^>]*Id="${sheetMatch[1]}"[^>]*Target="([^"]+)"`));
    if (relMatch) {
      const target = relMatch[1].replace(/^\/+/, "");
      return target.startsWith("xl/") ? target : `xl/${target}`;
    }
  }
  return files["xl/worksheets/sheet8.xml"] ? "xl/worksheets/sheet8.xml" : "";
}

function worksheetRowsFromXml(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("No se pudo leer la hoja Backup JSON.");
  return Array.from(doc.getElementsByTagName("row")).map((row) =>
    Array.from(row.getElementsByTagName("c")).map((cell) => {
      const textNode = cell.getElementsByTagName("t")[0];
      const valueNode = cell.getElementsByTagName("v")[0];
      return textNode ? textNode.textContent : valueNode ? valueNode.textContent : "";
    })
  );
}

async function backupJsonFromXlsx(arrayBuffer) {
  const files = await readZipTextFiles(arrayBuffer);
  const backupPath = worksheetPathForBackup(files);
  if (!backupPath || !files[backupPath]) throw new Error("No encontre la hoja Backup JSON en este Excel.");
  const rows = worksheetRowsFromXml(files[backupPath]);
  const json = rows.slice(1).map((row) => row[1] || "").join("");
  if (!json.trim()) throw new Error("La hoja Backup JSON esta vacia.");
  return json;
}

async function importBackupFile(file) {
  if (!file) return;
  const confirmed = confirm("Importar este respaldo reemplaza todos los datos actuales. ¿Continuar?");
  if (!confirmed) return;
  try {
    const imported = JSON.parse(await backupJsonFromXlsx(await file.arrayBuffer()));
    state = normalizeState(imported);
    state.activeView = "settings";
    logActivity("backup", "Importo respaldo", file?.name || "Archivo Excel");
    saveState();
    render();
    showActionToast("Respaldo importado correctamente.");
  } catch (error) {
    alert(`No se pudo importar el respaldo: ${error.message}`);
  } finally {
    const input = document.getElementById("importBackupInput");
    if (input) input.value = "";
  }
}

function exportExcelBackup() {
  const monthKey = state.selectedMonth || currentMonthKey();
  const closure = monthlyClosureMetrics(monthKey);
  const expenseData = expenseRows();
  const reportRows = [
    ["Campo", "Valor"],
    ["Mes", closure.label],
    ["Ingresos Local", closure.localIncome],
    ["Ingresos Web", closure.webIncome],
    ["Envios Web", closure.shipping],
    ["Ingresos Resultado", closure.income],
    ["Gastos", closure.expenseTotal],
    ["Costo Mercaderia", closure.merchandiseCost],
    ["Resultado", closure.result],
    ["Ventas", closure.salesCount],
    ["Exportado", new Date().toLocaleString("es-AR")],
  ];
  const salesRows = [
    ["Fecha", "Canal", "Orden", "Cliente", "DNI", "Medio", "Plataforma", "Importe", "Descuento", "Importe Venta", "Envio", "Total Cobrado", "Costo Mercaderia"],
    ...state.sales.map((sale) => [
      sale.date,
      saleChannelLabel(sale),
      saleOrder(sale),
      sale.customerName || "",
      sale.customerDni || "",
      paymentMethodName(sale.paymentMethod || (sale.channel === "online" ? "web" : "")),
      sale.channel === "online" ? onlinePaymentPlatformLabel(sale.paymentPlatform) : "",
      sale.channel === "online" ? Number(sale.grossAmount ?? sale.total ?? 0) : "",
      sale.channel === "online" ? Number(sale.discountAmount || 0) : "",
      Number(sale.total || 0),
      Number(sale.shippingAmount || 0),
      sale.channel === "online" ? onlineSaleCollectedTotal(sale) : Number(sale.total || 0),
      saleMerchandiseCost(sale),
    ]),
  ];
  const onlineRows = [
    ["Fecha", "Orden", "Cliente", "DNI", "Tienda", "Provincia", "Medio", "Plataforma", "Importe", "Descuento", "Importe Venta", "Envio", "Total ARCA", "Costo Estimado"],
    ...state.onlineOrders.map((order) => [
      order.date,
      order.orderNumber,
      order.customerName || "",
      order.customerDni || "",
      onlineStoreName(order.store),
      order.province || "",
      order.paymentMethod || "",
      onlinePaymentPlatformLabel(order.paymentPlatform),
      Number(order.grossAmount ?? order.saleAmount ?? order.total ?? 0),
      Number(order.discountAmount || 0),
      Number(order.saleAmount ?? order.total ?? 0),
      Number(order.shippingAmount ?? order.shipping ?? 0),
      Number(order.collectedTotal ?? (Number(order.saleAmount ?? order.total ?? 0) + Number(order.shippingAmount ?? order.shipping ?? 0))),
      Number(order.estimatedCost || 0),
    ]),
  ];
  const expenseRowsExport = [
    ["Fecha", "Tipo", "Categoria", "Comportamiento", "Concepto", "Detalle", "Importe", "Automatico"],
    ...expenseData.map((expense) => [
      expense.date,
      expenseTypeLabel(expense.type),
      expenseCategoryLabel(expense.category),
      expenseBehaviorLabel(expense.behavior),
      expense.concept,
      expense.detail || "",
      Number(expense.amount || 0),
      expense.automatic ? "Si" : "No",
    ]),
  ];
  const productRows = [
    ["Codigo", "Descripcion", "Color", "Categoria", "Subcategoria", "Precio", "Precio Promo", "Costo", "Stock", "Talles", "Publicado", "Control Stock"],
    ...state.products.map((product) => [
      product.code,
      product.description,
      product.color || "",
      product.category,
      product.subcategory || "",
      Number(product.price || 0),
      Number(product.promoPrice || 0),
      Number(product.cost || 0),
      Number(product.stock || 0),
      serializeProductSizeVariants(product),
      product.published ? "Si" : "No",
      product.tracksStock ? "Si" : "No",
    ]),
  ];
  const customerRows = [
    ["Cliente", "DNI", "Telefono", "Direccion", "Ventas", "Total Comprado", "Ticket Promedio"],
    ...state.customers.map((customer) => {
      const sales = salesForCustomer(customer);
      const total = sum(sales, (sale) => sale.total);
      return [customer.name, customer.dni || "", customer.phone || "", customer.address || "", sales.length, total, sales.length ? total / sales.length : 0];
    }),
  ];
  const closureRows = [
    ["Mes", "Cerrado", "Ingresos", "Envios", "Gastos", "Mercaderia", "Resultado", "Ventas"],
    ...(state.monthlyClosures || []).map((item) => [item.label || monthLabel(item.monthKey), item.closedAt || "", item.income, item.shipping, item.expenseTotal, item.merchandiseCost, item.result, item.salesCount]),
  ];
  const activityRows = [
    ["Fecha", "Usuario", "Tipo", "Accion", "Detalle"],
    ...(state.activityLog || []).map((entry) => [
      formatActivityDate(entry.at),
      entry.user || "",
      activityTypeLabel(entry.type),
      entry.action || "",
      entry.detail || "",
    ]),
  ];
  const backupChunks = JSON.stringify(state, null, 2).match(/.{1,28000}/gs) || [""];
  const backupRows = [["Parte", "JSON"], ...backupChunks.map((chunk, index) => [index + 1, chunk])];
  const workbook = xlsxWorkbookBlob([
    { name: "Resumen", rows: reportRows },
    { name: "Ventas", rows: salesRows },
    { name: "Ventas Online", rows: onlineRows },
    { name: "Gastos", rows: expenseRowsExport },
    { name: "Productos", rows: productRows },
    { name: "Clientes", rows: customerRows },
    { name: "Cierres", rows: closureRows },
    { name: "Movimientos", rows: activityRows },
    { name: "Backup JSON", rows: backupRows },
  ]);
  downloadBlob(`${BLACKSHOES_TECHNICAL_NAME}-respaldo-${todayIso()}.xlsx`, workbook);
}

function renderExpenses() {
  renderExpenseCategoryOptions();
  renderExpensePeriodOptions();
  const filters = state.expenseFilters || {};
  const filterValues = {
    expenseSearchFilter: filters.query || "",
    expenseYearFilter: filters.year || String(new Date().getFullYear()),
    expenseMonthFilter: filters.month || String(new Date().getMonth() + 1).padStart(2, "0"),
    expenseCategoryFilter: filters.category || "all",
    expenseTypeFilter: filters.type || "all",
    expenseBehaviorFilter: filters.behavior || "all",
    expenseCommissionFilter: filters.commissions || "all",
  };
  Object.entries(filterValues).forEach(([id, value]) => {
    const node = document.getElementById(id);
    if (node) node.value = value;
  });
  const rows = filteredExpenseRows();
  const page = pageItems(rows, state.expensesPage);
  state.expensesPage = page.current;
  const total = sum(rows, (entry) => entry.amount);
  const summaryNode = document.getElementById("expenseFilteredSummary");
  if (summaryNode) summaryNode.textContent = `Total Filtrado = ${money(total)} (${rows.length} ${rows.length === 1 ? "movimiento" : "movimientos"})`;
  document.getElementById("expensesTable").innerHTML = page.rows.map((entry) => `
    <tr>
      <td>${formatDateShort(entry.date)}</td>
      <td><span class="expense-badge ${expenseTypeClass(entry.type)}">${expenseTypeLabel(entry.type)}</span></td>
      <td>${expenseCategoryLabel(entry.category)}</td>
      <td>${expenseBehaviorLabel(entry.behavior)}</td>
      <td class="expense-detail-cell"><strong>${entry.concept}</strong><br><small>${entry.detail}${entry.source === "sale-cost" || entry.automatic ? " · Automático" : ""}</small></td>
      <td class="expense-amount-cell">${renderExpenseAmountCell(entry)}</td>
      <td class="row-actions">
        ${entry.deletable ? `<button class="tiny-action danger-action" data-delete-expense="${entry.key}" type="button">Eliminar</button>` : `<span class="auto-row-label">Automático</span>`}
      </td>
    </tr>
  `).join("") || `<tr><td colspan="7">Todavía no hay movimientos cargados.</td></tr>`;
  document.getElementById("expensesPagination").innerHTML = paginationControls("expenses", page.current, page.totalPages, rows.length);
  updateExpenseFormType();
}

function renderReportPeriodControls() {
  const multipleChannels = hasMultipleVisibleSalesChannels();
  if (!multipleChannels) state.reportScope = "total";
  const reportScopeButtons = document.getElementById("reportScopeButtons");
  if (reportScopeButtons) reportScopeButtons.hidden = !multipleChannels;
  document.querySelectorAll("#reportScopeButtons button").forEach((button) => {
    button.classList.toggle("active", button.dataset.reportScope === state.reportScope);
  });
  document.querySelectorAll("#periodButtons button").forEach((button) => {
    button.classList.toggle("active", button.dataset.period === state.reportPeriod);
  });
  const customRange = document.getElementById("reportCustomRange");
  const fromInput = document.getElementById("reportCustomFrom");
  const toInput = document.getElementById("reportCustomTo");
  const productsCard = document.getElementById("reportProductsCard");
  const provincesCard = document.getElementById("reportProvincesCard");
  const subcategoriesCard = document.getElementById("reportSubcategoriesCard");
  const shippingCard = document.getElementById("reportShippingCard");
  const marginTrendPanel = document.getElementById("marginTrendPanel");
  const marginTrendOrder = document.getElementById("marginTrendOrder");
  if (customRange) customRange.classList.toggle("is-hidden", state.reportPeriod !== "custom");
  if (fromInput) fromInput.value = normalizeDateInput(state.reportCustomFrom) || monthAgoIso();
  if (toInput) toInput.value = normalizeDateInput(state.reportCustomTo) || todayIso();
  if (productsCard) productsCard.classList.toggle("is-hidden", multipleChannels && state.reportScope === "web");
  if (provincesCard) provincesCard.classList.toggle("is-hidden", !multipleChannels || state.reportScope === "local");
  if (subcategoriesCard) subcategoriesCard.classList.remove("is-hidden");
  if (shippingCard) shippingCard.hidden = state.reportScope !== "web";
  if (marginTrendPanel) marginTrendPanel.classList.toggle("is-hidden", !["year", "all"].includes(state.reportPeriod));
  if (marginTrendOrder) marginTrendOrder.value = state.marginTrendOrder || "chronological";
}

function renderReports() {
  renderReportPeriodControls();
  const periodSales = state.sales.filter((item) => inPeriod(item.date));
  const sales = periodSales.filter(reportSaleMatchesScope);
  const salesCounter = document.getElementById("reportSalesCounter");
  if (salesCounter) {
    const salesCount = sales.length;
    salesCounter.textContent = `${salesCount} ${salesCount === 1 ? "venta" : "ventas"} en el periodo`;
  }
  const expenses = operatingExpenseRows().filter((item) => inPeriod(item.date) && expenseCountsInResult(item) && reportExpenseMatchesScope(item));
  const historicalMetrics = historicalClosuresInReportPeriod().map((closure) => closureScopeMetrics(closure, state.reportScope));
  const realIncome = sum(sales, (sale) => sale.total);
  const income = realIncome + sum(historicalMetrics, (entry) => entry.income);
  const shippingTotal = state.reportScope === "web"
    ? sum(sales.filter((sale) => sale.channel === "online"), (sale) => Number(sale.shippingAmount || 0)) + sum(historicalMetrics, (entry) => entry.shipping)
    : 0;
  const fixedExpenses = sum(expenses.filter((item) => item.kind === "fijo" || item.behavior === "fijo"), reportExpenseAmount) + sum(historicalMetrics, (entry) => entry.fixedExpenses);
  const variableExpenses = sum(expenses.filter((item) => item.kind !== "fijo" && item.behavior !== "fijo"), reportExpenseAmount) + sum(historicalMetrics, (entry) => entry.variableExpenses);
  const expenseTotal = fixedExpenses + variableExpenses;
  const merchandiseCost = sum(sales, (sale) => saleMerchandiseCost(sale)) + sum(historicalMetrics, (entry) => entry.merchandiseCost);
  const ticket = sales.length ? realIncome / sales.length : 0;
  const totalHistoricalMetrics = historicalClosuresInReportPeriod().map((closure) => closureScopeMetrics(closure, "total"));
  const localIncome = sum(periodSales.filter((sale) => sale.channel === "local"), (sale) => sale.total) + sum(totalHistoricalMetrics, (entry) => entry.localIncome);
  const webInsumos = sum(periodSales.filter((sale) => sale.channel === "online" && saleBucket(sale) === "insumos"), (sale) => sale.total) + sum(totalHistoricalMetrics, (entry) => entry.webInsumos);
  const webAccesorios = sum(periodSales.filter((sale) => sale.channel === "online" && saleBucket(sale) === "accesorios"), (sale) => sale.total) + sum(totalHistoricalMetrics, (entry) => entry.webAccesorios);
  const incomeSplit = state.reportScope === "total"
    ? { local: localIncome, insumos: webInsumos, accesorios: webAccesorios }
    : state.reportScope === "web"
      ? { insumos: webInsumos, accesorios: webAccesorios }
      : { local: income };
  document.getElementById("reportIncome").textContent = money(income);
  const shippingNode = document.getElementById("reportShipping");
  if (shippingNode) shippingNode.textContent = money(shippingTotal);
  document.getElementById("reportExpenses").textContent = money(expenseTotal);
  document.getElementById("reportPurchases").textContent = money(merchandiseCost);
  const marginNode = document.getElementById("reportMargin");
  const margin = income - expenseTotal - merchandiseCost;
  if (marginNode) {
    marginNode.textContent = signedMoney(margin);
    marginNode.classList.toggle("negative", margin < 0);
    marginNode.classList.toggle("positive", margin >= 0);
  }
  document.getElementById("reportTicket").textContent = money(ticket);
  renderWaterfall(income, fixedExpenses, variableExpenses, merchandiseCost, incomeSplit);
  renderMarginTrend();
  renderCategoryReports(sales);
  renderExpenseDetailReport(expenses);
}

function renderExpenseDetailReport(expenses) {
  renderAmountCountList("reportExpenseDetails", reportExpenseDetailData(expenses), REPORT_PREVIEW_LIMIT, "amount", {
    countSingular: "registro",
    countPlural: "registros",
  });
}

function reportExpenseOriginLabel(expense) {
  if (expense.source === "commission-tn") return "Comisión Tienda Nube";
  if (expense.source === "commission-platform") {
    const sale = state.sales.find((item) => item.id === expense.id);
    if (sale) return `Comisión ${onlinePaymentPlatformLabel(sale.paymentPlatform)}`;
    const label = String(expense.concept || "")
      .replace(/^Comisión\s+/i, "")
      .replace(/\s+(?:TN-)?\d+$/i, "")
      .trim();
    return `Comisión ${label || "Plataforma"}`;
  }
  return String(expense.concept || "Sin detalle").trim() || "Sin detalle";
}

function reportExpenseDetailData(expenses) {
  const groups = new Map();
  expenses.forEach((expense) => {
    const label = reportExpenseOriginLabel(expense);
    const key = normalizeTextKey(label) || label.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        label,
        count: 0,
        amount: 0,
      });
    }
    const group = groups.get(key);
    group.count += 1;
    group.amount += reportExpenseAmount(expense);
  });
  return [...groups.values()].reduce((acc, row) => {
    acc[row.label] = { amount: row.amount, count: row.count };
    return acc;
  }, {});
}

function currentReportExpenses() {
  return operatingExpenseRows().filter((item) => inPeriod(item.date) && expenseCountsInResult(item) && reportExpenseMatchesScope(item));
}

function currentReportHistoricalMetrics() {
  return historicalClosuresInReportPeriod().map((closure) => closureScopeMetrics(closure, state.reportScope));
}

function signedMoney(value) {
  if (value < 0) return `-${money(Math.abs(value))}`;
  return money(value);
}

function waterfallBar(start, end, cls, minPoint, range, split = null) {
  const segmentStart = Math.min(start, end);
  const amount = Math.abs(end - start);
  if (amount <= 0) return "";
  const left = ((segmentStart - minPoint) / range) * 100;
  const width = Math.max(2, (amount / range) * 100);
  const fillClass = cls === "margin" && end < 0 ? "margin negative" : cls;
  if (split?.kind === "expense" && cls === "expense") {
    const fixed = Number(split.fixed || 0);
    const variable = Number(split.variable || 0);
    const totalExpenses = Math.max(1, fixed + variable);
    return `
      <div class="waterfall-segment" style="left:${left}%;width:${width}%">
        <div class="bar-fill expense split-expense">
          ${fixed ? `<span class="split-segment split-expense-fixed" style="width:${fixed / totalExpenses * 100}%" title="Gastos Fijos: ${money(fixed)}"></span>` : ""}
          ${variable ? `<span class="split-segment split-expense-variable" style="width:${variable / totalExpenses * 100}%" title="Gastos Variables: ${money(variable)}"></span>` : ""}
        </div>
      </div>
    `;
  }
  if (!split || cls !== "income" || end <= 0) {
    return `<div class="waterfall-segment" style="left:${left}%;width:${width}%"><div class="bar-fill ${fillClass}"></div></div>`;
  }
  const local = Number(split.local || 0);
  const insumos = Number(split.insumos || 0);
  const accesorios = Number(split.accesorios || 0);
  const total = Math.max(1, local + insumos + accesorios);
  return `
    <div class="waterfall-segment" style="left:${left}%;width:${width}%">
      <div class="bar-fill income split-income">
        ${local ? `<span class="split-segment split-local" style="width:${local / total * 100}%" title="Local: ${money(local)}"></span>` : ""}
        ${insumos ? `<span class="split-segment split-insumos" style="width:${insumos / total * 100}%" title="Canal 1: ${money(insumos)}"></span>` : ""}
        ${accesorios ? `<span class="split-segment split-accesorios" style="width:${accesorios / total * 100}%" title="Canal 2: ${money(accesorios)}"></span>` : ""}
      </div>
    </div>
  `;
}

function renderWaterfall(income, fixedExpenses, variableExpenses, purchases, incomeSplit = null) {
  const multipleChannels = hasMultipleVisibleSalesChannels();
  const afterFixedExpenses = income - fixedExpenses;
  const afterExpenses = afterFixedExpenses - variableExpenses;
  const margin = afterExpenses - purchases;
  const minPoint = Math.min(0, afterFixedExpenses, afterExpenses, margin);
  const maxPoint = Math.max(1, income);
  const range = Math.max(1, maxPoint - minPoint);
  const totalExpenses = fixedExpenses + variableExpenses;
  const legendItems = multipleChannels && state.reportScope === "total"
    ? `<span><i class="dot dot-local"></i>Local</span><span><i class="dot dot-insumos"></i>Canal 1</span><span><i class="dot dot-accesorios"></i>Canal 2</span>`
    : multipleChannels && state.reportScope === "web"
      ? `<span><i class="dot dot-insumos"></i>Canal 1</span><span><i class="dot dot-accesorios"></i>Canal 2</span>`
      : "";
  const incomeLegendItem = `<span><i class="dot dot-income"></i>Ingresos</span>`;
  const costLegendItems = `<span><i class="dot dot-expense-fixed"></i>Gastos Fijos</span><span><i class="dot dot-expense-variable"></i>Gastos Variables</span>`;
  const legend = incomeLegendItem || legendItems || costLegendItems ? `
    <div class="chart-legend waterfall-legend">
      ${incomeLegendItem}${legendItems}${costLegendItems}
    </div>
  ` : "";
  const rows = [
    ["Ingresos", income, 0, income, "income"],
    ["Gastos Fijos", -fixedExpenses, income, afterFixedExpenses, "expense-fixed"],
    ["Gastos Variables", -variableExpenses, afterFixedExpenses, afterExpenses, "expense-variable"],
    ["Costo de Mercadería", purchases, "purchase"],
    ["Margen", margin, 0, margin, "margin"],
  ];
  rows[2] = ["Costo de Mercadería", -purchases, afterExpenses, margin, "purchase"];
  rows[2] = ["Gastos Variables", -variableExpenses, afterFixedExpenses, afterExpenses, "expense-variable"];
  rows[3] = ["Costo de Mercadería", -purchases, afterExpenses, margin, "purchase"];
  rows[3] = ["Costo de Mercader\u00eda", -purchases, afterExpenses, margin, "purchase"];
  rows.length = 0;
  rows.push(
    ["Ingresos", income, 0, income, "income"],
    ["Gastos", -totalExpenses, income, afterExpenses, "expense"],
    ["Costo de Mercader\u00eda", -purchases, afterExpenses, margin, "purchase"],
    ["Margen", margin, 0, margin, "margin"],
  );
  document.getElementById("marginChart").innerHTML = legend + rows.map(([label, value, start, end, cls]) => `
    <div class="waterfall-row">
      <span>${label}</span>
      <div class="bar-track">${waterfallBar(start, end, cls, minPoint, range, cls === "income" && multipleChannels ? incomeSplit : cls === "expense" ? { kind: "expense", fixed: fixedExpenses, variable: variableExpenses } : null)}</div>
      <strong>${signedMoney(value)}</strong>
    </div>
  `).join("");
}

function addMonthsToKey(key, amount) {
  const date = parseMonthKey(key);
  date.setMonth(date.getMonth() + amount);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthKeysBetween(fromKey, toKey) {
  const keys = [];
  let cursor = fromKey;
  while (cursor <= toKey) {
    keys.push(cursor);
    cursor = addMonthsToKey(cursor, 1);
  }
  return keys;
}

function trendMonthMetrics(key) {
  const sales = state.sales.filter((sale) => monthKeyFromDate(sale.date) === key && reportSaleMatchesScope(sale));
  const expenses = operatingExpenseRows().filter((expense) =>
    monthKeyFromDate(expense.date) === key
    && expenseCountsInResult(expense)
    && reportExpenseMatchesScope(expense)
  );
  const historical = historicalClosureForMonth(key);
  const historicalMetrics = historical ? closureScopeMetrics(historical, state.reportScope) : null;
  const income = sum(sales, (sale) => sale.total) + Number(historicalMetrics?.income || 0);
  const operatingExpenses = sum(expenses, reportExpenseAmount);
  const merchandiseCost = sum(sales, (sale) => saleMerchandiseCost(sale)) + Number(historicalMetrics?.merchandiseCost || 0);
  const historicalExpenses = Number(historicalMetrics?.expenseTotal || 0);
  const costs = operatingExpenses + historicalExpenses + merchandiseCost;
  const margin = income - costs;
  return {
    key,
    income,
    costs,
    margin,
    marginRate: income ? (margin / income) * 100 : 0,
  };
}

function sortTrendMetrics(metrics) {
  const order = state.marginTrendOrder || "chronological";
  if (order === "marginDesc") return [...metrics].sort((a, b) => b.margin - a.margin);
  if (order === "marginAsc") return [...metrics].sort((a, b) => a.margin - b.margin);
  return [...metrics].sort((a, b) => a.key.localeCompare(b.key));
}

function marginTrendMetrics() {
  if (state.reportPeriod === "year") {
    const endKey = currentMonthKey();
    const keys = monthKeysBetween(addMonthsToKey(endKey, -11), endKey);
    return sortTrendMetrics(keys.map(trendMonthMetrics));
  }
  if (state.reportPeriod === "all") {
    const keys = new Set();
    state.sales.forEach((sale) => {
      if (reportSaleMatchesScope(sale)) keys.add(monthKeyFromDate(sale.date));
    });
    operatingExpenseRows().forEach((expense) => {
      if (expenseCountsInResult(expense) && reportExpenseMatchesScope(expense)) keys.add(monthKeyFromDate(expense.date));
    });
    (state.monthlyClosures || []).forEach((closure) => {
      const metrics = closure.source === "historical-import" ? closureScopeMetrics(closure, state.reportScope) : null;
      if (closure.monthKey && metrics && (metrics.income || metrics.costs)) keys.add(closure.monthKey);
    });
    const metrics = sortTrendMetrics([...keys].filter(Boolean).map(trendMonthMetrics));
    if ((state.marginTrendOrder || "chronological") === "chronological") return metrics.slice(-36);
    return metrics.slice(0, 36);
  }
  return [];
}

function renderMarginTrend() {
  const panel = document.getElementById("marginTrendPanel");
  const chart = document.getElementById("marginTrendChart");
  const averages = document.getElementById("marginTrendAverages");
  if (!panel || !chart) return;
  const visible = ["year", "all"].includes(state.reportPeriod);
  panel.classList.toggle("is-hidden", !visible);
  if (!visible) {
    chart.innerHTML = "";
    if (averages) averages.innerHTML = "";
    return;
  }
  const metrics = marginTrendMetrics();
  const maxValue = Math.max(1, ...metrics.flatMap((entry) => [entry.income, entry.costs, Math.abs(entry.margin)]));
  if (!metrics.length) {
    chart.innerHTML = `<div class="empty-state">Sin Datos para este Período.</div>`;
    if (averages) averages.innerHTML = "";
    return;
  }
  const average = {
    income: sum(metrics, (entry) => entry.income) / metrics.length,
    costs: sum(metrics, (entry) => entry.costs) / metrics.length,
    margin: sum(metrics, (entry) => entry.margin) / metrics.length,
  };
  if (averages) {
    const negativeAverage = average.margin < 0;
    averages.innerHTML = `
      <span class="trend-average-pill sales"><i></i>Prom. ventas: ${trendMoney(average.income)}</span>
      <span class="trend-average-pill expenses"><i></i>Prom. gastos: ${trendMoney(average.costs)}</span>
      <span class="trend-average-pill margin ${negativeAverage ? "negative" : ""}"><i></i>Prom. margen: ${trendMoney(average.margin)}</span>
    `;
  }
  const labelSpace = 78;
  const barHeight = 142;
  const averageLine = (key, value) => {
    const bottom = labelSpace + (Math.abs(value) / maxValue) * barHeight;
    const negative = key === "margin" && value < 0;
    return `<div class="trend-average-line ${key} ${negative ? "negative" : ""}" style="bottom:${bottom}px"></div>`;
  };
  const averageLines = [
    averageLine("sales", average.income),
    averageLine("expenses", average.costs),
    averageLine("margin", average.margin),
  ].join("");
  chart.innerHTML = averageLines + metrics.map((entry) => {
    const salesHeight = Math.max(5, entry.income / maxValue * 100);
    const expensesHeight = Math.max(5, entry.costs / maxValue * 100);
    const marginHeight = Math.max(5, Math.abs(entry.margin) / maxValue * 100);
    const negative = entry.margin < 0;
    return `
      <div class="trend-month" title="${monthLabel(entry.key)} | Ventas: ${money(entry.income)} | Gastos: ${money(entry.costs)} | Margen: ${signedMoney(entry.margin)}">
        <div class="trend-bars">
          <span class="trend-bar sales" style="height:${salesHeight}%"></span>
          <span class="trend-bar expenses" style="height:${expensesHeight}%"></span>
          <span class="trend-bar margin ${negative ? "negative" : ""}" style="height:${marginHeight}%"></span>
        </div>
        <strong class="trend-value sales">V ${trendMoney(entry.income)}</strong>
        <strong class="trend-value expenses">G ${trendMoney(entry.costs)}</strong>
        <strong class="trend-value margin ${negative ? "negative" : ""}">M ${trendMoney(entry.margin)}</strong>
        <span class="trend-percent ${negative ? "negative" : ""}">${entry.marginRate.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%</span>
        <small>${shortMonthLabel(entry.key)}</small>
      </div>
    `;
  }).join("");
}

function reportDetailData(sales) {
  const categories = {};
  const products = {};
  const provinces = {};
  const payments = {};
  const subcategories = {};
  const subcategoryCategories = {};
  const productLabels = {};
  const productCategoriesByKey = {};
  const addSubcategory = (category, subcategory, quantity) => {
    if (!isReportableSaleCategory(category) || !subcategory) return;
    subcategories[subcategory] = (subcategories[subcategory] || 0) + quantity;
    if (!subcategoryCategories[subcategory]) subcategoryCategories[subcategory] = new Set();
    subcategoryCategories[subcategory].add(category);
  };
  const addProductCategoryMeta = (key, category) => {
    if (!key || !isReportableSaleCategory(category)) return;
    if (!productCategoriesByKey[key]) productCategoriesByKey[key] = new Set();
    productCategoriesByKey[key].add(category);
  };
  sales.forEach((sale) => {
    if (sale.items) {
      sale.items.forEach((item) => {
        const category = canonicalSaleItemCategory(item, sale);
        const subcategory = saleLineSubcategory(category, item.subcategory);
        if (isReportableSaleCategory(category)) categories[category] = (categories[category] || 0) + item.quantity;
        addSubcategory(category, subcategory, item.quantity);
        if (!item.manual) {
          const productMeta = saleProductReportMeta(item);
          products[productMeta.key] = (products[productMeta.key] || 0) + item.quantity;
          productLabels[productMeta.key] = productMeta.label;
          addProductCategoryMeta(productMeta.key, category);
        }
      });
    }
    if (sale.onlineLines) {
      sale.onlineLines.forEach((line) => {
        const category = canonicalProductCategory(line.category);
        const subcategory = saleLineSubcategory(category, line.subcategory);
        if (isReportableSaleCategory(category)) categories[category] = (categories[category] || 0) + line.quantity;
        addSubcategory(category, subcategory, line.quantity);
      });
    }
    if (sale.province) {
      if (!provinces[sale.province]) provinces[sale.province] = { amount: 0, count: 0 };
      provinces[sale.province].amount += Number(sale.total || 0);
      provinces[sale.province].count += 1;
    }
    const payment = paymentMethodName(sale.paymentMethod || (sale.channel === "local" ? "efectivo" : "web"));
    if (!payments[payment]) payments[payment] = { amount: 0, count: 0 };
    payments[payment].amount += Number(sale.total || 0);
    payments[payment].count += 1;
  });
  historicalDetailsInReportPeriod().forEach(({ detail }) => {
    if (state.reportScope !== "web") addToNumberMap(categories, detail.localCategories);
    if (state.reportScope !== "local") {
      addToNumberMap(categories, detail.webCategories);
      addToProvinceMap(provinces, detail.provinces);
    }
  });
  return {
    categories,
    products,
    productLabels,
    productCategories: Object.fromEntries(Object.entries(productCategoriesByKey).map(([key, categorySet]) => [key, [...categorySet].sort((a, b) => a.localeCompare(b, "es")).join(" / ")])),
    provinces,
    subcategories,
    subcategoryCategories: Object.fromEntries(Object.entries(subcategoryCategories).map(([subcategory, categorySet]) => [subcategory, [...categorySet].sort((a, b) => a.localeCompare(b, "es")).join(" / ")])),
    payments,
  };
}

function currentReportSales() {
  return state.sales.filter((item) => inPeriod(item.date)).filter(reportSaleMatchesScope);
}

function renderCategoryReports(sales) {
  const data = reportDetailData(sales);
  const comparisonMonths = reportComparisonMonthSpan();
  const averageOptions = comparisonMonths
    ? { comparisonMonths, averageLabel: reportComparisonLabel() }
    : {};
  const categoryAverages = comparisonMonths ? historicalAverageCategoryMap(state.reportScope) : {};
  const provinceAverages = comparisonMonths ? historicalAverageProvinceMap() : {};
  renderBarList("categoryChart", data.categories, "art.", REPORT_PREVIEW_LIMIT, { ...averageOptions, averages: categoryAverages });
  renderBarList("subcategoryChart", data.subcategories, "art.", REPORT_PREVIEW_LIMIT, { metaLabels: data.subcategoryCategories });
  renderAmountCountList("provinceChart", data.provinces, REPORT_PREVIEW_LIMIT, "count", { ...averageOptions, averages: provinceAverages });
  renderAmountCountList("paymentChart", data.payments, REPORT_PREVIEW_LIMIT);
}

function averageRowMeta(value, average, comparisonMonths, suffix, isMoney = false, label = "Prom. mensual") {
  if (!average || !comparisonMonths) return "";
  const expected = average * Math.max(1, comparisonMonths || 1);
  const diff = value - expected;
  const sign = diff >= 0 ? "+" : "-";
  const displayAverage = comparisonMonths > 1 ? expected : average;
  const formattedAverage = isMoney ? money(displayAverage) : Math.round(displayAverage).toLocaleString("es-AR");
  const formattedDiff = isMoney ? money(Math.abs(diff)) : Math.round(Math.abs(diff)).toLocaleString("es-AR");
  const unit = isMoney ? "" : ` ${suffix}`;
  return `<small class="${diff >= 0 ? "avg-positive" : "avg-negative"}">${label} ${formattedAverage}${unit} · ${sign}${formattedDiff}${unit}</small>`;
}

function renderBarList(id, data, suffix, limit = REPORT_PREVIEW_LIMIT, options = {}) {
  const container = document.getElementById(id);
  if (!container) return;
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const entries = Number.isFinite(limit) ? sorted.slice(0, limit) : sorted;
  const comparisonMonths = Math.max(1, Number(options.comparisonMonths || 1));
  const max = Math.max(1, ...entries.flatMap(([label, value]) => [value, Number(options.averages?.[label] || 0) * comparisonMonths]));
  container.innerHTML = entries.map(([label, value]) => {
    const displayLabel = options.displayLabels?.[label] || label;
    return `
    <div class="bar-row">
      <span class="bar-label">${htmlAttr(displayLabel)}${options.metaLabels?.[label] ? `<small>${htmlAttr(options.metaLabels[label])}</small>` : ""}</span>
      <div class="bar-track">
        <div class="bar-fill" style="width:${Math.max(3, value / max * 100)}%"></div>
      </div>
      <strong>${suffix === "$" ? money(value) : `${value} ${suffix}`}${averageRowMeta(value, options.averages?.[label], comparisonMonths, suffix, suffix === "$", options.averageLabel)}</strong>
    </div>
  `;
  }).join("") || `<div class="empty-state">Sin Datos para este Período.</div>`;
}

function renderAmountCountList(id, data, limit = REPORT_PREVIEW_LIMIT, sortBy = "amount", options = {}) {
  const container = document.getElementById(id);
  if (!container) return;
  const sorted = Object.entries(data).sort((a, b) => {
    if (sortBy === "count") return b[1].count - a[1].count || b[1].amount - a[1].amount;
    return b[1].amount - a[1].amount || b[1].count - a[1].count;
  });
  const entries = Number.isFinite(limit) ? sorted.slice(0, limit) : sorted;
  const comparisonMonths = Math.max(1, Number(options.comparisonMonths || 1));
  const max = Math.max(1, ...entries.flatMap(([label, value]) => [
    sortBy === "count" ? value.count : value.amount,
    Number(options.averages?.[label] || 0) * comparisonMonths,
  ]));
  container.innerHTML = entries.map(([label, value]) => {
    const metric = sortBy === "count" ? value.count : value.amount;
    const countSingular = options.countSingular || "venta";
    const countPlural = options.countPlural || "ventas";
    const primary = sortBy === "count" ? `${value.count} ${value.count === 1 ? countSingular : countPlural}` : money(value.amount);
    const average = options.averages?.[label];
    const averageMeta = averageRowMeta(metric, average, comparisonMonths, sortBy === "count" ? "ventas" : "$", sortBy !== "count", options.averageLabel);
    const secondary = averageMeta || (sortBy === "count" && value.amount ? `<small>${money(value.amount)}</small>` : sortBy !== "count" ? `<small>${value.count} ${value.count === 1 ? countSingular : countPlural}</small>` : "");
    return `
      <div class="bar-row">
        <span>${label}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width:${Math.max(3, metric / max * 100)}%"></div>
        </div>
        <strong>${primary}${secondary}</strong>
      </div>
    `;
  }).join("") || `<div class="empty-state">Sin Datos para este Período.</div>`;
}

function reportExpansionConfig(kind) {
  return {
    categories: { title: "Categorías Más Vendidas", suffix: "art.", type: "bar", limit: Infinity },
    provinces: { title: "Destinos Online", type: "amount", limit: Infinity, sortBy: "count" },
    subcategories: { title: "Subcategorías Más Vendidas", suffix: "art.", type: "bar", limit: Infinity },
    payments: { title: "Medios de Pago", type: "amount", limit: Infinity },
    expenses: { title: "Gastos por Origen", type: "amount", limit: Infinity, countSingular: "registro", countPlural: "registros" },
  }[kind] || null;
}

function openReportExpandModal(kind) {
  const config = reportExpansionConfig(kind);
  if (!config) return;
  const data = reportDetailData(currentReportSales());
  const source = kind === "expenses"
    ? reportExpenseDetailData(currentReportExpenses(), currentReportHistoricalMetrics())
    : data[kind] || {};
  const modal = document.getElementById("reportExpandModal");
  const title = document.getElementById("reportExpandTitle");
  const meta = document.getElementById("reportExpandMeta");
  const chart = document.getElementById("reportExpandChart");
  if (!modal || !title || !chart) return;
  title.textContent = config.title;
  chart.className = `bar-list report-expand-list report-chart-${kind}`;
  const totalRows = Object.keys(source).length;
  const shownRows = Number.isFinite(config.limit) ? Math.min(totalRows, config.limit) : totalRows;
  const comparisonMonths = reportComparisonMonthSpan();
  const averages = comparisonMonths && kind === "categories" ? historicalAverageCategoryMap(state.reportScope) : comparisonMonths && kind === "provinces" ? historicalAverageProvinceMap() : {};
  const averageOptions = comparisonMonths ? { averages, comparisonMonths, averageLabel: reportComparisonLabel() } : {};
  if (kind === "products") {
    averageOptions.displayLabels = data.productLabels || {};
    averageOptions.metaLabels = data.productCategories || {};
  }
  if (kind === "subcategories") averageOptions.metaLabels = data.subcategoryCategories || {};
  if (meta) {
    const limitText = config.meta || (shownRows < totalRows ? `${shownRows} de ${totalRows}` : `${totalRows} registros`);
    meta.textContent = limitText;
    meta.classList.toggle("is-hidden", !totalRows);
  }
  if (config.type === "amount") {
    renderAmountCountList("reportExpandChart", source, config.limit, config.sortBy || "amount", { ...averageOptions, countSingular: config.countSingular, countPlural: config.countPlural });
  } else {
    renderBarList("reportExpandChart", source, config.suffix, config.limit, averageOptions);
  }
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeReportExpandModal() {
  const modal = document.getElementById("reportExpandModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function groupSum(list, keyFn, valueFn) {
  return list.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] || 0) + Number(valueFn(item) || 0);
    return acc;
  }, {});
}

document.addEventListener("click", (event) => {
  const removeProductImageButton = event.target.closest("[data-remove-product-image]");
  if (removeProductImageButton) {
    productImageDraft.splice(Number(removeProductImageButton.dataset.removeProductImage), 1);
    renderProductImagePreview();
    return;
  }

  if (event.target.id === "createProductVariant") {
    addProductVariant();
    return;
  }

  const removeProductVariantButton = event.target.closest("[data-remove-product-variant]");
  if (removeProductVariantButton) {
    removeProductVariant(removeProductVariantButton.dataset.removeProductVariant);
    return;
  }

  const datePicker = event.target.closest(".date-picker-field");
  if (datePicker) {
    openNativeDatePicker(datePicker.querySelector('input[type="date"]'));
  }

  const nav = event.target.closest(".nav-item");
  if (nav) setView(nav.dataset.view);

  if (event.target.dataset.pageKind) {
    const delta = Number(event.target.dataset.pageDelta || 0);
    if (event.target.dataset.pageKind === "salesHistory") {
      state.salesHistoryPage = Number(state.salesHistoryPage || 1) + delta;
      saveUiState();
      renderSalesHistory();
    }
    if (event.target.dataset.pageKind === "online") {
      state.onlinePage = Number(state.onlinePage || 1) + delta;
      saveUiState();
      renderOnline();
    }
    if (event.target.dataset.pageKind === "expenses") {
      state.expensesPage = Number(state.expensesPage || 1) + delta;
      saveUiState();
      renderExpenses();
    }
    if (event.target.dataset.pageKind === "products") {
      state.productPage = Number(state.productPage || 1) + delta;
      saveUiState();
      renderCatalog();
    }
    if (event.target.dataset.pageKind === "customers") {
      state.customerPage = Number(state.customerPage || 1) + delta;
      saveUiState();
      renderCustomers();
    }
    if (event.target.dataset.pageKind === "stockHistory") {
      state.stockHistoryPage = Number(state.stockHistoryPage || 1) + delta;
      renderStockHistoryTable();
    }
    if (event.target.dataset.pageKind === "customerInfo") {
      state.customerInfoPage = Number(state.customerInfoPage || 1) + delta;
      renderCustomerInfoSales();
    }
    if (event.target.dataset.pageKind === "monthlyClosures") {
      state.monthlyClosuresPage = Number(state.monthlyClosuresPage || 1) + delta;
      saveUiState();
      renderMonthlyClosures();
    }
    if (event.target.dataset.pageKind === "activityLog") {
      state.activityLogPage = Number(state.activityLogPage || 1) + delta;
      renderActivityLogTable();
    }
    return;
  }

  const expenseLockButton = event.target.closest("[data-toggle-expense-lock]");
  if (expenseLockButton) {
    const key = expenseLockButton.dataset.toggleExpenseLock;
    if (unlockedExpenseAmounts.has(key)) {
      unlockedExpenseAmounts.delete(key);
    } else {
      unlockedExpenseAmounts.add(key);
    }
    renderExpenses();
    return;
  }

  if (event.target.id === "newCartButton") addCart();
  if (event.target.id === "addProductButton") openProductModal();
  if (event.target.id === "openPublicCatalogButton" || event.target.id === "openPublicCatalogSettingsButton") openPublicCatalog();
  if (event.target.dataset.openCatalogProduct) openCatalogProduct(event.target.dataset.openCatalogProduct);
  if (event.target.dataset.editProduct) openProductModal(event.target.dataset.editProduct);
  if (event.target.dataset.deleteProduct) {
    const product = state.products.find((item) => item.id === event.target.dataset.deleteProduct);
    if (product) {
      openConfirmModal({
        title: "Eliminar producto",
        message: `Se eliminara el producto ${product.code} - ${product.description}.`,
        confirmText: "Eliminar",
        danger: true,
        onConfirm: async () => {
          if (CLOUD_DATA_ENABLED && isUuid(product.id)) {
            try {
              if (!cloudEnabledWithSession()) {
                showAuthError("Ingresá con tu usuario BlackShoes para archivar productos en Supabase.");
                renderAuthState("Ingresá para guardar en Supabase.");
                return;
              }
              await archiveCloudRecord("product", product.id);
              logActivity("product", "Archivo producto", `${product.code} - ${product.description}`);
              await loadCloudData();
              saveState();
              render();
              showActionToast("Producto archivado en Supabase.");
              return;
            } catch (error) {
              console.warn("Cloud product archive failed", error);
              alert(`No pude archivar el producto en Supabase: ${error.message || "error desconocido"}`);
              return;
            }
          }
          rememberDeletedRecord("products", product.id);
          state.products = state.products.filter((item) => item.id !== product.id);
          logActivity("product", "Elimino producto", `${product.code} - ${product.description}`);
          saveState();
          render();
        },
      });
    }
  }
  if (event.target.id === "closeProductModal" || event.target.id === "cancelProductModal") closeProductModal();
  if (event.target.id === "productModal") closeProductModal();
  if (event.target.id === "cancelConfirmModal") runCancelAction();
  if (event.target.id === "closeConfirmModal" || event.target.id === "confirmModal") closeConfirmModal();
  if (event.target.id === "confirmActionButton") runConfirmAction();
  if (event.target.id === "closeStockCostUpdateModal" || event.target.id === "stockCostUpdateModal") closeStockCostUpdateModal();
  if (event.target.id === "stockCostKeepCost") saveProductKeepingOldCost();
  if (event.target.id === "stockCostAcceptCost") saveProductUpdatingCost();
  if (event.target.id === "openPriceUpdateButton") openPriceUpdateModal();
  if (event.target.id === "closePriceUpdateModal" || event.target.id === "cancelPriceUpdateModal") closePriceUpdateModal();
  if (event.target.id === "priceUpdateModal") closePriceUpdateModal();
  if (event.target.id === "openStockEntryButton") openStockEntryModal();
  if (event.target.id === "closeStockEntryModal" || event.target.id === "cancelStockEntryModal") closeStockEntryModal();
  if (event.target.id === "stockEntryModal") closeStockEntryModal();
  if (event.target.id === "confirmStockEntryBatch") confirmStockEntryBatch();
  if (event.target.id === "applyProductStockReduce") applyEditedProductStockReduce();
  if (event.target.dataset.removeStockEntry) {
    stockEntryDraft.splice(Number(event.target.dataset.removeStockEntry), 1);
    renderStockEntryDraft();
  }
  if (event.target.id === "openStockHistoryButton") openStockHistoryModal();
  if (event.target.id === "closeStockHistoryModal" || event.target.id === "stockHistoryModal") closeStockHistoryModal();
  if (event.target.id === "addManualItem") openManualItemModal();
  if (event.target.id === "closeManualItemModal" || event.target.id === "cancelManualItemModal") closeManualItemModal();
  if (event.target.id === "manualItemModal") closeManualItemModal();
  if (event.target.id === "closeCustomerPickerModal" || event.target.id === "cancelCustomerPickerModal") closeCustomerPickerModal();
  if (event.target.id === "customerPickerModal") closeCustomerPickerModal();
  if (event.target.id === "closeCustomerRegisterModal" || event.target.id === "customerRegisterModal") closeCustomerRegisterModal();
  if (event.target.id === "cancelCustomerRegisterModal") closeCustomerRegisterModal({ runSkip: true });
  if (event.target.id === "closeCustomerEditModal" || event.target.id === "cancelCustomerEditModal" || event.target.id === "customerEditModal") closeCustomerEditModal();
  if (event.target.id === "closeCustomerInfoModal" || event.target.id === "closeCustomerInfoButton") closeCustomerInfoModal();
  if (event.target.id === "customerInfoModal") closeCustomerInfoModal();
  if (event.target.dataset.expandReport) openReportExpandModal(event.target.dataset.expandReport);
  if (event.target.id === "closeReportExpandModal" || event.target.id === "closeReportExpandButton" || event.target.id === "reportExpandModal") closeReportExpandModal();
  if (event.target.id === "openAfipPendingButton") openAfipPendingModal();
  if (event.target.id === "closeAfipPendingModal" || event.target.id === "cancelAfipPendingModal" || event.target.id === "afipPendingModal") closeAfipPendingModal();
  if (event.target.id === "confirmAfipPendingButton") confirmAfipPendingOrders();
  if (event.target.id === "openOnlineMissingButton") openOnlineMissingModal();
  if (event.target.id === "closeOnlineMissingModal" || event.target.id === "cancelOnlineMissingModal" || event.target.id === "onlineMissingModal") closeOnlineMissingModal();
  if (event.target.id === "confirmOnlineMissingButton") confirmOnlineMissingResolved();
  if (event.target.id === "openFixedExpensesButton") openFixedExpensesModal();
  if (event.target.id === "closeFixedExpensesModal" || event.target.id === "cancelFixedExpensesModal" || event.target.id === "fixedExpensesModal") closeFixedExpensesModal();
  if (event.target.id === "confirmFixedExpensesButton") confirmFixedExpenses();
  if (event.target.id === "closeSelectedMonthButton") closeSelectedMonth();
  if (event.target.dataset.deleteMonthlyClosure) deleteMonthlyClosure(event.target.dataset.deleteMonthlyClosure);
  if (event.target.id === "exportExcelBackupButton") exportExcelBackup();
  if (event.target.id === "importBackupButton") document.getElementById("importBackupInput")?.click();
  if (event.target.id === "openSettingsButton" || event.target.closest("#openSettingsButton")) openSettingsPasswordModal();
  if (event.target.id === "closeSettingsPasswordModal" || event.target.id === "cancelSettingsPasswordModal" || event.target.id === "settingsPasswordModal") closeSettingsPasswordModal();
  if (event.target.id === "openActivityLogButton") openActivityLogModal();
  if (event.target.id === "closeActivityLogModal" || event.target.id === "closeActivityLogButton" || event.target.id === "activityLogModal") closeActivityLogModal();
  if (event.target.id === "openRemoteBackupsButton") openRemoteBackupsModal();
  if (event.target.id === "publishLocalPrimaryButton") confirmPublishLocalStateAsPrimary();
  if (event.target.id === "closeRemoteBackupsModal" || event.target.id === "closeRemoteBackupsButton" || event.target.id === "remoteBackupsModal") closeRemoteBackupsModal();
  if (event.target.id === "addFixedExpenseTemplateButton") addFixedExpenseTemplate();
  if (event.target.id === "saveFixedExpenseTemplatesButton") saveFixedExpenseTemplatesFromSettings();
  if (event.target.id === "addProductCategorySettingButton") addProductCategorySetting();
  if (event.target.id === "saveProductCategorySettingsButton") saveProductCategorySettingsFromSettings();
  if (event.target.id === "refreshUsersButton") refreshSupabaseProfiles();
  if (event.target.id === "saveUserPermissionsButton") saveUserPermissionsFromSettings();
  if (event.target.id === "closeSaleEditModal" || event.target.id === "cancelSaleEditModal" || event.target.id === "saleEditModal") closeSaleEditModal();
  if (event.target.id === "closeSaleInfoModal" || event.target.id === "closeSaleInfoButton" || event.target.id === "saleInfoModal") closeSaleInfoModal();
  if (event.target.dataset.deleteFixedTemplate) deleteFixedExpenseTemplate(event.target.dataset.deleteFixedTemplate);
  if (event.target.dataset.deleteProductCategory) deleteProductCategorySetting(event.target.dataset.deleteProductCategory);
  if (event.target.dataset.restoreRemoteBackup) {
    const backupKey = event.target.dataset.restoreRemoteBackup;
    openConfirmModal({
      title: "Restaurar respaldo",
      message: "Esto reemplaza los datos actuales por el respaldo elegido. Antes de restaurar se guarda una copia del estado actual.",
      confirmText: "Restaurar",
      danger: true,
      onConfirm: () => restoreRemoteBackup(backupKey),
    });
  }
  const pickedCustomerButton = event.target.closest("[data-pick-customer]");
  if (pickedCustomerButton) selectCustomerForTarget(pickedCustomerButton.dataset.pickCustomer);
  if (event.target.dataset.infoCustomer) openCustomerInfoModal(event.target.dataset.infoCustomer);
  if (event.target.id === "closeWorkshopPriceModal" || event.target.id === "cancelWorkshopPriceModal") closeWorkshopPriceModal();
  if (event.target.id === "workshopPriceModal") closeWorkshopPriceModal();
  if (event.target.id === "closeWorkshopDeliveryModal" || event.target.id === "cancelWorkshopDeliveryModal") closeWorkshopDeliveryModal();
  if (event.target.id === "workshopDeliveryModal") closeWorkshopDeliveryModal();
  if (event.target.dataset.saleInfo) openSaleInfoModal(event.target.dataset.saleInfo);
  if (event.target.dataset.saleReceipt) downloadSaleReceipt(event.target.dataset.saleReceipt);
  if (event.target.dataset.saleEdit) openSaleEditModal(event.target.dataset.saleEdit);
  if (event.target.dataset.onlineEdit) openOnlineOrderEditModal(event.target.dataset.onlineEdit);
  if (event.target.dataset.saleDelete) deleteSale(event.target.dataset.saleDelete);
  const posProductButton = event.target.closest("[data-select-pos-product]");
  if (posProductButton) selectPosProductCode(posProductButton.dataset.selectPosProduct);
  const inlineCustomerButton = event.target.closest("[data-inline-customer]");
  const inlineProvinceButton = event.target.closest("[data-inline-province]");
  if (inlineCustomerButton) selectInlineCustomer(inlineCustomerButton.dataset.inlineCustomer, inlineCustomerButton.dataset.inlineTarget);
  if (inlineProvinceButton) selectInlineProvince(inlineProvinceButton.dataset.inlineProvince, inlineProvinceButton.dataset.inlineTarget);
  if (!event.target.closest(".customer-sale-field") && !event.target.closest(".online-customer-field") && !event.target.closest(".province-suggest-field")) closeCustomerInlineSuggestions();
  if (!event.target.closest(".product-code-field")) closePosProductCodeSuggestions();
  if (event.target.id === "addProductCart") {
    const cart = activeCart();
    const product = productByCodeQuery(document.getElementById("productSearch").value);
    const quantity = Number(document.getElementById("productQty").value || 1);
    const size = document.getElementById("productSize")?.value || "";
    if (cart && product) addProductToCart(cart.id, product.id, quantity, size);
  }
  if (event.target.id === "finalizeCart") {
    const cart = activeCart();
    if (cart) startLocalSaleConfirmation(cart.id);
  }
  if (event.target.id === "cancelCart") cancelCart(activeCart().id);
  if (event.target.dataset.cartId) {
    state.activeCartId = event.target.dataset.cartId;
    saveUiState();
    render();
  }
  if (event.target.dataset.qty) updateCartItem(activeCart().id, Number(event.target.dataset.qty), Number(event.target.dataset.delta));
  if (event.target.dataset.removeItem) removeCartItem(activeCart().id, Number(event.target.dataset.removeItem));
  if (event.target.dataset.editWorkshopPrice) editWorkshopPrice(event.target.dataset.editWorkshopPrice);
  if (event.target.dataset.completeWorkshop) openWorkshopDeliveryModal(event.target.dataset.completeWorkshop);
  if (event.target.dataset.deleteWorkshop) deleteWorkshopOrder(event.target.dataset.deleteWorkshop);
  if (event.target.id === "addOnlineLine") {
    const quantity = Number(document.getElementById("onlineLineQty").value || 0);
    const category = canonicalProductCategory(document.getElementById("onlineLineCategory").value);
    const subcategorySelect = document.getElementById("onlineLineSubcategory");
    const subcategory = saleLineSubcategory(category, subcategorySelect?.disabled ? "" : subcategorySelect?.value);
    if (!quantity || !category) return;
    state.onlineDraftLines.push({ quantity, category, subcategory });
    document.getElementById("onlineLineQty").value = "";
    document.getElementById("onlineLineCategory").value = "";
    if (subcategorySelect) subcategorySelect.value = "";
    saveUiState();
    renderOnline();
  }
  if (event.target.dataset.selectOnlineCategory) {
    const input = document.getElementById("onlineLineCategory");
    if (input) input.value = event.target.dataset.selectOnlineCategory;
    renderOnlineCategorySuggestions();
    renderOnlineLineSubcategoryOptions();
    document.getElementById("onlineCategorySuggestions")?.classList.remove("open");
    document.getElementById("onlineLineQty")?.focus();
  }
  if (event.target.dataset.removeOnlineLine) {
    state.onlineDraftLines.splice(Number(event.target.dataset.removeOnlineLine), 1);
    saveUiState();
    renderOnline();
  }
  if (event.target.dataset.onlineDelete) deleteOnlineOrder(event.target.dataset.onlineDelete);
  if (event.target.dataset.deleteExpense) deleteExpenseMovement(event.target.dataset.deleteExpense);
  if (event.target.dataset.editCustomer) editCustomer(event.target.dataset.editCustomer);
  if (event.target.dataset.deleteCustomer) deleteCustomer(event.target.dataset.deleteCustomer);
  if (event.target.dataset.deleteCashClose) deleteCashClosure(event.target.dataset.deleteCashClose);
  if (event.target.id === "cancelCustomerEdit") clearCustomerForm();
  if (event.target.id === "clearExpenseFilters") {
    state.expenseFilters = defaultExpenseFilters();
    state.expensesPage = 1;
    saveUiState();
    renderExpenses();
  }
  if (event.target.id === "syncButton") {
    syncWithSupabase({ preferRemote: false });
    render();
  }
  if (event.target.id === "logoutButton" || event.target.id === "mobileLogoutButton") {
    signOut();
  }
  if (event.target.id === "authSignupButton") {
    handleAuthSubmit(event, "signup");
  }
  if (event.target.dataset.reportScope) {
    if (!hasMultipleVisibleSalesChannels()) return;
    state.reportScope = event.target.dataset.reportScope;
    saveUiState();
    renderReports();
  }
  if (event.target.dataset.period) {
    state.reportPeriod = event.target.dataset.period;
    if (state.reportPeriod === "custom") {
      state.reportCustomFrom = normalizeDateInput(state.reportCustomFrom) || monthAgoIso();
      state.reportCustomTo = normalizeDateInput(state.reportCustomTo) || todayIso();
    }
    saveUiState();
    renderReports();
  }
  if (!event.target.closest(".category-suggest-field")) {
    const panel = document.getElementById("onlineCategorySuggestions");
    if (panel) panel.classList.remove("open");
  }
});

function defaultExpenseFilters() {
  return {
    query: "",
    year: String(new Date().getFullYear()),
    month: String(new Date().getMonth() + 1).padStart(2, "0"),
    category: "all",
    type: "expense",
    behavior: "all",
    area: "all",
    commissions: "hide",
    cleanDefaultApplied: true,
  };
}

document.addEventListener("input", (event) => {
  if (event.target.matches(".money-field input")) {
    prepareMoneyInput(event.target);
  }
  if (event.target.id === "stockCostMargin") {
    syncStockCostPriceFields("margin");
    return;
  }
  if (event.target.id === "stockCostRecalculatedPrice") {
    syncStockCostPriceFields("price");
    return;
  }
  if (event.target.id === "productCost" || event.target.id === "productMargin") updateProductPrice();
  if (event.target.id === "productPrice") updateProductMarginFromPrice();
  if (event.target.id === "productCode") updateProductBarcode();
  if (event.target.matches("[data-variant-size], [data-variant-stock]")) {
    syncProductVariantInputFromRows();
    return;
  }
  if (event.target.id === "saleEditGross" || event.target.id === "saleEditDiscount") updateSaleEditOnlineTotal();
  if (event.target.id === "productSearch") {
    renderPosProductCodeSuggestions();
    if (productByCodeQuery(event.target.value)) closePosProductCodeSuggestions();
    updateLocalAccessorySubcategorySelect({ focusIfAvailable: true });
    updatePosSizeSelect({ focusIfAvailable: true });
    return;
  }
  if (event.target.id === "onlineSearchFilter" || event.target.id === "onlineOrderFilter") {
    const filters = state.onlineFilters;
    if (event.target.id === "onlineSearchFilter") filters.query = event.target.value;
    if (event.target.id === "onlineOrderFilter") filters.order = event.target.value;
    state.onlinePage = 1;
    saveUiState();
    renderOnline();
    return;
  }
  if (event.target.dataset.onlineLineQty) {
    updateOnlineDraftLineQuantity(Number(event.target.dataset.onlineLineQty), event.target.value);
    return;
  }
  if (event.target.id === "productSearchFilter") {
    state.productFilters.query = event.target.value;
    state.productPage = 1;
    saveUiState();
    renderCatalog();
    return;
  }
  if (event.target.id === "onlineLineCategory") {
    renderOnlineCategorySuggestions();
    renderOnlineLineSubcategoryOptions();
    return;
  }
  if (event.target.id === "salesHistoryOrderFilter" || event.target.id === "salesHistoryFrom" || event.target.id === "salesHistoryTo") {
    const filters = state.salesHistoryFilters;
    if (event.target.id === "salesHistoryOrderFilter") filters.order = event.target.value;
    if (event.target.id === "salesHistoryFrom") filters.from = event.target.value;
    if (event.target.id === "salesHistoryTo") filters.to = event.target.value;
    state.salesHistoryPage = 1;
    saveUiState();
    renderSalesHistory();
    return;
  }
  if (event.target.id === "workshopSearch") {
    renderWorkshop();
    return;
  }
  if (event.target.id === "customerSearch") {
    state.customerFilters.query = event.target.value;
    state.customerPage = 1;
    saveUiState();
    renderCustomers();
    return;
  }
  if (event.target.id === "customerPickerSearch") {
    renderCustomerPickerList();
    return;
  }
  if (event.target.matches("[data-dni-field]") && event.target.id !== "onlineCustomerDni") {
    formatDniInput(event.target);
    return;
  }
  if (event.target.id === "onlineCustomerDni") {
    const form = event.target.closest("form");
    if (form) delete form.dataset.customerReviewedName;
    const dni = normalizeCustomerDni(event.target.value);
    event.target.value = formatCustomerDni(dni);
    if (!dni) {
      const customerIdInput = document.getElementById("onlineCustomerId");
      if (customerIdInput) customerIdInput.value = "";
      closeCustomerInlineSuggestions();
      updateOnlineCostPreview();
      return;
    }
    const exactCustomer = assignCustomerDniToOnlineForm(form, dni);
    if (exactCustomer) {
      closeCustomerInlineSuggestions();
      updateOnlineCostPreview();
      return;
    }
    const linked = state.customers.find((customer) => customer.id === document.getElementById("onlineCustomerId")?.value);
    if (linked && normalizeCustomerDni(linked.dni) !== dni) {
      document.getElementById("onlineCustomerId").value = "";
    }
    renderCustomerInlineSuggestions("onlineCustomerDni", "onlineCustomerDniSuggestions");
    updateOnlineCostPreview();
    return;
  }
  if (event.target.id === "onlineClientLookup") {
    const form = event.target.closest("form");
    if (form) delete form.dataset.customerReviewedName;
    if (!String(event.target.value || "").trim()) {
      const customerIdInput = document.getElementById("onlineCustomerId");
      const provinceInput = document.getElementById("onlineProvince");
      if (customerIdInput) customerIdInput.value = "";
      if (provinceInput) provinceInput.value = "";
      closeCustomerInlineSuggestions();
      updateOnlineCostPreview();
      return;
    }
    const exactCustomer = assignExactCustomerToOnlineForm(form, event.target.value, {
      dni: document.getElementById("onlineCustomerDni")?.value,
      province: document.getElementById("onlineProvince")?.value,
    });
    if (exactCustomer) {
      closeCustomerInlineSuggestions();
      return;
    }
    const linked = state.customers.find((customer) => customer.id === document.getElementById("onlineCustomerId")?.value);
    if (linked && normalizeTextKey(event.target.value) !== normalizeTextKey(linked.name)) {
      document.getElementById("onlineCustomerId").value = "";
    }
    renderCustomerInlineSuggestions("onlineClientLookup", "onlineCustomerSuggestions");
    return;
  }
  if (event.target.id === "workshopClientLookup") {
    renderCustomerInlineSuggestions("workshopClientLookup", "workshopCustomerSuggestions");
    return;
  }
  if (event.target.id === "onlineProvince") {
    renderProvinceInlineSuggestions("onlineProvince", "onlineProvinceSuggestions");
    return;
  }
  if (["expenseSearchFilter"].includes(event.target.id)) {
    state.expenseFilters.query = event.target.value;
    state.expensesPage = 1;
    saveUiState();
    renderExpenses();
    return;
  }
  if (event.target.id === "activitySearchFilter") {
    state.activityLogFilters.query = event.target.value;
    state.activityLogPage = 1;
    renderActivityLogTable();
    return;
  }
  if (event.target.id === "stockEntryProductSearch") {
    renderStockEntryProductOptions(event.target.value);
    const product = findStockEntryProduct(event.target.value);
    document.getElementById("stockEntryProduct").value = product?.id || "";
    if (exactStockEntryProduct(event.target.value)) document.getElementById("stockEntryProductOptions")?.replaceChildren();
    updateStockEntryCurrentPrice(product);
    return;
  }
  if (event.target.id === "stockEntryUnitCost") {
    updateStockEntryCurrentPrice();
    return;
  }
  if (event.target.id === "stockHistoryProductSearch") {
    renderStockHistoryProductOptions(event.target.value);
    const product = findStockHistoryProduct(event.target.value);
    document.getElementById("stockHistoryProduct").value = product?.id || "all";
    if (product) document.getElementById("stockHistoryProductOptions")?.replaceChildren();
    state.stockHistoryPage = 1;
    renderStockHistoryTable();
    return;
  }
  if (event.target.closest("#priceUpdateForm")) updatePriceUpdatePreview();
  if (event.target.closest("#stockHistoryModal")) {
    state.stockHistoryPage = 1;
    renderStockHistoryTable();
  }
  if (event.target.id === "onlinePayment") syncOnlinePaymentPlatform();
  if (event.target.id === "saleEditPayment") {
    const sale = state.sales.find((item) => item.id === document.getElementById("saleEditId")?.value);
    if (sale?.channel === "online") {
      const platform = document.getElementById("saleEditPlatform");
      if (platform && String(event.target.value).toLowerCase() === "transferencia") platform.value = "transfer";
    }
  }
  if (event.target.closest("#onlineForm")) updateOnlineCostPreview();
  const cart = activeCart();
  if (!cart) return;
  if (event.target.id === "cartReference") {
    cart.reference = event.target.value;
    const exactCustomer = assignExactCustomerToCart(cart, event.target.value);
    if (exactCustomer) {
      saveUiState();
      closeCustomerInlineSuggestions();
      return;
    }
    if (cart.customerId && normalizeTextKey(event.target.value) !== normalizeTextKey(state.customers.find((customer) => customer.id === cart.customerId)?.name)) {
      cart.customerId = "";
    }
    renderCustomerInlineSuggestions("cartReference", "cartCustomerSuggestions");
    saveUiState();
  }
  if (event.target.id === "cartPaidAmount") {
    cart.paidAmount = String(event.target.value || "").trim() ? parseMoneyInput(event.target.value) : "";
    saveUiState();
    updateCartPaymentPreview(cart);
  }
  if (event.target.id === "cartManualTotal") {
    cart.manualTotal = String(event.target.value || "").trim() ? parseMoneyInput(event.target.value) : "";
    saveUiState();
    updateCartPaymentPreview(cart);
  }
});

document.addEventListener("focusin", (event) => {
  unlockBrowserAutofillField(event.target);
  if (event.target.id === "onlineClientLookup") {
    renderCustomerInlineSuggestions("onlineClientLookup", "onlineCustomerSuggestions");
  }
  if (event.target.id === "onlineCustomerDni") {
    renderCustomerInlineSuggestions("onlineCustomerDni", "onlineCustomerDniSuggestions");
  }
  if (event.target.id === "workshopClientLookup") {
    renderCustomerInlineSuggestions("workshopClientLookup", "workshopCustomerSuggestions");
  }
  if (event.target.id === "cartReference") {
    renderCustomerInlineSuggestions("cartReference", "cartCustomerSuggestions");
  }
  if (event.target.id === "productSearch") {
    renderPosProductCodeSuggestions();
    updatePosSizeSelect();
  }
  if (event.target.id === "onlineProvince") {
    renderProvinceInlineSuggestions("onlineProvince", "onlineProvinceSuggestions");
  }
});

document.addEventListener("focusout", (event) => {
  lockBrowserAutofillField(event.target);
});

document.addEventListener("mousedown", (event) => {
  if (event.target.closest(".customer-inline-suggestions button")) event.preventDefault();
  if (event.target.closest(".category-suggestions button")) event.preventDefault();
  if (event.target.closest(".product-code-suggestions button")) event.preventDefault();
});

document.addEventListener("change", async (event) => {
  if (event.target.id === "importBackupInput") {
    importBackupFile(event.target.files?.[0]);
    return;
  }
  if (event.target.id === "productImageFiles") {
    await addProductImageFiles(event.target.files);
    event.target.value = "";
    return;
  }
  if (event.target.id === "productSearch") {
    renderPosProductCodeSuggestions();
    if (productByCodeQuery(event.target.value)) closePosProductCodeSuggestions();
    updateLocalAccessorySubcategorySelect({ focusIfAvailable: true });
    updatePosSizeSelect({ focusIfAvailable: true });
    return;
  }
  if (event.target.id === "stockEntryProductSearch") {
    renderStockEntryProductOptions(event.target.value);
    const product = findStockEntryProduct(event.target.value);
    document.getElementById("stockEntryProduct").value = product?.id || "";
    if (exactStockEntryProduct(event.target.value)) document.getElementById("stockEntryProductOptions")?.replaceChildren();
    updateStockEntryCurrentPrice(product);
    return;
  }
  if (event.target.id === "stockHistoryProductSearch") {
    renderStockHistoryProductOptions(event.target.value);
    const product = findStockHistoryProduct(event.target.value);
    document.getElementById("stockHistoryProduct").value = product?.id || "all";
    if (product) document.getElementById("stockHistoryProductOptions")?.replaceChildren();
    state.stockHistoryPage = 1;
    renderStockHistoryTable();
    return;
  }
  if (event.target.id === "saleEditPayment") {
    const sale = state.sales.find((item) => item.id === document.getElementById("saleEditId")?.value);
    if (sale?.channel === "online") {
      const platform = document.getElementById("saleEditPlatform");
      if (platform && String(event.target.value).toLowerCase() === "transferencia") platform.value = "transfer";
    }
  }
  if (event.target.dataset.expenseAmount) {
    updateExpenseMovementAmount(event.target.dataset.expenseAmount, event.target.value);
    return;
  }
  if (event.target.id === "monthSelector" || event.target.id === "monthPickerMonth" || event.target.id === "monthPickerYear") {
    const monthSelect = document.getElementById("monthPickerMonth");
    const yearSelect = document.getElementById("monthPickerYear");
    state.selectedMonth = event.target.id === "monthSelector"
      ? event.target.value
      : `${yearSelect?.value || state.selectedMonth.slice(0, 4)}-${monthSelect?.value || state.selectedMonth.slice(5, 7)}`;
    saveUiState();
    renderDashboard();
    return;
  }
  if (event.target.id === "productCategory") {
    renderProductSubcategoryOptions(event.target.value);
    if (!document.getElementById("editingProductId")?.value) {
      const code = document.getElementById("productCode");
      if (code) code.value = "";
    }
    if (!document.getElementById("editingProductId")?.value || isAccessoryCategory(event.target.value)) updateProductCode();
    syncProductVariantInputFromRows();
    renderProductVariantBuilder();
    return;
  }
  if (event.target.id === "productSubcategory") {
    if (!document.getElementById("editingProductId")?.value) {
      const code = document.getElementById("productCode");
      if (code) code.value = "";
      updateProductCode();
    }
    return;
  }
  if (event.target.id === "productCategoryFilter") {
    state.productFilters.category = event.target.value;
    state.productFilters.subcategory = "all";
    state.productPage = 1;
    saveUiState();
    renderCatalog();
    return;
  }
  if (event.target.id === "productSortFilter") {
    state.productFilters.sort = event.target.value;
    state.productPage = 1;
    saveUiState();
    renderCatalog();
    return;
  }
  if (event.target.id === "onlineSortFilter" || event.target.id === "onlineStoreFilter") {
    if (event.target.id === "onlineSortFilter") state.onlineFilters.sort = event.target.value;
    if (event.target.id === "onlineStoreFilter") state.onlineFilters.store = event.target.value;
    state.onlinePage = 1;
    saveUiState();
    renderOnline();
    return;
  }
  if (event.target.id === "productSubcategoryFilter") {
    state.productFilters.subcategory = event.target.value;
    state.productPage = 1;
    saveUiState();
    renderCatalog();
    return;
  }
  if (event.target.id === "productStockFilter") {
    state.productFilters.stock = event.target.value;
    state.productPage = 1;
    saveUiState();
    renderCatalog();
    return;
  }
  if (event.target.matches("[data-variant-size], [data-variant-stock]")) {
    syncProductVariantInputFromRows();
    return;
  }
  if (event.target.id === "productPublishedFilter") {
    state.productFilters.published = event.target.value;
    state.productPage = 1;
    saveUiState();
    renderCatalog();
    return;
  }
  if (event.target.id === "customerSortFilter") {
    state.customerFilters.sort = event.target.value;
    state.customerPage = 1;
    saveUiState();
    renderCustomers();
    return;
  }
  if (event.target.id === "stockEntryPriceAction") {
    updateStockEntryCurrentPrice();
    return;
  }
  if (["salesHistoryPeriodFilter", "salesHistoryPaymentFilter"].includes(event.target.id)) {
    const filters = state.salesHistoryFilters;
    if (event.target.id === "salesHistoryPeriodFilter") filters.period = event.target.value;
    if (event.target.id === "salesHistoryPaymentFilter") filters.payment = event.target.value;
    state.salesHistoryPage = 1;
    saveUiState();
    renderSalesHistory();
    return;
  }
  if (event.target.id === "salesHistoryFrom" || event.target.id === "salesHistoryTo") {
    const filters = state.salesHistoryFilters;
    if (event.target.id === "salesHistoryFrom") filters.from = event.target.value;
    if (event.target.id === "salesHistoryTo") filters.to = event.target.value;
    state.salesHistoryPage = 1;
    saveUiState();
    renderSalesHistory();
    return;
  }
  if (event.target.id === "reportCustomFrom" || event.target.id === "reportCustomTo") {
    if (event.target.id === "reportCustomFrom") state.reportCustomFrom = normalizeDateInput(event.target.value) || monthAgoIso();
    if (event.target.id === "reportCustomTo") state.reportCustomTo = normalizeDateInput(event.target.value) || todayIso();
    state.reportPeriod = "custom";
    saveUiState();
    renderReports();
    return;
  }
  if (event.target.id === "marginTrendOrder") {
    state.marginTrendOrder = event.target.value;
    saveUiState();
    renderReports();
    return;
  }
  if (event.target.id === "activityUserFilter" || event.target.id === "activityTypeFilter") {
    if (event.target.id === "activityUserFilter") state.activityLogFilters.user = event.target.value;
    if (event.target.id === "activityTypeFilter") state.activityLogFilters.type = event.target.value;
    state.activityLogPage = 1;
    renderActivityLogTable();
    return;
  }
  if (event.target.id === "productTracksStock") {
    updateProductStockInput();
    return;
  }
  if (event.target.id === "productSizeVariants") {
    syncProductSizeStockInput();
    return;
  }
  if (["expenseCategorySelect", "expenseEntryType", "expenseBehavior"].includes(event.target.id)) {
    updateExpenseFormType();
    return;
  }
  if (["expenseYearFilter", "expenseMonthFilter", "expenseCategoryFilter", "expenseTypeFilter", "expenseBehaviorFilter", "expenseCommissionFilter"].includes(event.target.id)) {
    const map = {
      expenseYearFilter: "year",
      expenseMonthFilter: "month",
      expenseCategoryFilter: "category",
      expenseTypeFilter: "type",
      expenseBehaviorFilter: "behavior",
      expenseCommissionFilter: "commissions",
    };
    state.expenseFilters[map[event.target.id]] = event.target.value;
    state.expensesPage = 1;
    saveUiState();
    renderExpenses();
    return;
  }
  if (event.target.closest("#priceUpdateForm")) {
    updatePriceUpdatePreview();
    return;
  }
  if (event.target.closest("#stockHistoryModal")) {
    state.stockHistoryPage = 1;
    renderStockHistoryTable();
    return;
  }
  if (event.target.dataset.fixedAmount) {
    const checkbox = document.querySelector(`[data-fixed-enabled="${event.target.dataset.fixedAmount}"]`);
    if (checkbox) checkbox.checked = Number(event.target.value || 0) > 0;
    return;
  }
  if (event.target.id === "onlineDate") {
    syncOnlineDateDisplay();
    return;
  }
  if (event.target.id === "onlinePayment") syncOnlinePaymentPlatform();
  if (event.target.closest("#onlineForm")) {
    updateOnlineCostPreview();
    return;
  }
  if (event.target.closest("#workshopDeliveryForm")) {
    updateWorkshopDeliveryPreview();
    return;
  }
  const cart = activeCart();
  if (!cart) return;
  if (event.target.id === "cartPayment") {
    cart.paymentMethod = event.target.value;
    saveUiState();
    updateCartPaymentPreview(cart);
  }
  if (event.target.id === "cartManualTotalEnabled") {
    cart.manualTotalEnabled = event.target.checked;
    if (cart.manualTotalEnabled && (cart.manualTotal === "" || cart.manualTotal == null)) {
      cart.manualTotal = cartSubtotal(cart);
    }
    saveUiState();
    renderPos();
    return;
  }
  if (event.target.id === "cartPartialPaymentEnabled") {
    cart.partialPaymentEnabled = event.target.checked;
    if (!cart.partialPaymentEnabled) {
      cart.paidAmount = "";
    }
    saveUiState();
    renderPos();
    return;
  }
});

document.getElementById("offlineToggle").addEventListener("change", (event) => {
  state.offline = event.target.checked;
  saveUiState();
  render();
});

document.addEventListener("focusin", (event) => {
  if (event.target.id === "onlineLineCategory") renderOnlineCategorySuggestions();
});

document.addEventListener("focusout", (event) => {
  if (event.target.dataset.onlineLineQty) {
    const index = Number(event.target.dataset.onlineLineQty);
    event.target.value = Number(state.onlineDraftLines[index]?.quantity || 1);
  }
});

window.addEventListener("offline", () => {
  state.offline = true;
  persistStateLocalOnly();
  render();
});

window.addEventListener("online", () => {
  state.offline = false;
  persistStateLocalOnly();
  render();
  if (state.localSyncPending || businessStateDirty) syncWithSupabase({ preferRemote: false });
  else autoDownloadRemoteState({ force: true });
});

window.addEventListener("pageshow", () => {
  autoDownloadRemoteState({ force: true });
});

window.addEventListener("focus", () => {
  autoDownloadRemoteState();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") autoDownloadRemoteState();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (document.getElementById("productModal").classList.contains("open")) closeProductModal();
  if (document.getElementById("priceUpdateModal").classList.contains("open")) closePriceUpdateModal();
  if (document.getElementById("stockEntryModal").classList.contains("open")) closeStockEntryModal();
  if (document.getElementById("stockHistoryModal").classList.contains("open")) closeStockHistoryModal();
  if (document.getElementById("manualItemModal").classList.contains("open")) closeManualItemModal();
  if (document.getElementById("customerPickerModal").classList.contains("open")) closeCustomerPickerModal();
  if (document.getElementById("customerRegisterModal").classList.contains("open")) closeCustomerRegisterModal();
  if (document.getElementById("customerEditModal").classList.contains("open")) closeCustomerEditModal();
  if (document.getElementById("customerInfoModal").classList.contains("open")) closeCustomerInfoModal();
  if (document.getElementById("afipPendingModal").classList.contains("open")) closeAfipPendingModal();
  if (document.getElementById("onlineMissingModal").classList.contains("open")) closeOnlineMissingModal();
  if (document.getElementById("fixedExpensesModal").classList.contains("open")) closeFixedExpensesModal();
  if (document.getElementById("workshopPriceModal").classList.contains("open")) closeWorkshopPriceModal();
  if (document.getElementById("workshopDeliveryModal").classList.contains("open")) closeWorkshopDeliveryModal();
  if (document.getElementById("stockCostUpdateModal").classList.contains("open")) closeStockCostUpdateModal();
  if (document.getElementById("saleEditModal").classList.contains("open")) closeSaleEditModal();
  if (document.getElementById("saleInfoModal").classList.contains("open")) closeSaleInfoModal();
  if (document.getElementById("settingsPasswordModal").classList.contains("open")) closeSettingsPasswordModal();
  if (document.getElementById("activityLogModal").classList.contains("open")) closeActivityLogModal();
  if (document.getElementById("confirmModal").classList.contains("open")) closeConfirmModal();
});

document.getElementById("businessSettingsForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  saveBusinessSettingsFromForm(event.target);
});

document.getElementById("catalogSettingsForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  saveCatalogSettingsFromForm(event.target);
});

document.getElementById("dataLoadSettingsForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  saveDataLoadSettingsFromForm(event.target);
});

document.getElementById("saleEditForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  saveSaleEdit(event.target);
});

document.getElementById("settingsPasswordForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitSettingsPassword(event.target);
});

document.getElementById("manualItemForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const cart = activeCart();
  const data = formDataObject(event.target);
  if (!cart) return;
  addManualItem(cart.id, data.description, data.price, "Manual");
  closeManualItemModal();
});

document.getElementById("productForm").addEventListener("submit", (event) => {
  event.preventDefault();
  renderProductImagePreview();
  syncProductVariantInputFromRows();
  const data = formDataObject(event.target);
  const editingId = data.editingProductId || "";
  const existing = state.products.find((product) => product.id === editingId);
  if (existing && isAccessoryCategory(existing.category)) {
    showActionToast("Los accesorios quedan bloqueados. Solo se pueden eliminar.");
    closeProductModal();
    return;
  }
  const now = new Date().toISOString();
  const category = canonicalProductCategory(data.category);
  const code = isAccessoryCategory(category) ? accessoryPriceCode(data.price) : String(data.code || "").trim().toUpperCase();
  if (!isAccessoryCategory(category) && state.products.some((product) => product.id !== editingId && String(product.code || "").toUpperCase() === code)) {
    alert("Ese Código ya existe. Elegí otro Código libre.");
    return;
  }
  const updatedProduct = {
    code,
    barcode: data.barcode || barcodeFromCode(code),
    description: normalizeProductDescription(data.description),
    catalogDescription: String(data.catalogDescription || "").trim(),
    color: normalizeProductDescription(data.color || ""),
    category,
    subcategory: isAccessoryCategory(category) ? "" : String(data.subcategory || "").trim(),
    unit: "Unidad",
    cost: Number(data.cost || 0),
    margin: Number(data.margin || 0),
    price: Number(data.price),
    promoPrice: Number(data.promoPrice || 0),
    wholesalePrice: Number(data.wholesalePrice || 0),
    published: Boolean(data.published),
    featured: Boolean(data.featured),
    isNew: Boolean(data.isNew),
    imageUrls: normalizeProductImageUrls(data.imageUrls),
    sizeVariants: normalizeProductSizeVariants(data.sizeVariants),
    tracksStock: Boolean(data.tracksStock),
    stock: data.tracksStock ? Number(data.stock || 0) : null,
  };
  if (updatedProduct.tracksStock && !updatedProduct.sizeVariants.length) {
    alert("Agregá al menos una variedad/talle para controlar stock.");
    return;
  }
  if (updatedProduct.sizeVariants.length && updatedProduct.tracksStock) updatedProduct.stock = productSizeStockTotal(updatedProduct);
  const stockDraft = existing && existing.tracksStock && updatedProduct.tracksStock ? productStockAddDraft(existing) : null;
  if (stockDraft === false) return;
  if (stockDraft?.hasCost && Number(stockDraft.unitCost) !== Number(existing.cost || 0)) {
    openStockCostUpdateModal({ existing, updatedProduct, stockDraft, now });
    return;
  }
  commitProductFormSave({ existing, updatedProduct, stockDraft, now });
});

document.getElementById("priceUpdateForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = formDataObject(event.target);
  applyPriceUpdate(Number(data.percent || 0));
  closePriceUpdateModal();
});

document.getElementById("stockEntryForm").addEventListener("submit", (event) => {
  event.preventDefault();
  addStockEntryDraftFromForm(event.target);
  return;
  const data = formDataObject(event.target);
  const entryDate = normalizeDateInput(data.date);
  if (!entryDate) {
    alert("Escribí la Fecha como DD/MM/AA.");
    return;
  }
  const product = state.products.find((item) => item.id === data.productId) || findStockEntryProduct(data.productQuery);
  const quantity = Number(data.quantity || 0);
  if (!product || !product.tracksStock) {
    alert("Elegí un Producto con Control de Stock.");
    return;
  }
  if (quantity <= 0) return;
  product.stock = Number(product.stock || 0) + quantity;
  addStockHistory(product, "entrada", quantity, product.stock, data.note || "Reposición de Mercadería", entryDate);
  saveState();
  closeStockEntryModal();
  render();
});

document.getElementById("customerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formDataObject(event.target);
  const name = normalizeCustomerName(data.name);
  if (!name) return;
  const editingId = data.customerId || "";
  const dni = normalizeCustomerDni(data.dni);
  const dniOwner = findCustomerByDni(dni, { excludeId: editingId });
  if (dniOwner) {
    alert(`Ese DNI ya está cargado en ${dniOwner.name}.`);
    return;
  }
  const payload = {
    name,
    dni,
    phone: data.phone || "",
    initialDebt: Math.max(0, Number(data.initialDebt || 0)),
    province: normalizeProvince(data.province),
    notes: data.notes || "",
  };
  const existing = state.customers.find((customer) => customer.id === editingId);
  try {
    if (CLOUD_DATA_ENABLED) {
      if (!cloudEnabledWithSession()) {
        showAuthError("Ingresá con tu usuario BlackShoes para guardar clientes en Supabase.");
        renderAuthState("Ingresá para guardar en Supabase.");
        return;
      }
      const saved = await saveCloudCustomerRecord(existing, payload);
      if (existing) Object.assign(existing, saved);
      else state.customers.push(saved);
      await loadCloudOperationalData();
    } else if (existing) {
      Object.assign(existing, payload);
    } else {
      state.customers.push({ id: uid("customer"), ...payload });
    }
  } catch (error) {
    console.warn("Cloud customer save failed", error);
    alert(`No pude guardar el cliente en Supabase: ${error.message || "error desconocido"}`);
    return;
  }
  logActivity("customer", existing ? "Edito cliente" : "Creo cliente", payload.name);
  clearCustomerForm();
  saveState();
  render();
});

document.getElementById("customerRegisterForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitCustomerRegisterModal(event.target);
});

document.getElementById("customerEditForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitCustomerEditModal(event.target);
});

document.getElementById("customerDebtPaymentForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  registerCustomerDebtPayment(event.target);
});

document.getElementById("cashCloseForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = formDataObject(event.target);
  const date = normalizeDateInput(state.cashCloseDate) || todayIso();
  const summary = cashCloseDailySummary(date);
  const countedCash = Number(data.countedCash || 0);
  const withdrawals = Number(data.withdrawals || 0);
  const existing = state.cashClosures.find((closure) => closure.date === date);
  const closure = existing || { id: uid("cash-close") };
  Object.assign(closure, {
    date,
    totalLocal: summary.total,
    expectedCash: summary.expectedCash,
    countedCash,
    withdrawals,
    difference: countedCash + withdrawals - summary.expectedCash,
    notes: data.notes || "",
    byPayment: summary.byPayment,
  });
  if (!existing) state.cashClosures.push(closure);
  upsertCashClosureAdjustment(closure);
  logActivity("cash", existing ? "Actualizo cierre de caja" : "Creo cierre de caja", `${formatDateShort(date)} - diferencia ${money(closure.difference)}`);
  saveState();
  render();
});

document.getElementById("workshopPriceForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = formDataObject(event.target);
  const saved = saveWorkshopPrice(data.orderId, data.price);
  if (!saved) return;
  closeWorkshopPriceModal();
});

document.getElementById("workshopDeliveryForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = formDataObject(event.target);
  completeWorkshop(data.orderId, data.paymentMethod || "efectivo");
  closeWorkshopDeliveryModal();
});

document.getElementById("workshopForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = formDataObject(event.target);
  const customerName = String(document.getElementById("workshopClientLookup")?.value || data.workshopClientLookup || "").trim();
  const phone = String(document.getElementById("workshopPhoneEntry")?.value || data.workshopPhoneEntry || "").trim();
  const price = parseMoneyInput(document.getElementById("workshopPriceEntry")?.value || data.workshopPriceEntry || 0);
  if (!customerName) {
    alert("Ingresá el Cliente del pedido de taller.");
    return;
  }
  if (price <= 0) {
    alert("Ingresá el Precio Final del pedido de taller.");
    return;
  }
  const customer = findOrCreateCustomer(customerName, { phone, type: "taller" });
  const order = {
    id: uid("workshop"),
    number: nextWorkshopOrderNumber(),
    date: todayIso(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    customer: customerName,
    customerId: customer?.id || "",
    phone,
    description: data.description,
    price,
    status: "en_taller",
    paid: false,
  };
  state.workshopOrders.push(order);
  logActivity("workshop", "Registro pedido taller", `${order.number} - ${order.customer}`);
  event.target.reset();
  saveState();
  render();
});

document.getElementById("onlineForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = formDataObject(event.target);
  const saleDate = normalizeDateInput(data.date);
  if (!saleDate) {
    alert("Elegí la Fecha de la venta online.");
    return;
  }
  if (!state.onlineDraftLines.length) {
    alert("Agregá al menos una Categoría vendida.");
    return;
  }
  if (!data.paymentMethod) {
    alert("Elegí un Medio de Pago para registrar la venta online.");
    return;
  }
  if (!data.paymentPlatform) {
    alert("Elegí una Plataforma de Pago para registrar la venta online.");
    return;
  }
  if (!String(data.orderNumber || "").trim()) {
    alert("Ingresá el Número de Venta.");
    return;
  }
  const lines = state.onlineDraftLines.map((line) => ({ ...line }));
  const grossAmount = Number(data.saleAmount ?? data.total ?? 0);
  const discountAmount = Math.min(grossAmount, Math.max(0, Number(data.discountAmount || 0)));
  const saleAmount = onlineDiscountedSaleAmount(grossAmount, discountAmount);
  const shippingAmount = Number(data.shippingAmount || 0);
  const provinceValue = normalizeProvince(document.getElementById("onlineProvince")?.value || data.provinceLookup || "");
  if (grossAmount <= 0) {
    alert("Ingresá el Importe.");
    return;
  }
  if (!provinceValue) {
    alert("Ingresá la Provincia.");
    return;
  }
  if (!confirmOnlineCustomerBeforeSubmit(event.target, data)) return;
  const collectedTotal = saleAmount + shippingAmount;
  const paymentPlatform = canonicalOnlinePaymentPlatform(data.paymentPlatform, data.paymentMethod);
  const costRate = onlineCostRate(data.store, "base");
  const estimatedCost = onlineEstimatedCost(grossAmount, data.store, "base");
  const selectedCustomerId = event.target.elements.customerId?.value || data.customerId || "";
  const selectedCustomer = state.customers.find((customer) => customer.id === selectedCustomerId) || null;
  const customerName = selectedCustomer?.name || String(document.getElementById("onlineClientLookup")?.value || data.clientLookup || "").trim();
  const customerId = selectedCustomer?.id || "";
  const customerDni = selectedCustomer?.dni || normalizeCustomerDni(document.getElementById("onlineCustomerDni")?.value || data.customerDni);
  const orderId = uid("online");
  const saleId = uid("sale");
  const now = new Date().toISOString();
  const order = {
    id: orderId,
    saleId,
    createdAt: now,
    updatedAt: now,
    orderNumber: data.orderNumber,
    date: saleDate,
    store: data.store,
    province: provinceValue,
    total: saleAmount,
    grossAmount,
    discountAmount,
    saleAmount,
    shippingAmount,
    collectedTotal,
    paymentMethod: data.paymentMethod,
    paymentPlatform,
    promo: "base",
    costRate,
    estimatedCost,
    afipDone: false,
    afipDoneAt: "",
    customerId,
    customerName,
    customerDni,
    lines,
  };
  const sale = {
    id: saleId,
    createdAt: now,
    updatedAt: now,
    date: saleDate,
    channel: "online",
    source: "tiendanube",
    onlineOrderId: orderId,
    orderNumber: data.orderNumber,
    onlineStore: data.store,
    total: saleAmount,
    grossAmount,
    discountAmount,
    shippingAmount,
    collectedTotal,
    customerId,
    customerName,
    customerDni,
    syncStatus: state.offline ? "pending" : "synced",
    province: provinceValue,
    paymentMethod: data.paymentMethod,
    paymentPlatform,
    onlinePromo: "base",
    onlineCostRate: costRate,
    onlineCost: estimatedCost,
    onlineLines: order.lines,
  };
  openConfirmModal({
    title: "Confirmar venta online",
    message: `Venta ${data.orderNumber}. Importe: ${money(grossAmount)}. Descuento: ${money(discountAmount)}. Venta real: ${money(saleAmount)}. Envio: ${money(shippingAmount)}. Total ARCA: ${money(collectedTotal)}. Medio: ${paymentMethodName(data.paymentMethod)}. Plataforma: ${onlinePaymentPlatformLabel(paymentPlatform)}.`,
    confirmText: "Confirmar Venta",
    onConfirm: () => {
      const parsedOrder = parseOnlineOrderNumber(order.orderNumber);
      if (parsedOrder) {
        state.onlineResolvedMissingOrders = (state.onlineResolvedMissingOrders || [])
          .filter((row) => onlineMissingOrderKey(row.prefix, row.number) !== onlineMissingOrderKey(parsedOrder.prefix, parsedOrder.number));
      }
      state.onlineOrders.push(order);
      state.onlinePage = 1;
      state.sales.push(sale);
      rememberOnlineOrderNumber(order.orderNumber);
      state.salesHistoryPage = 1;
      state.onlineDraftLines = [];
      logActivity("online", "Registro venta online", `${order.orderNumber} - ${money(saleAmount)} - ${sum(lines, (line) => line.quantity)} articulos`);
      event.target.reset();
      delete event.target.dataset.customerReviewedName;
      const customerLookup = document.getElementById("onlineClientLookup");
      const customerDniInput = document.getElementById("onlineCustomerDni");
      if (customerLookup) customerLookup.value = "";
      if (customerDniInput) customerDniInput.value = "";
      setDateInput(event.target.date, saleDate);
      event.target.orderNumber.value = nextOnlineOrderNumber();
      event.target.paymentMethod.value = "";
      event.target.paymentPlatform.value = "";
      saveState();
      render();
    },
  });
});

document.getElementById("expenseForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formDataObject(event.target);
  const concept = String(document.getElementById("expenseConcept")?.value || data.expenseConceptEntry || "").trim();
  const movementDate = normalizeDateInput(data.date);
  if (!movementDate) {
    alert("Escribí la Fecha como DD/MM/AA.");
    return;
  }
  if (!concept) {
    alert("Ingresá el Concepto del gasto.");
    return;
  }
  const rule = expenseCategoryRules[data.category] || { type: data.entryType, behavior: data.behavior || "variable" };
  if (CLOUD_DATA_ENABLED) {
    try {
      if (!cloudEnabledWithSession()) {
        showAuthError("Ingresá con tu usuario BlackShoes para guardar gastos en Supabase.");
        renderAuthState("Ingresá para guardar en Supabase.");
        return;
      }
      await saveCloudExpenseRecord({
        date: movementDate,
        concept,
        category: rule.type === "purchase" ? "CompraMercaderia" : data.category,
        amount: Number(data.amount || 0),
        paymentMethod: data.paymentMethod || "",
      });
      await loadCloudOperationalData();
      logActivity(rule.type === "purchase" ? "expense" : "expense", rule.type === "purchase" ? "Registro mercaderia" : "Registro gasto", `${concept} - ${money(Number(data.amount || 0))}`);
      event.target.reset();
      event.target.date.value = todayIso();
      updateExpenseFormType();
      saveState();
      render();
      showActionToast("Movimiento guardado en Supabase.");
      return;
    } catch (error) {
      console.warn("Cloud expense save failed", error);
      alert(`No pude guardar el movimiento en Supabase: ${error.message || "error desconocido"}`);
      return;
    }
  }
  if (rule.type === "purchase") {
    state.purchases.push({
      id: uid("purchase"),
      date: movementDate,
      supplier: concept,
      category: data.category,
      behavior: rule.behavior,
      area: "local",
      amount: Number(data.amount),
      notes: "Compra de mercadería",
    });
    logActivity("expense", "Registro mercaderia", `${concept} - ${money(Number(data.amount || 0))}`);
  } else {
    state.expenses.push({
      id: uid("expense"),
      date: movementDate,
      concept,
      category: data.category,
      kind: rule.behavior,
      area: "local",
      amount: Number(data.amount),
    });
    logActivity("expense", "Registro gasto", `${concept} - ${money(Number(data.amount || 0))}`);
  }
  event.target.reset();
  event.target.date.value = todayIso();
  updateExpenseFormType();
  saveState();
  render();
});

document.getElementById("authForm").addEventListener("submit", (event) => {
  handleAuthSubmit(event, "signin");
});

document.querySelectorAll(".short-date-input").forEach((input) => {
  if (!input.value) setDateInput(input, todayIso());
});
if (document.getElementById("expenseDate")) document.getElementById("expenseDate").value = todayIso();
if (document.getElementById("cashCloseDate")) document.getElementById("cashCloseDate").value = state.cashCloseDate || todayIso();

function seedDemoData() {
  const svgImage = (kind, title, bg, accent, detail = false) => {
    const productArt = {
      hoodie: `
        <path d="M320 342 Q450 250 580 342 L668 462 L604 526 L558 468 L558 804 L342 804 L342 468 L296 526 L232 462 Z" fill="${accent}" filter="url(#shadow)"/>
        <path d="M362 342 Q450 270 538 342 Q505 392 450 392 Q395 392 362 342 Z" fill="#ffffff" opacity=".14"/>
        <path d="M392 398 Q450 445 508 398" fill="none" stroke="#ffffff" stroke-width="10" opacity=".35"/>
        <path d="M450 392 L450 780" stroke="#ffffff" stroke-width="5" opacity=".16"/>
        <circle cx="392" cy="438" r="8" fill="#ffffff" opacity=".45"/>
        <circle cx="508" cy="438" r="8" fill="#ffffff" opacity=".45"/>
      `,
      remera: `
        <path d="M318 330 L390 290 H510 L582 330 L680 412 L618 490 L560 450 V806 H340 V450 L282 490 L220 412 Z" fill="${accent}" filter="url(#shadow)"/>
        <path d="M390 290 Q450 354 510 290" fill="none" stroke="#111111" stroke-width="14" opacity=".14"/>
        <rect x="384" y="488" width="132" height="12" rx="6" fill="#111111" opacity=".12"/>
        <rect x="410" y="530" width="80" height="12" rx="6" fill="#111111" opacity=".10"/>
      `,
      zapatilla: `
        <path d="M168 656 C270 570 378 536 518 572 C640 604 710 566 792 472 C836 546 826 636 760 710 C640 756 472 760 306 740 C218 728 172 720 140 696 Z" fill="${accent}" filter="url(#shadow)"/>
        <path d="M188 664 C310 690 590 696 770 652" fill="none" stroke="#ffffff" stroke-width="24" opacity=".32"/>
        <path d="M288 600 L354 520 L464 558 L404 632 Z" fill="#ffffff" opacity=".18"/>
        <path d="M430 560 L578 592" stroke="#ffffff" stroke-width="12" opacity=".35"/>
        <path d="M466 612 L592 626" stroke="#ffffff" stroke-width="10" opacity=".28"/>
        <rect x="208" y="714" width="560" height="38" rx="19" fill="#111111" opacity=".18"/>
      `,
      short: `
        <path d="M298 334 H602 L642 784 H498 L450 584 L402 784 H258 Z" fill="${accent}" filter="url(#shadow)"/>
        <rect x="302" y="334" width="296" height="72" rx="18" fill="#111111" opacity=".16"/>
        <path d="M450 406 L450 584" stroke="#ffffff" stroke-width="9" opacity=".22"/>
        <path d="M350 452 H550" stroke="#ffffff" stroke-width="10" opacity=".20"/>
      `,
      gorra: `
        <path d="M260 582 C292 430 412 344 556 390 C650 420 700 492 704 602 C558 566 402 566 260 582 Z" fill="${accent}" filter="url(#shadow)"/>
        <path d="M458 584 C598 568 724 586 814 646 C696 678 560 672 438 626 Z" fill="${accent}" opacity=".85"/>
        <path d="M330 562 C370 452 466 410 574 424" fill="none" stroke="#ffffff" stroke-width="14" opacity=".24"/>
        <path d="M598 428 C644 464 670 520 676 596" fill="none" stroke="#111111" stroke-width="10" opacity=".16"/>
      `,
    }[kind] || "";
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1100">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="${bg}"/>
          <stop offset="1" stop-color="#ffffff"/>
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="26" stdDeviation="24" flood-color="#111111" flood-opacity=".18"/>
        </filter>
      </defs>
      <rect width="900" height="1100" fill="url(#bg)"/>
      <circle cx="704" cy="246" r="132" fill="${accent}" opacity=".12"/>
      <circle cx="178" cy="848" r="176" fill="${accent}" opacity=".08"/>
      <rect x="118" y="238" width="664" height="646" rx="54" fill="#ffffff" opacity=".54"/>
      ${productArt}
      ${detail ? `<rect x="118" y="842" width="664" height="6" rx="3" fill="${accent}" opacity=".35"/>` : ""}
      <text x="72" y="126" fill="#111" font-family="Arial, sans-serif" font-size="58" font-weight="800">${title}</text>
      <text x="72" y="198" fill="#333" font-family="Arial, sans-serif" font-size="32" font-weight="700">BlackShoes · producto demo</text>
    </svg>
  `)}`;
  };
  const imageSet = (kind, title, bg, accent) => [
    svgImage(kind, title, bg, accent),
    svgImage(kind, `${title} detalle`, "#f8fafc", accent, true),
  ];
  const variants = (rows) => Object.entries(rows).map(([size, stock]) => ({ size, stock }));
  const withStock = (product) => ({ ...product, stock: productSizeStockTotal(product), createdAt: product.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
  const products = [
    withStock({ id: "seed-product-hoodie-negro", code: "H", description: "Hoodie Essential", color: "Negro", unit: "Unidad", category: "Hoodies", subcategory: "Urbano", cost: 28500, margin: 90, price: 54900, promoPrice: 49900, wholesalePrice: 0, tracksStock: true, sizeVariants: variants({ S: 2, M: 4, L: 3, XL: 1, XXL: 0 }), published: true, catalogDescription: "Hoodie frizado de uso urbano, corte comodo y capucha amplia.", images: imageSet("hoodie", "Hoodie Essential", "#f1f2f4", "#111111"), createdAt: `${daysAgoIso(9)}T10:00:00.000Z` }),
    withStock({ id: "seed-product-remera-blanca", code: "R", description: "Remera Box Fit", color: "Blanco", unit: "Unidad", category: "Remeras", subcategory: "Urbano", cost: 9200, margin: 95, price: 18900, promoPrice: 0, wholesalePrice: 0, tracksStock: true, sizeVariants: variants({ S: 5, M: 3, L: 2, XL: 1, XXL: 0 }), published: true, catalogDescription: "Remera box fit de algodon, ideal para looks urbanos.", images: imageSet("remera", "Remera Box Fit", "#ffffff", "#d9a441"), createdAt: `${daysAgoIso(7)}T10:00:00.000Z` }),
    withStock({ id: "seed-product-zapatilla-gris", code: "Z", description: "Zapatilla Runner 90", color: "Gris", unit: "Par", category: "Zapatillas", subcategory: "Deportivo", cost: 42000, margin: 75, price: 78900, promoPrice: 72900, wholesalePrice: 0, tracksStock: true, sizeVariants: variants({ 39: 1, 40: 2, 41: 2, 42: 1, 43: 0, 44: 1 }), published: true, catalogDescription: "Zapatilla liviana con suela confortable para uso diario.", images: imageSet("zapatilla", "Runner 90", "#e9ecef", "#6b7280"), createdAt: `${daysAgoIso(5)}T10:00:00.000Z` }),
    withStock({ id: "seed-product-short-azul", code: "S", description: "Short Training", color: "Azul", unit: "Unidad", category: "Shorts", subcategory: "Deportivo", cost: 11800, margin: 85, price: 22900, promoPrice: 0, wholesalePrice: 0, tracksStock: true, sizeVariants: variants({ S: 3, M: 2, L: 2, XL: 0, XXL: 1 }), published: true, catalogDescription: "Short deportivo de secado rapido con cintura elastica.", images: imageSet("short", "Short Training", "#dbeafe", "#1d4ed8"), createdAt: `${daysAgoIso(3)}T10:00:00.000Z` }),
    { id: "seed-product-gorra-roja", code: "G", description: "Gorra Classic", color: "Rojo", unit: "Unidad", category: "Accesorios", subcategory: "Gorras", cost: 6500, margin: 100, price: 13900, promoPrice: 0, wholesalePrice: 0, tracksStock: false, stock: 0, sizeVariants: [], published: true, catalogDescription: "Gorra regulable para completar cualquier outfit.", images: imageSet("gorra", "Gorra Classic", "#fee2e2", "#b91c1c"), createdAt: `${daysAgoIso(1)}T10:00:00.000Z`, updatedAt: new Date().toISOString() },
  ];
  const customers = [
    { id: "seed-customer-sofia", name: "Sofia Martinez", dni: "42555111", phone: "3515551020", province: "Cordoba", notes: "Demo", initialDebt: 0, initialDebtPayments: [] },
    { id: "seed-customer-diego", name: "Diego Alvarez", dni: "38123999", phone: "3515552040", province: "Cordoba", notes: "Demo con deuda", initialDebt: 18000, initialDebtPayments: [] },
  ];
  const sales = [
    { id: "seed-sale-0001", localOrderNumber: 1, date: todayIso(), channel: "local", source: "mostrador", total: 49900, paidAmount: 49900, debtPayments: [], syncStatus: "synced", saleType: "minorista", paymentMethod: "efectivo", skipPaymentAdjustment: false, manualTotalEnabled: false, manualTotal: "", reference: "Sofia Martinez", customerId: "seed-customer-sofia", customerName: "Sofia Martinez", items: [{ productId: "seed-product-hoodie-negro", code: "H", description: "Hoodie Essential", category: "Hoodies", subcategory: "Urbano", size: "M", quantity: 1, unitPrice: 49900, tracksStock: true }] },
    { id: "seed-sale-0002", localOrderNumber: 2, date: todayIso(), channel: "local", source: "mostrador", total: 85000, paidAmount: 60000, debtPayments: [], syncStatus: "synced", saleType: "minorista", paymentMethod: "transferencia", skipPaymentAdjustment: false, manualTotalEnabled: true, manualTotal: 85000, reference: "Diego Alvarez", customerId: "seed-customer-diego", customerName: "Diego Alvarez", items: [{ productId: "seed-product-zapatilla-gris", code: "Z", description: "Zapatilla Runner 90", category: "Zapatillas", subcategory: "Deportivo", size: "41", quantity: 1, unitPrice: 78900, tracksStock: true }, { productId: "seed-product-gorra-roja", code: "G", description: "Gorra Classic", category: "Accesorios", subcategory: "Gorras", size: "", quantity: 1, unitPrice: 13900, tracksStock: false }] },
    { id: "seed-sale-0003", localOrderNumber: 3, date: daysAgoIso(2), channel: "local", source: "mostrador", total: 40800, paidAmount: 40800, debtPayments: [], syncStatus: "synced", saleType: "minorista", paymentMethod: "qr", skipPaymentAdjustment: false, manualTotalEnabled: true, manualTotal: 40800, reference: "Venta mostrador", customerId: "", customerName: "", items: [{ productId: "seed-product-remera-blanca", code: "R", description: "Remera Box Fit", category: "Remeras", subcategory: "Urbano", size: "L", quantity: 1, unitPrice: 18900, tracksStock: true }, { productId: "seed-product-short-azul", code: "S", description: "Short Training", category: "Shorts", subcategory: "Deportivo", size: "M", quantity: 1, unitPrice: 22900, tracksStock: true }] },
  ];
  const expenses = [
    { id: "seed-expense-alquiler", date: `${currentMonthKey()}-01`, concept: "Alquiler local", category: "Alquiler", kind: "fijo", area: "local", amount: 180000 },
    { id: "seed-expense-luz", date: daysAgoIso(4), concept: "Factura de luz", category: "Servicios", kind: "variable", area: "local", amount: 32500 },
    { id: "seed-expense-instagram", date: daysAgoIso(3), concept: "Publicidad Instagram", category: "Marketing", kind: "variable", area: "local", amount: 22000 },
  ];
  const purchases = [{ id: "seed-purchase-mercaderia", date: daysAgoIso(6), supplier: "Reposicion proveedor demo", category: "CompraMercaderia", behavior: "variable", area: "local", amount: 260000, notes: "Compra de mercaderia demo" }];
  const stockHistory = products.filter((product) => product.tracksStock).map((product) => ({ id: `seed-stock-${product.id}`, date: daysAgoIso(8), productId: product.id, productCode: product.code, productName: product.description, type: "ajuste", quantity: product.stock, stockAfter: product.stock, note: "Stock demo inicial" }));
  const removeSeed = (rows) => (Array.isArray(rows) ? rows.filter((item) => !String(item.id || "").startsWith("seed-")) : []);
  state.products = [...removeSeed(state.products), ...products];
  state.customers = [...removeSeed(state.customers), ...customers];
  state.sales = [...removeSeed(state.sales), ...sales];
  state.expenses = [...removeSeed(state.expenses), ...expenses];
  state.purchases = [...removeSeed(state.purchases), ...purchases];
  state.stockHistory = [...removeSeed(state.stockHistory), ...stockHistory];
  state.activityLog = [...removeSeed(state.activityLog), { id: "seed-activity-demo", at: new Date().toISOString(), user: "Demo", type: "settings", action: "Cargo datos demo", detail: "Productos, ventas, gastos y catalogo publicados" }];
  state.catalogSettings = { ...catalogSettings(), businessName: "BlackShoes", defaultWhatsappMessage: "Hola {businessName}, quiero consultar por este producto:", sizeAvailabilityMode: "show-unavailable", outOfStockProductMode: "show" };
  state.productFilters = { query: "", sort: "recent", category: "all", subcategory: "all", stock: "all", published: "all" };
  state.activeView = "dashboard";
  state.selectedMonth = currentMonthKey();
  state.productPage = 1;
  state.customerPage = 1;
  state.salesHistoryPage = 1;
  state.expensesPage = 1;
  saveState();
}

const bootParams = new URLSearchParams(window.location.search);
const demoUrlNeedsSeed =
  bootParams.get("v") === "demo-data-loaded" &&
  !state.products.length &&
  !state.sales.length &&
  !state.expenses.length &&
  !state.customers.length;
if (bootParams.has("seedDemo") || demoUrlNeedsSeed) {
  seedDemoData();
  window.history.replaceState({}, "", "index.html?v=demo-data-loaded");
}

if (!state.carts.length) addCart();
setView(state.activeView || "dashboard");
window.matchMedia?.("(max-width: 760px)")?.addEventListener("change", () => render());
initializeSupabaseAuth();






