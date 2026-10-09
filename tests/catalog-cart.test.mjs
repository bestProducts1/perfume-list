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
const storageKeys = {
  cart: `bestProducts1:${site.id}:cart:v1`,
  otherCart: `bestProducts1:${isCatalog ? 'perfume-list' : 'catalog'}:cart:v1`,
  sharedCart: 'bestProducts1SharedCartV3',
  sharedReset: 'bestProducts1SharedCartResetV3',
  inquiry: 'bestProducts1:sku:inquiry:v1',
  receipt: `bestProducts1:${site.id}:sku-inquiry-applied:v1`,
};

// Load the production configuration, production data module and real page handlers.
// This intentionally no longer extracts the obsolete inline scripts from index/cart.html.
// Only DOM rendering and browser APIs are stubbed; inventory, quantity, reconciliation,
// totals, message composition and checkout all execute the shipping implementation.
function createContext({ initialStorage = [], sharedStorage, storefrontId = site.id, location = 'index.html' } = {}) {
  const memory = sharedStorage || new Map(initialStorage);
  const storageAccess = [];
  const cartKey = `bestProducts1:${storefrontId}:cart:v1`;
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
      style: {}, dataset: {}, textContent: '', value: '', options: [], children: [], tabIndex: 0, innerHTMLWrites: 0,
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
      blur() {
        if (document?.activeElement !== el) return;
        document.activeElement = document.body;
        document.dispatchEvent({ type: 'focusout', target: el });
      },
      select() { el.selectionStart = 0; el.selectionEnd = el.value.length; },
      setSelectionRange(start, end) { el.selectionStart = start; el.selectionEnd = end; },
      closest(selector) {
        if (selector === '[data-action]') return el.dataset.action ? el : el.parentElement?.closest(selector) || null;
        if (selector === '.quantity-stepper') return classes.has('quantity-stepper') ? el : el.parentElement?.closest(selector) || null;
        return null;
      },
      contains(target) { return target === el || el.children.some((child) => child === target || child.contains?.(target)); },
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
      configurable: true,
      get: () => html,
      set(value) {
        el.innerHTMLWrites++;
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
      getItem: (key) => { storageAccess.push(['get', key]); return memory.get(key) ?? null; },
      setItem: (key, value) => { storageAccess.push(['set', key]); memory.set(key, String(value)); },
      removeItem: (key) => { storageAccess.push(['remove', key]); memory.delete(key); },
    },
    fetch: async () => { throw new Error('offline'); },
    alert: () => { throw new Error('Unexpected native alert'); },
    open: () => { throw new Error('Unexpected unchecked navigation'); },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source('storefront-config.js'), sandbox, { filename: 'storefront-config.js' });
  if (storefrontId !== site.id) {
    sandbox.STOREFRONT_CONFIG = Object.freeze({ ...sandbox.STOREFRONT_CONFIG, siteId: storefrontId });
  }
  vm.runInContext(source('inquiry-sync.js'), sandbox, { filename: 'inquiry-sync.js' });
  vm.runInContext(source('db.js'), sandbox, { filename: 'db.js' });
  const app = source('app.mjs').replace(/^import[^\n]*\n/gm, '');
  vm.runInContext(app, sandbox, { filename: 'app.mjs' });
  return {
    sandbox, memory, element, storageAccess, cartKey,
    evaluate: (code) => vm.runInContext(code, sandbox),
    dispatchDocument: (type, event) => document.dispatchEvent({ type, ...event }),
    dispatchWindow: (type, event = {}) => sandbox.dispatchEvent({ type, ...event }),
    setCart(cart) {
      memory.set(cartKey, JSON.stringify(cart));
    },
    cart: () => plain(sandbox.readStoredCart()),
    approve: () => element('confirm-submit').dispatchEvent({ type: 'click' }),
  };
}

// Deliberately small DOM fixture: quantity controls are real mock objects whose
// identity survives text/disabled changes. A component innerHTML replacement
// remounts its controls, so accidental full rendering cannot pass silently.
function mountQuantityActions(context, p, { detail = false } = {}) {
  const { sandbox: s, element } = context;
  const suffix = `${detail ? 'detail' : 'card'}-${s.cartStockKey(p.id, p.warehouse)}`;
  const actions = element(`actions-${suffix}`);
  const html = Object.getOwnPropertyDescriptor(actions, 'innerHTML');
  let revision = 0;
  let nodes = {};
  function refresh(value) {
    revision++;
    nodes = {};
    actions.children = [];
    const create = (name) => element(`${suffix}-${name}-${revision}`);
    if (value.includes('quantity-stepper')) {
      nodes.stepper = create('stepper');
      nodes.stepper.classList.add('quantity-stepper');
      nodes.stepper.dataset.stockKey = s.cartStockKey(p.id, p.warehouse);
      nodes.input = create('input');
      nodes.input.dataset = { action: 'set-quantity', id: s.cartStockKey(p.id, p.warehouse) };
      nodes.input.value = value.match(/<input\b[^>]*value="(\d+)"/)?.[1] || '0';
      nodes.input.disabled = /<input\b[^>]*\bdisabled/.test(value);
      for (const action of ['product-minus', 'product-plus']) {
        const button = create(action);
        button.dataset = { action, id: s.cartStockKey(p.id, p.warehouse) };
        button.disabled = new RegExp(`data-action="${action}"[^>]*\\bdisabled`).test(value);
        nodes[action] = button;
        nodes.stepper.append(button);
      }
      nodes.stepper.append(nodes.input);
      nodes.stepper.querySelector = (selector) => selector === '.quantity-input' ? nodes.input
        : selector === '[data-action="product-minus"]' ? nodes['product-minus']
        : selector === '[data-action="product-plus"]' ? nodes['product-plus'] : null;
      actions.append(nodes.stepper);
    }
    if (/data-action="add"/.test(value) || /class="primary-button detail-add"/.test(value)) {
      nodes.add = create('add');
      nodes.add.dataset = /data-action="add"/.test(value) ? { action: 'add', id: s.cartStockKey(p.id, p.warehouse) } : {};
      nodes.add.disabled = /<button\b[^>]*\bdisabled/.test(value);
      actions.append(nodes.add);
    }
    if (value.includes('soon-note')) { nodes.soon = create('soon'); actions.append(nodes.soon); }
    if (value.includes('class="in-order"')) { nodes.inOrder = create('in-order'); actions.append(nodes.inOrder); }
    if (value.includes('data-action="close-product"')) {
      nodes.continue = create('continue'); nodes.continue.dataset.action = 'close-product'; actions.append(nodes.continue);
    }
  }
  Object.defineProperty(actions, 'innerHTML', {
    configurable: true,
    get: html.get,
    set(value) { html.set(value); refresh(String(value)); },
  });
  actions.querySelector = (selector) => selector === '.quantity-stepper' ? nodes.stepper || null
    : selector === '[data-action="add"]' ? nodes.add?.dataset.action === 'add' ? nodes.add : null
    : selector === '.detail-add' ? nodes.add || null
    : selector === '.in-order' ? nodes.inOrder || null
    : selector === '.soon-note' ? nodes.soon || null : null;
  actions.querySelectorAll = (selector) => selector === '[data-action]'
    ? [nodes.add, nodes['product-minus'], nodes.input, nodes['product-plus'], nodes.continue].filter((node) => node?.dataset.action) : [];
  actions.innerHTML = detail ? s.detailOrderActionsHtml(p) : s.productActionsHtml(p);
  return { actions, get nodes() { return nodes; } };
}

function mountStableCard(context, p) {
  const { sandbox: s, element } = context;
  const root = element('products');
  const card = element(`card-${s.cartStockKey(p.id, p.warehouse)}`);
  const photo = element(`photo-${s.cartStockKey(p.id, p.warehouse)}`);
  const inOrder = element(`in-order-${s.cartStockKey(p.id, p.warehouse)}`);
  const mounted = mountQuantityActions(context, p);
  card.dataset = { stockKey: s.cartStockKey(p.id, p.warehouse), productId: p.id };
  card.append(photo); card.append(mounted.actions); card.append(inOrder); root.append(card);
  card.querySelector = (selector) => selector === '.product-actions' ? mounted.actions
    : selector === '.in-order' ? inOrder : selector === 'img' ? photo : null;
  root.querySelectorAll = (selector) => selector === '.product-card' ? root.children
    : selector === '[data-action]' ? root.children.flatMap((child) => child.querySelector('.product-actions').querySelectorAll(selector)) : [];
  return { ...mounted, card, photo, inOrder, root, get nodes() { return mounted.nodes; } };
}

function mountStableDetail(context, p) {
  const { element } = context;
  const root = element('product-detail');
  element('product-dialog').append(root);
  const body = element('detail-body-fixture');
  const photo = element('detail-photo-fixture');
  body.scrollTop = 180; body.append(photo);
  const mounted = mountQuantityActions(context, p, { detail: true });
  root.append(body); root.append(mounted.actions);
  root.querySelector = (selector) => selector === '.detail-order-actions' ? mounted.actions
    : selector === '.detail-body' ? body : selector === 'img' ? photo : null;
  root.querySelectorAll = (selector) => mounted.actions.querySelectorAll(selector);
  return { ...mounted, root, body, photo, get nodes() { return mounted.nodes; } };
}

