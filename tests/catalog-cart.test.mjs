import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as model from '../catalog-model.mjs';

const root = new URL('../', import.meta.url);
const source = (file) => fs.readFileSync(new URL(file, root), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const isCatalog = root.pathname.endsWith('/catalog/');
const site = isCatalog ? {
  id: 'catalog', gid: 0, whatsapp: '17253041220', shipping: 'Calculated Separately', freeShipping: false,
  sheet: '2PACX-1vSaFTXofUSG63pjWela7csIA57AcA6rqrhb26_p_NKQ73P8ofYD3Ec4JDqGPVEUv6Fe3HWDpsj8ldaE',
  cache: 'perfumeDB_BestProducts_Catalog_Data_V14',
  tiers: [
    { min: 1, max: 10, percent: 0 }, { min: 11, max: 20, percent: .035 },
    { min: 21, max: 40, percent: .08 }, { min: 41, max: Infinity, percent: .12 },
  ],
} : {
  id: 'perfume-list', gid: 1967485424, whatsapp: '16232027321', shipping: 'FREE', freeShipping: true,
  sheet: '2PACX-1vRFWYImNbJ0ao5z0VDk_VZwhOP1pnY2UZdFuwxtYOvKaNfEX4sInJh7uk-MlRSH9kffdZ5TjzhudLao',
  cache: 'perfumeDB_BestProducts_Catalog_Data_V13',
  tiers: [
    { min: 1, max: 1, percent: 0 }, { min: 2, max: 2, percent: .03 },
    { min: 3, max: 4, percent: .05 }, { min: 5, max: 9, percent: .08 },
    { min: 10, max: 19, percent: .14 }, { min: 20, max: 29, percent: .24 },
    { min: 30, max: 49, percent: .26 }, { min: 50, max: 79, percent: .29 },
    { min: 80, max: 100, percent: .32 }, { min: 101, max: Infinity, percent: .35 },
  ],
};
const product = (overrides = {}) => ({
  id: 'TX-A055', warehouse: 'TX', name: 'New York Nights', brand: 'Bond No. 9',
  price: 33, stock: 19, inventory: 19, ml: '100', img: 'photo.webp', ...overrides,
});
const item = (overrides = {}) => ({
  name: 'TX-A055', warehouse: 'TX', caption: 'TX-A055 - New York Nights',
  brand: 'Bond No. 9', price: 33, quantity: 1, ml: '100', img: 'photo.webp', ...overrides,
});
const csvFor = (p) => `id,warehouse,name,stock,price,ml,brand\n${p.id},${p.warehouse},${p.name},${p.stock},${p.price},${p.ml},${p.brand}`;
const storageKeys = { cart: 'bestProducts1SharedCartV3', reset: 'bestProducts1SharedCartResetV3' };

// Load the production configuration, production data module and real page handlers.
// This intentionally no longer extracts the obsolete inline scripts from index/cart.html.
// Only DOM rendering and browser APIs are stubbed; inventory, quantity, reconciliation,
// totals, message composition and checkout all execute the shipping implementation.
function createContext({ initialStorage = [], location = 'index.html' } = {}) {
  const memory = new Map(initialStorage);
  const elements = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  let document;
  function element(id = '') {
    if (elements.has(id)) return elements.get(id);
    const classes = new Set();
    const listeners = new Map();
    const attributes = new Map();
    let html = '';
    const el = {
      id, open: false, isConnected: true, hidden: false, disabled: false, checked: true,
      style: {}, dataset: {}, textContent: '', value: '', options: [], children: [], tabIndex: 0,
      classList: {
        add: (...names) => names.forEach((n) => classes.add(n)),
        remove: (...names) => names.forEach((n) => classes.delete(n)),
        contains: (n) => classes.has(n),
        toggle(name, force) {
          const add = force === undefined ? !classes.has(name) : force;
          if (add) classes.add(name); else classes.delete(name);
          return add;
        },
      },
      setAttribute: (name, value) => attributes.set(name, String(value)),
      getAttribute: (name) => attributes.get(name),
      addEventListener(type, handler) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(handler);
      },
      dispatchEvent(event) {
        for (const handler of listeners.get(event.type) || []) handler({ ...event, target: event.target || el });
      },
      append(child) {
        child.parentElement = el;
        if (!el.children.includes(child)) el.children.push(child);
      },
      appendChild(child) { el.append(child); return child; },
      focus() { if (document) document.activeElement = el; },
      contains(target) { return target === el || el.children.includes(target); },
      matches: (selector) => selector === ':disabled' && el.disabled,
      querySelector: () => null,
      querySelectorAll: () => [],
      getClientRects: () => [{ width: 100, height: 50 }],
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 390, bottom: 500, width: 390, height: 500 }),
      scrollIntoView() {},
      showModal() { el.open = true; el.focus(); },
      close() { if (!el.open) return; el.open = false; el.dispatchEvent({ type: 'close', target: el }); },
    };
    Object.defineProperty(el, 'innerHTML', {
      get: () => html,
      set(value) {
        html = String(value);
        el.options = [...html.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)]
          .map((match) => ({ value: match[1], textContent: match[2] }));
      },
    });
    Object.defineProperty(el, 'selectedOptions', {
      get: () => el.options.filter((option) => option.value === el.value),
    });
    elements.set(id, el);
    return el;
  }
  const dialogs = ['product-dialog', 'cart-dialog', 'menu-dialog', 'confirm-dialog'].map(element);
  document = {
    body: element('body'), activeElement: element('focus'),
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
    dispatchEvent(event) {
      for (const handler of documentListeners.get(event.type) || []) handler(event);
    },
    getElementById: element,
    createElement: () => element(`created-${elements.size}`),
    querySelector: () => null,
    querySelectorAll: (selector) => selector === 'dialog' ? dialogs : [],
  };
  const sandbox = {
    console, AbortController, URL, URLSearchParams, ...model, innerHeight: 800,
    Event: class { constructor(type, options = {}) { this.type = type; Object.assign(this, options); } },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: (fn) => fn(), matchMedia: () => ({ matches: false }),
    addEventListener(type, handler) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(handler);
    },
    dispatchEvent(event) { for (const handler of windowListeners.get(event.type) || []) handler(event); },
    scrollTo() {},
    location: { href: location, search: location.includes('?') ? '?' + location.split('?')[1].split('#')[0] : '', hash: location.includes('#') ? '#' + location.split('#')[1] : '', host: 'example.test' },
    document,
    localStorage: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: (key) => memory.delete(key),
    },
    fetch: async () => { throw new Error('offline'); },
    alert: () => { throw new Error('Unexpected native alert'); },
    open: () => { throw new Error('Unexpected unchecked navigation'); },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source('storefront-config.js'), sandbox, { filename: 'storefront-config.js' });
  vm.runInContext(source('db.js'), sandbox, { filename: 'db.js' });
  const app = source('app.mjs').replace(/^import[^\n]*\n/gm, '');
  vm.runInContext(app, sandbox, { filename: 'app.mjs' });
  return {
    sandbox, memory, element,
    evaluate: (code) => vm.runInContext(code, sandbox),
    dispatchDocument: (type, event) => document.dispatchEvent({ type, ...event }),
    dispatchWindow: (type, event = {}) => sandbox.dispatchEvent({ type, ...event }),
    setCart(cart) {
      memory.set(storageKeys.reset, 'done');
      memory.set(storageKeys.cart, JSON.stringify(cart));
    },
    cart: () => plain(sandbox.readStoredCart()),
    approve: () => element('confirm-submit').dispatchEvent({ type: 'click' }),
  };
}

