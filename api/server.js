// api/server.js
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..")));

// -------------------------
// 圖片上傳設定
// -------------------------
const uploadDir = path.join(__dirname, "..", "uploads", "menu");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/\s+/g, "_");
    cb(null, Date.now() + "-" + safe);
  }
});

const upload = multer({ storage });

function buildImageUrl(req, filename) {
  return `${req.protocol}://${req.get("host")}/uploads/menu/${filename}`;
}

// -------------------------
// 假資料（之後可換成 DB）
// -------------------------
let menuData = [
  { id: 1, name: "牛肉麵", price: 150, category: "主食", image: "" },
  { id: 2, name: "陽春麵", price: 80, category: "主食", image: "" },
  { id: 3, name: "炸雞塊", price: 60, category: "小菜", image: "" },
  { id: 4, name: "滷蛋", price: 20, category: "小菜", image: "" },
  { id: 5, name: "珍珠奶茶", price: 60, category: "飲料", image: "" },
  { id: 6, name: "紅茶", price: 30, category: "飲料", image: "" }
];

// -------------------------
// API：取得菜單
// -------------------------
app.get("/api/menu", (req, res) => {
  res.json(menuData);
});

// -------------------------
// API：新增菜單
// -------------------------
app.post("/api/menu", upload.single("image"), (req, res) => {
  const { name, price, category } = req.body;
  const numPrice = Number(price);

  if (!name || Number.isNaN(numPrice)) {
    return res.status(400).json({ message: "品名與價格必填" });
  }

  const newId =
    menuData.length > 0 ? Math.max(...menuData.map(m => m.id)) + 1 : 1;

  let image = "";
  if (req.file) image = buildImageUrl(req, req.file.filename);

  const newItem = {
    id: newId,
    name,
    price: numPrice,
    category: category || "",
    image
  };

  menuData.push(newItem);
  res.status(201).json(newItem);
});

// -------------------------
// API：修改菜單
// -------------------------
app.put("/api/menu/:id", upload.single("image"), (req, res) => {
  const id = Number(req.params.id);
  const { name, price, category } = req.body;
  const item = menuData.find(m => m.id === id);

  if (!item) return res.status(404).json({ message: "找不到品項" });

  if (name !== undefined) item.name = name;
  if (price !== undefined) {
    const p = Number(price);
    if (!Number.isNaN(p)) item.price = p;
  }
  if (category !== undefined) item.category = category;

  if (req.file) {
    item.image = buildImageUrl(req, req.file.filename);
  }

  res.json(item);
});

// -------------------------
// API：刪除品項
// -------------------------
app.delete("/api/menu/:id", (req, res) => {
  const id = Number(req.params.id);
  const index = menuData.findIndex(m => m.id === id);

  if (index === -1) {
    return res.status(404).json({ message: "找不到品項" });
  }

  const removed = menuData.splice(index, 1)[0];
  res.json(removed);
});

// -------------------------
// 啟動 Server
// -------------------------
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
