// ============================================================
//  販売レポート 画面（年 / 月 / 日）
// ============================================================
import { $, yen, num, toast, localDate, lastDayOfMonth, formatDateTime, escapeHtml } from "./ui.js";
import { fetchSales, fetchSaleItems, firstSaleYear } from "./store.js";
import { errMessage } from "./db.js";

const MAX_LOG_ROWS = 100;   // 会計履歴の表示上限
const pad2 = (n) => String(n).padStart(2, "0");

const state = {
  mode: "year",     // year | month | day
  yearsLoaded: false,
  loading: false,
};

/* ---------------- 期間の計算 ---------------- */

function currentRange() {
  const year = parseInt($("#report-year").value, 10);
  const month = parseInt($("#report-month").value, 10);
  if (state.mode === "year") {
    return { from: `${year}-01-01`, to: `${year}-12-31`, label: `${year}年` };
  }
  if (state.mode === "month") {
    const last = lastDayOfMonth(year, month);
    return {
      from: `${year}-${pad2(month)}-01`,
      to: `${year}-${pad2(month)}-${pad2(last)}`,
      label: `${year}年${month}月`,
    };
  }
  const date = $("#report-date").value || localDate();
  const [y, m, d] = date.split("-");
  return { from: date, to: date, label: `${y}年${parseInt(m, 10)}月${parseInt(d, 10)}日` };
}

/* ---------------- 画面部品 ---------------- */

function applyMode() {
  document.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("is-on", b.dataset.mode === state.mode));
  $("#ctl-year").hidden = state.mode === "day";
  $("#ctl-month").hidden = state.mode !== "month";
  $("#ctl-day").hidden = state.mode !== "day";
}

async function fillYearOptions() {
  const thisYear = new Date().getFullYear();
  let from = thisYear;
  try {
    from = Math.min(await firstSaleYear(), thisYear);
  } catch { /* 取れなければ今年だけ */ }
  const sel = $("#report-year");
  const keep = sel.value;
  sel.innerHTML = "";
  for (let y = thisYear; y >= from; y--) {
    sel.insertAdjacentHTML("beforeend", `<option value="${y}">${y}年</option>`);
  }
  sel.value = keep && Array.from(sel.options).some((o) => o.value === keep) ? keep : String(thisYear);
  state.yearsLoaded = true;
}

function fillMonthOptions() {
  const sel = $("#report-month");
  if (sel.options.length) return;
  for (let m = 1; m <= 12; m++) {
    sel.insertAdjacentHTML("beforeend", `<option value="${m}">${m}月</option>`);
  }
  sel.value = String(new Date().getMonth() + 1);
}

/* ---------------- 集計と描画 ---------------- */

function aggregate(sales, items) {
  const byProduct = new Map();   // "名前@単価" -> { name, price, qty, amount, cost }
  for (const it of items) {
    const key = `${it.name}@@${it.price}`;
    const row = byProduct.get(key) || { name: it.name, price: it.price, qty: 0, amount: 0, cost: 0 };
    row.qty += it.qty;
    row.amount += it.price * it.qty;
    row.cost += (it.cost || 0) * it.qty;
    byProduct.set(key, row);
  }

  const sumSales = sales.reduce((s, r) => s + r.total_amount, 0);
  const sumCost = sales.reduce((s, r) => s + r.total_cost, 0);
  const sumQty = sales.reduce((s, r) => s + r.total_qty, 0);

  return {
    sales: sumSales,
    cost: sumCost,
    profit: sumSales - sumCost,
    qty: sumQty,
    count: sales.length,
    byProduct: Array.from(byProduct.values()).sort((a, b) => b.amount - a.amount),
    someCostMissing: items.some((it) => !it.cost),
  };
}

function renderKpi(agg) {
  $("#kpi-sales").textContent = yen(agg.sales);
  $("#kpi-cost").textContent = yen(agg.cost);
  $("#kpi-profit").textContent = yen(agg.profit);
  $("#kpi-margin").textContent = agg.sales ? `粗利率 ${Math.round((agg.profit / agg.sales) * 100)}%` : "";
  $("#kpi-count").textContent = num(agg.count);
  $("#kpi-qty").textContent = num(agg.qty) + " 点";
  $("#cost-note").hidden = !agg.someCostMissing;
}

