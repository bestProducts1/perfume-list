// A one-way inquiry handoff, not a shared shopping cart or a source of prices.
(() => {
  const storageKey = 'bestProducts1:sku:inquiry:v1';
  const fields = ['sku', 'warehouse', 'quantity'];
  const skuPattern = /^[A-Z]{1,10}-[A-Z0-9][A-Z0-9_-]{0,99}$/;
  const revisionPattern = /^[A-Za-z0-9._:-]{1,160}$/;

  function normalizeItems(items, fromCart = false) {
    if (!Array.isArray(items) || !items.length || items.length > 2000) return null;
    const grouped = new Map();
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      if (!fromCart && Object.keys(item).some(key => !fields.includes(key))) return null;
      const rawSku = fromCart ? item.name || item.sku || item.id : item.sku;
      if (typeof rawSku !== 'string') return null;
      const sku = rawSku.trim().toUpperCase();
      if (!skuPattern.test(sku)) return null;
      const prefix = sku.split('-')[0];
      const rawWarehouse = fromCart ? item.warehouse || prefix : item.warehouse;
      if (typeof rawWarehouse !== 'string') return null;
      const warehouse = rawWarehouse.trim().toUpperCase().replace(/\s+WAREHOUSE$/, '').trim();
      if (warehouse !== prefix) return null;
      const rawQuantity = item.quantity;
      const numericText = fromCart && typeof rawQuantity === 'string' && /^\d+$/.test(rawQuantity.trim());
      if (typeof rawQuantity !== 'number' && !numericText) return null;
      const quantity = numericText ? Number(rawQuantity) : rawQuantity;
      if (!Number.isSafeInteger(quantity) || quantity <= 0) return null;
      const key = sku + '::' + warehouse;
      const existing = grouped.get(key);
      if (existing) {
        const total = existing.quantity + quantity;
        if (!Number.isSafeInteger(total)) return null;
        existing.quantity = total;
      } else grouped.set(key, {sku, warehouse, quantity});
    }
    return [...grouped.values()];
  }

  function read() {
    try {
      const payload = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (!payload || payload.version !== 1 || payload.source !== 'SKU' ||
          typeof payload.revision !== 'string' || !revisionPattern.test(payload.revision) ||
          !Number.isSafeInteger(payload.createdAt) || payload.createdAt <= 0) return null;
      const items = normalizeItems(payload.items);
      return items ? {version: 1, source: 'SKU', revision: payload.revision, createdAt: payload.createdAt, items} : null;
    } catch { return null; }
  }

  function publish(cart) {
    const items = normalizeItems(cart, true);
    if (!items) throw new Error('The inquiry contains invalid product codes or quantities.');
    const createdAt = Date.now();
    const revision = window.crypto?.randomUUID?.() ||
      createdAt.toString(36) + '-' + Math.random().toString(36).slice(2);
    const payload = {version: 1, source: 'SKU', revision, createdAt, items};
    localStorage.setItem(storageKey, JSON.stringify(payload));
    return payload;
  }

  function receiptKey(siteId) {
    if (!['catalog', 'perfume-list'].includes(siteId)) throw new Error('Unknown receiving storefront.');
    return 'bestProducts1:' + siteId + ':sku-inquiry-applied:v1';
  }

  window.SkuInquirySync = Object.freeze({storageKey, read, publish, receiptKey});
})();
