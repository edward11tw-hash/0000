// server.js

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

// 有沒有設定 DATABASE_URL？有的話就用 PostgreSQL
const useDb = !!process.env.DATABASE_URL;
let pool = null;

if (useDb) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false
  });
  console.log("✅ 使用 PostgreSQL 資料庫作為【菜單】儲存");
} else {
  console.log("⚠️ 未設定 DATABASE_URL，【菜單】改用本機 JSON 檔 menu.json 儲存");
}

const app = express();
app.use(cors());
app.use(express.json());

// ------------------------------
// 檔案路徑
// ------------------------------
const MENU_FILE = path.join(__dirname, "menu.json");
const MEMBERS_FILE = path.join(__dirname, "members.json");
const ORDERS_FILE = path.join(__dirname, "orders.json");

// ------------------------------
// 點數規則（你可自行調整）
// ------------------------------
const POINT_PER_AMOUNT = 100; // 消費滿多少元＝1點
const POINT_VALUE = 1;        // 1 點可折抵多少元（1點＝1元）

// 可用訂單狀態（要跟 admin/orders.js 一樣）
const VALID_STATUS = [
  "PENDING_PAYMENT",
  "PAID",
  "COOKING",
  "READY",
  "DONE"
];

// ------------------------------
// 通用讀寫 JSON
// ------------------------------
function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2), "utf-8");
  }
  const data = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(data);
  } catch (err) {
    console.error(filePath, "格式錯誤，重置為空陣列");
    fs.writeFileSync(filePath, JSON.stringify([], null, 2), "utf-8");
    return [];
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ------------------------------
// menu / members / orders 的存取
// ------------------------------
function loadMenu() {
  return loadJson(MENU_FILE);
}
function saveMenu(menu) {
  saveJson(MENU_FILE, menu);
}

function loadMembers() {
  return loadJson(MEMBERS_FILE);
}
function saveMembers(members) {
  saveJson(MEMBERS_FILE, members);
}

function loadOrders() {
  return loadJson(ORDERS_FILE);
}
function saveOrders(orders) {
  saveJson(ORDERS_FILE, orders);
}

// ------------------------------
// 菜單 API
// ------------------------------
app.get("/api/menu", async (req, res) => {
  try {
    if (pool) {
      const result = await pool.query(`
        SELECT 
          id,
          name,
          price,
          category,
          image,
          description,
          tags,
          spicy,
          is_hot
        FROM menu_items
        ORDER BY id ASC
      `);

      const items = result.rows.map(r => {
        // 處理 tags（可能是字串也可能是 JSON）
        let parsedTags = [];
        if (Array.isArray(r.tags)) {
          parsedTags = r.tags;
        } else if (typeof r.tags === "string" && r.tags.trim() !== "") {
          parsedTags = r.tags
            .split(/[;,、，]/)
            .map(t => t.trim())
            .filter(Boolean);
        }

        return {
          id: r.id,
          name: r.name,
          price: Number(r.price),
          category: r.category,
          image: r.image,
          description: r.description || "",
          tags: parsedTags,
          spicy: !!r.spicy,     // PostgreSQL boolean 轉 JS boolean
          isHot: !!r.is_hot     // 給前端使用 item.isHot
        };
      });

      return res.json(items);
    }

    // 沒資料庫時 fallback
    return res.json(loadMenu());
  } catch (err) {
    console.error("讀取菜單失敗", err);
    res.status(500).json({ message: "讀取菜單失敗" });
  }
});

app.post("/api/menu", async (req, res) => {
  // 從前端接收的欄位（後台 menu.js 會送這些）
  const {
    name,
    price,
    category,
    image,
    description,
    tags,
    spicy,
    isHot
  } = req.body;

  const priceNumber = Number(price);
  if (!name || !Number.isFinite(priceNumber)) {
    return res.status(400).json({ message: "缺少品名或價格錯誤" });
  }

  try {
    if (pool) {
      // tags 可能是陣列或字串，先轉成儲存到 DB 的字串
      let tagsValue = null;
      if (Array.isArray(tags)) {
        tagsValue = tags.join(",");
      } else if (typeof tags === "string" && tags.trim() !== "") {
        tagsValue = tags.trim();
      }

      const spicyVal = !!spicy;  // 轉成 true/false
      const isHotVal = !!isHot;  // 對應資料表 is_hot

      const result = await pool.query(
        `
        INSERT INTO menu_items
          (name, price, category, image, description, tags, spicy, is_hot)
        VALUES
          ($1,   $2,    $3,       $4,    $5,          $6,   $7,    $8)
        RETURNING
          id, name, price, category, image, description, tags, spicy, is_hot
        `,
        [
          name,
          priceNumber,
          category || null,
          image || null,
          description || null,
          tagsValue,
          spicyVal,
          isHotVal
        ]
      );

      const row = result.rows[0];

      // 把 DB 裡的 tags 字串轉成陣列回給前端（跟 GET /api/menu 一致）
      let parsedTags = [];
      if (Array.isArray(row.tags)) {
        parsedTags = row.tags;
      } else if (typeof row.tags === "string" && row.tags.trim() !== "") {
        parsedTags = row.tags
          .split(/[;,、，]/)
          .map(t => t.trim())
          .filter(Boolean);
      }

      return res.status(201).json({
        id: row.id,
        name: row.name,
        price: Number(row.price),
        category: row.category,
        image: row.image,
        description: row.description || "",
        tags: parsedTags,
        spicy: !!row.spicy,
        isHot: !!row.is_hot
      });
    }

    // 無 DB 時走原本 JSON 模式（順便支援新欄位）
    const menu = loadMenu();
    const newId = menu.length ? Math.max(...menu.map(i => i.id || 0)) + 1 : 1;
    const item = {
      id: newId,
      name,
      price: priceNumber,
      category,
      image,
      description: description || "",
      tags: Array.isArray(tags)
        ? tags
        : typeof tags === "string"
        ? tags
            .split(/[;,、，]/)
            .map(t => t.trim())
            .filter(Boolean)
        : [],
      spicy: !!spicy,
      isHot: !!isHot
    };
    menu.push(item);
    saveMenu(menu);
    return res.status(201).json(item);
  } catch (err) {
    console.error("新增菜單失敗", err);
    res.status(500).json({ message: "新增菜單失敗" });
  }
});

app.put("/api/menu/:id", async (req, res) => {
  const id = Number(req.params.id);

  const {
    name,
    price,
    category,
    image,
    description,
    tags,
    spicy,
    isHot
  } = req.body;

  try {
    if (pool) {
      // 先查出舊資料（包含新欄位）
      const found = await pool.query(
        `
        SELECT
          id,
          name,
          price,
          category,
          image,
          description,
          tags,
          spicy,
          is_hot
        FROM menu_items
        WHERE id = $1
        `,
        [id]
      );

      if (found.rowCount === 0) {
        return res.status(404).json({ message: "品項不存在" });
      }

      const old = found.rows[0];

      // —— 決定要更新成什麼值（沒給就沿用舊資料） ——
      const newName = name || old.name;

      const newPrice = 
        price !== undefined && !Number.isNaN(Number(price))
          ? Number(price)
          : Number(old.price);

      const newCategory =
        category !== undefined ? category : old.category;

      const newImage =
        image !== undefined ? image : old.image;

      const newDescription =
        description !== undefined ? description : old.description;

      // tags 可能是陣列 / 字串 / 未給（沿用舊的）
      let tagsToUse;
      if (tags !== undefined) {
        tagsToUse = tags;
      } else {
        tagsToUse = old.tags;
      }

      let tagsValue = null;
      if (Array.isArray(tagsToUse)) {
        tagsValue = tagsToUse.join(",");
      } else if (typeof tagsToUse === "string" && tagsToUse.trim() !== "") {
        tagsValue = tagsToUse.trim();
      }

      // 辣 / 熱銷：沒給就沿用舊值
      const newSpicy =
        spicy !== undefined ? !!spicy : !!old.spicy;
      const newIsHot =
        isHot !== undefined ? !!isHot : !!old.is_hot;

      // —— 寫回資料庫 ——
      const result = await pool.query(
        `
        UPDATE menu_items
        SET
          name        = $2,
          price       = $3,
          category    = $4,
          image       = $5,
          description = $6,
          tags        = $7,
          spicy       = $8,
          is_hot      = $9
        WHERE id = $1
        RETURNING
          id, name, price, category, image, description, tags, spicy, is_hot
        `,
        [
          id,
          newName,
          newPrice,
          newCategory || null,
          newImage || null,
          newDescription || null,
          tagsValue,
          newSpicy,
          newIsHot
        ]
      );

      const row = result.rows[0];

      // tags 轉成陣列再回給前端
      let parsedTags = [];
      if (Array.isArray(row.tags)) {
        parsedTags = row.tags;
      } else if (typeof row.tags === "string" && row.tags.trim() !== "") {
        parsedTags = row.tags
          .split(/[;,、，]/)
          .map(t => t.trim())
          .filter(Boolean);
      }

      return res.json({
        id: row.id,
        name: row.name,
        price: Number(row.price),
        category: row.category,
        image: row.image,
        description: row.description || "",
        tags: parsedTags,
        spicy: !!row.spicy,
        isHot: !!row.is_hot
      });
    }

    // —— 無 DB：原本 JSON 模式（順便支援新欄位） ——
    const menu = loadMenu();
    const idx = menu.findIndex(i => Number(i.id) === id);
    if (idx === -1) {
      return res.status(404).json({ message: "品項不存在" });
    }

    const old = menu[idx];

    const updated = {
      ...old,
      ...(name && { name }),
      ...(price !== undefined &&
        !Number.isNaN(Number(price)) && { price: Number(price) }),
      ...(category !== undefined && { category }),
      ...(image !== undefined && { image }),
      ...(description !== undefined && { description }),
      ...(tags !== undefined && {
        tags: Array.isArray(tags)
          ? tags
          : typeof tags === "string"
          ? tags
              .split(/[;,、，]/)
              .map(t => t.trim())
              .filter(Boolean)
          : []
      }),
      ...(spicy !== undefined && { spicy: !!spicy }),
      ...(isHot !== undefined && { isHot: !!isHot })
    };

    menu[idx] = updated;
    saveMenu(menu);
    return res.json(updated);
  } catch (err) {
    console.error("更新菜單失敗", err);
    res.status(500).json({ message: "更新菜單失敗" });
  }
});

app.delete("/api/menu/:id", async (req, res) => {
  const id = Number(req.params.id);

  try {
    if (pool) {
      const result = await pool.query(
        "DELETE FROM menu_items WHERE id = $1",
        [id]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ message: "品項不存在" });
      }
      return res.json({ message: "已刪除" });
    }

    // 無 DB：原本 JSON 模式
    const menu = loadMenu();
    const idx = menu.findIndex(i => Number(i.id) === id);
    if (idx === -1) return res.status(404).json({ message: "品項不存在" });

    menu.splice(idx, 1);
    saveMenu(menu);

    return res.json({ message: "已刪除" });
  } catch (err) {
    console.error("刪除菜單失敗", err);
    res.status(500).json({ message: "刪除菜單失敗" });
  }
});