test('stock below 19 and unknown prices are blocked', () => {
  const { sandbox: s } = createContext();
  assert.equal(s.getOrderStockLimit(product({ stock: 1 })), 0);
  assert.equal(s.getOrderStockLimit(product({ stock: 18 })), 0);
  assert.equal(s.getOrderStockLimit(product({ stock: 19 })), 19);
  assert.equal(s.getOrderStockLimit(product({ stock: 0 })), 0);
  assert.equal(s.getOrderStockLimit(product({ stock: '', inventory: '', stock_status: 'AVAILABLE' })), Number.MAX_SAFE_INTEGER);
  assert.equal(s.getOrderStockLimit(product({ stock: 20, stock_status: 'OUT OF STOCK' })), 0);
  assert.equal(s.getOrderStockLimit(product({ stock: 20, stock_status: 'LOW / HIDDEN' })), 0);
  for (const price of ['', 0, -1, NaN, Infinity]) assert.equal(s.getOrderStockLimit(product({ price })), 0);
});

test('homepage cannot add 21 units from a warehouse with 19', () => {
  const { sandbox: s, cart } = createContext();
  s.perfumeDB = [product()];
  const key = s.cartStockKey('TX-A055', 'TX');
  s.addToOrder(key);
  for (let i = 1; i < 21; i++) s.updateProductQuantity(key, 1);
  assert.equal(cart()[0].quantity, 19);
  s.updateProductQuantity(key, -1);
  assert.equal(cart()[0].quantity, 18);
});

test('cart drawer caps additions per warehouse, not across warehouses', () => {
  const { sandbox: s, setCart, cart } = createContext();
  s.perfumeDB = [product(), product({ id: 'NE-A055', warehouse: 'NE', stock: 25 })];
  setCart([item({ quantity: 19 }), item({ name: 'NE-A055', warehouse: 'NE', quantity: 20 })]);
  s.updateCartQuantity(0, 1);
  s.updateCartQuantity(1, 1);
  assert.deepEqual(cart().map((p) => p.quantity), [19, 21]);
  s.updateCartQuantity(0, -1);
  assert.equal(cart()[0].quantity, 18);
});

test('reconciliation caps quantity, refreshes price and asks for review', () => {
  const { sandbox: s } = createContext();
  const before = [item({ quantity: 30, price: 30 })];
  const result = s.reconcileCart(before, [product()]);
  assert.equal(result.items[0].quantity, 19);
  assert.equal(result.items[0].price, 33);
  assert.equal(result.changes.length, 2);
  assert.equal(before[0].quantity, 30);
});

