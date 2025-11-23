// api/server.js
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// 中介軟體
app.use(cors());              // 若前後端同網域，其實可以拿掉或鎖來源
app.use(express.json());      // 讓我們可以讀 req.body JSON

// 靜態檔案（如果你想用同一個 Node 來 serve 前端，可以這樣）
// 例如 http://localhost:3000/customer/index.html
app.use(express.static(path.join(__dirname, "..")));

// ====== 假資料：菜單（之後可改成資料庫） ======
const menuData = [
  { id: 1, name: "牛肉麵", price: 150, category: "主食" },
  { id: 2, name: "陽春麵", price: 80, category: "主食" },
  { id: 3, name: "炸雞塊", price: 60, category: "小菜" },
  { id: 4, name: "滷蛋", price: 20, category: "小菜" },
  { id: 5, name: "珍珠奶茶", price: 60, category: "飲料" },
  { id: 6, name: "紅茶", price: 30, category: "飲料" }
];

// 暫時用記憶體存訂單（之後可換 MySQL / MongoDB）
let orders = [];

// 產生訂單編號的小工具
function generateOrderId() {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const t = String(now.getTime()).slice(-5); // 最後 5 碼
  return `ORD${y}${m}${d}${t}`;               // 例如 ORD2025112301234
}

// 模擬建立 Line Pay 交易（之後換成真的 Line Pay 呼叫）
function createMockLinePayTransaction(order) {
  // 正式串接時，這裡會呼叫 Line Pay 的 API，拿到真實的 URL
  const fakePaymentUrl = `https://example.com/mock-linepay?orderId=${order.orderId}`;
  return { paymentUrl: fakePaymentUrl };
}

// ====== API：取得菜單（可給前端 customer.js 用） ======
app.get("/api/menu", (req, res) => {
  res.json(menuData);
});

// ====== API：建立訂單 ======
app.post("/api/order", (req, res) => {
  const { mode, table, items, totalAmount } = req.body;

  // 1. 基本驗證
  if (!mode || !Array.isArray(items) || items.length === 0 || !totalAmount) {
    return res.status(400).json({ message: "缺少必要欄位" });
  }
  if (mode !== "dinein" && mode !== "takeout") {
    return res.status(400).json({ message: "mode 必須是 dinein 或 takeout" });
  }

  // 2. 算一次後端認為的金額（避免被前端亂傳）
  const serverCalcTotal = items.reduce((sum, item) => {
    // 找出這個品項在菜單中的價格（避免前端自己改價錢）
    const menuItem = menuData.find(m => m.id === item.itemId);
    if (!menuItem) return sum;
    const qty = Number(item.qty) || 0;
    return sum + menuItem.price * qty;
  }, 0);

  if (serverCalcTotal <= 0) {
    return res.status(400).json({ message: "計算金額異常，請重新下單" });
  }

  // （可選）你可以檢查一下 client 傳來的 totalAmount 是否跟後端算的一樣
  if (Number(totalAmount) !== serverCalcTotal) {
    console.warn("前端計算金額與後端不一致", { totalAmount, serverCalcTotal });
    // 這裡你可以選擇直接拒絕，或是覆蓋成後端金額
    // return res.status(400).json({ message: "金額不一致，請重新下單" });
  }

  // 3. 建立訂單物件
  const orderId = generateOrderId();

  const newOrder = {
    orderId,
    mode,                      // dinein / takeout
    table: mode === "dinein" ? (table || "") : null,
    items: items.map(item => ({
      itemId: item.itemId,
      name: item.name,
      price: item.price,
      qty: item.qty
    })),
    totalAmount: serverCalcTotal,
    status: "PENDING_PAYMENT", // 之後可改為 NEW / PAID / COOKING...
    createdAt: new Date().toISOString()
  };

  // 存到記憶體
  orders.push(newOrder);

  // 4. 建立 Line Pay 交易（目前是模擬）
  const { paymentUrl } = createMockLinePayTransaction(newOrder);

  // 5. 回傳給前端
  res.json({
    orderId: newOrder.orderId,
    paymentUrl
  });
});

// ====== （選配）看目前所有訂單，用來 debug ======
app.get("/api/orders", (req, res) => {
  res.json(orders);
});

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
