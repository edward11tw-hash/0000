// api/server.js
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

// ================================
// 中介軟體
// ================================
app.use(cors());
app.use(express.json());

// 靜態檔案（讓 /customer, /owner, /uploads, /images 都能被存取）
app.use(express.static(path.join(__dirname, "..")));

// ================================
// 圖片上傳設定（放在 /uploads/menu）
// ================================
const uploadDir = path.join(__dirname, "..", "uploads", "menu");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, "_");
    const uniqueName = Date.now() + "-" + safeName;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

// 幫圖片檔名組成完整網址，前端可以直接 <img src="...">
function buildImageUrl(req, filename) {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  return `${baseUrl}/uploads/menu/${filename}`;
}

// ================================
// 假資料：菜單（之後可以換成資料庫）
// ================================
let menuData = [
  { id: 1, name: "牛肉麵", price: 150, category: "主食", image: "" },
  { id: 2, name: "陽春麵", price: 80, category: "主食", image: "" },
  { id: 3, name: "炸雞塊", price: 60, category: "小菜", image: "" },
  { id: 4, name: "滷蛋", price: 20, category: "小菜", image: "" },
  { id: 5, name: "珍珠奶茶", price: 60, category: "飲料", image: "" },
  { id: 6, name: "紅茶", price: 30, category: "飲料", image: "" }
];

// 暫存訂單（之後你可以改成資料庫）
let orders = [];

// 產生訂單編號（簡單版）
function generateOrderId() {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const t = String(now.getTime()).slice(-5);
  return `ORD${y}${m}${d}${t}`;
}

// 模擬 LinePay（其實只是假網址）
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
// API：新增菜單（支援圖片上傳）
// ================================
app.post("/api/menu", upload.single("image"), (req, res) => {
  const { name, price, category } = req.body;

  // ✅ 不管前端丟字串還是數字，都轉成 number
  const numPrice = Number(price);
  if (!name || Number.isNaN(numPrice)) {
    return res
      .status(400)
      .json({ message: "品名與價格必填，且價格需為數字" });
  }

  const newId =
    menuData.length > 0 ? Math.max(...menuData.map(m => m.id)) + 1 : 1;

  let image = "";
  if (req.file) {
    image = buildImageUrl(req, req.file.filename);
  } else if (req.body.image) {
    // 有傳純文字 image 也可以
    image = req.body.image;
  }

  const newItem = {
    id: newId,
    name,
    price: numPrice,
    category: category || "",
    image: image || ""
  };

  menuData.push(newItem);
  res.status(201).json(newItem);
});

// ================================
// API：更新菜單（支援更新圖片）
// ================================
app.put("/api/menu/:id", upload.single("image"), (req, res) => {
  const id = Number(req.params.id);
  const { name, price, category } = req.body;

  const item = menuData.find(m => m.id === id);
  if (!item) return res.status(404).json({ message: "找不到品項" });

  if (name !== undefined) item.name = name;

  if (price !== undefined) {
    const numPrice = Number(price);
    if (!Number.isNaN(numPrice)) {
      item.price = numPrice;
    }
  }

  if (category !== undefined) item.category = category;

  // 若有上傳新圖片，覆蓋原本 image
  if (req.file) {
    item.image = buildImageUrl(req, req.file.filename);
  } else if (req.body.image !== undefined) {
    // 有傳文字 image 也允許覆蓋（可清空或改連結）
    item.image = req.body.image;
  }

  res.json(item);
});

// ================================
// API：刪除菜單
// ================================
app.delete("/api/menu/:id", (req, res) => {
  const id = Number(req.params.id);
  const index = menuData.findIndex(m => m.id === id);

  if (index === -1) {
    return res.status(404).json({ message: "找不到品項" });
  }

  const removed = menuData.splice(index, 1)[0];
  res.json(removed);
});

// ================================
// API：建立訂單（含客製加價）
// ================================
app.post("/api/order", (req, res) => {
  const { mode, table, items, totalAmount } = req.body;

  if (!mode || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "缺少必要欄位" });
  }
  if (mode !== "dinein" && mode !== "takeout") {
    return res.status(400).json({ message: "mode 必須是 dinein 或 takeout" });
  }

  // 伺服器重新計算總價，避免被竄改
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

  let ticketNo = null;
  if (mode === "takeout") {
    const takeoutOrders = orders.filter(o => o.mode === "takeout");
    ticketNo = takeoutOrders.length + 1;
  }

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

  orders.push(newOrder);

  const { paymentUrl } = createMockLinePayTransaction(newOrder);

  res.json({
    orderId,
    ticketNo,
    paymentUrl
  });
});

// ================================
// API：取得所有訂單（後台查詢用）
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

  if (!status) {
    return res.status(400).json({ message: "缺少狀態欄位" });
  }

  const order = orders.find(o => o.orderId === orderId);
  if (!order) {
    return res.status(404).json({ message: "找不到訂單" });
  }

  order.status = status;
  order.updatedAt = new Date().toISOString();

  res.json(order);
});

// ================================
// 啟動 Server
// ================================
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
