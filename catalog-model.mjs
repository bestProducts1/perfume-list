const MIN_STOCK = 19;
const BLOCKED_STATUSES = new Set(['OUT OF STOCK', 'MISSING INVENTORY', 'UNAVAILABLE', 'LOW / HIDDEN']);
const STOPWORDS = new Set(['a', 'an', 'and', 'de', 'el', 'for', 'la', 'le', 'of', 'the']);
const BRAND_ALIASES = {
  lv: 'Louis Vuitton', louis: 'Louis Vuitton', 'louis vuitton': 'Louis Vuitton',
  ysl: 'Yves Saint Laurent', yves: 'Yves Saint Laurent', saint: 'Yves Saint Laurent',
  'yves saint laurent': 'Yves Saint Laurent',
  mfk: 'Maison Francis Kurkdjian', kurkdjian: 'Maison Francis Kurkdjian',
  'maison francis kurkdjian': 'Maison Francis Kurkdjian',
  tf: 'Tom Ford', tom: 'Tom Ford', ford: 'Tom Ford', 'tom ford': 'Tom Ford',
  armani: 'Giorgio Armani', 'giorgio armani': 'Giorgio Armani',
  versace: 'Versace', jpg: 'Jean Paul Gaultier', jeanpaulgaultier: 'Jean Paul Gaultier',
  'jean paul gaultier': 'Jean Paul Gaultier',
  pacorabanne: 'Paco Rabanne', 'paco rabanne': 'Paco Rabanne', rabanne: 'Paco Rabanne',
  bvlgari: 'Bvlgari', bulgari: 'Bvlgari',
  pdm: 'Parfums de Marly', marly: 'Parfums de Marly', 'parfums de marly': 'Parfums de Marly',
  bond: 'Bond No. 9', 'bond no 9': 'Bond No. 9',
  dolce: 'Dolce & Gabbana', gabbana: 'Dolce & Gabbana', 'd&g': 'Dolce & Gabbana',
  'dolce gabbana': 'Dolce & Gabbana', 'dolce and gabbana': 'Dolce & Gabbana',
  viktor: 'Viktor & Rolf', rolf: 'Viktor & Rolf', 'viktor rolf': 'Viktor & Rolf',
  'viktor and rolf': 'Viktor & Rolf',
};

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:milliliters?|millilitres?|ml)\b/g,
      (_, size) => `${size.replace(',', '.')}ml`)
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .trim().replace(/\s+/g, ' ');
}

export function formatSize(value) {
  const size = String(value ?? '').trim();
  return /^\d+(?:\.\d+)?$/.test(size) ? `${size}ml` : size;
}

function brandSearchKey(value) {
  const normalized = normalizeText(value);
  return normalizeText(BRAND_ALIASES[normalized] || normalized);
}

export function searchProducts(products, query = '') {
  const source = Array.isArray(products) ? products : [];
  const term = normalizeText(query);
  if (!term) return String(query ?? '').trim() ? [] : [...source];
  const paddedTerm = ` ${term} `;
  const aliases = [
    ...Object.entries(BRAND_ALIASES),
    ...source.map((product) => [product.brand, product.brand]),
  ].map(([alias, brand]) => ({ alias: normalizeText(alias), brand }))
    .filter(({ alias }) => alias)
    .sort((a, b) => b.alias.length - a.alias.length);
  const brandMatch = aliases.find(({ alias }) => paddedTerm.includes(` ${alias} `));
  const remainder = brandMatch ? paddedTerm.replace(` ${brandMatch.alias} `, ' ') : term;
  const tokens = normalizeText(remainder).split(' ').filter((token) => token && !STOPWORDS.has(token));
  return source.map((product, index) => {
    const fields = {
      id: normalizeText(product.id || product.sku),
      brand: normalizeText(product.brand),
      name: normalizeText(product.name),
      size: normalizeText(formatSize(product.ml)),
    };
    const haystack = `${fields.id} ${fields.brand} ${fields.name} ${fields.size}`;
    const words = haystack.split(' ');
    const matches = (!brandMatch || brandSearchKey(product.brand) === brandSearchKey(brandMatch.brand)) &&
      (tokens.length ? tokens.every((token) => token.length <= 2 ? words.includes(token) : haystack.includes(token)) : Boolean(brandMatch));
    const score = tokens.reduce((total, token) => total +
      (fields.id.includes(token) ? 100 : 0) + (fields.brand.includes(token) ? 60 : 0) +
      (fields.name.includes(token) ? 50 : 0) + (fields.size.includes(token) ? 50 : 0), 0);
    return { product, index, matches, score };
  }).filter(({ matches }) => matches)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ product }) => product);
}

function stockOf(product) {
  const value = product?.stock !== '' && product?.stock != null ? product.stock : product?.inventory;
  return value === '' || value == null ? NaN : Number(value);
}

function positiveWeight(product, field) {
  const value = Number(product?.[field]);
  return Number.isFinite(value) && value > 0 ? value : Infinity;
}