test('unavailable, removed and pending-price items are not sent or moved to another warehouse', () => {
  const { sandbox: s } = createContext();
  for (const products of [[], [product({ stock: 0 })], [product({ stock_status: 'MISSING INVENTORY' })], [product({ price: '' })], [product({ id: 'NE-A055', warehouse: 'NE' })]]) {
    const result = s.reconcileCart([item()], products);
    assert.equal(result.items.length, 0);
    assert.equal(result.changes.length, 1);
  }
});

test('duplicate cart lines share one stock ceiling and invalid quantities are removed', () => {
  const { sandbox: s } = createContext();
  const result = s.reconcileCart([item({ quantity: 15 }), item({ quantity: 15 }), item({ quantity: -5 })], [product()]);
  assert.deepEqual(plain(result.items.map((p) => p.quantity)), [15, 4]);
  assert.equal(result.changes.length, 2);
});

test('size corrections require review while unchanged items do not', () => {
  const { sandbox: s } = createContext();
  assert.equal(s.reconcileCart([item()], [product()]).changes.length, 0);
  const result = s.reconcileCart([item()], [product({ ml: '75' })]);
  assert.equal(result.items[0].ml, '75');
  assert.match(result.changes[0], /size updated to 75ml/);
});

test('warehouse labels normalize and malformed storage cannot crash a cart', () => {
  const { sandbox: s, memory } = createContext();
  assert.equal(s.reconcileCart([item({ warehouse: 'tx Warehouse' })], [product()]).items.length, 1);
  for (const raw of ['broken', '{}', 'null']) {
    memory.set(storageKeys.reset, 'done');
    memory.set(storageKeys.cart, raw);
    assert.deepEqual(plain(s.readStoredCart()), []);
  }
});

test('catalog storage clears old carts once and then uses the shared official-SKU cart', () => {
  const { sandbox: s, memory } = createContext();
  memory.delete(storageKeys.reset);
  for (const key of ['perfumeCart', 'bestProducts1CatalogCartV1', 'bestProducts1CatalogCartV2', 'bestProducts1SkuCartV2']) {
    memory.set(key, JSON.stringify([item({ name: 'B02', warehouse: '' })]));
  }
  assert.deepEqual(plain(s.readStoredCart()), []);
  for (const key of ['perfumeCart', 'bestProducts1CatalogCartV1', 'bestProducts1CatalogCartV2', 'bestProducts1SkuCartV2']) assert.equal(memory.has(key), false);
  s.writeStoredCart([item()]);
  assert.deepEqual(plain(s.readStoredCart().map((entry) => entry.name)), ['TX-A055']);
  assert.equal(JSON.parse(memory.get(storageKeys.cart))[0].name, 'TX-A055');
});

test('search supports accents, volume, aliases and both warehouses with official identifiers', () => {
  const products = [
    product({ id: 'TX-H1', brand: 'Hermès', name: "Terre d'Hermès", ml: '100' }),
    product({ id: 'TX-C1', brand: 'Chanel', name: 'N°5 Eau de Parfum', ml: '100' }),
    product({ id: 'NE-C1', warehouse: 'NE', brand: 'Chanel', name: 'N°5 Eau de Parfum', ml: '100' }),
    product({ id: 'TX-C2', brand: 'Chanel', name: 'Coco', ml: '50' }),
    product({ id: 'TX-Y1', brand: 'Yves Saint Laurent', name: 'Libre', ml: '90' }),
    product({ id: 'TX-B1', brand: 'Bond No. 9', name: 'Tribeca', ml: '100' }),
  ];
  assert.equal(model.searchProducts(products, 'Hermes').length, 1);
  assert.equal(model.searchProducts(products, 'Hermès').length, 1);
  for (const query of ['Chanel 100ml', 'Chanel 100 ml', 'Chanel 100 milliliters']) assert.equal(model.searchProducts(products, query).length, 2);
  assert.equal(model.searchProducts(products, 'YSL Libre').length, 1);
  assert.equal(model.searchProducts(products, 'Bond No 9 100ml').length, 1);
  assert.equal(model.searchProducts(products, 'NE C1').length, 1);
  assert.equal(model.searchProducts(products, 'Chanel 75ml').length, 0);
  assert.deepEqual(model.searchProducts(products, 'love'), []);
  // The redesigned storefront renders one official SKU per warehouse instead of
  // grouping two warehouses behind a legacy internal identifier.
  const matches = model.selectProducts(products, { query: 'Chanel 100ml' });
  assert.deepEqual(matches.map(({ id, warehouse }) => ({ id, warehouse })),
    [{ id: 'TX-C1', warehouse: 'TX' }, { id: 'NE-C1', warehouse: 'NE' }]);
});

test('CSV supports commas, quotes, multiline cells and rejects incomplete rows', () => {
  const { sandbox: s } = createContext();
  const csv = '\uFEFFid,warehouse,name,stock,price,ml\r\nTX-A,TX,"Line 1, ""sample""\nLine 2",20,30,100\r\n';
  const rows = s.parseCSV(csv);
  assert.equal(rows[0].name, 'Line 1, "sample"\nLine 2');
  assert.equal(rows[0].stock, 20);
  assert.throws(() => s.parseCSV('id,name,price\nTX-A,Name'));
  assert.throws(() => s.parseCSV('id,name\nTX-A,"unfinished'));
});