// ------------------------------
// ⭐ 會員：查詢 / 自動建立
// ------------------------------
app.post("/api/member/lookup", (req, res) => {
  const { phone, name } = req.body;

  if (!phone) {
    return res.status(400).json({ message: "缺少手機號碼" });
  }

  let members = loadMembers();
  let m = members.find(x => x.phone === phone);

  // 沒有就自動建立
  if (!m) {
    m = { phone, name: name || "", points: 0 };
    members.push(m);
    saveMembers(members);
  }

  res.json(m);
});

// ------------------------------
// 小工具：產生訂單 ID / ticketNo
// ------------------------------
function generateOrderId() {
  return "O" + Date.now();
}

// 外帶取餐號碼（簡單版）
function generateTicketNo() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 90 + 10); // 10~99
  return `${h}${m}${rand}`;
}

// ------------------------------
// ⭐ 訂單 ＋ 點數處理（前台結帳用）
// ------------------------------
app.post("/api/order", (req, res) => {
  const { items, totalAmount, mode, table, memberPhone, usePoints = 0 } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "沒有商品內容" });
  }

  let finalTotal = Number(totalAmount) || 0;

  let members = loadMembers();
  let member = null;
  let beforePoints = 0;
  let usedPoints = 0;

  // 會員折抵
  if (memberPhone) {
    member = members.find(m => m.phone === memberPhone);
    if (!member) {
      member = { phone: memberPhone, name: "", points: 0 };
      members.push(member);
    }

    beforePoints = member.points;

    const maxUsable = Math.min(
      member.points,
      Math.floor(finalTotal / POINT_VALUE)
    );
    const wantUse = Number(usePoints) || 0;
    usedPoints = Math.min(wantUse, maxUsable);

    if (usedPoints > 0) {
      finalTotal -= usedPoints * POINT_VALUE;
      member.points -= usedPoints;
    }
  }

  // 消費換點
  let earnedPoints = 0;
  if (finalTotal > 0) {
    earnedPoints = Math.floor(finalTotal / POINT_PER_AMOUNT);
  }

  if (member) {
    member.points += earnedPoints;
    saveMembers(members);
  }

  const orderId = generateOrderId();
  const createdAt = new Date().toISOString();
  const ticketNo = mode === "takeout" ? generateTicketNo() : null;

  // ⭐ 把訂單真的存到 orders.json
  const orders = loadOrders();
  const order = {
    orderId,                                // 給前端 / 後台用
    items,
    mode: mode || null,                     // 內用 / 外帶
    table: mode === "dinein" ? (table || "") : null,
    totalAmount: Number(totalAmount) || 0,  // 原價總額
    finalTotal,                             // 折抵後實付
    memberPhone: member ? member.phone : null,
    usedPoints,
    earnedPoints,
    status: "PENDING_PAYMENT",              // ⭐ 新訂單狀態
    createdAt,
    ticketNo
  };
  orders.push(order);
  saveOrders(orders);

  // 回傳給前端（customer.js 用 data.orderId; 之後要顯示點數也可用 member）
  res.json({
    orderId,
    finalTotal,
    member: member
      ? {
          phone: member.phone,
          beforePoints,
          usedPoints,
          earnedPoints,
          afterPoints: member.points
        }
      : null
  });
});

