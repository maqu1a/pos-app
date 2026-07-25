// ============================================================
//  起動処理・画面遷移
//  ログイン → ダッシュボード → 商品登録 / レジ / 販売レポート
// ============================================================
import { sb, configured, errMessage } from "./db.js";
import { $, yen, num, toast } from "./ui.js";
import { store, loadProducts, todaySummary } from "./store.js";
import { initAuth, resetAuthForms } from "./auth.js";
import { initProducts, renderProducts, refreshProducts } from "./products.js";
import { initRegister, enterRegister, render as renderRegister } from "./register.js";
import { initReport, enterReport, resetReport } from "./report.js";
import { SHOP_NAME } from "./config.js";

const SCREENS = {
  dashboard: { title: "ダッシュボード", back: false },
  products: { title: "商品登録", back: true },
  register: { title: "レジ", back: true },
  report: { title: "販売レポート", back: true },
};

let signedIn = false;

/* ---------------- 画面遷移 ---------------- */

function screenFromHash() {
  const name = (location.hash || "").replace(/^#\/?/, "");
  return SCREENS[name] ? name : "dashboard";
}

export function navigate(name) {
  const target = SCREENS[name] ? name : "dashboard";
  if (screenFromHash() === target) return showScreen(target);
  location.hash = `#/${target}`;   // hashchange → showScreen
}

async function showScreen(name) {
  Object.keys(SCREENS).forEach((key) => {
    $(`#screen-${key}`).hidden = key !== name;
  });
  $("#screen-title").textContent = SCREENS[name].title;
  $("#back-btn").hidden = !SCREENS[name].back;
  window.scrollTo(0, 0);

  // 画面に入るたびにサーバーから取り直す（別の端末で追加・削除された分を反映）
  if (name === "dashboard") refreshToday();
  if (name === "products") {
    renderProducts();
    refreshProducts().catch((err) => toast(errMessage(err), "err"));
  }
  if (name === "register") {
    enterRegister();
    refreshProducts().then(renderRegister).catch((err) => toast(errMessage(err), "err"));
  }
  if (name === "report") enterReport();
}

/* ---------------- ダッシュボードの本日分 ---------------- */

async function refreshToday() {
  try {
    const t = await todaySummary();
    $("#today-amount").textContent = yen(t.amount);
    $("#today-count").textContent = num(t.count);
    $("#today-qty").textContent = num(t.qty);
  } catch (err) {
    toast(errMessage(err), "err");
  }
}

/* ---------------- ログイン状態の切り替え ---------------- */

async function enterApp(user) {
  if (signedIn) return;
  signedIn = true;
  store.user = user;
  $("#auth-view").hidden = true;
  $("#app-view").hidden = false;
  $("#user-email").textContent = user.email || "";
  $("#dash-lead").textContent = `${SHOP_NAME} — 今日の売上を確認して、レジを開きましょう。`;
  resetReport();   // 前のログインで見ていた期間指定を引き継がない

  $("#loading").hidden = false;
  try {
    await loadProducts();
  } catch (err) {
    toast(errMessage(err), "err");
  } finally {
    $("#loading").hidden = true;
  }
  showScreen(screenFromHash());
}

function leaveApp() {
  signedIn = false;
  store.user = null;
  store.products = [];
  $("#app-view").hidden = true;
  $("#auth-view").hidden = false;
  resetAuthForms();
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

/* ---------------- 起動 ---------------- */

function boot() {
  if (!configured) {
    $("#setup-notice").hidden = false;
    return;
  }

  initAuth();
  initProducts();
  initRegister();
  initReport();

  document.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.goto));
  });
  $("#back-btn").addEventListener("click", () => navigate("dashboard"));
  $("#logout-btn").addEventListener("click", async () => {
    if (!confirm("この端末からログアウトしますか？")) return;
    // scope: "local" … 他の端末のログイン状態はそのまま（既定の global は全端末が落ちる）
    await sb.auth.signOut({ scope: "local" });
  });
  window.addEventListener("hashchange", () => {
    if (signedIn) showScreen(screenFromHash());
  });

  // ログイン状態を監視（初回の復元もここに来る）
  sb.auth.onAuthStateChange((event, session) => {
    if (session?.user) enterApp(session.user);
    else leaveApp();
  });

  // 復元されたセッションが無ければログイン画面を出す
  sb.auth
    .getSession()
    .then(({ data }) => {
      if (!data.session) $("#auth-view").hidden = false;
    })
    .catch((err) => {
      // 通信できないときも、せめてログイン画面は出す
      $("#auth-view").hidden = false;
      toast(errMessage(err), "err");
    });

  // PWA（http/https で開かれたときだけ）
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

try {
  boot();
} catch (err) {
  // 起動時の例外は画面に出す（index.html 側のハンドラ）
  if (window.__bootErr) window.__bootErr("起動処理でエラー: " + (err?.message || err));
  else throw err;
}
