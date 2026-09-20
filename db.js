// ==========================================
// db.js - 产品数据管理中心
// ==========================================

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRFWYImNbJ0ao5z0VDk_VZwhOP1pnY2UZdFuwxtYOvKaNfEX4sInJh7uk-MlRSH9kffdZ5TjzhudLao/pub?gid=1967485424&single=true&output=csv";

// 缓存时间 (1分钟)
const CACHE_DURATION = 1 * 60 * 1000;
const PRODUCT_CACHE_KEY = "perfumeDB_BestProducts_Data_V13";
const PRODUCT_TIME_KEY = "perfumeDB_BestProducts_Time_V13";
const PRODUCT_FALLBACK_KEY = "perfumeDB_BestProducts_Last_Valid_Data_V13";
const MIN_ORDER_STOCK = 19;
let latestProductRequest = null;

window.perfumeDB = [];

document.addEventListener("DOMContentLoaded", () => {
  initProductData();
});

async function initProductData() {
  // Use a dedicated cache version for the warehouse-based catalog.
  const cacheKey = PRODUCT_CACHE_KEY;
  const timeKey = PRODUCT_TIME_KEY;
  const fallbackKey = PRODUCT_FALLBACK_KEY;

  const now = new Date().getTime();
  const cachedTime = localStorage.getItem(timeKey);
  const cachedData = localStorage.getItem(cacheKey);

  function readValidCache(rawData) {
    if (!rawData) return null;
    try {
      const parsed = JSON.parse(rawData);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  const cachedProducts = readValidCache(cachedData);

  // 1. 尝试加载缓存
  if (cachedProducts && cachedTime && now - cachedTime < CACHE_DURATION) {
    console.log("🚀 加载缓存数据");
    window.perfumeDB = cachedProducts;
    runPageLogic();
    return;
  }

  // 2. 下载新数据
  console.log("🌐 下载最新数据...");
  try {
    await fetchLatestProductData();

    runPageLogic();
  } catch (error) {
    console.error("下载失败:", error);
    // 数据源异常时保留上一次成功加载的商品，避免页面突然变空。
    const fallbackProducts =
      cachedProducts ||
      readValidCache(localStorage.getItem(fallbackKey));
    if (fallbackProducts) {
      window.perfumeDB = fallbackProducts;
      runPageLogic();
      if (typeof showToast === "function") {
        showToast("Showing saved products. Checkout requires a live inventory check.");
      }
    }
  }
}

// Checkout must use a successful network response, never an offline fallback.
async function fetchLatestProductData() {
  if (latestProductRequest) return latestProductRequest;
  latestProductRequest = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${SHEET_URL}&_=${Date.now()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Could not load the latest inventory.");
      const products = parseCSV(await response.text()).filter(
        (product) =>
          String(product.id || "").trim() &&
          String(product.warehouse || "").trim() &&
          String(product.name || "").trim() &&
          (Number(product.price) > 0 || Number(product.coming_soon_weight) > 0),
      );
      if (!products.length) {
        throw new Error("The inventory data is incomplete. Please try again later.");
      }
      const keys = products.map((p) => cartStockKey(p.id, p.warehouse));
      if (products.some((p) => !String(p.id).trim() || !String(p.warehouse).trim()) ||
          new Set(keys).size !== keys.length) {
        throw new Error("The inventory data needs to be checked. Please try again later.");
      }
      window.perfumeDB = products;
      try {
        const data = JSON.stringify(products);
        localStorage.setItem(PRODUCT_CACHE_KEY, data);
        localStorage.setItem(PRODUCT_TIME_KEY, String(Date.now()));
        localStorage.setItem(PRODUCT_FALLBACK_KEY, data);
      } catch (error) {
        console.warn("Product cache could not be saved.", error);
      }
      return products;
    } finally {
      clearTimeout(timer);
    }
  })();
  try {
    return await latestProductRequest;
  } finally {
    latestProductRequest = null;
  }
}

function cartStockKey(sku, warehouse) {
  const code = String(warehouse || "").trim().toUpperCase().replace(/\s+WAREHOUSE$/, "").trim();
  return `${String(sku || "").trim().toUpperCase()}::${code}`;
}

function readStoredCart() {
  try {
    const cart = JSON.parse(localStorage.getItem("perfumeCart") || "[]");
    return Array.isArray(cart) ? cart.filter((item) => item && typeof item === "object") : [];
  } catch (error) {
    return [];
  }
}