function mountStableCart(context) {
  const { sandbox: s, element, cart } = context;
  const root = element('cart-body');
  element('cart-dialog').append(root);
  const summary = element('cart-summary-fixture');
  const lines = cart().map((saved, index) => {
    const line = element(`cart-line-fixture-${index}`);
    const photo = element(`cart-photo-fixture-${index}`);
    const input = element(`cart-input-fixture-${index}`); input.value = String(saved.quantity);
    input.dataset = { action: 'set-quantity', id: s.cartStockKey(saved.name, saved.warehouse) };
    const controls = {};
    for (const action of ['cart-minus', 'cart-plus', 'remove-line']) {
      controls[action] = element(`${action}-fixture-${index}`);
      controls[action].dataset = { action, index: String(index) };
      line.append(controls[action]);
    }
    line.append(photo); line.append(input); root.append(line);
    line.querySelector = (selector) => selector === 'img' ? photo : selector === '.quantity-input' ? input
      : selector === '[data-action="cart-minus"]' ? controls['cart-minus']
      : selector === '[data-action="cart-plus"]' ? controls['cart-plus']
      : selector === '[data-action="remove-line"]' ? controls['remove-line'] : null;
    return { line, photo, input, ...controls };
  });
  const headings = model.getWarehouseSummaries(cart()).map((warehouse, index) => {
    const heading = element(`warehouse-heading-fixture-${index}`);
    const summary = element(`warehouse-summary-fixture-${index}`);
    heading.dataset.warehouse = warehouse.warehouse;
    summary.textContent = s.warehouseSummaryText(warehouse);
    heading.append(summary); root.append(heading);
    heading.querySelector = (selector) => selector === '.warehouse-section-summary' ? summary : null;
    return { heading, summary };
  });
  root.append(summary);
  root.querySelector = (selector) => selector === '.order-summary' ? summary : null;
  root.querySelectorAll = (selector) => selector === '.cart-line' ? lines.map(({ line }) => line)
    : selector === '.warehouse-section-title' ? headings.map(({ heading }) => heading)
    : selector === '[data-action]' ? lines.flatMap((line) => [line['cart-minus'], line.input, line['cart-plus'], line['remove-line']]) : [];
  return { root, summary, lines, headings };
}

function editQuantity(context, input, value) {
  input.focus();
  context.dispatchDocument('focusin', { target: input });
  input.value = value;
  input.setSelectionRange(value.length, value.length);
  context.dispatchDocument('input', { target: input });
}

function quantityKey(context, input, key) {
  const result = { prevented: false, stopped: false };
  context.dispatchDocument('keydown', {
    target: input, key,
    preventDefault() { result.prevented = true; },
    stopPropagation() { result.stopped = true; },
  });
  return result;
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
    memory.set(storageKeys.cart, raw);
    assert.deepEqual(plain(s.readStoredCart()), []);
  }
});

