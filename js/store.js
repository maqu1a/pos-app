// ============================================================
//  データアクセス層（Supabase とのやり取りは全部ここ）
// ============================================================
import { sb } from "./db.js";
import { localDate } from "./ui.js";

export const store = {
  products: [],     // 登録済み商品（archived = false）
  user: null,       // ログイン中のユーザー
};

/* ---------------- 商品 ---------------- */

export async function loadProducts() {
  const { data, error } = await sb
    .from("products")
    .select("id,name,price,cost")
    .eq("archived", false)
    .order("created_at", { ascending: true });
  if (error) throw error;
  store.products = data || [];
  return store.products;
}

export async function createProduct({ name, price, cost }) {
  const { data, error } = await sb
    .from("products")
    .insert({ name, price, cost })
    .select("id,name,price,cost")
    .single();
  if (error) throw error;
  store.products.push(data);
  return data;
}

// 一覧から外すだけ（過去の売上明細は残る）
export async function archiveProduct(id) {
  const { error } = await sb.from("products").update({ archived: true }).eq("id", id);
  if (error) throw error;
  store.products = store.products.filter((p) => p.id !== id);
}

/* ---------------- 会計 ---------------- */

const receiptNo = (soldOn, seq) => soldOn.replace(/-/g, "") + "-" + String(seq).padStart(3, "0");

// その日の最大番号＋1を返す（削除で番号が抜けていても衝突しない）
async function nextSeq(soldOn) {
  const { data, error } = await sb
    .from("sales")
    .select("receipt_no")
    .eq("sold_on", soldOn)
    .order("receipt_no", { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!data || !data.length) return 1;
  const last = parseInt(String(data[0].receipt_no).split("-")[1] || "0", 10);
  return (Number.isNaN(last) ? 0 : last) + 1;
}

/**
 * 会計を保存する。
 * lines: [{ product_id, name, price, cost, qty }]
 * 戻り値: { receipt_no, sold_at, total_amount, change_due }
 */
export async function saveSale({ lines, received, changeDue }) {
  const soldOn = localDate();
  const soldAt = new Date().toISOString();
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  const totalAmount = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const totalCost = lines.reduce((s, l) => s + (l.cost || 0) * l.qty, 0);

  let seq = await nextSeq(soldOn);
  let sale = null;
  let lastError = null;

  // 会計番号が万一かぶったら次の番号で再試行
  for (let attempt = 0; attempt < 5 && !sale; attempt++, seq++) {
    const { data, error } = await sb
      .from("sales")
      .insert({
        receipt_no: receiptNo(soldOn, seq),
        sold_at: soldAt,
        sold_on: soldOn,
        total_qty: totalQty,
        total_amount: totalAmount,
        total_cost: totalCost,
        received: received,
        change_due: changeDue,
      })
      .select("id,receipt_no,sold_at,total_amount,change_due")
      .single();
    if (!error) { sale = data; break; }
    if (error.code !== "23505") throw error;   // 重複以外はそのまま失敗
    lastError = error;
  }
  if (!sale) throw lastError || new Error("会計番号を発行できませんでした");

  const items = lines.map((l) => ({
    sale_id: sale.id,
    product_id: l.product_id,
    name: l.name,
    price: l.price,
    cost: l.cost || 0,
    qty: l.qty,
  }));
  const { error: itemError } = await sb.from("sale_items").insert(items);
  if (itemError) {
    // 明細が入らなかったら会計ごと巻き戻す（中身のないレシートを残さない）
    await sb.from("sales").delete().eq("id", sale.id);
    throw itemError;
  }
  return sale;
}

/* ---------------- レポート ---------------- */

// 期間内の会計を新しい順に取得
export async function fetchSales(from, to) {
  const { data, error } = await sb
    .from("sales")
    .select("id,receipt_no,sold_at,sold_on,total_qty,total_amount,total_cost")
    .gte("sold_on", from)
    .lte("sold_on", to)
    .order("sold_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// 会計IDに紐づく明細を取得（URLが長くなりすぎないよう分割して問い合わせ）
export async function fetchSaleItems(saleIds) {
  if (!saleIds.length) return [];
  const CHUNK = 80;
  const all = [];
  for (let i = 0; i < saleIds.length; i += CHUNK) {
    const { data, error } = await sb
      .from("sale_items")
      .select("sale_id,name,price,cost,qty")
      .in("sale_id", saleIds.slice(i, i + CHUNK));
    if (error) throw error;
    all.push(...(data || []));
  }
  return all;
}

// 会計を削除（明細は sale_items の外部キー ON DELETE CASCADE で一緒に消える）
export async function deleteSale(id) {
  const { error } = await sb.from("sales").delete().eq("id", id);
  if (error) throw error;
}

// ダッシュボードの「本日」
export async function todaySummary() {
  const today = localDate();
  const { data, error } = await sb
    .from("sales")
    .select("total_qty,total_amount")
    .eq("sold_on", today);
  if (error) throw error;
  const rows = data || [];
  return {
    amount: rows.reduce((s, r) => s + r.total_amount, 0),
    qty: rows.reduce((s, r) => s + r.total_qty, 0),
    count: rows.length,
  };
}

// 一番古い販売年（レポートの年プルダウン用）
export async function firstSaleYear() {
  const { data, error } = await sb
    .from("sales")
    .select("sold_on")
    .order("sold_on", { ascending: true })
    .limit(1);
  if (error) throw error;
  if (!data || !data.length) return new Date().getFullYear();
  return parseInt(String(data[0].sold_on).slice(0, 4), 10);
}
