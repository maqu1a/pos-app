// ============================================================
//  起動処理・画面遷移
//  ログイン → ダッシュボード → 商品登録 / レジ / 販売レポート
// ============================================================
import { sb, configured, errMessage } from "./db.js";
import { $, yen, num, toast, setBusy, confirmDialog, initConfirmDialog } from "./ui.js";
import { store, loadProducts, todaySummary, deleteOwnAccount } from "./store.js";
import { initAuth, resetAuthForms } from "./auth.js";
import { initProducts, renderProducts, refreshProducts } from "./products.js";
import { initRegister, enterRegister, render as renderRegister } from "./register.js";
import { initReport, enterReport, resetReport } from "./report.js";
import { SHOP_NAME } from "./config.js";
import { APP_VERSION } from "./version.js";

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

// ショップ名（登録時に入力したもの）を画面に反映
function applyShopName(user) {
  const name = (user?.user_metadata?.shop_name || "").trim() || SHOP_NAME;
  $("#shop-name").textContent = name;
  $("#dash-lead").textContent = `${name} — 今日の売上を確認して、レジを開きましょう。`;
  document.title = `${name} — KaikeiPOS`;
}

async function enterApp(user) {
  if (signedIn) return;
  signedIn = true;
  store.user = user;
  $("#auth-view").hidden = true;
  $("#app-view").hidden = false;
  $("#user-email").textContent = user.email || "";
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

  $("#app-version").textContent = APP_VERSION;

  initConfirmDialog();
  initAuth();
  initProducts();
  initRegister();
  initReport();

  document.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.goto));
  });
  $("#back-btn").addEventListener("click", () => navigate("dashboard"));
  $("#logout-btn").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "ログアウトしますか？",
      message: "この端末からログアウトします。ほかの端末のログイン状態はそのままです。",
      okLabel: "ログアウト",
    });
    if (!ok) return;
    // scope: "local" … 他の端末のログイン状態はそのまま（既定の global は全端末が落ちる）
    await sb.auth.signOut({ scope: "local" });
  });
  window.addEventListener("hashchange", () => {
    if (signedIn) showScreen(screenFromHash());
  });

  // ショップ名の変更（登録済みアカウントでも後から設定できる）
  const shopError = (message) => {
    const el = $("#shop-dialog-error");
    el.textContent = message;
    el.hidden = !message;
  };
  $("#edit-shop-btn").addEventListener("click", () => {
    $("#shop-input").value = store.user?.user_metadata?.shop_name || "";
    shopError("");
    $("#shop-dialog").hidden = false;
    $("#shop-input").focus();
  });
  $("#shop-cancel").addEventListener("click", () => {
    $("#shop-dialog").hidden = true;
  });
  $("#shop-save").addEventListener("click", async () => {
    const name = $("#shop-input").value.trim();
    if (!name) return shopError("ショップ名を入力してください");
    shopError("");
    setBusy($("#shop-save"), true, "保存中…");
    try {
      const { data, error } = await sb.auth.updateUser({ data: { shop_name: name } });
      if (error) throw error;
      store.user = data.user;
      applyShopName(data.user);
      $("#shop-dialog").hidden = true;
      toast("ショップ名を変更しました");
    } catch (err) {
      shopError(errMessage(err));
    } finally {
      setBusy($("#shop-save"), false);
    }
  });

  // ---- 登録情報の削除（ダッシュボード下部の小さいリンク）----
  const deleteError = (message) => {
    const el = $("#delete-error");
    el.textContent = message;
    el.hidden = !message;
  };
  $("#open-delete-account").addEventListener("click", () => {
    $("#delete-email").value = "";
    deleteError("");
    $("#delete-dialog").hidden = false;
  });
  $("#delete-cancel").addEventListener("click", () => {
    $("#delete-dialog").hidden = true;
  });
  $("#delete-confirm").addEventListener("click", async () => {
    const typed = $("#delete-email").value.trim().toLowerCase();
    const mine = (store.user?.email || "").toLowerCase();
    if (!typed) return deleteError("登録したメールアドレスを入力してください");
    if (typed !== mine) return deleteError("メールアドレスが一致しません");

    deleteError("");
    setBusy($("#delete-confirm"), true, "削除中…");
    try {
      await deleteOwnAccount();
      $("#delete-dialog").hidden = true;
      await sb.auth.signOut({ scope: "local" });
      toast("登録情報を削除しました");
    } catch (err) {
      deleteError(errMessage(err));
    } finally {
      setBusy($("#delete-confirm"), false);
    }
  });

  // ログイン状態を監視（初回の復元もここに来る）
  sb.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      store.user = session.user;
      applyShopName(session.user);   // ログイン直後・情報更新時に反映
      enterApp(session.user);
    } else {
      leaveApp();
    }
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
