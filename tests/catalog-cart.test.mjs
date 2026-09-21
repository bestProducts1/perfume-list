import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (file) => fs.readFileSync(new URL(file, root), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const product = (overrides = {}) => ({
  id: 'TX-A055', warehouse: 'TX', name: 'New York Nights', brand: 'Bond No. 9',
  price: 33, stock: 19, inventory: 19, ml: '100', img: 'photo.webp', ...overrides,
});
const item = (overrides = {}) => ({
  name: 'TX-A055', warehouse: 'TX', caption: 'TX-A055 - New York Nights',
  brand: 'Bond No. 9', price: 33, quantity: 1, ml: '100', img: 'photo.webp', ...overrides,
});

function createContext(page = 'index.html') {
  const memory = new Map();
  const elements = new Map();
  const documentListeners = new Map();
  function element(id = '') {
    if (elements.has(id)) return elements.get(id);
    const classes = new Set();
    const el = {
      style: {}, dataset: {}, innerHTML: '', textContent: '', disabled: false,
      classList: { add: (...names) => names.forEach((n) => classes.add(n)), remove: (...names) => names.forEach((n) => classes.delete(n)), contains: (n) => classes.has(n), toggle() {} },
      setAttribute() {}, addEventListener() {}, appendChild() {}, focus() {},
      querySelector: (selector) => element(id + selector), querySelectorAll: () => [],
    };
    elements.set(id, el);
    return el;
  }
  const sandbox = {
    console, AbortController, URL, Event: class {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: (fn) => fn(),
    addEventListener() {}, dispatchEvent() {}, scrollTo() {},
    location: { href: page, host: 'example.test' },
    document: {
      addEventListener(type, handler) {
        if (!documentListeners.has(type)) documentListeners.set(type, []);
        documentListeners.get(type).push(handler);
      },
      getElementById: element,
      createElement: () => element(`created-${elements.size}`),
      querySelector: element,
      querySelectorAll: () => [],
      activeElement: element('focus'),
    },
    localStorage: { getItem: (key) => memory.get(key) ?? null, setItem: (key, val) => memory.set(key, String(val)), removeItem: (key) => memory.delete(key) },
    fetch: async () => { throw new Error('offline'); },
    alert: () => { throw new Error('Unexpected native alert'); },
    open: () => { throw new Error('Unexpected unchecked navigation'); },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source('db.js'), sandbox);
  const scripts = [...source(page).matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1]).filter((code) => code.includes(page === 'index.html' ? 'const WHATSAPP_NUMBER' : 'function toggleSidebar'));
  assert.equal(scripts.length, 1);
  vm.runInContext(scripts[0], sandbox);
  return {
    sandbox,
    memory,
    element,
    dispatchDocument(type, event) {
      (documentListeners.get(type) || []).forEach((handler) => handler(event));
    },
    setCart: (cart) => {
      memory.set('bestProducts1SharedCartResetV3', 'done');
      memory.set('bestProducts1SharedCartV3', JSON.stringify(cart));
    },
    cart: () => plain(sandbox.readStoredCart()),
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
  for (let i = 0; i < 21; i++) s.updateItemQty('A055::TX', 1);
  assert.equal(cart()[0].quantity, 19);
  s.updateItemQty('A055::TX', -1);
  assert.equal(cart()[0].quantity, 18);
});

test('cart page caps additions per warehouse, not across warehouses', () => {
  const { sandbox: s, setCart, cart } = createContext('cart.html');
  s.perfumeDB = [product(), product({ id: 'NE-A055', warehouse: 'NE', stock: 25 })];
  setCart([item({ quantity: 19 }), item({ name: 'NE-A055', warehouse: 'NE', quantity: 20 })]);
  s.updateQty(0, 1);
  s.updateQty(1, 1);
  assert.deepEqual(cart().map((p) => p.quantity), [19, 21]);
  s.updateQty(0, -1);
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
    memory.set('bestProducts1SharedCartResetV3', 'done');
    memory.set('bestProducts1SharedCartV3', raw);
    assert.deepEqual(plain(s.readStoredCart()), []);
  }
});