test('simplified sheet derives warehouses, parses launch weights and keeps supplier SKU private', () => {
  const { sandbox: s } = createContext();
  const csv = 'sku,brand,name,target,price,ml,stock,hot_selling_weight,new_arrival_weight,coming_soon_weight,image_url,sku2\nTX-A001,Valentino,Donna,Women,36,100,48,,,,https://example.test/a.webp,供应商SKU一\nNE-B002,Dior,Sauvage,Men,38,100,19,,,3,https://example.test/b.webp,供应商SKU二';
  const rows = s.parseCSV(csv);
  assert.deepEqual(plain(rows.map(({ id, warehouse, gender, stock, coming_soon_weight, img, sku2 }) => ({ id, warehouse, gender, stock, coming_soon_weight, img, sku2 }))), [
    { id: 'TX-A001', warehouse: 'TX', gender: 'Women', stock: 48, coming_soon_weight: '', img: 'https://example.test/a.webp', sku2: '供应商SKU一' },
    { id: 'NE-B002', warehouse: 'NE', gender: 'Men', stock: 19, coming_soon_weight: 3, img: 'https://example.test/b.webp', sku2: '供应商SKU二' },
  ]);
  assert.equal(s.getOrderStockLimit(rows[1]), 19);
  assert.equal(model.searchProducts(rows, '供应商SKU一').length, 0);
  assert.doesNotMatch(s.productCard(rows[0]), /供应商SKU一/);
  assert.doesNotMatch(s.cartLine(item(), 0), /Internal:/);
});

test('coming soon products are weighted, visible in details and never purchasable', async () => {
  const { sandbox: s, cart, element } = createContext();
  const coming = product({ stock: 0, inventory: 0, coming_soon_weight: 2 });
  const unweighted = product({ id: 'TX-A056', stock: 0, inventory: 0 });
  const arrived = product({ id: 'TX-A057', stock: 19, inventory: 19, coming_soon_weight: 1 });
  assert.equal(model.isComingSoon(coming), true);
  assert.equal(model.isComingSoon(unweighted), false);
  assert.equal(model.isComingSoon(arrived), false);
  s.perfumeDB = [coming, unweighted, arrived];
  assert.deepEqual(model.selectProducts(s.perfumeDB, { category: 'ComingSoon' }).map((p) => p.id), ['TX-A055']);
  const ref = s.cartStockKey(coming.id, coming.warehouse);
  const card = s.productCard(coming);
  assert.match(card, /Coming soon/);
  assert.match(card, /Arriving soon/);
  assert.doesNotMatch(card, /data-action="add"/);
  s.renderDetail(coming);
  assert.match(element('product-detail').innerHTML, /Arriving soon/);
  assert.doesNotMatch(element('product-detail').innerHTML, /data-action="add"/);
  s.addToOrder(ref);
  assert.deepEqual(cart(), []);
  s.fetch = async () => ({
    ok: true,
    text: async () => 'id,warehouse,name,stock,price,ml,brand,coming_soon_weight\nTX-C1,TX,Preview,0,,100,Brand,1',
  });
  const [pendingPrice] = await s.fetchLatestProductData();
  assert.equal(pendingPrice.price, '');
  assert.equal(model.isComingSoon(pendingPrice), true);
});

test('all original discount boundaries agree on homepage, order drawer and WhatsApp request', () => {
  const context = createContext();
  const { sandbox: s, element, setCart } = context;
  const quantities = new Set([1, 10, 11, 20, 21, 40, 41, 80, 81, 101]);
  site.tiers.forEach((tier) => {
    quantities.add(tier.min);
    if (Number.isFinite(tier.max)) { quantities.add(tier.max); quantities.add(tier.max + 1); }
  });
  for (const quantity of [...quantities].sort((a, b) => a - b)) {
    const percent = site.tiers.find(({ min, max }) => quantity >= min && quantity <= max).percent;
    const items = [item({ price: 100, quantity })];
    const amount = (100 * quantity * (1 - percent)).toFixed(2);
    const percentLabel = Number((percent * 100).toFixed(2));
    setCart(items);
    s.updateOrderUI();
    assert.equal(element('mobile-order-total').textContent, `$${amount}`, `${quantity} pieces`);
    const summary = model.getOrderSummary(items, s.STOREFRONT_CONFIG.discountTiers);
    assert.equal(summary.discountPercent, percent);
    s.renderCart();
    assert.match(element('cart-body').innerHTML, new RegExp(`Volume discount \\(${String(percentLabel).replace('.', '\\.')}%\\)`));
    assert.ok(element('cart-body').innerHTML.includes(`$${amount}`));
    assert.ok(element('cart-body').innerHTML.includes(site.shipping));
    const message = s.composeOrder(items);
    assert.ok(message.includes(`Discount (${percentLabel}%):`));
    assert.ok(message.includes(`${site.freeShipping ? 'Total Amount' : 'Total Amount (excl. shipping)'}:* $${amount}`));
    assert.ok(message.includes(`Shipping: ${site.shipping}`));
    if (isCatalog) assert.doesNotMatch(message, /FREE/);
  }
  for (const quantity of [0, 1, 2, 3, 101]) assert.equal(s.getShippingCost(quantity), 0);
  assert.doesNotMatch(source('index.html'), /fbq|fbevents|facebook\.com\/tr/i);
  assert.doesNotMatch(source('cart.html'), /fbq|fbevents|facebook\.com\/tr/i);
  if (isCatalog) assert.doesNotMatch(source('index.html'), /free shipping|shipping.{0,30}free|ships free/i);
});

