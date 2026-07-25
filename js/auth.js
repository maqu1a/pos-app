// ============================================================
//  ログイン / アカウント作成
// ============================================================
import { sb, errMessage, hashErrorMessage } from "./db.js";
import { $, setBusy, toast } from "./ui.js";

function showError(id, message) {
  const el = $(id);
  el.textContent = message;
  el.hidden = !message;
}

function showOk(id, message) {
  const el = $(id);
  el.textContent = message;
  el.hidden = !message;
}

function showPanel(which) {
  $("#login-panel").hidden = which !== "login";
  $("#signup-panel").hidden = which !== "signup";
  $("#verify-panel").hidden = which !== "verify";
  $("#to-signup").hidden = which !== "login";
  showError("#login-error", "");
  showError("#signup-error", "");
  showError("#verify-error", "");
  $("#signup-ok").hidden = true;
  $("#login-ok").hidden = true;
  $("#verify-ok").hidden = true;
}

// 確認メールを送り直す（送信先アドレスと表示先を指定）
async function resend(email, button, errorId, okId) {
  if (!email) return showError(errorId, "メールアドレスを入力してから押してください");
  showError(errorId, "");
  $(okId).hidden = true;
  setBusy(button, true, "送信中…");
  const { error } = await sb.auth.resend({ type: "signup", email });
  setBusy(button, false);
  if (error) return showError(errorId, errMessage(error));
  showOk(okId, "確認メールを送り直しました。新しいメールのリンクを開いてください。");
}

export function initAuth() {
  $("#to-signup").addEventListener("click", () => showPanel("signup"));
  $("#to-login").addEventListener("click", () => showPanel("login"));

  // 確認メールのリンクが期限切れ等だった場合、その理由をログイン画面に出す
  const linkError = hashErrorMessage();
  if (linkError) {
    showError("#login-error", linkError);
    history.replaceState(null, "", location.pathname + location.search);
  }

  // ---- 確認メールの再送 ----
  $("#resend-btn").addEventListener("click", () =>
    resend($("#login-email").value.trim(), $("#resend-btn"), "#login-error", "#login-ok")
  );
  $("#verify-resend").addEventListener("click", () =>
    resend($("#verify-panel").dataset.email || "", $("#verify-resend"), "#verify-error", "#verify-ok")
  );
  $("#verify-to-login").addEventListener("click", () => showPanel("login"));

  // ---- ログイン ----
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    if (!email || !password) return showError("#login-error", "メールアドレスとパスワードを入力してください");

    showError("#login-error", "");
    setBusy($("#login-submit"), true, "ログイン中…");
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy($("#login-submit"), false);
    if (error) return showError("#login-error", errMessage(error));
    $("#login-password").value = "";
    // 画面の切り替えは app.js の onAuthStateChange 側で行う
  });

  // ---- アカウント作成 ----
  $("#signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const shopName = $("#signup-shop").value.trim();
    const email = $("#signup-email").value.trim();
    const password = $("#signup-password").value;
    const password2 = $("#signup-password2").value;
    $("#signup-ok").hidden = true;

    if (!shopName) return showError("#signup-error", "ショップ名を入力してください");
    if (!email) return showError("#signup-error", "メールアドレスを入力してください");
    if (password.length < 6) return showError("#signup-error", "パスワードは6文字以上にしてください");
    if (password !== password2) return showError("#signup-error", "パスワード（確認）が一致しません");

    showError("#signup-error", "");
    setBusy($("#signup-submit"), true, "登録中…");
    // ショップ名はユーザーのメタデータに持たせる（テーブル不要）
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { shop_name: shopName } },
    });
    setBusy($("#signup-submit"), false);
    if (error) return showError("#signup-error", errMessage(error));

    if (data.session) {
      toast("アカウントを作成しました");
      return; // そのままログイン状態になる
    }
    // メール確認が必要な設定のとき → 案内画面を出す
    $("#login-email").value = email;
    $("#verify-panel").dataset.email = email;
    $("#verify-email").textContent = email;
    showPanel("verify");
  });
}

export function resetAuthForms() {
  showPanel("login");
  $("#login-password").value = "";
  $("#signup-form").reset();
}