function getCartProduct(item, products = window.perfumeDB) {
  const key = cartStockKey(item.name, item.warehouse);
  return (products || []).find((p) => cartStockKey(p.id, p.warehouse) === key);
}

function getOrderStockLimit(product) {
  const rawStock = product?.stock !== "" && product?.stock != null
    ? product.stock
    : product?.inventory;
  const stock = rawStock === "" || rawStock == null ? NaN : Number(rawStock);
  const price = Number(product?.price);
  const status = String(product?.stock_status || "").trim().toUpperCase();
  const unavailable = [
    "OUT OF STOCK",
    "MISSING INVENTORY",
    "UNAVAILABLE",
    "LOW / HIDDEN",
  ].includes(status);
  if (unavailable || !Number.isFinite(price) || price <= 0) return 0;
  if (Number.isFinite(stock)) {
    return stock >= MIN_ORDER_STOCK ? Math.floor(stock) : 0;
  }
  return status === "AVAILABLE" ? Number.MAX_SAFE_INTEGER : 0;
}

// Pure reconciliation: preserve the chosen warehouse and ask before applying changes.
function reconcileCart(items, products) {
  const updatedItems = [];
  const changes = [];
  const allocated = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const product = getCartProduct(item, products);
    const label = String(item.name || "Product");
    const limit = getOrderStockLimit(product);
    if (!limit) {
      const reason = !product ? "no longer listed in this warehouse" :
        !(Number(product.price) > 0) ? "price pending" : "out of stock or unavailable";
      changes.push(`${label}: removed (${reason}).`);
      return;
    }
    const key = cartStockKey(product.id, product.warehouse);
    const rawQuantity = Number(item.quantity);
    const remaining = Math.max(0, limit - (allocated.get(key) || 0));
    const quantity = Number.isFinite(rawQuantity)
      ? Math.max(0, Math.min(Math.floor(rawQuantity), remaining)) : 0;
    if (!quantity) {
      changes.push(`${label}: removed (invalid quantity or stock limit reached).`);
      return;
    }
    allocated.set(key, (allocated.get(key) || 0) + quantity);
    if (quantity !== rawQuantity) {
      changes.push(`${label}: quantity ${item.quantity} → ${quantity} (available: ${limit}).`);
    }
    if (Number(item.price) !== Number(product.price)) {
      changes.push(`${label}: price $${(Number(item.price) || 0).toFixed(2)} → $${Number(product.price).toFixed(2)}.`);
    }
    const size = String(product.ml ?? "").trim();
    if (String(item.ml ?? "").trim() !== size) {
      changes.push(`${label}: size updated to ${formatOrderSize(size) || "not specified"}.`);
    }
    updatedItems.push({
      ...item,
      name: product.id,
      caption: `${product.id} - ${product.name}`,
      brand: product.brand,
      img: product.img,
      warehouse: product.warehouse,
      ml: size,
      price: Number(product.price),
      quantity,
    });
  });
  return { items: updatedItems, changes };
}

function runPageLogic() {
  // 确保首页和购物车逻辑存在才执行
  if (typeof renderHome === "function") renderHome();
  if (typeof renderCart === "function") renderCart();
}

function getShippingCost(totalQuantity) {
  return 0;
}