test('discount applies to combined quantity across warehouses with its exact fractional label', () => {
  const { sandbox: s } = createContext();
  const items = [item({ quantity: 6, price: 10 }), item({ name: 'IL-B001', warehouse: 'IL', quantity: 5, price: 10 })];
  const percent = isCatalog ? .035 : .14;
  const discount = (110 * percent).toFixed(2);
  const amount = (110 - Number(discount)).toFixed(2);
  const message = s.composeOrder(items);
  assert.match(message, /Total Quantity: 11 pcs/);
  assert.ok(message.includes(`Discount (${s.formatDiscountPercent(percent)}%): -$${discount}`));
  assert.ok(message.includes(`${site.freeShipping ? 'Total Amount' : 'Total Amount (excl. shipping)'}:* $${amount}`));
});

test('unnamed sheet columns are ignored but duplicate named columns still fail', () => {
  const { sandbox: s } = createContext();
  const [row] = s.parseCSV('sku,brand,name,target,price,ml,stock,hot_selling_weight,new_arrival_weight,coming_soon_weight,image_url,sku2,,\nIL-B001,Louis Vuitton,Afternoon Swim,Unisex,42,100,175,,,,photo.webp,午后漫游,,10');
  assert.equal(row.id, 'IL-B001');
  assert.equal(row.price, 42);
  assert.equal(row.stock, 175);
  assert.equal(row.warehouse, 'IL');
  assert.equal(Object.hasOwn(row, ''), false);
  assert.throws(() => s.parseCSV('sku,name,price,price\nIL-B001,Swim,42,52'), /Duplicate product columns/);
});

test('enlarged product uses the native dialog dismissal lifecycle without reacting to other keys', () => {
  const { sandbox: s, element, dispatchDocument } = createContext();
  assert.match(source('index.html'), /<dialog\b[^>]*id="product-dialog"/);
  s.perfumeDB = [product()];
  s.openProduct(s.cartStockKey('TX-A055', 'TX'));
  assert.equal(element('product-dialog').open, true);
  dispatchDocument('keydown', { key: 'Enter', preventDefault() { throw new Error('Enter must not dismiss product details'); } });
  assert.equal(element('product-dialog').open, true);
  // Escape is a browser-native <dialog> default action in the redesigned page;
  // the real browser release check presses Escape. Here exercise the close event
  // resulting from that default action, including focus/scroll restoration.
  element('product-dialog').close();
  assert.equal(element('product-dialog').open, false);
  assert.equal(element('body').style.overflow, '');
});

test('fresh checkout requests bypass cache and reject bad or duplicate data', async () => {
  const { sandbox: s, memory } = createContext();
  memory.set('perfumeDB_BestProducts_Catalog_Last_Valid_Data_V13', JSON.stringify([product({ price: 1 })]));
  await assert.rejects(() => s.fetchLatestProductData(), /offline/);
  let fetchOptions;
  let fetchUrl;
  s.fetch = async (url, options) => { fetchUrl = url; fetchOptions = options; return { ok: true, text: async () => csvFor(product()) }; };
  assert.equal((await s.fetchLatestProductData())[0].price, 33);
  assert.ok(fetchUrl.includes(site.sheet + `/pub?gid=${site.gid}&single=true&output=csv`));
  assert.ok(memory.has(site.cache));
  assert.equal(fetchOptions.cache, 'no-store');
  assert.ok(fetchOptions.signal);
  for (const bad of ['id,name\nA,Name', csvFor(product()) + '\n' + csvFor(product()).split('\n')[1]]) {
    s.fetch = async () => ({ ok: true, text: async () => bad });
    await assert.rejects(() => s.fetchLatestProductData());
  }
});

test('homepage checkout cannot send old prices or continue while offline', async () => {
  const { sandbox: s, setCart, cart, element } = createContext();
  setCart([item()]);
  await s.checkout();
  assert.equal(s.location.href, 'index.html');
  assert.match(element('cart-validation').textContent, /Nothing has been sent/);
  s.fetch = async () => ({ ok: true, text: async () => csvFor(product({ price: 35 })) });
  await s.checkout();
  assert.equal(s.location.href, 'index.html');
  assert.equal(element('confirm-dialog').open, true);
  assert.equal(cart()[0].price, 33);
  assert.match(element('confirm-message').textContent, /price \$33\.00 → \$35\.00/);
});

