const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// ------------------------------
// 檔案路徑
// ------------------------------
const MENU_FILE = path.join(__dirname, "menu.json");
const MEMBERS_FILE = path.join(__dirname, "members.json");

// ------------------------------
// 點數規則（你可自行調整）
// ------------------------------
const POINT_PER_AMOUNT = 100; // 消費滿多少元＝1點
const POINT_VALUE = 1;        // 1 點可折抵多少元（1點＝1元）

// ------------------------------
// 工具：讀/寫 JSON
// ------------------------------
function loadJson(pathFile) {
  if (!fs.existsSync(pathFile)) {
    fs.writeFileSync(pathFile, JSON.stringify([], null, 2), "utf-8");
  }
  const data = fs.readFileSync(pathFile, "utf-8");
  try {
    return JSON.parse(data);
  } catch (err) {
    fs.writeFileSync(pathFile, JSON.stringify([], null, 2), "utf-8");
    return [];
  }
}

function saveJson(pathFile, data) {
  fs.writeFileSync(pathFile, JSON.stringify(data, null, 2), "utf-8");
}

// ------------------------------
// 載入資料
// ------------------------------
function loadMenu() {
  return loadJson(MENU_FILE);
}
function saveMenu(data) {
  saveJson(MENU_FILE, data);
}

function loadMembers() {
  return loadJson(MEMBERS_FILE);
}
function saveMembers(data) {
  saveJson(MEMBERS_FILE, data);
}

// ------------------------------
// API：菜單
// ------------------------------
app.get("/api/menu", (req, res) => {
  res.json(loadMenu());
});

app.post("/api/menu", (req, res) => {
  const menu = loadMenu();
  const { name, price, category, image } = req.body;

  if (!name || typeof price !== "number") {
    return res.status(400).json({ message: "缺少品名或價格錯誤" });
  }

  const newId = menu.length ? Math.max(...menu.map(i => i.id)) + 1 : 1;
  const item = { id: newId, name, price, category, image };
  menu.push(item);
  saveMenu(menu);

  res.status(201).json(item);
});

app.put("/api/menu/:id", (req, res) => {
  const menu = loadMenu();
  const id = Number(req.params.id);

  const idx = menu.findIndex(i => i.id === id);
  if (idx === -1) return res.status(404).json({ message: "品項不存在" });

  const { name, price, category, image } = req.body;

  menu[idx] = {
    ...menu[idx],
    ...(name && { name }),
    ...(typeof price === "number" && { price }),
    ...(category !== undefined && { category }),
    ...(image !== undefined && { image })
  };

  saveMenu(menu);
  res.json(menu[idx]);
});

app.delete("/api/menu/:id", (req, res) => {
  const menu = loadMenu();
  const id = Number(req.params.id);

  const idx = menu.findIndex(i => i.id === id);
  if (idx === -1) return res.status(404).json({ message: "品項不存在" });

  menu.splice(idx, 1);
  saveMenu(menu);

  res.json({ message: "已刪除" });
});

// ------------------------------
// ⭐ API：查詢 / 建立會員
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
// ⭐ API：建立訂單 + 點數處理
// ------------------------------
app.post("/api/order", (req, res) => {
  const { items, totalAmount, mode, table, memberPhone, usePoints = 0 } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ message: "沒有商品內容" });
  }

  let finalTotal = totalAmount;
  let members = loadMembers();
  let member = null;
  let beforePoints = 0;
  let usedPoints = 0;

  // ----會員折抵----
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
    usedPoints = Math.min(usePoints, maxUsable);

    if (usedPoints > 0) {
      finalTotal -= usedPoints * POINT_VALUE;
      member.points -= usedPoints;
    }
  }

  // ----消費換點----
  let earnedPoints = Math.floor(finalTotal / POINT_PER_AMOUNT);

  if (member) {
    member.points += earnedPoints;
    saveMembers(members);
  }

  const orderId = "O" + Date.now();

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
// 啟動 server
// ------------------------------
app.listen(3000, () => {
  console.log("API server running (menu + members)");
});