function buildWhatsAppOrderMessage(items, discountTiers) {
  const cart = (Array.isArray(items) ? items : []).filter(
    (item) => (Number(item.quantity) || 0) > 0,
  );
  let totalQty = 0;
  let lvCount = 0;
  let otherCount = 0;
  let subtotal = 0;
  const warehouseGroups = new Map();

  cart.forEach((item) => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.price) || 0;
    const warehouseCode = String(item.warehouse || "")
      .trim()
      .toUpperCase()
      .replace(/\s+WAREHOUSE$/, "")
      .trim();
    const groupKey = warehouseCode || "UNASSIGNED";

    totalQty += quantity;
    subtotal += unitPrice * quantity;
    if (String(item.caption || "").toLowerCase().includes("louis vuitton")) {
      lvCount += quantity;
    } else {
      otherCount += quantity;
    }

    if (!warehouseGroups.has(groupKey)) {
      warehouseGroups.set(groupKey, {
        label: warehouseCode
          ? `${warehouseCode} Warehouse`
          : "Warehouse not selected",
        items: [],
      });
    }
    warehouseGroups.get(groupKey).items.push({
      caption: String(item.caption || item.name || "Product").trim(),
      size: formatOrderSize(item.ml),
      quantity,
      unitPrice,
      lineSubtotal: unitPrice * quantity,
    });
  });

  const tiers = Array.isArray(discountTiers) ? discountTiers : [];
  const tier =
    tiers.find((item) => totalQty >= item.min && totalQty <= item.max) ||
    tiers[0] ||
    { percent: 0 };
  const discountPercent = Number(tier.percent) || 0;
  const discountAmount = subtotal * discountPercent;
  const shipping = getShippingCost(totalQty);
  const finalTotal = subtotal - discountAmount + shipping;

  let message = `*New Order Request* 📦\n`;
  message += `----------------------------\n`;
  warehouseGroups.forEach((group) => {
    message += `*${group.label}*\n`;
    group.items.forEach((item) => {
      const compactCaption = item.caption.replace(/\s+/g, "").toLowerCase();
      const compactSize = item.size.replace(/\s+/g, "").toLowerCase();
      const sizeSuffix =
        item.size && !compactCaption.includes(compactSize)
          ? ` · ${item.size}`
          : "";
      message += `• ${item.caption}${sizeSuffix}\n`;
      message += `  Unit $${item.unitPrice.toFixed(2)} × ${item.quantity} = Line subtotal *$${item.lineSubtotal.toFixed(2)}*\n`;
    });
    message += `\n`;
  });

  message += `----------------------------\n`;
  message += `LV Quantity: ${lvCount}\n`;
  message += `Other Quantity: ${otherCount}\n`;
  message += `*Total Quantity: ${totalQty} pcs*\n`;
  message += `----------------------------\n`;
  message += `Subtotal: $${subtotal.toFixed(2)}\n`;
  message += `Discount (${Math.round(discountPercent * 100)}%): -$${discountAmount.toFixed(2)}\n`;
  message += `Shipping: ${shipping === 0 ? "FREE" : "$" + shipping.toFixed(2)}\n`;
  message += `*Total Amount:* $${finalTotal.toFixed(2)}`;
  return message;
}

function formatOrderSize(value) {
  const size = String(value ?? "").trim();
  if (!size) return "";
  return /^\d+(?:\.\d+)?$/.test(size) ? `${size}ml` : size;
}

window.buildWhatsAppOrderMessage = buildWhatsAppOrderMessage;
window.getShippingCost = getShippingCost;

function parseCSV(csvText) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const text = String(csvText).replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value.trim()); value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      row.push(value.trim()); rows.push(row); row = []; value = "";
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else value += char;
  }
  if (quoted) throw new Error("Incomplete quoted product data.");
  if (value || row.length) { row.push(value.trim()); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw new Error("Duplicate product columns.");

  return rows
    .slice(1)
    .filter((values) => values.some((cell) => cell !== ""))
    .map((values) => {
      const obj = {};
      if (values.length !== headers.length) throw new Error("Incomplete product row.");

      headers.forEach((header, index) => {
        let val = values[index] || "";

        // Keep empty numeric cells empty so pending prices and stock can be
        // distinguished from an intentional numeric zero.
        if (
          header === "price" ||
          header === "stock" ||
          header === "inventory" ||
          header === "hot_selling_weight" ||
          header === "new_arrival_weight" ||
          header === "coming_soon_weight"
        ) {
          val = val === "" ? "" : Number(val);
        }

        obj[header] = val;
      });

      // Accept the current sheet names and the legacy storefront names. The
      // current sheet derives the warehouse from a SKU such as TX-A001, while
      // explicit warehouse fields remain supported for older data sources.
      obj.id = obj.id || obj.sku || "";
      obj.img = obj.image_url || obj.img || "";
      obj.gender = obj.target || obj.gender || "";
      const inferredWarehouse = String(obj.id).includes("-")
        ? String(obj.id).split("-")[0]
        : "";
      obj.warehouse = obj.warehouse || obj.warehouse_code || obj.location || inferredWarehouse;
      const inventorySource = obj.inventory !== undefined
        ? obj.inventory
        : obj.stock !== undefined
          ? obj.stock
          : obj["#ref!"];
      obj.inventory = inventorySource === "" || inventorySource == null
        ? ""
        : Number(inventorySource);
      obj.stock = obj.stock === "" || obj.stock == null
        ? obj.inventory
        : Number(obj.stock);
      obj.stock_status = String(obj.stock_status || "").trim().toUpperCase();

      return obj;
    });
}