test('cart updates require approval and a second checkout check', async () => {
  const { sandbox: s, setCart, cart, element, approve } = createContext();
  setCart([item({ price: 30, quantity: 21 })]);
  let requests = 0;
  s.fetch = async () => { requests++; return { ok: true, text: async () => csvFor(product()) }; };
  await s.checkout();
  assert.equal(s.location.href, 'index.html');
  assert.equal(cart()[0].price, 30);
  assert.match(element('confirm-message').textContent, /quantity 21 → 19/);
  approve();
  assert.equal(cart()[0].price, 33);
  assert.equal(cart()[0].quantity, 19);
  assert.equal(s.location.href, 'index.html');
  await s.checkout();
  assert.equal(requests, 2);
  assert.ok(s.location.href.startsWith(`https://wa.me/${site.whatsapp}?text=`));
  const message = decodeURIComponent(s.location.href);
  assert.ok(message.includes('• TX-A055 × 19 - New York Nights · 100ml'));
  assert.ok(message.includes('Unit $33.00 = Line subtotal *$627.00*'));
});

test('offline cart checkout stays on the page with a retry message', async () => {
  const { sandbox: s, setCart, element } = createContext();
  setCart([item()]);
  s.openCart();
  await s.checkout();
  assert.equal(s.location.href, 'index.html');
  assert.equal(element('cart-dialog').open, true);
  assert.match(element('cart-validation').textContent, /Nothing has been sent/);
});

test('a changed cart in another tab is rechecked instead of overwritten by approval', async () => {
  const { sandbox: s, setCart, cart, approve, element } = createContext();
  setCart([item({ price: 30 })]);
  s.fetch = async () => ({ ok: true, text: async () => csvFor(product()) });
  await s.checkout();
  setCart([item({ quantity: 3 })]);
  approve();
  assert.equal(cart()[0].quantity, 3);
  assert.equal(cart()[0].price, 33);
  assert.equal(s.location.href, 'index.html');
  assert.match(element('cart-validation').textContent, /changed in another window/);
});

test('site configuration preserves its own sheet, WhatsApp, shipping and entire original tier schedule', () => {
  const { sandbox: s, evaluate } = createContext();
  assert.equal(s.STOREFRONT_CONFIG.siteId, site.id);
  assert.equal(String(s.STOREFRONT_CONFIG.whatsappNumber), site.whatsapp);
  assert.equal(s.STOREFRONT_CONFIG.shippingLabel, site.shipping);
  assert.equal(s.STOREFRONT_CONFIG.freeShipping, site.freeShipping);
  // JSON cannot retain Infinity, so compare each tuple directly instead of serializing.
  const tiers = s.STOREFRONT_CONFIG.discountTiers;
  assert.equal(tiers.length, site.tiers.length);
  tiers.forEach((tier, index) => {
    assert.equal(tier.min, site.tiers[index].min);
    assert.equal(tier.max, site.tiers[index].max);
    assert.equal(tier.percent, site.tiers[index].percent);
  });
  assert.equal(evaluate('SHIPPING_LABEL'), site.shipping);
  assert.deepEqual(plain(evaluate('CATALOG_DISCOUNT_TIERS.map(tier => tier.percent)')), site.tiers.map(({ percent }) => percent));
  assert.ok(evaluate('SHEET_URL').includes(site.sheet));
  assert.ok(source('index.html').includes('storefront-config.js'));
});

test('publishing does not clear the existing shared cart or touch the isolated preview cart', () => {
  const saved = [item({ quantity: 7, price: 28 })];
  const preview = JSON.stringify([item({ name: 'IL-B999', warehouse: 'IL', quantity: 2 })]);
  const { sandbox: s, memory, cart, dispatchWindow, element } = createContext({
    initialStorage: [[storageKeys.reset, 'done'], [storageKeys.cart, JSON.stringify(saved)],
      ['bestProducts1CatalogPreviewCartReadyV1', 'done'], ['bestProducts1CatalogPreviewCartV1', preview]],
  });
  assert.deepEqual(cart(), saved);
  assert.equal(element('cart-count').textContent, 7);
  assert.equal(memory.get('bestProducts1CatalogPreviewCartV1'), preview);
  memory.set(storageKeys.cart, JSON.stringify([item({ quantity: 9 })]));
  dispatchWindow('storage', { key: storageKeys.cart });
  assert.equal(element('cart-count').textContent, 9);
  dispatchWindow('pageshow');
  assert.equal(cart()[0].quantity, 9);
  assert.equal(memory.get(storageKeys.reset), 'done');
  assert.doesNotMatch(source('app.mjs'), /CatalogPreviewCart|CatalogPreviewCartReady/);
  s.writeStoredCart([item({ quantity: 4 })]);
  assert.equal(memory.get('bestProducts1CatalogPreviewCartV1'), preview);
});

test('Coming Soon with missing stock and legacy AVAILABLE status is never purchasable or sent', () => {
  const { sandbox: s, setCart, cart } = createContext();
  const coming = product({ stock: '', inventory: '', stock_status: 'AVAILABLE', coming_soon_weight: 1 });
  assert.equal(model.isComingSoon(coming), true);
  assert.equal(s.getOrderStockLimit(coming), 0);
  assert.deepEqual(model.selectProducts([coming]), []);
  assert.deepEqual(model.selectProducts([coming], { category: 'HotSelling', stockOnly: false }), []);
  assert.equal(model.selectProducts([coming], { category: 'ComingSoon' }).length, 1);
  s.perfumeDB = [coming];
  s.addToOrder(s.cartStockKey(coming.id, coming.warehouse));
  assert.deepEqual(cart(), []);
  setCart([item()]);
  const result = s.reconcileCart(cart(), [coming]);
  assert.equal(result.items.length, 0);
  assert.equal(result.changes.length, 1);
  assert.equal(s.getOrderStockLimit(product({ coming_soon_weight: 1 })), 19);
});

