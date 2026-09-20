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
    document: { addEventListener() {}, getElementById: element, createElement: () => element(`created-${elements.size}`), querySelector: element, querySelectorAll: () => [], activeElement: element('focus') },
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
  return { sandbox, memory, element, setCart: (cart) => memory.set('perfumeCart', JSON.stringify(cart)), cart: () => plain(sandbox.readStoredCart()) };
}

test('positive stock is orderable while zero stock and unknown prices are blocked', () => {
  const { sandbox: s } = createContext();
  assert.equal(s.getOrderStockLimit(product({ stock: 1 })), 1);
  assert.equal(s.getOrderStockLimit(product({ stock: 14 })), 14);
  assert.equal(s.getOrderStockLimit(product({ stock: 0 })), 0);
  assert.equal(s.getOrderStockLimit(product({ stock: '', inventory: '', stock_status: 'AVAILABLE' })), Number.MAX_SAFE_INTEGER);
  assert.equal(s.getOrderStockLimit(product({ stock: 20, stock_status: 'OUT OF STOCK' })), 0);
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
    memory.set('perfumeCart', raw);
    assert.deepEqual(plain(s.readStoredCart()), []);
  }
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

test('current sheet fields map to storefront fields and warehouses come from sheet data', () => {
  const { sandbox: s } = createContext();
  const csv = 'sku,warehouse,brand,name,target,price,ml,#REF!,stock_status,image_url\nTX-A001,TX,Valentino,Donna,Women,36,100,48,,https://example.test/a.webp\nNE-B002,NE,Dior,Sauvage,Men,38,100,,AVAILABLE,https://example.test/b.webp';
  const rows = s.parseCSV(csv);
  assert.deepEqual(plain(rows.map(({ id, warehouse, gender, stock, img }) => ({ id, warehouse, gender, stock, img }))), [
    { id: 'TX-A001', warehouse: 'TX', gender: 'Women', stock: 48, img: 'https://example.test/a.webp' },
    { id: 'NE-B002', warehouse: 'NE', gender: 'Men', stock: '', img: 'https://example.test/b.webp' },
  ]);
  assert.equal(s.getOrderStockLimit(rows[1]), Number.MAX_SAFE_INTEGER);
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

const csvFor = (p) => `id,warehouse,name,stock,price,ml,brand\n${p.id},${p.warehouse},${p.name},${p.stock},${p.price},${p.ml},${p.brand}`;
test('fresh checkout requests bypass cache and reject bad or duplicate data', async () => {
  const { sandbox: s, memory } = createContext();
  memory.set('perfumeDB_BestProducts_Last_Valid_Data_V12', JSON.stringify([product({ price: 1 })]));
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