test('catalog storage clears old carts once and then uses the shared official-SKU cart', () => {
  const { sandbox: s, memory } = createContext();
  memory.set('perfumeCart', JSON.stringify([item({ name: 'B02', warehouse: '' })]));
  memory.set('bestProducts1CatalogCartV1', JSON.stringify([item()]));
  memory.set('bestProducts1CatalogCartV2', JSON.stringify([item()]));
  memory.set('bestProducts1SkuCartV2', JSON.stringify([item()]));
  assert.deepEqual(plain(s.readStoredCart()), []);
  assert.equal(memory.has('perfumeCart'), false);
  assert.equal(memory.has('bestProducts1CatalogCartV1'), false);
  assert.equal(memory.has('bestProducts1CatalogCartV2'), false);
  assert.equal(memory.has('bestProducts1SkuCartV2'), false);

  s.writeStoredCart([item()]);
  assert.deepEqual(plain(s.readStoredCart().map((entry) => entry.name)), ['TX-A055']);
  assert.equal(JSON.parse(memory.get('bestProducts1SharedCartV3'))[0].name, 'TX-A055');
});

test('search supports accents, volume, aliases and both warehouses', () => {
  const { sandbox: s } = createContext();
  const products = [
    product({ id: 'TX-H1', brand: 'Hermès', name: "Terre d'Hermès", ml: '100' }),
    product({ id: 'TX-C1', brand: 'Chanel', name: 'N°5 Eau de Parfum', ml: '100' }),
    product({ id: 'NE-C1', warehouse: 'NE', brand: 'Chanel', name: 'N°5 Eau de Parfum', ml: '100' }),
    product({ id: 'TX-C2', brand: 'Chanel', name: 'Coco', ml: '50' }),
    product({ id: 'TX-Y1', brand: 'Yves Saint Laurent', name: 'Libre', ml: '90' }),
    product({ id: 'TX-B1', brand: 'Bond No. 9', name: 'Tribeca', ml: '100' }),
  ];
  s.perfumeDB = products;
  assert.equal(s.searchProducts(products, 'Hermes').length, 1);
  assert.equal(s.searchProducts(products, 'Hermès').length, 1);
  for (const query of ['Chanel 100ml', 'Chanel 100 ml', 'Chanel 100 milliliters']) assert.equal(s.searchProducts(products, query).length, 2);
  assert.equal(s.searchProducts(products, 'YSL Libre').length, 1);
  assert.equal(s.searchProducts(products, 'Bond No 9 100ml').length, 1);
  assert.equal(s.searchProducts(products, 'NE C1').length, 1);
  assert.equal(s.searchProducts(products, 'Chanel 75ml').length, 0);
  assert.equal(s.detectBrandIntent('love'), null);
  assert.equal(s.groupProductsForDisplay(s.searchProducts(products, 'Chanel 100ml'), products).length, 1);
});

test('CSV supports commas, quotes, multiline cells and rejects incomplete rows', () => {
  const { sandbox: s } = createContext();
  const csv = '\uFEFFid,warehouse,name,stock,price,ml\r\nTX-A,TX,"Line 1, \"\"sample\"\"\nLine 2",20,30,100\r\n';
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
  assert.equal(s.searchProducts(rows, '供应商SKU一').length, 0);
});

test('coming soon products are weighted, visible in details and never purchasable', async () => {
  const { sandbox: s, cart } = createContext();
  const coming = product({ stock: 0, inventory: 0, coming_soon_weight: 2 });
  const unweighted = product({ id: 'TX-A056', stock: 0, inventory: 0 });
  const arrived = product({ id: 'TX-A057', stock: 19, inventory: 19, coming_soon_weight: 1 });
  assert.equal(s.isComingSoonProduct(coming), true);
  assert.equal(s.isComingSoonProduct(unweighted), false);
  assert.equal(s.isComingSoonProduct(arrived), false);
  s.perfumeDB = [coming, unweighted, arrived];
  const ranked = s.getRankedProducts(s.perfumeDB.filter(s.isComingSoonProduct), 'coming_soon_weight');
  assert.deepEqual(plain(ranked.map((p) => p.id)), ['TX-A055']);
  const ref = s.getProductReference(coming);
  assert.match(s.getAddButtonHtml(ref), /COMING SOON/);
  assert.match(s.getProductAvailabilityHtml(coming), /Arriving Soon/);
  s.updateItemQty(ref, 1);
  assert.deepEqual(cart(), []);
  s.fetch = async () => ({
    ok: true,
    text: async () => 'id,warehouse,name,stock,price,ml,brand,coming_soon_weight\nTX-C1,TX,Preview,0,,100,Brand,1',
  });
  const [pendingPrice] = await s.fetchLatestProductData();
  assert.equal(pendingPrice.price, '');
  assert.equal(s.isComingSoonProduct(pendingPrice), true);
});