test('storefront uses only its site cart and never reads, migrates or deletes older shared carts', () => {
  const legacyKeys = ['perfumeCart', 'bestProducts1CatalogCartV1', 'bestProducts1CatalogCartV2',
    'bestProducts1SkuCartV1', 'bestProducts1SkuCartV2', storageKeys.sharedCart, storageKeys.sharedReset, storageKeys.otherCart];
  const legacy = new Map(legacyKeys.map((key) => [key, JSON.stringify([item({ name: 'B02', warehouse: '' })])]));
  const { sandbox: s, memory, cart, storageAccess, evaluate } = createContext({ initialStorage: legacy });
  assert.equal(evaluate('CART_STORAGE_KEY'), storageKeys.cart);
  assert.deepEqual(cart(), [], 'a fresh site cart must not inherit any old shared or other-site items');
  s.writeStoredCart([item()]);
  assert.deepEqual(cart().map((entry) => entry.name), ['TX-A055']);
  assert.equal(JSON.parse(memory.get(storageKeys.cart))[0].name, 'TX-A055');
  s.clearStoredCart();
  assert.deepEqual(cart(), []);
  assert.equal(memory.has(storageKeys.cart), false);
  for (const [key, value] of legacy) assert.equal(memory.get(key), value, `${key} must remain unchanged`);
  assert.ok(storageAccess.every(([, key]) => !legacyKeys.includes(key)), 'legacy and other-site keys must not even be read');
  assert.equal(evaluate('typeof resetCatalogCartOnce'), 'undefined');
  assert.equal(evaluate('typeof CART_RESET_KEY'), 'undefined');
  assert.doesNotMatch(source('db.js'), /SharedCart|CatalogCartV[12]|SkuCartV[12]|resetCatalogCartOnce|CART_RESET_KEY/);
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

test('publishing retains this site cart and ignores shared, other-site and preview carts', () => {
  const saved = [item({ quantity: 7, price: 28 })];
  const preview = JSON.stringify([item({ name: 'IL-B999', warehouse: 'IL', quantity: 2 })]);
  const shared = JSON.stringify([item({ quantity: 15, price: 1 })]);
  const other = JSON.stringify([item({ quantity: 3, price: 90 })]);
  const { sandbox: s, memory, cart, dispatchWindow, element } = createContext({
    initialStorage: [[storageKeys.cart, JSON.stringify(saved)], [storageKeys.sharedReset, 'done'],
      [storageKeys.sharedCart, shared], [storageKeys.otherCart, other],
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
  assert.equal(memory.get(storageKeys.sharedReset), 'done');
  assert.doesNotMatch(source('app.mjs'), /CatalogPreviewCart|CatalogPreviewCartReady/);
  s.writeStoredCart([item({ quantity: 4 })]);
  assert.equal(memory.get('bestProducts1CatalogPreviewCartV1'), preview);
  assert.equal(memory.get(storageKeys.sharedCart), shared);
  assert.equal(memory.get(storageKeys.otherCart), other);
});

test('both storefronts sharing the same origin keep independent quantities and prices after reload', () => {
  const sharedStorage = new Map([[storageKeys.sharedCart, JSON.stringify([item({ quantity: 99, price: 1 })])],
    [storageKeys.sharedReset, 'done']]);
  const own = createContext({ sharedStorage });
  const otherId = isCatalog ? 'perfume-list' : 'catalog';
  const other = createContext({ sharedStorage, storefrontId: otherId });
  assert.equal(own.cartKey, storageKeys.cart);
  assert.equal(other.cartKey, storageKeys.otherCart);
  assert.notEqual(own.cartKey, other.cartKey);
  assert.deepEqual(own.cart(), []); assert.deepEqual(other.cart(), []);
  const ownProduct = product({ price: 26, stock: 100 });
  const otherProduct = product({ price: 36, stock: 100 });
  own.sandbox.perfumeDB = [ownProduct]; other.sandbox.perfumeDB = [otherProduct];
  const key = own.sandbox.cartStockKey(ownProduct.id, ownProduct.warehouse);
  own.sandbox.addToOrder(key);
  assert.equal(own.cart()[0].price, 26); assert.equal(own.cart()[0].quantity, 1);
  assert.deepEqual(other.cart(), []);
  other.sandbox.addToOrder(key); other.sandbox.updateProductQuantity(key, 1);
  assert.equal(other.cart()[0].price, 36); assert.equal(other.cart()[0].quantity, 2);
  assert.equal(own.cart()[0].price, 26); assert.equal(own.cart()[0].quantity, 1);
  own.sandbox.setProductQuantity(key, '8');
  assert.equal(own.cart()[0].quantity, 8); assert.equal(other.cart()[0].quantity, 2);
  const ownReload = createContext({ sharedStorage });
  const otherReload = createContext({ sharedStorage, storefrontId: otherId });
  assert.deepEqual(ownReload.cart(), own.cart()); assert.deepEqual(otherReload.cart(), other.cart());
  assert.equal(ownReload.element('cart-count').textContent, 8);
  assert.equal(otherReload.element('cart-count').textContent, 2);
  assert.equal(JSON.parse(sharedStorage.get(storageKeys.sharedCart))[0].quantity, 99);
  assert.equal(sharedStorage.get(storageKeys.sharedReset), 'done');
});

test('all old shared reset flag states are ignored without clearing a valid site cart or touching other data', () => {
  const saved = [item({ quantity: 3, price: 26 })];
  for (const reset of [undefined, '', 'done', 'broken']) {
    const untouched = [[storageKeys.sharedCart, JSON.stringify([item({ quantity: 50 })])],
      [storageKeys.otherCart, JSON.stringify([item({ quantity: 8, price: 36 })])],
      ['bestProducts1SkuCartV2', 'legacy supplier cart'], [site.cache, 'cached site products']];
    if (reset !== undefined) untouched.push([storageKeys.sharedReset, reset]);
    const context = createContext({ initialStorage: [[storageKeys.cart, JSON.stringify(saved)], ...untouched] });
    assert.deepEqual(context.cart(), saved, `reset flag ${String(reset)}`);
    context.sandbox.writeStoredCart([item({ quantity: 4 })]);
    context.sandbox.clearStoredCart();
    for (const [key, value] of untouched) assert.equal(context.memory.get(key), value, key);
    if (reset === undefined) assert.equal(context.memory.has(storageKeys.sharedReset), false);
    assert.ok(context.storageAccess.every(([, key]) => ![storageKeys.sharedCart, storageKeys.otherCart,
      storageKeys.sharedReset, 'bestProducts1SkuCartV2'].includes(key)));
  }
});

test('same-site storage events and pageshow refresh the order while named unrelated events do nothing', () => {
  const context = createContext({ initialStorage: [[storageKeys.cart, JSON.stringify([item({ quantity: 2 })])]] });
  const { sandbox: s, memory, dispatchWindow, element, storageAccess } = context;
  let updates = 0;
  const update = s.updateOrderUI;
  s.updateOrderUI = () => { updates++; return update(); };
  const unrelatedKeys = [storageKeys.otherCart, storageKeys.sharedCart, storageKeys.sharedReset,
    site.cache, `bestProducts1${site.id}LayoutV1`, 'random-other-app'];
  for (const key of unrelatedKeys) {
    memory.set(key, JSON.stringify([item({ quantity: 90, price: 1 })]));
    storageAccess.length = 0;
    dispatchWindow('storage', { key, storageArea: s.localStorage });
    assert.equal(updates, 0, key); assert.equal(element('cart-count').textContent, 2, key);
    assert.deepEqual(storageAccess, [], 'unrelated changes should not even re-read the site cart');
  }
  memory.set(storageKeys.cart, JSON.stringify([item({ quantity: 7, price: 26 })]));
  dispatchWindow('storage', { key: storageKeys.cart, storageArea: s.localStorage });
  assert.equal(updates, 1); assert.equal(element('cart-count').textContent, 7);
  const expected = model.getOrderSummary(context.cart(), site.tiers);
  assert.equal(element('mobile-order-total').textContent, '$' + expected.totalAmount.toFixed(2));
  memory.set(storageKeys.cart, JSON.stringify([item({ quantity: 9, price: 26 })]));
  dispatchWindow('pageshow'); assert.equal(updates, 2); assert.equal(element('cart-count').textContent, 9);
});

test('clearing localStorage in another tab synchronizes the empty own order via a null storage key', () => {
  const context = createContext({ initialStorage: [[storageKeys.cart, JSON.stringify([item({ quantity: 2 })])]] });
  const { sandbox: s, memory, dispatchWindow, element, storageAccess } = context;
  assert.equal(element('mobile-order-bar').hidden, false);
  memory.clear(); // Simulate the browser's clear() in another same-origin tab, not an application action.
  storageAccess.length = 0;
  dispatchWindow('storage', { key: null, storageArea: s.localStorage });
  assert.deepEqual(context.cart(), []); assert.equal(element('cart-count').textContent, 0);
  assert.equal(element('mobile-order-bar').hidden, true);
  assert.ok(storageAccess.every(([operation]) => operation === 'get'), 'a clear notification must not write or reset other app data');
});

test('a storage event from a different storage area cannot refresh the localStorage order', () => {
  const context = createContext({ initialStorage: [[storageKeys.cart, JSON.stringify([item({ quantity: 2 })])]] });
  const { sandbox: s, memory, dispatchWindow, element, storageAccess } = context;
  memory.set(storageKeys.cart, JSON.stringify([item({ quantity: 7 })])); storageAccess.length = 0;
  dispatchWindow('storage', { key: storageKeys.cart, storageArea: { getItem() { return null; } } });
  assert.equal(element('cart-count').textContent, 2); assert.deepEqual(storageAccess, []);
  dispatchWindow('storage', { key: storageKeys.cart, storageArea: s.localStorage });
  assert.equal(element('cart-count').textContent, 7);
});

test('an unrelated storefront storage event cannot disrupt an active quantity draft or its selection', () => {
  const context = createContext();
  const { sandbox: s, setCart, memory, dispatchWindow, evaluate, storageAccess } = context;
  const p = product({ stock: 100 }); s.perfumeDB = [p]; setCart([item({ quantity: 4 })]); evaluate('state.loaded = true');
  const mounted = mountStableCard(context, p), input = mounted.nodes.input;
  editQuantity(context, input, '12'); input.setSelectionRange(1, 1);
  const writes = [mounted.root.innerHTMLWrites, mounted.actions.innerHTMLWrites];
  for (const key of [storageKeys.otherCart, storageKeys.sharedCart, storageKeys.sharedReset]) {
    memory.set(key, JSON.stringify([item({ quantity: 80 })])); storageAccess.length = 0;
    dispatchWindow('storage', { key, storageArea: s.localStorage });
    assert.deepEqual(storageAccess, []);
    assert.equal(input.value, '12'); assert.equal(input.selectionStart, 1); assert.equal(input.selectionEnd, 1);
    assert.equal(s.document.activeElement, input); assert.equal(mounted.nodes.input, input);
    assert.deepEqual([mounted.root.innerHTMLWrites, mounted.actions.innerHTMLWrites], writes);
  }
  quantityKey(context, input, 'Enter');
  assert.equal(context.cart()[0].quantity, 12);
  assert.equal(JSON.parse(memory.get(storageKeys.otherCart))[0].quantity, 80);
});

test('another storefront changing its cart cannot invalidate this site removal confirmation', () => {
  const context = createContext();
  const { sandbox: s, setCart, memory, dispatchWindow, element, evaluate, approve, storageAccess } = context;
  const p = product(); s.perfumeDB = [p]; setCart([item({ quantity: 4 })]);
  s.setProductQuantity(s.cartStockKey(p.id, p.warehouse), '0');
  const confirm = evaluate('state.confirm');
  const unrelated = JSON.stringify([item({ quantity: 99, price: 36 })]);
  memory.set(storageKeys.otherCart, unrelated); storageAccess.length = 0;
  dispatchWindow('storage', { key: storageKeys.otherCart, storageArea: s.localStorage });
  assert.deepEqual(storageAccess, []); assert.equal(element('confirm-dialog').open, true);
  assert.equal(evaluate('state.confirm'), confirm);
  approve(); assert.deepEqual(context.cart(), []); assert.equal(memory.get(storageKeys.otherCart), unrelated);
  assert.equal(element('confirm-dialog').open, false);
});

test('the Clear order action clears only this site and leaves every unrelated storage entry unchanged', () => {
  const untouched = [[storageKeys.otherCart, JSON.stringify([item({ quantity: 9, price: 36 })])],
    [storageKeys.sharedCart, JSON.stringify([item({ quantity: 7 })])], [storageKeys.sharedReset, 'done'],
    ['bestProducts1SkuCartV2', 'conversion website cart'], ['personalOtherApp', 'keep me'],
    [site.cache, 'products cache'], ['bestProducts1CatalogPreviewCartV1', 'preview cart']];
  const context = createContext({ initialStorage: [[storageKeys.cart, JSON.stringify([item({ quantity: 3 })])], ...untouched] });
  const { sandbox: s, element, dispatchDocument, approve, storageAccess, memory } = context;
  s.perfumeDB = [product()]; s.openCart(); storageAccess.length = 0;
  const trigger = element('clear-order-trigger'); trigger.dataset.action = 'clear-cart';
  dispatchDocument('click', { target: trigger });
  assert.equal(element('confirm-dialog').open, true); assert.equal(context.cart()[0].quantity, 3);
  approve(); assert.deepEqual(context.cart(), []); assert.equal(element('cart-count').textContent, 0);
  assert.equal(element('mobile-order-bar').hidden, true);
  for (const [key, value] of untouched) assert.equal(memory.get(key), value, key);
  assert.ok(storageAccess.every(([, key]) => key === storageKeys.cart), 'order clearing must touch only this cart key');
});

test('invalid own cart data remains isolated and never falls back to another valid cart', () => {
  const shared = JSON.stringify([item({ quantity: 90 })]), other = JSON.stringify([item({ quantity: 5, price: 36 })]);
  for (const invalid of ['broken', '{}', 'null', 'false', '42', '"wrong type"']) {
    const context = createContext({ initialStorage: [[storageKeys.cart, invalid],
      [storageKeys.sharedCart, shared], [storageKeys.otherCart, other]] });
    const { sandbox: s, memory, dispatchWindow, element } = context;
    assert.deepEqual(context.cart(), []); assert.equal(element('mobile-order-bar').hidden, true);
    dispatchWindow('storage', { key: storageKeys.cart, storageArea: s.localStorage });
    assert.equal(element('cart-count').textContent, 0);
    s.writeStoredCart([item({ quantity: 2 })]); assert.equal(context.cart()[0].quantity, 2);
    assert.equal(memory.get(storageKeys.sharedCart), shared); assert.equal(memory.get(storageKeys.otherCart), other);
  }
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
  assert.match(added, /Continue shopping/);
  assert.doesNotMatch(added, /View order|data-action="open-cart"/);
});
test('product details display the sheet audience beside the size with matching category icons', () => {
  const { sandbox: s, element, setCart } = createContext();
  for (const [value, label, symbol] of [
    ['Men', 'Men', 'gender-male'], [' women ', 'Women', 'gender-female'],
    ['UNISEX', 'Unisex', 'circles-relation'],
  ]) {
    const [p] = s.parseCSV(`sku,name,price,ml,stock,target\nTX-A055,New York Nights,33,100,19,${value}`);
    assert.equal(p.gender.trim().toLowerCase(), label.toLowerCase());
    setCart([]);
    s.renderDetail(p);
    const html = element('product-detail').innerHTML;
    assert.ok(html.includes(`100ml<span class="detail-gender" aria-label="For ${label}">`));
    assert.ok(html.includes(`ti ti-${symbol}`));
    assert.match(html, new RegExp(`</i>${label}</span></p>`));
    assert.match(html, /Add to order/);
    assert.equal([...html.matchAll(/<img\b/g)].length, 0);
    setCart([item({ quantity: 3 })]);
    s.renderDetail(p);
    assert.ok(element('product-detail').innerHTML.includes(`For ${label}`));
    assert.match(element('product-detail').innerHTML, /3 in your order|Continue shopping/);
  }
  assert.match(s.detailGenderHtml({ target: 'Women' }), /Women/);
  assert.match(source('styles.css'), /\.detail-copy \.product-size\{display:flex;align-items:center;gap:9px;flex-wrap:wrap\}/);
});
test('missing or unsupported audiences do not invent a gender or expose raw sheet values', () => {
  const { sandbox: s, element } = createContext();
  for (const value of ['', null, undefined, 'Unknown', 'constructor', '__proto__', '<img src=x onerror=alert(1)>']) {
    assert.equal(s.detailGenderHtml({ gender: value }), '');
    s.renderDetail(product({ gender: value }));
    const html = element('product-detail').innerHTML;
    assert.doesNotMatch(html, /detail-gender|onerror=alert/);
    assert.match(html, /<p class="product-size">100ml<\/p>/);
    assert.match(html, /Add to order/);
  }
});
test('detail actions are separate from the scrollable product body', () => {
  const { sandbox: s, element } = createContext();
  s.renderDetail(product());
  const html = element('product-detail').innerHTML;
  assert.match(html, /class="detail-body"/);
  assert.match(html, /<\/span><\/div><\/div><div class="detail-order-actions">/);
  const actions = html.split('<div class="detail-order-actions">')[1];
  assert.match(actions, /data-action="add"/);
  assert.doesNotMatch(actions, /detail-photo|detail-copy|detail-title/);
  assert.match(source('styles.css'), /\.detail-layout\{display:flex;flex-direction:column;height:auto;max-height:/);
  assert.match(source('styles.css'), /\.product-dialog\{height:fit-content;max-height:calc\(100dvh - 24px\)/);
  assert.match(source('styles.css'), /\.detail-body\{display:block;flex:0 1 auto;min-height:0;overflow-y:auto/);
  assert.match(source('styles.css'), /\.quantity-stepper button\{height:50px;min-width:48px;font-size:26px/);
  assert.match(source('styles.css'), /padding:12px 16px calc\(12px \+ env\(safe-area-inset-bottom\)\)/);
});
test('detail quantity updates retain scroll while opening a product resets it', () => {
  const { sandbox: s, element } = createContext();
  const p = product();
  const body = { scrollTop: 180 };
  element('product-detail').querySelector = (selector) => selector === '.detail-body' ? body : null;
  s.renderDetail(p);
  assert.equal(body.scrollTop, 180);
  body.scrollTop = 240;
  s.perfumeDB = [p];
  s.openProduct(s.cartStockKey(p.id, p.warehouse));
  assert.equal(body.scrollTop, 0);
  assert.equal(element('product-dialog').open, true);
});
test('continuing shopping closes details without opening the cart or changing quantities', () => {
  const { sandbox: s, element, cart, dispatchDocument } = createContext();
  const p = product();
  s.perfumeDB = [p];
  const key = s.cartStockKey(p.id, p.warehouse);
  s.openProduct(key);
  s.addToOrder(key);
  for (let i = 1; i < 4; i++) s.updateProductQuantity(key, 1);
  const saved = cart();
  const html = element('product-detail').innerHTML;
  assert.match(html, /Continue shopping/);
  assert.doesNotMatch(html, /View order|data-action="open-cart"/);
  const button = { dataset: { action: 'close-product' } };
  dispatchDocument('click', { target: { closest: (selector) => selector === '[data-action]' ? button : null } });
  assert.equal(element('product-dialog').open, false);
  assert.equal(element('cart-dialog').open, false);
  assert.deepEqual(cart(), saved);
  s.openProduct(key);
  for (let i = 0; i < 4; i++) s.updateProductQuantity(key, -1);
  assert.deepEqual(cart(), []);
  assert.match(element('product-detail').innerHTML, /Add to order/);
  assert.doesNotMatch(element('product-detail').innerHTML, /View order|Continue shopping/);
});

test('syncing a quantity stepper keeps its controls and updates inventory and checking limits', () => {
  const context = createContext();
  const { sandbox: s, setCart, evaluate } = context;
  const p = product();
  s.perfumeDB = [p]; setCart([item({ quantity: 7 })]);
  const mounted = mountQuantityActions(context, p);
  const { stepper, input, 'product-plus': plus, 'product-minus': minus } = mounted.nodes;
  const writes = mounted.actions.innerHTMLWrites;
  s.syncQuantityStepper(stepper, p);
  assert.equal(input.value, '7');
  assert.equal(plus.disabled, false); assert.equal(minus.disabled, false);
  setCart([item({ quantity: 19 })]); s.syncQuantityStepper(stepper, p);
  assert.equal(input.value, '19'); assert.equal(plus.disabled, true); assert.equal(minus.disabled, false);
  evaluate('state.checking = true'); s.syncQuantityStepper(stepper, p);
  assert.equal(plus.disabled, true); assert.equal(minus.disabled, true);
  evaluate('state.checking = false'); setCart([item({ quantity: 18 })]); s.syncQuantityStepper(stepper, p);
  assert.equal(input.value, '18'); assert.equal(plus.disabled, false); assert.equal(minus.disabled, false);
  assert.equal(mounted.actions.innerHTMLWrites, writes);
  assert.equal(stepper.querySelector('.quantity-input'), input);
  assert.equal(stepper.querySelector('[data-action="product-plus"]'), plus);
  assert.equal(stepper.querySelector('[data-action="product-minus"]'), minus);
});

test('homepage repeated plus and minus preserve photo, controls, focus and collection DOM', () => {
  const context = createContext();
  const { sandbox: s, setCart, cart, evaluate } = context;
  const p = product();
  s.perfumeDB = [p]; setCart([item()]); evaluate('state.loaded = true');
  const mounted = mountStableCard(context, p);
  const { stepper, input, 'product-plus': plus, 'product-minus': minus } = mounted.nodes;
  mounted.root.innerHTML = '<section>Stable collection and image</section>';
  const rootHTML = mounted.root.innerHTML, rootWrites = mounted.root.innerHTMLWrites;
  const actionWrites = mounted.actions.innerHTMLWrites;
  s.document.activeElement = plus;
  s.renderProducts = () => { throw new Error('Quantity updates must not rerender the collection'); };
  for (const delta of [1, 1, -1, 1]) s.updateProductQuantity(s.cartStockKey(p.id, p.warehouse), delta);
  assert.equal(cart()[0].quantity, 3); assert.equal(input.value, '3');
  assert.equal(mounted.inOrder.textContent, '3 in your order');
  assert.equal(mounted.card.querySelector('img'), mounted.photo);
  assert.equal(mounted.nodes.stepper, stepper); assert.equal(mounted.nodes.input, input);
  assert.equal(mounted.nodes['product-plus'], plus); assert.equal(mounted.nodes['product-minus'], minus);
  assert.equal(mounted.actions.innerHTMLWrites, actionWrites);
  assert.equal(mounted.root.innerHTMLWrites, rootWrites); assert.equal(mounted.root.innerHTML, rootHTML);
  assert.equal(s.document.activeElement, plus);
});

test('Add and zero removal replace only product actions, not product photos or the collection', () => {
  const context = createContext();
  const { sandbox: s, cart, evaluate } = context;
  const p = product(); s.perfumeDB = [p]; evaluate('state.loaded = true');
  const mounted = mountStableCard(context, p);
  const initialAdd = mounted.nodes.add;
  const rootWrites = mounted.root.innerHTMLWrites, initialWrites = mounted.actions.innerHTMLWrites;
  s.document.activeElement = initialAdd;
  s.renderProducts = () => { throw new Error('Add and removal must not rerender photos'); };
  const key = s.cartStockKey(p.id, p.warehouse);
  s.addToOrder(key);
  assert.equal(cart()[0].quantity, 1);
  assert.equal(mounted.actions.innerHTMLWrites, initialWrites + 1);
  assert.ok(mounted.nodes.stepper); assert.equal(mounted.nodes.add, undefined);
  const firstStepper = mounted.nodes.stepper;
  assert.equal(s.document.activeElement, mounted.nodes['product-plus']);
  s.updateProductQuantity(key, 1); s.updateProductQuantity(key, -1);
  assert.equal(mounted.nodes.stepper, firstStepper);
  assert.equal(mounted.actions.innerHTMLWrites, initialWrites + 1);
  s.updateProductQuantity(key, -1);
  assert.deepEqual(cart(), []); assert.equal(mounted.nodes.stepper, undefined);
  assert.ok(mounted.nodes.add); assert.notEqual(mounted.nodes.add, initialAdd);
  assert.equal(mounted.actions.innerHTMLWrites, initialWrites + 2);
  assert.equal(mounted.root.innerHTMLWrites, rootWrites);
  assert.equal(mounted.card.querySelector('img'), mounted.photo);
  assert.equal(mounted.inOrder.textContent, ''); assert.equal(s.document.activeElement, mounted.nodes.add);
});

test('incremental card updates isolate equal SKU values in separate warehouses', () => {
  const context = createContext();
  const { sandbox: s, setCart, evaluate } = context;
  const tx = product(), ne = product({ warehouse: 'NE', stock: 25 });
  s.perfumeDB = [tx, ne]; setCart([item({ quantity: 2 }), item({ warehouse: 'NE', quantity: 4 })]);
  evaluate('state.loaded = true');
  const first = mountStableCard(context, tx), second = mountStableCard(context, ne);
  const secondStepper = second.nodes.stepper, secondWrites = second.actions.innerHTMLWrites;
  s.updateProductQuantity(s.cartStockKey(tx.id, tx.warehouse), 1);
  assert.equal(first.nodes.input.value, '3'); assert.equal(second.nodes.input.value, '4');
  assert.equal(first.inOrder.textContent, '3 in your order'); assert.equal(second.inOrder.textContent, '4 in your order');
  assert.equal(second.nodes.stepper, secondStepper); assert.equal(second.actions.innerHTMLWrites, secondWrites);
  assert.equal(first.card.querySelector('img'), first.photo); assert.equal(second.card.querySelector('img'), second.photo);
});

test('detail repeated quantity changes leave photo, scroll body and footer controls mounted', () => {
  const context = createContext();
  const { sandbox: s, setCart, evaluate } = context;
  const p = product(); s.perfumeDB = [p]; setCart([item()]); evaluate('state.loaded = true');
  s.openProduct(s.cartStockKey(p.id, p.warehouse));
  const mounted = mountStableDetail(context, p);
  const { stepper, input, 'product-plus': plus, 'product-minus': minus } = mounted.nodes;
  const rootHTML = mounted.root.innerHTML, rootWrites = mounted.root.innerHTMLWrites;
  const actionWrites = mounted.actions.innerHTMLWrites;
  s.document.activeElement = plus;
  s.renderProducts = () => { throw new Error('Detail quantity must not redraw the collection'); };
  s.renderDetail = () => { throw new Error('Detail quantity must not recreate product images'); };
  for (const delta of [1, 1, -1]) s.updateProductQuantity(s.cartStockKey(p.id, p.warehouse), delta);
  assert.equal(input.value, '2'); assert.equal(mounted.nodes.inOrder.textContent, '2 in your order');
  assert.equal(mounted.nodes.stepper, stepper); assert.equal(mounted.nodes.input, input);
  assert.equal(mounted.nodes['product-plus'], plus); assert.equal(mounted.nodes['product-minus'], minus);
  assert.equal(mounted.actions.innerHTMLWrites, actionWrites);
  assert.equal(mounted.root.innerHTMLWrites, rootWrites); assert.equal(mounted.root.innerHTML, rootHTML);
  assert.equal(mounted.root.querySelector('img'), mounted.photo); assert.equal(mounted.body.scrollTop, 180);
  assert.equal(s.document.activeElement, plus);
});

test('detail first Add and removal remount only its action footer', () => {
  const context = createContext();
  const { sandbox: s, cart, evaluate } = context;
  const p = product(); s.perfumeDB = [p]; evaluate('state.loaded = true');
  s.openProduct(s.cartStockKey(p.id, p.warehouse));
  const mounted = mountStableDetail(context, p);
  const writes = mounted.actions.innerHTMLWrites, rootWrites = mounted.root.innerHTMLWrites;
  s.document.activeElement = mounted.nodes.add;
  s.renderProducts = () => { throw new Error('Detail Add must not redraw the collection'); };
  s.renderDetail = () => { throw new Error('Detail Add must not recreate the product photo'); };
  const key = s.cartStockKey(p.id, p.warehouse);
  s.addToOrder(key);
  assert.equal(cart()[0].quantity, 1); assert.equal(mounted.nodes.input.value, '1');
  assert.equal(mounted.actions.innerHTMLWrites, writes + 1);
  assert.equal(s.document.activeElement, mounted.nodes['product-plus']);
  s.updateProductQuantity(key, -1);
  assert.deepEqual(cart(), []); assert.ok(mounted.nodes.add); assert.equal(mounted.nodes.stepper, undefined);
  assert.equal(mounted.actions.innerHTMLWrites, writes + 2);
  assert.equal(mounted.root.innerHTMLWrites, rootWrites); assert.equal(mounted.root.querySelector('img'), mounted.photo);
  assert.equal(mounted.body.scrollTop, 180); assert.equal(s.document.activeElement, mounted.nodes.add);
});

test('storage and pageshow sync quantities without redrawing product images or open details', () => {
  const context = createContext();
  const { sandbox: s, setCart, dispatchWindow, evaluate } = context;
  const p = product(); s.perfumeDB = [p]; setCart([item()]); evaluate('state.loaded = true');
  const card = mountStableCard(context, p);
  s.openProduct(s.cartStockKey(p.id, p.warehouse));
  const detail = mountStableDetail(context, p);
  const cardWrites = card.root.innerHTMLWrites, detailWrites = detail.root.innerHTMLWrites;
  const cardStepper = card.nodes.stepper, detailStepper = detail.nodes.stepper;
  s.renderProducts = () => { throw new Error('Storage/pageshow must not redraw product cards'); };
  s.renderDetail = () => { throw new Error('Storage/pageshow must not recreate product details'); };
  setCart([item({ quantity: 5 })]); dispatchWindow('storage', { key: storageKeys.cart });
  assert.equal(card.nodes.input.value, '5'); assert.equal(detail.nodes.input.value, '5');
  setCart([item({ quantity: 6 })]); dispatchWindow('pageshow');
  assert.equal(card.nodes.input.value, '6'); assert.equal(detail.nodes.input.value, '6');
  assert.equal(card.nodes.stepper, cardStepper); assert.equal(detail.nodes.stepper, detailStepper);
  assert.equal(card.root.innerHTMLWrites, cardWrites); assert.equal(detail.root.innerHTMLWrites, detailWrites);
  assert.equal(card.card.querySelector('img'), card.photo); assert.equal(detail.root.querySelector('img'), detail.photo);
  assert.equal(detail.body.scrollTop, 180);
});

test('checking state updates mounted card and detail buttons without recreating their images', () => {
  const context = createContext();
  const { sandbox: s, setCart, evaluate } = context;
  const p = product(); s.perfumeDB = [p]; setCart([item()]); evaluate('state.loaded = true');
  const card = mountStableCard(context, p);
  s.openProduct(s.cartStockKey(p.id, p.warehouse));
  const detail = mountStableDetail(context, p);
  const rootWrites = [card.root.innerHTMLWrites, detail.root.innerHTMLWrites];
  const controls = [card.nodes['product-plus'], card.nodes['product-minus'], detail.nodes['product-plus'], detail.nodes['product-minus']];
  s.renderProducts = () => { throw new Error('Checking must not recreate product cards'); };
  s.renderDetail = () => { throw new Error('Checking must not recreate detail images'); };
  evaluate('state.checking = true'); s.updateOrderUI();
  assert.ok(controls.every((control) => control.disabled));
  evaluate('state.checking = false'); s.updateOrderUI();
  assert.ok(controls.every((control) => !control.disabled));
  assert.deepEqual([card.root.innerHTMLWrites, detail.root.innerHTMLWrites], rootWrites);
  assert.equal(card.nodes['product-plus'], controls[0]); assert.equal(detail.nodes['product-minus'], controls[3]);
});

test('cart quantity and checking updates preserve row photos and controls while updating only the summary', () => {
  const context = createContext();
  const { sandbox: s, setCart, cart, evaluate } = context;
  const p = product(); s.perfumeDB = [p]; setCart([item()]);
  s.openCart();
  const mounted = mountStableCart(context);
  const row = mounted.lines[0], rootHTML = mounted.root.innerHTML;
  const rootWrites = mounted.root.innerHTMLWrites, summaryWrites = mounted.summary.innerHTMLWrites;
  s.document.activeElement = row['cart-plus'];
  for (let quantity = 2; quantity <= 19; quantity++) s.updateCartQuantity(0, 1);
  assert.equal(cart()[0].quantity, 19); assert.equal(row.input.value, '19');
  assert.equal(row['cart-plus'].disabled, true); assert.equal(row['cart-minus'].disabled, false);
  assert.equal(mounted.root.innerHTMLWrites, rootWrites); assert.equal(mounted.root.innerHTML, rootHTML);
  assert.equal(mounted.summary.innerHTMLWrites, summaryWrites + 18);
  const expected = model.getOrderSummary(cart(), site.tiers);
  assert.ok(mounted.summary.innerHTML.includes(`Items (${expected.qty})`));
  assert.ok(mounted.summary.innerHTML.includes('$' + expected.totalAmount.toFixed(2)));
  assert.equal(row.line.querySelector('img'), row.photo); assert.equal(row.line.querySelector('.quantity-input'), row.input);
  assert.equal(row.line.querySelector('[data-action="cart-plus"]'), row['cart-plus']);
  assert.equal(row.line.querySelector('[data-action="cart-minus"]'), row['cart-minus']);
  evaluate('state.checking = true'); s.renderCart();
  assert.equal(row['cart-plus'].disabled, true); assert.equal(row['cart-minus'].disabled, true); assert.equal(row['remove-line'].disabled, true);
  evaluate('state.checking = false'); s.updateCartQuantity(0, -1);
  assert.equal(row.input.value, '18'); assert.equal(row['cart-plus'].disabled, false); assert.equal(row['cart-minus'].disabled, false);
  s.perfumeDB = []; s.renderCart();
  assert.equal(row['cart-plus'].disabled, true, 'a removed product remains unable to increase in the incremental path');
  assert.equal(row['cart-minus'].disabled, false); assert.equal(row['remove-line'].disabled, false);
  assert.equal(mounted.root.innerHTMLWrites, rootWrites); assert.equal(row.line.querySelector('img'), row.photo);
});

test('cart metadata, row order and row count changes invalidate the incremental signature', () => {
  const context = createContext();
  const { sandbox: s, setCart, element } = context;
  const first = item(), second = item({ name: 'NE-A056', warehouse: 'NE', caption: 'NE-A056 - Another perfume', img: 'second.webp' });
  s.perfumeDB = [product(), product({ id: 'NE-A056', warehouse: 'NE' })];
  setCart([first, second]); s.renderCart();
  const mounted = mountStableCart(context);
  let writes = mounted.root.innerHTMLWrites;
  const changes = [
    { caption: 'TX-A055 - Corrected title' }, { img: 'corrected-photo.webp' },
    { price: 40 }, { ml: '75' }, { brand: 'Corrected brand' },
  ];
  for (const change of changes) {
    setCart([{ ...first, ...change }, second]); s.renderCart();
    assert.equal(mounted.root.innerHTMLWrites, ++writes, `changed metadata ${Object.keys(change)[0]}`);
  }
  setCart([second, first]); s.renderCart();
  assert.equal(mounted.root.innerHTMLWrites, ++writes, 'reordering rows rebuilds data-index associations');
  const reordered = mounted.root.innerHTML;
  assert.ok(reordered.indexOf('NE Warehouse') < reordered.indexOf('TX Warehouse'));
  assert.match(reordered, /data-action="cart-minus" data-index="0"/);
  assert.match(reordered, /data-action="cart-minus" data-index="1"/);
  setCart([first]); s.renderCart();
  assert.equal(mounted.root.innerHTMLWrites, ++writes, 'row removal rebuilds the drawer');
  assert.doesNotMatch(mounted.root.innerHTML, /NE-A056/);
  setCart([]); s.renderCart();
  assert.equal(mounted.root.innerHTMLWrites, ++writes); assert.match(mounted.root.innerHTML, /Your order starts here/);
  assert.equal(element('cart-actions').hidden, true);
});

test('quantity validation accepts only safe whole-number totals within the warehouse stock limit', () => {
  for (const value of ['', ' ', '-1', '1.5', '1e2', 'Infinity', 'NaN', '+2', '2,000', '9007199254740992']) {
    assert.deepEqual(model.validateOrderQuantity(value, 100), { ok: false, reason: 'integer' }, value);
  }
  assert.deepEqual(model.validateOrderQuantity('21', 20), { ok: false, reason: 'stock', limit: 20 });
  assert.deepEqual(model.validateOrderQuantity('00012', 20), { ok: true, quantity: 12 });
  assert.deepEqual(model.validateOrderQuantity(' 20 ', 20), { ok: true, quantity: 20 });
  assert.deepEqual(model.validateOrderQuantity('0', 0), { ok: true, quantity: 0 });
  assert.deepEqual(model.validateOrderQuantity('9007199254740991'), { ok: true, quantity: Number.MAX_SAFE_INTEGER });
});

test('quantity inputs expose total quantity, numeric keyboard and labels in all order presentations', () => {
  const { sandbox: s, setCart, evaluate } = createContext();
  const p = product(); s.perfumeDB = [p]; setCart([item({ quantity: 7 })]);
  const key = s.cartStockKey(p.id, p.warehouse);
  for (const html of [s.productActionsHtml(p), s.detailOrderActionsHtml(p), s.cartLine(item({ quantity: 7 }), 0)]) {
    assert.match(html, /class="quantity-input" type="text" inputmode="numeric"/);
    assert.ok(html.includes(`data-action="set-quantity" data-id="${key}" value="7"`));
    assert.match(html, /aria-label="Quantity in your order for [^"]+"/);
    assert.match(html, /title="Click to enter total quantity"/);
    assert.doesNotMatch(html, /autofocus|<output/);
  }
  evaluate("state.view = 'list'");
  assert.match(s.productCard(p), /class="quantity-input"/);
});

test('typing drafts does not save; Enter sets a total once, preserves images and dismisses the keyboard', () => {
  const context = createContext();
  const { sandbox: s, setCart, cart, element, evaluate } = context;
  const p = product({ stock: 100 }); s.perfumeDB = [p]; setCart([item({ quantity: 3 })]); evaluate('state.loaded = true');
  const mounted = mountStableCard(context, p);
  const { input, stepper } = mounted.nodes;
  const writes = [mounted.root.innerHTMLWrites, mounted.actions.innerHTMLWrites];
  let saves = 0;
  const save = s.writeStoredCart;
  s.writeStoredCart = (...args) => { saves++; return save(...args); };
  editQuantity(context, input, '2');
  assert.equal(cart()[0].quantity, 3); assert.equal(saves, 0);
  input.value = '20'; context.dispatchDocument('input', { target: input });
  assert.equal(cart()[0].quantity, 3); assert.equal(saves, 0);
  assert.deepEqual(quantityKey(context, input, 'Enter'), { prevented: true, stopped: true });
  assert.equal(cart()[0].quantity, 20); assert.equal(input.value, '20'); assert.equal(saves, 1);
  assert.match(element('toast').textContent, /Quantity set.*now 20 in your order/);
  assert.doesNotMatch(element('toast').textContent, /Added 1/);
  assert.notEqual(s.document.activeElement, input);
  assert.equal(mounted.nodes.input, input); assert.equal(mounted.nodes.stepper, stepper);
  assert.equal(mounted.card.querySelector('img'), mounted.photo);
  assert.deepEqual([mounted.root.innerHTMLWrites, mounted.actions.innerHTMLWrites], writes);
  context.dispatchDocument('focusout', { target: input });
  assert.equal(saves, 1, 'Enter followed by blur must not save twice');
});

test('blurring a detail draft sets its total without replacing the photo, footer controls or scroll', () => {
  const context = createContext();
  const { sandbox: s, setCart, cart, evaluate } = context;
  const p = product(); s.perfumeDB = [p]; setCart([item()]); evaluate('state.loaded = true');
  s.openProduct(s.cartStockKey(p.id, p.warehouse));
  const mounted = mountStableDetail(context, p), input = mounted.nodes.input;
  const writes = [mounted.root.innerHTMLWrites, mounted.actions.innerHTMLWrites];
  editQuantity(context, input, '12'); input.blur();
  assert.equal(cart()[0].quantity, 12); assert.equal(input.value, '12');
  assert.equal(mounted.nodes.input, input); assert.equal(mounted.root.querySelector('img'), mounted.photo);
  assert.equal(mounted.body.scrollTop, 180);
  assert.deepEqual([mounted.root.innerHTMLWrites, mounted.actions.innerHTMLWrites], writes);
});

test('invalid and over-stock drafts restore the latest saved total with an explicit message', () => {
  const context = createContext();
  const { sandbox: s, setCart, cart, element, evaluate } = context;
  const p = product(); s.perfumeDB = [p]; setCart([item({ quantity: 4 })]); evaluate('state.loaded = true');
  const mounted = mountStableCard(context, p), input = mounted.nodes.input;
  for (const value of ['', '-1', '1.2', '1e1', 'Infinity', '9007199254740992', '20']) {
    editQuantity(context, input, value); input.blur();
    assert.equal(cart()[0].quantity, 4, value); assert.equal(input.value, '4', value);
    assert.match(element('toast').textContent, /Your saved quantity was not changed/);
  }
  assert.match(element('toast').textContent, /up to 19 pcs/);
  editQuantity(context, input, '30');
  setCart([item({ quantity: 7 })]); context.dispatchWindow('storage', { key: storageKeys.cart }); input.blur();
  assert.equal(cart()[0].quantity, 7); assert.equal(input.value, '7');
});

test('storage sync preserves an active draft and selection, then commit uses latest commercial data', () => {
  const context = createContext();
  const { sandbox: s, setCart, cart, dispatchWindow, evaluate } = context;
  const p = product({ price: 55, ml: '75', stock: 100 }); s.perfumeDB = [p]; setCart([item({ quantity: 4 })]); evaluate('state.loaded = true');
  const mounted = mountStableCard(context, p), input = mounted.nodes.input;
  editQuantity(context, input, '12'); input.setSelectionRange(1, 1);
  const newest = item({ quantity: 7, price: 41, ml: '50', img: 'saved-other.webp' });
  const unrelated = item({ name: 'IL-B001', warehouse: 'IL', quantity: 3 });
  setCart([newest, unrelated]); dispatchWindow('storage', { key: storageKeys.cart });
  assert.equal(input.value, '12'); assert.equal(input.selectionStart, 1); assert.equal(input.selectionEnd, 1);
  assert.equal(s.document.activeElement, input); assert.equal(mounted.nodes.input, input);
  quantityKey(context, input, 'Enter');
  assert.deepEqual(cart(), [{ ...newest, quantity: 12 }, unrelated]);
  assert.equal(mounted.card.querySelector('img'), mounted.photo);
});

test('Escape cancels an input draft and dismisses its keyboard without closing the product or cart', () => {
  const context = createContext();
  const { sandbox: s, setCart, cart, element } = context;
  const p = product(); s.perfumeDB = [p]; setCart([item({ quantity: 4 })]);
  s.openProduct(s.cartStockKey(p.id, p.warehouse));
  const detail = mountStableDetail(context, p);
  editQuantity(context, detail.nodes.input, '12');
  assert.deepEqual(quantityKey(context, detail.nodes.input, 'Escape'), { prevented: true, stopped: true });
  assert.equal(detail.nodes.input.value, '4'); assert.equal(cart()[0].quantity, 4);
  assert.equal(element('product-dialog').open, true); assert.equal(element('confirm-dialog').open, false);
  assert.notEqual(s.document.activeElement, detail.nodes.input);
  s.openCart(); const drawer = mountStableCart(context);
  editQuantity(context, drawer.lines[0].input, '10'); quantityKey(context, drawer.lines[0].input, 'Escape');
  assert.equal(drawer.lines[0].input.value, '4'); assert.equal(cart()[0].quantity, 4);
  assert.equal(element('cart-dialog').open, true);
});

test('typing zero requires approval and cancelling leaves the saved total and non-input focus intact', () => {
  const context = createContext();
  const { sandbox: s, setCart, cart, element, approve } = context;
  const p = product(); s.perfumeDB = [p]; setCart([item({ quantity: 14 })]);
  s.openProduct(s.cartStockKey(p.id, p.warehouse)); const mounted = mountStableDetail(context, p);
  editQuantity(context, mounted.nodes.input, '0'); quantityKey(context, mounted.nodes.input, 'Enter');
  assert.equal(cart()[0].quantity, 14); assert.equal(element('confirm-dialog').open, true);
  assert.equal(mounted.nodes.input.value, '14');
  element('confirm-cancel').dispatchEvent({ type: 'click' });
  assert.equal(cart()[0].quantity, 14); assert.equal(s.document.activeElement, mounted.nodes['product-minus']);
  editQuantity(context, mounted.nodes.input, '0'); quantityKey(context, mounted.nodes.input, 'Enter'); approve();
  assert.deepEqual(cart(), []); assert.equal(element('confirm-dialog').open, false);
  assert.equal(mounted.root.querySelector('img'), mounted.photo); assert.ok(mounted.nodes.add);
});

test('queued close from a cancelled zero confirmation cannot clear the next confirmation or duplicate the dialog stack', () => {
  const context = createContext();
  const { sandbox: s, setCart, cart, element, evaluate, approve } = context;
  const p = product(); s.perfumeDB = [p]; setCart([item({ quantity: 14 })]);
  s.openProduct(s.cartStockKey(p.id, p.warehouse)); const mounted = mountStableDetail(context, p);
  const dialog = element('confirm-dialog');
  const closeEvents = [];
  dialog.close = () => { if (dialog.open) { dialog.open = false; closeEvents.push(() => dialog.dispatchEvent({ type: 'close' })); } };
  editQuantity(context, mounted.nodes.input, '0'); quantityKey(context, mounted.nodes.input, 'Enter');
  element('confirm-cancel').dispatchEvent({ type: 'click' });
  editQuantity(context, mounted.nodes.input, '0'); quantityKey(context, mounted.nodes.input, 'Enter');
  closeEvents.shift()();
  assert.equal(dialog.open, true); assert.equal(evaluate('typeof state.confirm'), 'function');
  assert.equal(evaluate('dialogStack.filter(dialog => dialog.id === "confirm-dialog").length'), 1);
  approve(); assert.deepEqual(cart(), []);
  closeEvents.shift()();
  assert.equal(evaluate('dialogStack.filter(dialog => dialog.id === "confirm-dialog").length'), 0);
  assert.equal(element('product-dialog').open, true);
});

test('zero approval checks the latest target item and never overwrites a new quantity from another window', () => {
  const context = createContext();
  const { sandbox: s, setCart, cart, element, approve } = context;
  const p = product(); s.perfumeDB = [p]; setCart([item({ quantity: 4 })]);
  s.setProductQuantity(s.cartStockKey(p.id, p.warehouse), '0');
  setCart([item({ quantity: 7 })]); approve();
  assert.equal(cart()[0].quantity, 7); assert.match(element('toast').textContent, /changed in another window/);
  s.setProductQuantity(s.cartStockKey(p.id, p.warehouse), '0');
  const other = item({ name: 'IL-B001', warehouse: 'IL', quantity: 2 });
  setCart([item({ quantity: 7 }), other]); approve();
  assert.deepEqual(cart(), [other], 'unrelated additions are retained when the target is unchanged');
});

test('a draft cannot recreate an item removed in another window, and checking still blocks direct edits', () => {
  const context = createContext();
  const { sandbox: s, setCart, cart, element, evaluate } = context;
  const p = product(); s.perfumeDB = [p]; setCart([item({ quantity: 4 })]); evaluate('state.loaded = true');
  const mounted = mountStableCard(context, p), input = mounted.nodes.input;
  editQuantity(context, input, '12'); setCart([]); context.dispatchWindow('storage', { key: storageKeys.cart });
  assert.equal(mounted.nodes.input, input); assert.equal(input.value, '12');
  quantityKey(context, input, 'Enter');
  assert.deepEqual(cart(), []); assert.match(element('toast').textContent, /removed in another window/);
  setCart([item({ quantity: 4 })]); evaluate('state.checking = true'); s.updateOrderUI();
  assert.equal(mounted.nodes.input.disabled, true);
  assert.equal(s.setProductQuantity(s.cartStockKey(p.id, p.warehouse), '7'), false);
  assert.equal(cart()[0].quantity, 4); assert.match(element('toast').textContent, /being checked/);
});

test('warehouse count and pre-discount amounts update with cart inputs without remounting rows', () => {
  const context = createContext();
  const { sandbox: s, setCart, cart, element } = context;
  const tx = product({ stock: 100 }), il = product({ id: 'IL-B001', warehouse: 'IL', price: 27, stock: 100 });
  s.perfumeDB = [tx, il];
  const txItem = item({ quantity: 3 }), ilItem = item({ name: il.id, warehouse: il.warehouse, price: il.price, quantity: 2 });
  setCart([txItem, ilItem]); s.openCart();
  assert.match(element('cart-body').innerHTML, /class="warehouse-section-name">TX Warehouse<\/span><span class="warehouse-section-summary">3 pcs · \$99\.00 before discount/);
  const mounted = mountStableCart(context), row = mounted.lines[0];
  const writes = mounted.root.innerHTMLWrites;
  editQuantity(context, row.input, '20'); quantityKey(context, row.input, 'Enter');
  assert.equal(cart()[0].quantity, 20); assert.equal(row.input.value, '20');
  assert.equal(mounted.headings[0].summary.textContent, '20 pcs · $660.00 before discount');
  assert.equal(mounted.headings[1].summary.textContent, '2 pcs · $54.00 before discount');
  assert.equal(mounted.root.innerHTMLWrites, writes); assert.equal(row.line.querySelector('img'), row.photo);
  const expected = model.getOrderSummary(cart(), site.tiers);
  assert.ok(mounted.summary.innerHTML.includes('$' + expected.totalAmount.toFixed(2)));
  assert.equal(element('mobile-order-total').textContent, '$' + expected.totalAmount.toFixed(2));
  assert.equal(element('mobile-order-savings').textContent, `${s.formatDiscountPercent(expected.discountPercent)}% off · Saved $${expected.discountAmount.toFixed(2)}`);
  assert.equal(element('mobile-order-savings').hidden, false);
});

test('warehouse summaries use cents and normalized warehouses while savings hide at zero discount', () => {
  const items = [item({ warehouse: 'tx warehouse', price: 1.005, quantity: 2 }), item({ warehouse: ' TX ', price: 2.345, quantity: 1 }), item({ warehouse: 'IL', price: 26, quantity: 8 })];
  assert.deepEqual(model.getWarehouseSummaries(items), [{ warehouse: 'TX', qty: 3, subtotal: 4.37 }, { warehouse: 'IL', qty: 8, subtotal: 208 }]);
  const context = createContext();
  const { sandbox: s, setCart, element } = context;
  setCart([item()]); s.updateOrderUI();
  assert.equal(element('mobile-order-savings').hidden, true);
  assert.equal(element('mobile-order-savings').textContent, '');
  assert.equal(s.warehouseSummaryText({ qty: 1, subtotal: 33 }), '1 pc · $33.00 before discount');
  setCart([item({ quantity: 25 })]); s.updateOrderUI();
  const expected = model.getOrderSummary(context.cart(), site.tiers);
  assert.equal(element('mobile-order-savings').hidden, false);
  assert.equal(element('mobile-order-savings').textContent, `${s.formatDiscountPercent(expected.discountPercent)}% off · Saved $${expected.discountAmount.toFixed(2)}`);
  assert.match(element('mobile-order-quantity').textContent, /^25 items · /);
});

const inquiry = (items = [{ sku: 'TX-A055', warehouse: 'TX', quantity: 3 }], revision = 'inquiry-test-1') => ({
  version: 1, source: 'SKU', revision, createdAt: Date.now(), items,
});
function seedInquiry(context, payload = inquiry()) {
  context.memory.set(storageKeys.inquiry, JSON.stringify(payload));
}

test('SKU handoff helper loads before product data and its receiver cache version changes', () => {
  const html = source('index.html');
  assert.match(html, /inquiry-sync\.js\?v=20261009-sku-inquiry/);
  assert.ok(html.indexOf('inquiry-sync.js') < html.indexOf('db.js'));
  assert.match(html, /app\.mjs\?v=20261009-sku-inquiry/);
  assert.match(html, /db\.js\?v=20261009-cart-isolation/);
});

test('a SKU handoff replaces the scoped order with exact own warehouse products and own quote metadata', () => {
  const context = createContext();
  const { sandbox: s, setCart, cart, memory, element } = context;
  const p = product({ price: 26, ml: '75', img: 'local-photo.webp', name: 'Local table name', brand: 'Local Brand', stock: 100 });
  const il = product({ id: 'IL-B001', warehouse: 'IL', price: 45, ml: '50', stock: 100 });
  setCart([item({ name: 'IL-OLD', warehouse: 'IL', price: 1, quantity: 77 })]);
  memory.set(storageKeys.otherCart, JSON.stringify([item({ price: 36, quantity: 99 })]));
  seedInquiry(context, inquiry([{ sku: p.id, warehouse: 'TX', quantity: 7 }, { sku: il.id, warehouse: 'IL', quantity: 2 }]));
  s.perfumeDB = [p, il]; s.renderHome();
  assert.deepEqual(cart(), [
    item({ caption: 'TX-A055 - Local table name', brand: 'Local Brand', price: 26, quantity: 7, ml: '75', img: 'local-photo.webp' }),
    item({ name: 'IL-B001', warehouse: 'IL', caption: 'IL-B001 - New York Nights', price: 45, quantity: 2, ml: '50' }),
  ]);
  assert.equal(memory.get(storageKeys.receipt), 'inquiry-test-1');
  assert.equal(JSON.parse(memory.get(storageKeys.otherCart))[0].quantity, 99);
  const expected = model.getOrderSummary(cart(), site.tiers);
  assert.equal(element('mobile-order-total').textContent, '$' + expected.totalAmount.toFixed(2));
  assert.equal(element('cart-count').textContent, 9);
  assert.match(element('toast').textContent, /Imported 9 pcs from SKU/);
  assert.doesNotMatch(element('cart-validation').textContent, /price.*changed|different.*price/i);
});

test('each directory consumes the same price-free inquiry once and retains independent prices and edits', () => {
  const sharedStorage = new Map();
  const own = createContext({ sharedStorage });
  const otherId = isCatalog ? 'perfume-list' : 'catalog';
  const other = createContext({ sharedStorage, storefrontId: otherId });
  seedInquiry(own, inquiry([{ sku: 'TX-A055', warehouse: 'TX', quantity: 8 }]));
  own.sandbox.perfumeDB = [product({ price: 26, stock: 100 })];
  other.sandbox.perfumeDB = [product({ price: 36, stock: 100, ml: '50', img: 'other-photo.webp' })];
  own.sandbox.renderHome(); other.sandbox.renderHome();
  assert.equal(own.cart()[0].quantity, 8); assert.equal(other.cart()[0].quantity, 8);
  assert.equal(own.cart()[0].price, 26); assert.equal(other.cart()[0].price, 36);
  assert.equal(other.cart()[0].ml, '50'); assert.equal(other.cart()[0].img, 'other-photo.webp');
  assert.equal(sharedStorage.get(own.sandbox.SkuInquirySync.receiptKey(site.id)), 'inquiry-test-1');
  assert.equal(sharedStorage.get(other.sandbox.SkuInquirySync.receiptKey(otherId)), 'inquiry-test-1');
  own.sandbox.setProductQuantity('TX-A055::TX', '5'); other.sandbox.renderHome();
  assert.equal(own.cart()[0].quantity, 5); assert.equal(other.cart()[0].quantity, 8);
  other.sandbox.clearStoredCart(); other.sandbox.updateOrderUI();
  assert.deepEqual(other.cart(), []); assert.equal(own.cart()[0].quantity, 5);
  const refreshed = createContext({ sharedStorage, storefrontId: otherId });
  refreshed.sandbox.perfumeDB = [product({ price: 36, stock: 100 })]; refreshed.sandbox.renderHome();
  assert.deepEqual(refreshed.cart(), [], 'refresh must not resurrect a cleared already-imported inquiry');
});

test('receipt idempotence preserves edited quantities and saved commercial data across refreshes', () => {
  const context = createContext(); seedInquiry(context);
  context.sandbox.perfumeDB = [product({ price: 26, stock: 100 })]; context.sandbox.renderHome();
  context.setCart([item({ price: 26, quantity: 12 })]);
  const refreshed = createContext({ sharedStorage: context.memory });
  refreshed.sandbox.perfumeDB = [product({ price: 36, stock: 100 })]; refreshed.sandbox.renderHome();
  assert.equal(refreshed.cart()[0].quantity, 12); assert.equal(refreshed.cart()[0].price, 26);
  assert.equal(refreshed.element('toast').textContent, '');
});

test('a new inquiry waits for a real page refresh rather than later rendering, storage or pageshow', () => {
  const context = createContext(); seedInquiry(context);
  const { sandbox: s, memory, cart, dispatchWindow, evaluate } = context;
  s.perfumeDB = [product({ stock: 100 })]; s.renderHome();
  s.setProductQuantity('TX-A055::TX', '4');
  seedInquiry(context, inquiry([{ sku: 'TX-A055', warehouse: 'TX', quantity: 9 }], 'inquiry-test-2'));
  dispatchWindow('storage', { key: storageKeys.inquiry, storageArea: s.localStorage });
  dispatchWindow('pageshow'); s.renderHome();
  evaluate('state.checking = true'); s.renderHome(); evaluate('state.checking = false'); s.renderHome();
  assert.equal(cart()[0].quantity, 4); assert.equal(memory.get(storageKeys.receipt), 'inquiry-test-1');
  const refreshed = createContext({ sharedStorage: memory });
  refreshed.sandbox.perfumeDB = [product({ stock: 100 })]; refreshed.sandbox.renderHome();
  assert.equal(refreshed.cart()[0].quantity, 9); assert.equal(memory.get(storageKeys.receipt), 'inquiry-test-2');
});

test('no inquiry on initial load prevents a later paste being consumed during checkout re-render', () => {
  const context = createContext(); const { sandbox: s, cart, memory } = context;
  s.perfumeDB = [product()]; s.renderHome(); s.addToOrder('TX-A055::TX');
  seedInquiry(context); s.renderHome();
  assert.equal(cart()[0].quantity, 1); assert.equal(memory.has(storageKeys.receipt), false);
  const refreshed = createContext({ sharedStorage: memory });
  refreshed.sandbox.perfumeDB = [product()]; refreshed.sandbox.renderHome();
  assert.equal(refreshed.cart()[0].quantity, 3);
});

test('empty product loading cannot consume or acknowledge an inquiry before the table arrives', () => {
  const context = createContext(); seedInquiry(context);
  context.sandbox.renderHome();
  assert.deepEqual(context.cart(), []); assert.equal(context.memory.has(storageKeys.receipt), false);
  context.sandbox.perfumeDB = [product()]; context.sandbox.renderHome();
  assert.equal(context.cart()[0].quantity, 3); assert.equal(context.memory.get(storageKeys.receipt), 'inquiry-test-1');
});

test('a first render during checkout checking cannot import and later quantity renders do not retry it', () => {
  const context = createContext(); seedInquiry(context); context.setCart([item({ quantity: 2 })]);
  context.sandbox.perfumeDB = [product()]; context.evaluate('state.checking = true'); context.sandbox.renderHome();
  context.evaluate('state.checking = false'); context.sandbox.renderHome(); context.sandbox.updateOrderUI();
  assert.equal(context.cart()[0].quantity, 2); assert.equal(context.memory.has(storageKeys.receipt), false);
});

test('unmatched warehouse references never fall back to another warehouse or erase an existing order', () => {
  const context = createContext(); seedInquiry(context); context.setCart([item({ quantity: 7 })]);
  context.sandbox.perfumeDB = [product({ warehouse: 'IL' })]; context.sandbox.renderHome();
  assert.equal(context.cart()[0].quantity, 7); assert.equal(context.memory.get(storageKeys.receipt), 'inquiry-test-1');
  assert.match(context.element('cart-validation').textContent, /TX-A055 \(TX\): not listed in this warehouse/);
  assert.match(context.element('toast').textContent, /existing order was kept/);
  const refreshed = createContext({ sharedStorage: context.memory });
  refreshed.sandbox.perfumeDB = [product()]; refreshed.sandbox.renderHome();
  assert.equal(refreshed.cart()[0].quantity, 7, 'same rejected revision is not retried automatically against a changed table');
});

test('partial imports skip unavailable, low-stock, coming-soon and price-pending rows and cap local inventory explicitly', () => {
  const context = createContext(); const { sandbox: s, cart, element } = context;
  const requested = ['TX-A055', 'IL-B001', 'IL-B002', 'IL-B003', 'IL-B004', 'IL-B999']
    .map((sku, index) => ({ sku, warehouse: sku.split('-')[0], quantity: index ? 2 : 30 }));
  seedInquiry(context, inquiry(requested));
  s.perfumeDB = [product({ price: 26, stock: 19 }),
    product({ id: 'IL-B001', warehouse: 'IL', stock: 0 }),
    product({ id: 'IL-B002', warehouse: 'IL', stock: 18 }),
    product({ id: 'IL-B003', warehouse: 'IL', stock: 0, coming_soon_weight: 1 }),
    product({ id: 'IL-B004', warehouse: 'IL', price: 0, stock: 100 })];
  s.renderHome();
  assert.deepEqual(cart(), [item({ price: 26, quantity: 19 })]);
  const notice = element('cart-validation').textContent;
  assert.match(notice, /30 requested, 19 added \(available stock\)/);
  assert.match(notice, /IL-B001 \(IL\): unavailable/); assert.match(notice, /IL-B002 \(IL\): unavailable/);
  assert.match(notice, /IL-B003 \(IL\): arriving soon/); assert.match(notice, /IL-B004 \(IL\): price pending/);
  assert.match(notice, /IL-B999 \(IL\): not listed/); assert.equal(element('cart-validation').dataset.state, 'error');
  assert.match(element('toast').textContent, /Review the skipped items or quantity adjustments/);
});

test('all unavailable inquiry products retain the old raw scoped order while acknowledging the attempt', () => {
  const context = createContext(); seedInquiry(context); context.setCart([item({ quantity: 11, price: 22 })]);
  const raw = context.memory.get(storageKeys.cart);
  context.sandbox.perfumeDB = [product({ stock: 18 })]; context.sandbox.renderHome();
  assert.equal(context.memory.get(storageKeys.cart), raw); assert.equal(context.memory.get(storageKeys.receipt), 'inquiry-test-1');
  assert.match(context.element('cart-validation').textContent, /No SKU products could be added/);
});

test('malformed, foreign or price-bearing inquiry envelopes are not imported or acknowledged', () => {
  const invalid = [null, {}, { ...inquiry(), version: 2 }, { ...inquiry(), source: 'catalog' },
    { ...inquiry(), revision: '' }, { ...inquiry(), createdAt: 'today' }, inquiry([]),
    inquiry([{ sku: 'B10', warehouse: 'IL', quantity: 1 }]),
    inquiry([{ sku: 'TX-A055', warehouse: 'IL', quantity: 1 }]),
    inquiry([{ sku: 'TX-A055', warehouse: 'TX', quantity: 1.5 }]),
    inquiry([{ sku: 'TX-A055', warehouse: 'TX', quantity: 1, price: 1 }])];
  for (const payload of invalid) {
    const context = createContext(); seedInquiry(context, payload); context.setCart([item({ quantity: 7 })]);
    context.sandbox.perfumeDB = [product()]; context.sandbox.renderHome();
    assert.equal(context.cart()[0].quantity, 7); assert.equal(context.memory.has(storageKeys.receipt), false);
    assert.equal(context.element('toast').textContent, '');
  }
  const broken = createContext(); broken.memory.set(storageKeys.inquiry, '{bad JSON'); broken.setCart([item({ quantity: 4 })]);
  broken.sandbox.perfumeDB = [product()]; broken.sandbox.renderHome();
  assert.equal(broken.cart()[0].quantity, 4); assert.equal(broken.memory.has(storageKeys.receipt), false);
});

test('receipt read failure blocks the import without changing either scoped order', () => {
  const context = createContext(); seedInquiry(context); context.setCart([item({ quantity: 7 })]);
  const { sandbox: s, memory } = context; const get = s.localStorage.getItem;
  s.localStorage.getItem = (key) => { if (key === storageKeys.receipt) throw new Error('blocked'); return get(key); };
  s.perfumeDB = [product()]; s.renderHome();
  assert.equal(context.cart()[0].quantity, 7); assert.equal(memory.has(storageKeys.receipt), false);
  assert.match(context.element('toast').textContent, /could not be read.*order was not changed/);
});

test('failed cart writes never acknowledge or report a successful inquiry import', () => {
  const context = createContext(); seedInquiry(context); context.setCart([item({ quantity: 7 })]);
  const { sandbox: s, memory } = context; const set = s.localStorage.setItem;
  s.localStorage.setItem = (key, value) => { if (key === storageKeys.cart) throw new Error('quota'); return set(key, value); };
  s.perfumeDB = [product()]; s.renderHome();
  assert.equal(context.cart()[0].quantity, 7); assert.equal(memory.has(storageKeys.receipt), false);
  assert.match(context.element('toast').textContent, /could not be saved.*previous order was kept/);
  assert.doesNotMatch(context.element('toast').textContent, /Imported/);
});

test('receipt write failure rolls back the exact previous raw cart and leaves the revision retryable', () => {
  for (const previous of [null, JSON.stringify([item({ price: 22, quantity: 7 })])]) {
    const context = createContext(); seedInquiry(context); if (previous !== null) context.memory.set(storageKeys.cart, previous);
    const { sandbox: s, memory } = context; const set = s.localStorage.setItem;
    s.localStorage.setItem = (key, value) => { if (key === storageKeys.receipt) throw new Error('quota'); return set(key, value); };
    s.perfumeDB = [product()]; s.renderHome();
    assert.equal(memory.get(storageKeys.cart) ?? null, previous); assert.equal(memory.has(storageKeys.receipt), false);
    assert.match(context.element('toast').textContent, /previous order was kept/);
    const refreshed = createContext({ sharedStorage: memory }); refreshed.sandbox.perfumeDB = [product()]; refreshed.sandbox.renderHome();
    assert.equal(refreshed.cart()[0].quantity, 3); assert.equal(memory.get(storageKeys.receipt), 'inquiry-test-1');
  }
});

test('failed receipt rollback does not overwrite a newer same-site edit made during storage failure', () => {
  const context = createContext(); seedInquiry(context); context.setCart([item({ quantity: 7 })]);
  const { sandbox: s, memory } = context; const set = s.localStorage.setItem;
  const newer = JSON.stringify([item({ quantity: 12, price: 36 })]);
  s.localStorage.setItem = (key, value) => {
    if (key === storageKeys.receipt) { memory.set(storageKeys.cart, newer); throw new Error('quota'); }
    return set(key, value);
  };
  s.perfumeDB = [product()]; s.renderHome();
  assert.equal(memory.get(storageKeys.cart), newer); assert.equal(memory.has(storageKeys.receipt), false);
  assert.match(context.element('toast').textContent, /could not be saved completely.*Review your order/);
});

test('failed unmatched-inquiry receipt persistence keeps the old order and does not claim acknowledgement', () => {
  const context = createContext(); seedInquiry(context); context.setCart([item({ quantity: 7 })]);
  const { sandbox: s, memory } = context; const set = s.localStorage.setItem;
  s.localStorage.setItem = (key, value) => { if (key === storageKeys.receipt) throw new Error('blocked'); return set(key, value); };
  s.perfumeDB = [product({ id: 'IL-B001', warehouse: 'IL' })]; s.renderHome();
  assert.equal(context.cart()[0].quantity, 7); assert.equal(memory.has(storageKeys.receipt), false);
  assert.match(context.element('toast').textContent, /could not be saved/);
});

test('each new inquiry replaces rather than appends and leaves unrelated storage completely unchanged', () => {
  const untouched = [[storageKeys.otherCart, JSON.stringify([item({ quantity: 99, price: 36 })])],
    [storageKeys.sharedCart, JSON.stringify([item({ quantity: 55 })])], [storageKeys.sharedReset, 'done'],
    ['bestProducts1SkuCartV2', JSON.stringify([item({ quantity: 18 })])]];
  const context = createContext({ initialStorage: untouched }); context.setCart([item({ quantity: 7 })]);
  seedInquiry(context, inquiry([{ sku: 'TX-A055', warehouse: 'TX', quantity: 2 }]));
  context.sandbox.perfumeDB = [product()]; context.sandbox.renderHome();
  assert.equal(context.cart()[0].quantity, 2);
  for (const [key, value] of untouched) assert.equal(context.memory.get(key), value, key);
  context.sandbox.clearStoredCart();
  seedInquiry(context, inquiry([{ sku: 'TX-A055', warehouse: 'TX', quantity: 5 }], 'inquiry-test-2'));
  const refreshed = createContext({ sharedStorage: context.memory }); refreshed.sandbox.perfumeDB = [product()]; refreshed.sandbox.renderHome();
  assert.equal(refreshed.cart()[0].quantity, 5);
  for (const [key, value] of untouched) assert.equal(context.memory.get(key), value, key);
});
