// ============================================================
//  レジ 画面
// ============================================================
import { $, yen, num, toast, parseAmount, setBusy, escapeHtml, formatDateTime } from "./ui.js";
import { store, saveSale } from "./store.js";
import { errMessage } from "./db.js";

const cart = new Map(); // product.id -> qty

function showError(message) {
  const el = $("#reg-error");
  el.textContent = message;
  el.hidden = !message;
}

// 別の端末で商品が消された場合に備えて、無くなった商品はカゴから外す
function pruneCart() {
  for (const id of cart.keys()) {
    if (!store.products.some((p) => p.id === id)) cart.delete(id);
  }
}

const lines = () =>
  Array.from(cart.entries())
    .map(([id, qty]) => {
      const p = store.products.find((x) => x.id === id);
      return p ? { product_id: id, name: p.name, price: p.price, cost: p.cost || 0, qty } : null;
    })
    .filter(Boolean);

const totals = () => {
  const ls = lines();
  return {
    qty: ls.reduce((s, l) => s + l.qty, 0),
    amount: ls.reduce((s, l) => s + l.price * l.qty, 0),
  };
};

// 商品ボタン（登録済み商品の一覧）
function renderGrid() {
  const grid = $("#reg-product-grid");
  const items = store.products;
  $("#reg-empty").hidden = items.length > 0;
  grid.innerHTML = items
    .map((p) => {
      const qty = cart.get(p.id) || 0;
      return `
      <button type="button" class="reg-item ${qty ? "picked" : ""}" data-pick="${p.id}">
        <span class="rname">${escapeHtml(p.name)}</span>
        <span class="rprice">${yen(p.price)}</span>
        ${qty ? `<span class="rqty">×${qty}</span>` : ""}
      </button>`;
    })
    .join("");
}

// 会計パネル（カゴの中身・合計・おつり）
function renderPanel() {
  const ls = lines();
  const t = totals();

  $("#cart-list").innerHTML = ls
    .map(
      (l) => `
      <div class="cart-row" data-id="${l.product_id}">
        <span class="cname">${escapeHtml(l.name)}</span>
        <span class="camount">${yen(l.price * l.qty)}</span>
        <span class="cart-ctl">
          <button type="button" class="stepper" data-minus="${l.product_id}" aria-label="1つ減らす">−</button>
          <span class="cqty">${l.qty}</span>
          <button type="button" class="stepper" data-plus="${l.product_id}" aria-label="1つ増やす">＋</button>
          <span class="cunit">@${yen(l.price)}</span>
        </span>
      </div>`
    )
    .join("");
  $("#cart-empty").hidden = ls.length > 0;

  $("#cart-qty").textContent = num(t.qty);
  $("#cart-total").textContent = yen(t.amount);

  // おつり
  const received = parseAmount($("#received").value);
  const changeEl = $("#change");
  let canCheckout = ls.length > 0;

  if (received === null || Number.isNaN(received)) {
    changeEl.textContent = yen(0);
    changeEl.classList.remove("short");
    if (Number.isNaN(received)) canCheckout = false;
  } else if (received < t.amount) {
    changeEl.textContent = `${yen(t.amount - received)} 不足`;
    changeEl.classList.add("short");
    canCheckout = false;
  } else {
    changeEl.textContent = yen(received - t.amount);
    changeEl.classList.remove("short");
  }

  $("#checkout-btn").disabled = !canCheckout;
  $("#clear-cart-btn").disabled = ls.length === 0;
}

export function render() {
  pruneCart();
  renderGrid();
  renderPanel();
}

function add(id, delta) {
  const qty = (cart.get(id) || 0) + delta;
  if (qty <= 0) cart.delete(id);
  else cart.set(id, qty);
  showError("");
  render();
}

export function clearCart() {
  cart.clear();
  $("#received").value = "";
  showError("");
  render();
}

export function initRegister() {
  // 商品タップ → 1点追加
  $("#reg-product-grid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-pick]");
    if (btn) add(btn.dataset.pick, 1);
  });

  // カゴ内の増減
  $("#cart-list").addEventListener("click", (e) => {
    const plus = e.target.closest("[data-plus]");
    if (plus) return add(plus.dataset.plus, 1);
    const minus = e.target.closest("[data-minus]");
    if (minus) return add(minus.dataset.minus, -1);
  });

  // お預かり
  $("#received").addEventListener("input", renderPanel);
  document.querySelectorAll("[data-cash]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.cash;
      $("#received").value = v === "exact" ? String(totals().amount) : v;
      renderPanel();
    });
  });

  $("#clear-cart-btn").addEventListener("click", () => {
    if (cart.size && !confirm("カゴの中身を全部消しますか？")) return;
    clearCart();
  });

  // ---- 会計 ----
  $("#checkout-btn").addEventListener("click", async () => {
    const ls = lines();
    if (!ls.length) return;
    const t = totals();
    const receivedInput = parseAmount($("#received").value);
    if (Number.isNaN(receivedInput)) return showError("お預かり金額は数字で入力してください");
    const received = receivedInput === null ? t.amount : receivedInput;   // 未入力ならちょうど扱い
    if (received < t.amount) return showError("お預かり金額が足りません");

    showError("");
    setBusy($("#checkout-btn"), true, "登録中…");
    try {
      const sale = await saveSale({ lines: ls, received, changeDue: received - t.amount });
      $("#done-receipt").textContent = sale.receipt_no;
      $("#done-date").textContent = formatDateTime(sale.sold_at);
      $("#done-total").textContent = yen(sale.total_amount);
      $("#done-change").textContent = yen(sale.change_due ?? 0);
      $("#done-overlay").hidden = false;
      clearCart();
    } catch (err) {
      showError(errMessage(err));
      toast("会計を登録できませんでした", "err");
    } finally {
      setBusy($("#checkout-btn"), false);
    }
  });

  $("#done-close").addEventListener("click", () => {
    $("#done-overlay").hidden = true;
  });
}

// 画面に入るたびに商品ボタンを描き直す
export function enterRegister() {
  clearCart();
}