test('cent rounding agrees on drawer, homepage, message and subtotal minus discount', () => {
  const { sandbox: s, setCart, element } = createContext();
  const items = [item({ quantity: 11, price: 1.005 })];
  setCart(items);
  const summary = model.getOrderSummary(items, site.tiers);
  assert.equal(summary.subtotal, 11.11);
  const percent = isCatalog ? .035 : .14;
  const cents = Math.round(1111 * percent);
  assert.equal(summary.discountAmount, cents / 100);
  assert.equal(summary.totalAmount, (1111 - cents) / 100);
  assert.equal(Math.round(summary.subtotal * 100) - Math.round(summary.discountAmount * 100), Math.round(summary.totalAmount * 100));
  s.updateOrderUI();
  s.renderCart();
  const expected = '$' + summary.totalAmount.toFixed(2);
  assert.equal(element('mobile-order-total').textContent, expected);
  const message = s.composeOrder(items);
  assert.ok(message.includes('Subtotal: $11.11'));
  assert.ok(message.includes(`Discount (${s.formatDiscountPercent(percent)}%): -$${summary.discountAmount.toFixed(2)}`));
  assert.ok(message.includes((site.freeShipping ? 'Total Amount:* ' : 'Total Amount (excl. shipping):* ') + expected));
  assert.ok(message.includes('• TX-A055 × 11 - New York Nights · 100ml'));
  assert.ok(message.includes('Unit $1.01 = Line subtotal *$11.11*'));
  assert.ok(element('cart-body').innerHTML.includes('$1.01'));
  assert.ok(s.productCard(product({ price: 1.005 })).includes('$1.01'));
  assert.ok(element('cart-body').innerHTML.includes(expected));
});