function isOrderable(product) {
  const price = Number(product?.price);
  const status = String(product?.stock_status || '').trim().toUpperCase();
  if (!Number.isFinite(price) || price <= 0 || BLOCKED_STATUSES.has(status) || isComingSoon(product)) return false;
  const stock = stockOf(product);
  return Number.isFinite(stock) ? stock >= MIN_STOCK : status === 'AVAILABLE';
}

export function isComingSoon(product) {
  return positiveWeight(product, 'coming_soon_weight') < Infinity && !(stockOf(product) >= MIN_STOCK);
}

function warehouseCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+WAREHOUSE$/, '').trim();
}

function categoryMatches(product, category) {
  const gender = normalizeText(product.gender || product.target);
  if (category === 'Men' || category === 'Women' || category === 'Unisex') return gender === normalizeText(category);
  if (category === 'GiftSets') {
    const size = String(product.ml ?? '');
    return /\b(set|gift\s*box)\b/i.test(String(product.name ?? '')) ||
      /\bset\b/i.test(size) || /\d+(?:\.\d+)?\s*ml\s*[*×x]\s*\d+/i.test(size);
  }
  if (category === 'HotSelling') return positiveWeight(product, 'hot_selling_weight') < Infinity;
  if (category === 'NewArrival') return positiveWeight(product, 'new_arrival_weight') < Infinity;
  return true;
}

export function selectProducts(products, filters = {}) {
  const category = filters.category || 'All';
  const warehouse = warehouseCode(filters.warehouse);
  const brand = normalizeText(filters.brand);
  const priceRange = filters.priceRange || filters.priceRanges || 'any';
  let result = (Array.isArray(products) ? products : []).filter((product) => {
    const orderable = isOrderable(product);
    const eligible = category === 'ComingSoon' ? isComingSoon(product) :
      category === 'HotSelling' || category === 'NewArrival' ? orderable :
        orderable || (filters.stockOnly === false && isComingSoon(product));
    if (!eligible || !categoryMatches(product, category)) return false;
    if (warehouse && warehouse !== 'ALL' && warehouseCode(product.warehouse) !== warehouse) return false;
    if (brand && brand !== 'all' && normalizeText(product.brand) !== brand) return false;
    const price = Number(product.price);
    if (priceRange !== 'any' && (!Number.isFinite(price) || price <= 0)) return false;
    if (priceRange === 'under30' && !(price < 30)) return false;
    if (priceRange === '30to40' && !(price >= 30 && price <= 40)) return false;
    if (priceRange === 'over40' && !(price > 40)) return false;
    return true;
  });
  if (filters.query || filters.search) result = searchProducts(result, filters.query || filters.search);
  const sort = filters.sort || 'popular';
  return result.map((product, index) => ({ product, index })).sort((a, b) => {
    let difference = 0;
    if (sort === 'priceAsc' || sort === 'priceDesc') {
      const priceA = Number(a.product.price) > 0 ? Number(a.product.price) : Infinity;
      const priceB = Number(b.product.price) > 0 ? Number(b.product.price) : Infinity;
      difference = priceA === Infinity || priceB === Infinity ? priceA - priceB :
        sort === 'priceAsc' ? priceA - priceB : priceB - priceA;
    } else if (sort === 'nameAsc') {
      difference = String(a.product.name || '').localeCompare(String(b.product.name || ''), 'en', { sensitivity: 'base' });
    } else {
      const field = category === 'ComingSoon' ? 'coming_soon_weight' :
        sort === 'newest' || category === 'NewArrival' ? 'new_arrival_weight' : 'hot_selling_weight';
      const weightA = positiveWeight(a.product, field);
      const weightB = positiveWeight(b.product, field);
      difference = weightA === weightB ? 0 : weightA - weightB;
    }
    return difference || a.index - b.index;
  }).map(({ product }) => product);
}

export function getOrderSummary(items, tiers = []) {
  let qty = 0;
  let subtotalCents = 0;
  let lvQty = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const rawQuantity = Number(item?.quantity);
    const quantity = Number.isFinite(rawQuantity) ? Math.max(0, Math.floor(rawQuantity)) : 0;
    if (!quantity) continue;
    const rawPrice = Number(item?.price);
    const priceCents = Number.isFinite(rawPrice) && rawPrice > 0 ? Math.round((rawPrice + Number.EPSILON) * 100) : 0;
    qty += quantity;
    subtotalCents += priceCents * quantity;
    if (`${normalizeText(item.brand)} ${normalizeText(item.caption)}`.replace(/\s+/g, '').includes('louisvuitton')) lvQty += quantity;
  }
  const tier = (Array.isArray(tiers) ? tiers : []).find(({ min, max }) => qty >= min && qty <= max);
  const rawPercent = Number(tier?.percent);
  const discountPercent = Number.isFinite(rawPercent) && rawPercent > 0 ? rawPercent : 0;
  const discountCents = Math.round((subtotalCents * discountPercent) + Number.EPSILON);
  return {
    qty, subtotal: subtotalCents / 100, discountPercent,
    discountAmount: discountCents / 100,
    totalAmount: (subtotalCents - discountCents) / 100,
    lvQty, otherQty: qty - lvQty,
  };
}