// ------------------------------
// ⭐ 後台：取得所有訂單（admin/orders.js 用）
// ------------------------------
app.get("/api/orders", (req, res) => {
  const orders = loadOrders();

  // 依建立時間新到舊排
  orders.sort((a, b) => {
    const ta = new Date(a.createdAt || 0).getTime();
    const tb = new Date(b.createdAt || 0).getTime();
    return tb - ta;
  });

  res.json(orders);
});

// ------------------------------
// ⭐ 後台：更新訂單狀態
//    PATCH /api/orders/:orderId/status
//    body: { status: "COOKING" | "READY" | "DONE" | "PENDING_PAYMENT" | "PAID" }
// ------------------------------
app.patch("/api/orders/:orderId/status", (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ message: "必須提供新的狀態" });
  }

  if (!VALID_STATUS.includes(status)) {
    return res.status(400).json({ message: "無效的訂單狀態" });
  }

  const orders = loadOrders();
  const idx = orders.findIndex(o => String(o.orderId) === String(orderId));
  if (idx === -1) {
    return res.status(404).json({ message: "找不到此訂單" });
  }

  orders[idx].status = status;
  saveOrders(orders);

  res.json(orders[idx]);
});

// ------------------------------
// 啟動伺服器
// ------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("API server running on port", PORT);
});
