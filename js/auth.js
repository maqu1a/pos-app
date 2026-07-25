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
  $("#to-signup").hidden = which === "signup";
  showError("#login-error", "");
  showError("#signup-error", "");
  $("#signup-ok").hidden = true;
  $("#login-ok").hidden = true;
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
  $("#resend-btn").addEventListener("click", async () => {
    const email = $("#login-email").value.trim();
    $("#login-ok").hidden = true;
    if (!email) return showError("#login-error", "メールアドレスを入力してから押してください");

    showError("#login-error", "");
    setBusy($("#resend-btn"), true, "送信中…");
    const { error } = await sb.auth.resend({ type: "signup", email });
    setBusy($("#resend-btn"), false);
    if (error) return showError("#login-error", errMessage(error));
    showOk("#login-ok", "確認メールを送り直しました。メール内のリンクを開いてください。");
  });

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
    const email = $("#signup-email").value.trim();
    const password = $("#signup-password").value;
    const password2 = $("#signup-password2").value;
    $("#signup-ok").hidden = true;

    if (!email) return showError("#signup-error", "メールアドレスを入力してください");
    if (password.length < 6) return showError("#signup-error", "パスワードは6文字以上にしてください");
    if (password !== password2) return showError("#signup-error", "パスワード（確認）が一致しません");

    showError("#signup-error", "");
    setBusy($("#signup-submit"), true, "登録中…");
    const { data, error } = await sb.auth.signUp({ email, password });
    setBusy($("#signup-submit"), false);
    if (error) return showError("#signup-error", errMessage(error));

    if (data.session) {
      toast("アカウントを作成しました");
      return; // そのままログイン状態になる
    }
    // メール確認が有効なプロジェクトの場合
    const ok = $("#signup-ok");
    ok.textContent = "確認メールを送信しました。メール内のリンクを開いたあと、ログインしてください。";
    ok.hidden = false;
    $("#login-email").value = email;
  });
}

export function resetAuthForms() {
  showPanel("login");
  $("#login-password").value = "";
  $("#signup-form").reset();
}