test('shipping is always free and both pages preserve the original discount schedule', () => {
  const { sandbox: home } = createContext();
  const { sandbox: cart } = createContext('cart.html');
  for (const quantity of [0, 1, 2, 3, 101]) assert.equal(home.getShippingCost(quantity), 0);
  const expected = [0, 0.03, 0.05, 0.08, 0.14, 0.24, 0.26, 0.29, 0.32, 0.35];
  assert.deepEqual(plain(vm.runInContext('discountTiers.map((tier) => tier.percent)', home)), expected);
  assert.deepEqual(plain(vm.runInContext('tiers.map((tier) => tier.percent)', cart)), expected);
  assert.doesNotMatch(source('cart.html'), /fbq|fbevents|facebook\.com\/tr/i);
});

test('Escape closes the enlarged product card without reacting to other keys', () => {
  const { sandbox: s, element, dispatchDocument } = createContext();
  s.setupModalKeyboardControls();
  const modal = element('modal');
  modal.classList.add('open');
  dispatchDocument('keydown', { key: 'Enter', preventDefault() {} });
  assert.equal(modal.classList.contains('open'), true);
  let prevented = false;
  dispatchDocument('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(modal.classList.contains('open'), false);
  assert.equal(prevented, true);
});

const csvFor = (p) => `id,warehouse,name,stock,price,ml,brand\n${p.id},${p.warehouse},${p.name},${p.stock},${p.price},${p.ml},${p.brand}`;
test('fresh checkout requests bypass cache and reject bad or duplicate data', async () => {
  const { sandbox: s, memory } = createContext();
  memory.set('perfumeDB_BestProducts_Catalog_Last_Valid_Data_V13', JSON.stringify([product({ price: 1 })]));
  await assert.rejects(() => s.fetchLatestProductData(), /offline/);
  let fetchOptions;
  s.fetch = async (_url, options) => { fetchOptions = options; return { ok: true, text: async () => csvFor(product()) }; };
  assert.equal((await s.fetchLatestProductData())[0].price, 33);
  assert.equal(fetchOptions.cache, 'no-store');
  assert.ok(fetchOptions.signal);
  for (const bad of ['id,name\nA,Name', csvFor(product()) + '\n' + csvFor(product()).split('\n')[1]]) {
    s.fetch = async () => ({ ok: true, text: async () => bad });
    await assert.rejects(() => s.fetchLatestProductData());
  }
});

test('homepage checkout cannot send old prices or continue while offline', async () => {
  const { sandbox: s, setCart } = createContext();
  setCart([item()]);
  await s.sendOrderToWhatsApp();
  assert.equal(s.location.href, 'index.html');
  s.fetch = async () => ({ ok: true, text: async () => csvFor(product({ price: 35 })) });
  await s.sendOrderToWhatsApp();
  assert.equal(s.location.href, 'cart.html');
});

test('cart updates require approval and a second checkout check', async () => {
  const { sandbox: s, setCart, cart, element } = createContext('cart.html');
  setCart([item({ price: 30, quantity: 21 })]);
  s.fetch = async () => ({ ok: true, text: async () => csvFor(product()) });
  await s.reviewLatestCart(true);
  assert.equal(s.location.href, 'cart.html');
  assert.equal(cart()[0].price, 30);
  assert.match(element('cart-confirm-message').textContent, /quantity 21 → 19/);
  s.confirmCartAction();
  assert.equal(cart()[0].price, 33);
  assert.equal(cart()[0].quantity, 19);
  assert.equal(s.location.href, 'cart.html');
  await s.reviewLatestCart(true);
  assert.match(s.location.href, /^https:\/\/wa.me\//);
  assert.match(decodeURIComponent(s.location.href), /Unit \$33.00 × 19/);
});

test('offline cart checkout stays on the page with a retry message', async () => {
  const { sandbox: s, setCart, element } = createContext('cart.html');
  setCart([item()]);
  await s.reviewLatestCart(true);
  assert.equal(s.location.href, 'cart.html');
  assert.match(element('cart-validation-status').textContent, /Nothing has been sent/);
});

test('a changed cart in another tab is rechecked instead of overwritten by approval', async () => {
  const { sandbox: s, setCart, cart } = createContext('cart.html');
  setCart([item({ price: 30 })]);
  s.fetch = async () => ({ ok: true, text: async () => csvFor(product()) });
  await s.reviewLatestCart();
  setCart([item({ quantity: 3 })]);
  s.confirmCartAction();
  await Promise.resolve();
  assert.equal(cart()[0].quantity, 3);
});