test('old cart.html links redirect to the new order drawer without duplicating legacy cart logic', () => {
  const html = source('cart.html');
  assert.match(html, /\.\/\?cart=1/);
  assert.match(html, /<meta[^>]*http-equiv=["']refresh["']/i);
  assert.match(html, /location\.replace\(/);
  assert.doesNotMatch(html, /function (toggleSidebar|calculateTotals|updateQty)|bestProducts1SharedCartResetV4|perfumeCart/);
  assert.doesNotMatch(html, /fbq|fbevents|facebook\.com\/tr/i);
  const context = { location: { replace(value) { context.redirect = value; } } };
  vm.createContext(context);
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length, 1);
  vm.runInContext(scripts[0], context);
  assert.equal(context.redirect, './?cart=1');
  const { sandbox: s, element } = createContext({ location: 'index.html?cart=1' });
  s.perfumeDB = [product()];
  s.renderHome();
  assert.equal(element('cart-dialog').open, true);
});

test('first Add and repeated quantity changes use actual saved quantity and visible receipts', () => {
  const { sandbox: s, element, cart } = createContext();
  s.perfumeDB = [product({ stock: 50 })];
  const key = s.cartStockKey('TX-A055', 'TX');
  s.addToOrder(key);
  assert.equal(cart()[0].quantity, 1);
  assert.equal(element('toast').textContent, 'Added 1 · TX-A055 now 1 in your order');
  s.addToOrder(key);
  assert.equal(cart()[0].quantity, 1);
  for (let quantity = 2; quantity <= 9; quantity++) {
    s.updateProductQuantity(key, 1);
    assert.equal(cart()[0].quantity, quantity);
    assert.equal(element('toast').textContent, `Added 1 · TX-A055 now ${quantity} in your order`);
    assert.equal(element('cart-count').textContent, quantity);
  }
  s.updateCartQuantity(0, -1);
  assert.equal(cart()[0].quantity, 8);
  assert.equal(element('toast').textContent, 'Updated · TX-A055 now 8 in your order');
  for (let count = 0; count < 8; count++) s.updateProductQuantity(key, -1);
  assert.deepEqual(cart(), []);
  assert.equal(element('mobile-order-bar').hidden, true);
  assert.equal(element('toast').textContent, 'TX-A055 removed from your order');
});

test('checkout checking prevents Add and quantity mutations until a live check completes', async () => {
  const { sandbox: s, setCart, cart } = createContext();
  s.perfumeDB = [product(), product({ id: 'IL-B001', warehouse: 'IL' })];
  setCart([item()]);
  let resolveResponse;
  s.fetch = () => new Promise((resolve) => { resolveResponse = resolve; });
  const checking = s.checkout();
  s.addToOrder(s.cartStockKey('IL-B001', 'IL'));
  s.updateProductQuantity(s.cartStockKey('TX-A055', 'TX'), 1);
  s.updateProductQuantity(s.cartStockKey('TX-A055', 'TX'), -1);
  s.updateCartQuantity(0, 1);
  s.updateCartQuantity(0, -1);
  assert.deepEqual(cart(), [item()]);
  resolveResponse({ ok: true, text: async () => csvFor(product()) });
  await checking;
  assert.ok(s.location.href.startsWith(`https://wa.me/${site.whatsapp}?text=`));
});

test('gift-set x4 and x6 labels never precede or replace the official SKU purchase quantity', () => {
  const { sandbox: s } = createContext();
  const gifts = [
    item({ name: 'TX-A004', caption: 'TX-A004 - Discovery Gift Set x4', ml: '30ml*4', quantity: 3, price: 12 }),
    item({ name: 'IL-B006', warehouse: 'IL', caption: 'IL-B006 - Mini Fragrance Set x6', ml: '10ml×6', quantity: 2, price: 18 }),
  ];
  const message = s.composeOrder(gifts);
  const productLines = message.split('\n').filter((line) => line.startsWith('• '));
  assert.deepEqual(productLines, [
    '• TX-A004 × 3 - Discovery Gift Set x4 · 30ml*4',
    '• IL-B006 × 2 - Mini Fragrance Set x6 · 10ml×6',
  ]);
  // A parser's first SKU + multiplication pair must be the ordered quantity,
  // not the number of miniature bottles contained inside the gift set.
  assert.deepEqual(productLines.map((line) => {
    const match = line.match(/^• ([A-Z]+-[A-Z0-9]+) × (\d+) - /);
    assert.ok(match);
    return { sku: match[1], quantity: Number(match[2]) };
  }), [{ sku: 'TX-A004', quantity: 3 }, { sku: 'IL-B006', quantity: 2 }]);
  const unitLines = message.split('\n').filter((line) => line.trim().startsWith('Unit '));
  assert.deepEqual(unitLines, [
    '  Unit $12.00 = Line subtotal *$36.00*',
    '  Unit $18.00 = Line subtotal *$36.00*',
  ]);
  assert.ok(unitLines.every((line) => !line.includes('×') && !/\s[x*]\s?\d/i.test(line)));
  assert.ok(message.includes('Total Quantity: 5 pcs'));
});

test('desktop and mobile share one discounted bottom summary that hides for an empty order', () => {
  const { sandbox: s, setCart, element } = createContext();
  const items = [item({ quantity: 11, price: 33 })];
  setCart(items);
  s.updateOrderUI();
  const summary = model.getOrderSummary(items, site.tiers);
  assert.equal(element('mobile-order-bar').hidden, false);
  assert.equal(element('mobile-order-total').textContent, '$' + summary.totalAmount.toFixed(2));
  assert.equal(element('mobile-order-quantity').textContent, `11 items · ${site.freeShipping ? 'free shipping' : 'excl. shipping'}`);
  assert.equal(element('body').classList.contains('has-order'), true);
  assert.equal([...source('index.html').matchAll(/id="mobile-order-bar"/g)].length, 1);
  assert.match(source('styles.css'), /@media\(min-width:651px\)\{\s*\.mobile-order-bar\{display:block/);
  assert.match(source('styles.css'), /body\.has-order>\.toast\{bottom:/);
  setCart([]);
  s.updateOrderUI();
  assert.equal(element('mobile-order-bar').hidden, true);
  assert.equal(element('body').classList.contains('has-order'), false);
});

test('closing a cleared order returns focus to the header instead of the hidden bottom bar', () => {
  const { sandbox: s, setCart, element } = createContext();
  const opener = element('bottom-order-trigger');
  const header = element('header-order-trigger');
  s.document.querySelector = (selector) => selector === '.header-actions [data-action="open-cart"]' ? header : null;
  setCart([item()]);
  s.document.activeElement = opener;
  s.openCart();
  opener.getClientRects = () => [];
  setCart([]);
  s.updateOrderUI();
  element('cart-dialog').close();
  assert.equal(s.document.activeElement, header);
  assert.equal(element('mobile-order-bar').hidden, true);
});
test('product details show one main photo without a duplicate thumbnail', () => {
  const { sandbox: s, element, setCart } = createContext();
  const single = product();
  const missing = product({ img: '' });
  const coming = product({ stock: 0, inventory: 0, coming_soon_weight: 2 });
  for (const p of [single, missing, coming]) {
    s.renderDetail(p);
    const html = element('product-detail').innerHTML;
    assert.equal([...html.matchAll(/<img\b/g)].length, p.img ? 1 : 0);
    assert.doesNotMatch(html, /detail-thumbnail/);
    assert.match(html, /class="detail-photo"/);
    assert.ok(html.includes(p.id));
    if (!p.img) assert.match(html, /Product photo unavailable/);
    if (p === coming) {
      assert.match(html, /Arriving soon/);
      assert.doesNotMatch(html, /data-action="add"/);
    }
  }
  setCart([item({ quantity: 2 })]);
  s.renderDetail(single);
  const added = element('product-detail').innerHTML;
  assert.equal([...added.matchAll(/<img\b/g)].length, 1);
  assert.doesNotMatch(added, /detail-thumbnail/);
  assert.match(added, /Quantity in order/);
  assert.match(added, /2 in your order/);
  assert.match(added, /View order/);
});
