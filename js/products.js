// ============================================================
//  商品登録 画面
// ============================================================
import { $, yen, toast, parseAmount, setBusy, escapeHtml } from "./ui.js";
import { store, loadProducts, createProduct, archiveProduct } from "./store.js";
import { errMessage } from "./db.js";

function showError(message) {
  const el = $("#product-error");
  el.textContent = message;
  el.hidden = !message;
}

export function renderProducts() {
  const list = $("#product-list");
  const items = store.products;
  $("#product-count").textContent = items.length;
  $("#product-empty").hidden = items.length > 0;

  list.innerHTML = items
    .map(
      (p) => `
      <div class="product-row" data-id="${p.id}">
        <span class="pname">${escapeHtml(p.name)}</span>
        <span class="pprice">${yen(p.price)}
          <span class="pcost">${p.cost === null || p.cost === undefined ? "原価未設定" : "原価 " + yen(p.cost)}</span>
        </span>
        <button type="button" class="del-btn" data-del="${p.id}" aria-label="${escapeHtml(p.name)}を削除">🗑</button>
      </div>`
    )
    .join("");
}

export function initProducts() {
  // ---- 登録 ----
  $("#product-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#product-name").value.trim();
    const price = parseAmount($("#product-price").value);
    const costRaw = $("#product-cost").value;
    const cost = parseAmount(costRaw);

    if (!name) return showError("商品名を入力してください");
    if (price === null) return showError("金額を入力してください");
    if (Number.isNaN(price)) return showError("金額は数字で入力してください");
    if (costRaw.trim() !== "" && Number.isNaN(cost)) return showError("原価は数字で入力してください");
    if (cost !== null && !Number.isNaN(cost) && cost > price) {
      // 止めはしないが気づけるように
      toast("原価が金額を上回っています", "err");
    }

    showError("");
    setBusy($("#product-submit"), true, "登録中…");
    try {
      await createProduct({ name, price, cost: cost === null || Number.isNaN(cost) ? null : cost });
      $("#product-form").reset();
      $("#product-name").focus();
      renderProducts();
      toast(`「${name}」を登録しました`);
    } catch (err) {
      showError(errMessage(err));
    } finally {
      setBusy($("#product-submit"), false);
    }
  });

  // ---- 削除（一覧から外す。過去の売上は残る）----
  $("#product-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-del]");
    if (!btn) return;
    const id = btn.dataset.del;
    const product = store.products.find((p) => p.id === id);
    if (!product) return;
    if (!confirm(`「${product.name}」をレジの一覧から外しますか？\n（過去の売上データは残ります）`)) return;
    try {
      await archiveProduct(id);
      renderProducts();
      toast("一覧から外しました");
    } catch (err) {
      toast(errMessage(err), "err");
    }
  });
}

export async function refreshProducts() {
  await loadProducts();
  renderProducts();
}