// 年 → 月別 / 月 → 日別 の内訳（クリックでその期間へ移動できる）
function renderBreakdown(sales, range) {
  const card = $("#breakdown-card");
  if (state.mode === "day") { card.hidden = true; return; }
  card.hidden = false;

  const isYear = state.mode === "year";
  $("#breakdown-title").textContent = isYear ? "月別" : "日別";
  $("#breakdown-head").textContent = isYear ? "月" : "日";

  const groups = new Map();
  for (const s of sales) {
    const key = isYear ? String(s.sold_on).slice(0, 7) : String(s.sold_on);
    const g = groups.get(key) || { amount: 0, profit: 0, count: 0 };
    g.amount += s.total_amount;
    g.profit += s.total_amount - s.total_cost;
    g.count += 1;
    groups.set(key, g);
  }

  const keys = Array.from(groups.keys()).sort();
  if (!keys.length) {
    $("#breakdown-body").innerHTML = `<tr><td colspan="4" class="muted">データなし</td></tr>`;
    return;
  }
  $("#breakdown-body").innerHTML = keys
    .map((k) => {
      const g = groups.get(k);
      const label = isYear ? `${parseInt(k.slice(5, 7), 10)}月` : `${parseInt(k.slice(8, 10), 10)}日`;
      return `<tr class="link-row" data-drill="${k}">
        <td>${label}</td>
        <td class="r">${yen(g.amount)}</td>
        <td class="r">${yen(g.profit)}</td>
        <td class="r">${num(g.count)}</td>
      </tr>`;
    })
    .join("");
}

function renderByProduct(agg) {
  $("#report-empty").hidden = agg.byProduct.length > 0;
  $("#byproduct-body").innerHTML = agg.byProduct
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.name)}</td>
        <td class="r">${yen(r.price)}</td>
        <td class="r">${num(r.qty)}</td>
        <td class="r">${yen(r.amount)}</td>
        <td class="r">${yen(r.amount - r.cost)}</td>
      </tr>`
    )
    .join("");
}

function renderLog(sales, items) {
  const itemsBySale = new Map();
  for (const it of items) {
    const arr = itemsBySale.get(it.sale_id) || [];
    arr.push(it);
    itemsBySale.set(it.sale_id, arr);
  }
  const shown = sales.slice(0, MAX_LOG_ROWS);
  const rest = sales.length - shown.length;

  $("#sales-log").innerHTML =
    (shown.length
      ? shown
          .map((s) => {
            const names = (itemsBySale.get(s.id) || [])
              .map((it) => `${escapeHtml(it.name)}${it.qty > 1 ? `×${it.qty}` : ""}`)
              .join("、");
            return `<div class="log-row">
              <div class="log-top">
                <span>${String(s.sold_on).replace(/-/g, "/")} <span class="log-no">${escapeHtml(s.receipt_no)}</span></span>
                <span class="log-amount">${yen(s.total_amount)}</span>
              </div>
              <div class="log-items">${names || "—"}</div>
            </div>`;
          })
          .join("")
      : `<p class="empty">この期間の会計はありません。</p>`) +
    (rest > 0 ? `<p class="hint">新しい順に${MAX_LOG_ROWS}件まで表示しています（ほか${num(rest)}件）。</p>` : "");
}

/* ---------------- 読み込み ---------------- */

export async function loadReport() {
  if (state.loading) return;
  state.loading = true;
  $("#loading").hidden = false;
  try {
    if (!state.yearsLoaded) await fillYearOptions();
    const range = currentRange();
    $("#report-period").textContent = `${range.label}の集計`;

    const sales = await fetchSales(range.from, range.to);
    const items = await fetchSaleItems(sales.map((s) => s.id));
    const agg = aggregate(sales, items);

    renderKpi(agg);
    renderBreakdown(sales, range);
    renderByProduct(agg);
    renderLog(sales, items);
  } catch (err) {
    toast(errMessage(err), "err");
  } finally {
    $("#loading").hidden = true;
    state.loading = false;
  }
}

export function initReport() {
  fillMonthOptions();
  $("#report-date").value = localDate();

  document.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.mode = btn.dataset.mode;
      applyMode();
      loadReport();
    });
  });

  $("#report-year").addEventListener("change", loadReport);
  $("#report-month").addEventListener("change", loadReport);
  $("#report-date").addEventListener("change", loadReport);
  $("#report-reload").addEventListener("click", loadReport);

  // 内訳の行をタップ → 月 / 日 の詳細へ
  $("#breakdown-body").addEventListener("click", (e) => {
    const row = e.target.closest("[data-drill]");
    if (!row) return;
    const key = row.dataset.drill;
    if (state.mode === "year") {
      $("#report-year").value = key.slice(0, 4);
      $("#report-month").value = String(parseInt(key.slice(5, 7), 10));
      state.mode = "month";
    } else {
      $("#report-date").value = key;
      state.mode = "day";
    }
    applyMode();
    loadReport();
  });

  applyMode();
}

// 画面に入るときに年プルダウンを作り直す（新しい年の売上が出たとき用）
export function enterReport() {
  state.yearsLoaded = false;
  return loadReport();
}

// ログインし直したときは期間指定を「今年」に戻す
export function resetReport() {
  state.mode = "year";
  state.yearsLoaded = false;
  $("#report-date").value = localDate();
  $("#report-month").value = String(new Date().getMonth() + 1);
  $("#report-year").value = String(new Date().getFullYear());
  applyMode();
}
