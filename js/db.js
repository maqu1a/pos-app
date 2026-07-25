// Supabase クライアント（vendor/supabase.js が window.supabase を用意している）
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const sb = configured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      // detectSessionInUrl: 確認メールのリンクから戻ってきたとき、URLに付いてくる
      // アクセストークンを拾ってそのままログイン状態にする
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

// Supabase のエラーを日本語に寄せる
export function errMessage(error) {
  if (!error) return "";
  const m = String(error.message || error);
  if (/Invalid login credentials/i.test(m)) return "メールアドレスまたはパスワードが違います";
  if (/User already registered/i.test(m)) return "このメールアドレスは既に登録されています";
  if (/Password should be at least/i.test(m)) return "パスワードは6文字以上にしてください";
  if (/Unable to validate email address/i.test(m)) return "メールアドレスの形式が正しくありません";
  if (/Email not confirmed/i.test(m)) return "メールアドレスの確認が完了していません";
  if (/Failed to fetch|NetworkError/i.test(m)) return "通信できませんでした。ネット接続を確認してください";
  if (/For security purposes|only request this after/i.test(m)) return "続けて送信できません。1分ほど待ってからもう一度お試しください";
  if (/Could not find the function|delete_own_account.*does not exist/i.test(m)) {
    return "削除機能の準備がまだです。Supabaseの SQL Editor で supabase/delete-account.sql を実行してください";
  }
  return m;
}

// 確認メールのリンクから戻ってきたときにURLへ付く #error=... を日本語にする
export function hashErrorMessage() {
  const raw = (typeof location !== "undefined" && location.hash) || "";
  if (!raw.includes("error")) return "";
  const p = new URLSearchParams(raw.slice(1));
  const code = p.get("error_code") || "";
  const desc = p.get("error_description") || p.get("error") || "";
  if (!code && !desc) return "";
  if (/otp_expired|access_denied/i.test(code + desc)) {
    return "確認リンクの有効期限が切れているか、すでに使用済みです。下の「確認メールを再送する」からやり直してください。";
  }
  return desc.replace(/\+/g, " ");
}
