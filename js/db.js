// Supabase クライアント（vendor/supabase.js が window.supabase を用意している）
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const sb = configured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
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
  return m;
}
