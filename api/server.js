// api/server.js
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ================================
// 中介軟體
// ================================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..")));


// ================================
// 假資料：菜單（之後可改成資料庫）
// ================================
let menuData = [
  { id: 1, name: "牛肉麵", price: 150, category: "主食" },
  { id: 2, name: "陽春麵", price: 80, category: "主食" },
  { id: 3, name: "炸雞塊", price: 60, category: "小菜" },
  { id: 4, name: "滷蛋", price: 20, category: "小菜" },
  { id: 5, name: "珍珠奶茶", price: 60, category: "飲料" },
  { id: 6, name: "紅茶", price: 30, category: "飲料" }
];

// 訂單暫存（之後可改 DB）
let orders = [];


// ================================
// 工具：產生訂單編號
// ================================
function generateOrderId() {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const t = String(now.getTime()).slice(-5);
  return `ORD${y}${m}${d}${t}`;
}


// ================================
// 模擬 LinePay API
// ================================
function createMockLinePayTransaction(order) {
  return {
    paymentUrl: `https://example.com/mock-linepay?orderId=${order.orderId}`
  };
}


// ================================
// API：取得菜單
// ================================
app.get("/api/menu", (req, res) => {
  res.json(menuData);
});


// ================================
// API：建立訂單（含客製化）
// ================================
app.post("/api/order", (req, res) => {
  const { mode, table, items, totalAmount } = req.body;

  //--- 基本檢查 ---
  if (!mode || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "缺少必要欄位" });
  }
  if (mode !== "dinein" && mode !== "takeout") {
    return res.status(400).json({ message: "mode 必須是 dinein 或 takeout" });
  }

  //--- 後端重算金額（真正安全）---
  const serverCalcTotal = items.reduce((sum, item) => {
    const menuItem = menuData.find(m => m.id === item.itemId);
    if (!menuItem) return sum;

    const qty = Number(item.qty) || 0;
    const extra = Number(item.extraPricePerUnit) || 0;

    const unitPrice = menuItem.price + extra;
    return sum + unitPrice * qty;
  }, 0);

  if (serverCalcTotal <= 0) {
    return res.status(400).json({ message: "金額異常，請重新下單" });
  }

  //--- 外帶取號 ---
  let ticketNo = null;
  if (mode === "takeout") {
    const takeoutOrders = orders.filter(o => o.mode === "takeout");
    ticketNo = takeoutOrders.length + 1;
  }

  //--- 產生訂單 ---
  const orderId = generateOrderId();

  const newOrder = {
    orderId,
    ticketNo,
    mode,
    table: mode === "dinein" ? (table || "") : null,
    items: items.map(item => {
      const menuItem = menuData.find(m => m.id === item.itemId);

      return {
        itemId: item.itemId,
        name: item.name,
        basePrice: menuItem ? menuItem.price : item.basePrice,
        extraPricePerUnit: Number(item.extraPricePerUnit) || 0,
        qty: item.qty,
        removeKeys: item.removeKeys || [],
        addKeys: item.addKeys || []
      };
    }),
    totalAmount: serverCalcTotal,
    status: "PENDING_PAYMENT",
    createdAt: new Date().toISOString()
  };

  //--- 存入 orders ---
  orders.push(newOrder);

  //--- 建立付款連結 ---
  const { paymentUrl } = createMockLinePayTransaction(newOrder);

  res.json({
    orderId,
    ticketNo,
    paymentUrl
  });
});


// ================================
// API：取得所有訂單（後台用）
// ================================
app.get("/api/orders", (req, res) => {
  res.json(orders);
});


// ================================
// API：更新訂單狀態
// ================================
app.patch("/api/orders/:orderId/status", (req, res) => {
  const orderId = req.params.orderId;
  const { status } = req.body;

  if (!status) return res.status(400).json({ message: "缺少狀態欄位" });

  const order = orders.find(o => o.orderId === orderId);
  if (!order) return res.status(404).json({ message: "找不到訂單" });

  order.status = status;
  order.updatedAt = new Date().toISOString();

  res.json(order);
});


// ================================
// 菜單 CRUD
// ================================

// 新增
app.post("/api/menu", (req, res) => {
  const { name, price, category, image } = req.body;

  if (!name || typeof price !== "number") {
    return res.status(400).json({ message: "品名與價格必填" });
  }

  const newId =
    menuData.length > 0 ? Math.max(...menuData.map(m => m.id)) + 1 : 1;

  const newItem = {
    id: newId,
    name,
    price,
    category: category || "",
    image: image || "" // 可選：圖片 URL
  };

  menuData.push(newItem);
  res.status(201).json(newItem);
});

// 更新
app.put("/api/menu/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name, price, category, image } = req.body;

  const item = menuData.find(m => m.id === id);
  if (!item) return res.status(404).json({ message: "找不到品項" });

  if (name !== undefined) item.name = name;
  if (price !== undefined) item.price = price;
  if (category !== undefined) item.category = category;
  if (image !== undefined) item.image = image;

  res.json(item);
});

// 刪除
app.delete("/api/menu/:id", (req, res) => {
  const id = Number(req.params.id);
  const index = menuData.findIndex(m => m.id === id);

  if (index === -1) return res.status(404).json({ message: "找不到品項" });

  const removed = menuData.splice(index, 1)[0];
  res.json(removed);
});


// ================================
// 啟動 Server
// ================================
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
