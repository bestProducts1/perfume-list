// ==========================================
// 🔗 香水网站跳转目标 URL
// ==========================================
const PERFUME_SITE_URL = "https://bestproducts1.github.io/catalog/";

// ==========================================
// 🛒 全局购物车 LocalStorage 通用管理函数
// ==========================================
function loadCart() {
  try {
    const data = localStorage.getItem("perfumeCart");
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error("读取购物车失败:", e);
    return [];
  }
}

function saveCart(cart) {
  try {
    localStorage.setItem("perfumeCart", JSON.stringify(cart));
  } catch (e) {
    console.error("保存购物车失败:", e);
  }
}

function clearCart() {
  localStorage.removeItem("perfumeCart");
}

// ==========================================
// db.js - 产品数据管理中心
// ==========================================

// 🔴 注意：已将 pubhtml 修正为 pub?output=csv
const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRu7b5PXTT7XKOyfWf8zyQIE-uP0W6ZmuQh7e6BdsqQ-igpoLC_IMd-RWk6KBHFR0jJgic--5av7zGc/pub?output=csv";

const CACHE_DURATION = 1 * 60 * 1000; // 缓存时间 (1分钟)
window.perfumeDB = [];

document.addEventListener("DOMContentLoaded", () => {
  initProductData();
});

async function initProductData() {
  const cacheKey = "perfumeDB_Data_V5";
  const timeKey = "perfumeDB_Time_V5";

  const now = new Date().getTime();
  const cachedTime = localStorage.getItem(timeKey);
  const cachedData = localStorage.getItem(cacheKey);

  if (cachedData && cachedTime && now - cachedTime < CACHE_DURATION) {
    try {
      window.perfumeDB = JSON.parse(cachedData);
      runPageLogic();
      return;
    } catch (e) {
      console.warn("缓存数据损坏，重新下载");
    }
  }

  try {
    const response = await fetch(SHEET_URL);
    if (!response.ok) throw new Error("网络响应错误");
    const data = await response.text();
    window.perfumeDB = parseCSV(data);

    localStorage.setItem(cacheKey, JSON.stringify(window.perfumeDB));
    localStorage.setItem(timeKey, now);

    runPageLogic();
  } catch (error) {
    console.error("下载失败:", error);
    if (cachedData) {
      window.perfumeDB = JSON.parse(cachedData);
      runPageLogic();
      alert("网络较慢，已加载离线数据");
    }
  }
}

function runPageLogic() {
  if (typeof renderHome === "function") renderHome();
  if (typeof renderCartPage === "function") renderCartPage();
}

function parseCSV(csvText) {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0]
    .trim()
    .split(",")
    .map((h) => h.trim().toLowerCase());

  return lines
    .slice(1)
    .map((line) => {
      const values = [];
      let current = "";
      let inQuote = false;
      for (let char of line) {
        if (char === '"') {
          inQuote = !inQuote;
        } else if (char === "," && !inQuote) {
          values.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      values.push(current.trim());

      if (values.length < headers.length) return null;

      const obj = {};
      headers.forEach((header, index) => {
        let val = values[index] ? values[index].replace(/^"|"$/g, "") : "";
        if (
          header === "price" ||
          header === "stock" ||
          header === "inventory"
        ) {
          val = Number(val);
        }
        obj[header] = val;
      });
      return obj;
    })
    .filter((item) => item !== null);
}