// ============================================================
//  KaikeiPOS 擬似E2E: jsdom + Supabase モックで画面操作を通す
// ============================================================
import { JSDOM } from "jsdom";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const APP = dirname(dirname(fileURLToPath(import.meta.url))).replace(/\\/g, "/");
const SCRATCH = mkdtempSync(join(tmpdir(), "kaikeipos-test-")).replace(/\\/g, "/");

let fails = 0, passes = 0;
const ok = (cond, label) => { if (cond) { passes++; console.log("  ✓", label); } else { fails++; console.log("  ✗ FAIL:", label); } };
const eq = (actual, expected, label) => ok(actual === expected, `${label} … ${JSON.stringify(actual)}${actual === expected ? "" : " ≠ " + JSON.stringify(expected)}`);

/* ------------------------------------------------------------
   Supabase モック（アプリが使うメソッドだけ実装）
------------------------------------------------------------ */
function makeMockSupabase() {
  const db = { products: [], sales: [], sale_items: [] };
  let seq = { sale_items: 1 };
  let user = null;
  const listeners = [];
  const uid = () => "u-1";
  let idc = 0;
  const newId = (p) => `${p}-${++idc}`;

  const auth = {
    async signUp({ email }) { user = { id: uid(), email }; emit("SIGNED_IN"); return { data: { session: { user } }, error: null }; },
    async signInWithPassword({ email, password }) {
      if (password === "wrong") return { data: {}, error: { message: "Invalid login credentials" } };
      user = { id: uid(), email }; emit("SIGNED_IN"); return { data: { session: { user } }, error: null };
    },
    async signOut(opts) { auth._lastSignOutOpts = opts; user = null; emit("SIGNED_OUT"); return { error: null }; },
    async getSession() { return { data: { session: user ? { user } : null } }; },
    onAuthStateChange(cb) { listeners.push(cb); cb("INITIAL_SESSION", user ? { user } : null); return { data: { subscription: { unsubscribe() {} } } }; },
  };
  function emit(ev) { listeners.forEach((cb) => cb(ev, user ? { user } : null)); }

  // クエリビルダ（thenable）
  function from(table) {
    const q = {
      _table: table, _filters: [], _op: "select", _payload: null, _count: null, _head: false,
      _single: false, _order: null, _limit: null,
      select(_cols, opts = {}) { if (opts.count) { this._count = opts.count; this._head = !!opts.head; } if (this._op !== "insert" && this._op !== "update" && this._op !== "delete") this._op = "select"; return this; },
      insert(payload) { this._op = "insert"; this._payload = payload; return this; },
      update(payload) { this._op = "update"; this._payload = payload; return this; },
      delete() { this._op = "delete"; return this; },
      eq(col, val) { this._filters.push((r) => String(r[col]) === String(val)); return this; },
      gte(col, val) { this._filters.push((r) => String(r[col]) >= String(val)); return this; },
      lte(col, val) { this._filters.push((r) => String(r[col]) <= String(val)); return this; },
      in(col, vals) { this._filters.push((r) => vals.includes(r[col])); return this; },
      order(col, opts = {}) { this._order = { col, asc: opts.ascending !== false }; return this; },
      limit(n) { this._limit = n; return this; },
      single() { this._single = true; return this; },
      then(resolve, reject) { return Promise.resolve().then(() => run(this)).then(resolve, reject); },
    };
    return q;
  }

  function run(q) {
    const rows = db[q._table];
    const match = (r) => q._filters.every((f) => f(r));

    if (q._op === "insert") {
      const payload = Array.isArray(q._payload) ? q._payload : [q._payload];
      const inserted = [];
      for (const p of payload) {
        if (q._table === "sales" && db.sales.some((s) => s.user_id === uid() && s.receipt_no === p.receipt_no)) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        const row = { id: q._table === "sale_items" ? seq.sale_items++ : newId(q._table), user_id: uid(), created_at: new Date().toISOString(), archived: false, ...p };
        rows.push(row);
        inserted.push(row);
      }
      return { data: q._single ? inserted[0] : inserted, error: null };
    }
    if (q._op === "update") {
      const hit = rows.filter(match);
      hit.forEach((r) => Object.assign(r, q._payload));
      return { data: hit, error: null };
    }
    if (q._op === "delete") {
      const keep = rows.filter((r) => !match(r));
      const removed = rows.length - keep.length;
      db[q._table] = keep;
      return { data: null, error: null, count: removed };
    }
    let out = rows.filter(match);
    if (q._order) out = out.slice().sort((a, b) => (String(a[q._order.col]) > String(b[q._order.col]) ? 1 : -1) * (q._order.asc ? 1 : -1));
    if (q._limit) out = out.slice(0, q._limit);
    if (q._count) return { data: q._head ? null : out, error: null, count: out.length };
    if (q._single) return { data: out[0] ?? null, error: out.length ? null : { message: "no rows" } };
    return { data: out, error: null };
  }

  return { createClient: () => ({ auth, from }), _db: db, _auth: auth };
}

/* ------------------------------------------------------------
   jsdom 環境を用意して app.js を読み込む
------------------------------------------------------------ */
const html = readFileSync(`${APP}/index.html`, "utf8")
  .replace('<script src="./vendor/supabase.js"></script>', "")
  .replace('<script type="module" src="./js/app.js"></script>', "");

const dom = new JSDOM(html, { url: "https://example.github.io/pos-app/", pretendToBeVisual: true });
const { window } = dom;
const mock = makeMockSupabase();
window.supabase = mock;
window.confirm = () => true;
window.scrollTo = () => {};

global.window = window;
global.document = window.document;
global.location = window.location;
global.history = window.history;
Object.defineProperty(global, "navigator", { value: window.navigator, configurable: true });
global.confirm = window.confirm;
global.HTMLElement = window.HTMLElement;
global.Event = window.Event;

// config.js にダミー値を差し込んだコピーを使う（本体は書き換えない）
mkdirSync(`${SCRATCH}/appcopy/js`, { recursive: true });
writeFileSync(`${SCRATCH}/appcopy/package.json`, `{"type":"module"}`);
for (const f of ["app.js", "auth.js", "db.js", "products.js", "register.js", "report.js", "store.js", "ui.js"]) {
  writeFileSync(`${SCRATCH}/appcopy/js/${f}`, readFileSync(`${APP}/js/${f}`, "utf8"));
}
writeFileSync(
  `${SCRATCH}/appcopy/js/config.js`,
  `export const SUPABASE_URL="https://mock.supabase.co";export const SUPABASE_ANON_KEY="mock-anon";export const SHOP_NAME="テスト商店";`
);

const $ = (sel) => window.document.querySelector(sel);
const click = (sel) => { const el = $(sel); if (!el) throw new Error(`要素なし: ${sel}`); el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); };
const type = (sel, value) => {
  const el = $(sel);
  el.value = value;
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
  el.dispatchEvent(new window.Event("change", { bubbles: true }));
};
const submit = (sel) => $(sel).dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
const tick = (n = 8) => new Promise((r) => setTimeout(r, n));

const MOD = `file:///${SCRATCH}/appcopy/js`.replace(/\\/g, "/");
await import(`${MOD}/app.js`);
await tick();

/* ------------------------------------------------------------
   1. ログイン画面
------------------------------------------------------------ */
console.log("\n[1] ログイン画面");
ok(!$("#auth-view").hidden, "ログイン画面が表示される");
ok($("#app-view").hidden, "アプリ本体は隠れている");
ok($("#setup-notice").hidden, "設定済みなので案内は出ない");
ok(!$("#login-panel").hidden && $("#signup-panel").hidden, "中央にログインフォーム");
ok(!$("#to-signup").hidden, "右下にアカウント作成リンク");

// 失敗するログイン
type("#login-email", "shop@example.com");
type("#login-password", "wrong");
submit("#login-form");
await tick();
eq($("#login-error").textContent, "メールアドレスまたはパスワードが違います", "誤パスワードでエラー表示");
ok(!$("#app-view").hidden === false, "ログインしていないのでアプリは開かない");

// アカウント作成 → 自動ログイン
click("#to-signup");
ok(!$("#signup-panel").hidden, "アカウント作成パネルへ切替");
type("#signup-email", "shop@example.com");
type("#signup-password", "abc123");
type("#signup-password2", "abc124");
submit("#signup-form");
await tick();
eq($("#signup-error").textContent, "パスワード（確認）が一致しません", "確認用パスワード不一致を検出");
type("#signup-password2", "abc123");
submit("#signup-form");
await tick(20);

/* ------------------------------------------------------------
   2. ダッシュボード
------------------------------------------------------------ */
console.log("\n[2] ダッシュボード");
ok($("#auth-view").hidden && !$("#app-view").hidden, "ログイン後アプリへ遷移");
eq($("#screen-title").textContent, "ダッシュボード", "画面タイトル");
eq($("#user-email").textContent, "shop@example.com", "ログインユーザー表示");
eq($("#today-amount").textContent, "¥0", "本日の売上は0円");
ok($("#back-btn").hidden, "ダッシュボードでは戻るボタンなし");

/* ------------------------------------------------------------
   3. 商品登録
------------------------------------------------------------ */
console.log("\n[3] 商品登録");
click('[data-goto="products"]');
await tick();
eq($("#screen-title").textContent, "商品登録", "商品登録画面へ");

submit("#product-form");
await tick();
eq($("#product-error").textContent, "商品名を入力してください", "商品名必須のバリデーション");
type("#product-name", "ブレンドコーヒー");
submit("#product-form");
await tick();
eq($("#product-error").textContent, "金額を入力してください", "金額必須のバリデーション");

type("#product-price", "500");
type("#product-cost", "150");
submit("#product-form");
await tick(20);
eq(mock._db.products.length, 1, "商品が1件保存された");
eq(mock._db.products[0].cost, 150, "原価が保存された");
eq($("#product-count").textContent, "1", "登録件数バッジ");
ok($("#product-list").textContent.includes("ブレンドコーヒー"), "一覧に商品名");
ok($("#product-list").textContent.includes("原価 ¥150"), "一覧に原価");
eq($("#product-name").value, "", "フォームがリセットされる");

// 原価なし商品／全角金額
type("#product-name", "自家製ケーキ");
type("#product-price", "８００");   // 全角
submit("#product-form");
await tick(20);
eq(mock._db.products.length, 2, "2件目も保存");
eq(mock._db.products[1].price, 800, "全角数字を数値化");
eq(mock._db.products[1].cost, null, "原価未設定は null");
ok($("#product-list").textContent.includes("原価未設定"), "原価未設定と表示");

/* ------------------------------------------------------------
   4. レジ
------------------------------------------------------------ */
console.log("\n[4] レジ");
click("#back-btn");
await tick();
click('[data-goto="register"]');
await tick(20);
eq($("#screen-title").textContent, "レジ", "レジ画面へ");
eq($("#reg-product-grid").querySelectorAll(".reg-item").length, 2, "登録済み商品がボタンで並ぶ");
ok($("#checkout-btn").disabled, "カゴが空なら会計できない");

const pick = (n) => click(`#reg-product-grid .reg-item:nth-child(${n})`);
pick(1); pick(1); pick(2);   // コーヒー×2, ケーキ×1
await tick();
eq($("#cart-qty").textContent, "3", "合計点数 = 3");
eq($("#cart-total").textContent, "¥1,800", "合計金額 = 500×2 + 800");
eq($("#cart-list").querySelectorAll(".stepper").length, 4, "カゴ2行ぶんの増減ボタン");
ok(!$("#checkout-btn").disabled, "お預かり未入力でも会計可（ちょうど扱い）");

// 減らす
click('[data-minus]');
await tick();
eq($("#cart-qty").textContent, "2", "− で1点減る");
pick(1);
await tick();
eq($("#cart-qty").textContent, "3", "商品タップで戻る");

// お預かり不足
type("#received", "1000");
eq($("#change").textContent, "¥800 不足", "不足額を表示");
ok($("#checkout-btn").disabled, "不足時は会計ボタンが無効");

// おつり
type("#received", "2000");
eq($("#change").textContent, "¥200", "おつり = 2000 - 1800");
ok(!$("#checkout-btn").disabled, "足りていれば会計できる");

// 「ちょうど」ボタン
click('[data-cash="exact"]');
eq($("#received").value, "1800", "ちょうどボタンで合計額が入る");
eq($("#change").textContent, "¥0", "おつり0円");
type("#received", "2000");

// 会計
click("#checkout-btn");
await tick(30);
ok(!$("#done-overlay").hidden, "会計完了パネルが出る");
const today = new Date();
const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
eq($("#done-receipt").textContent, `${ymd}-001`, "会計番号は日付+連番");
eq($("#done-total").textContent, "¥1,800", "完了パネルの合計");
eq($("#done-change").textContent, "¥200", "完了パネルのおつり");
eq(mock._db.sales.length, 1, "sales に1件");
eq(mock._db.sale_items.length, 2, "sale_items に2行（商品2種）");
eq(mock._db.sales[0].total_cost, 300, "原価合計 = 150×2（ケーキは原価0）");
eq(mock._db.sales[0].received, 2000, "お預かりが保存された");
eq(mock._db.sales[0].change_due, 200, "おつりが保存された");
eq($("#cart-qty").textContent, "0", "会計後カゴがクリアされる");
eq($("#received").value, "", "お預かり欄もクリア");

click("#done-close");
ok($("#done-overlay").hidden, "「次の会計へ」で閉じる");

// 2件目の会計（連番の確認）
pick(2);
await tick();
click("#checkout-btn");
await tick(30);
eq($("#done-receipt").textContent, `${ymd}-002`, "2件目は連番002");
eq(mock._db.sales.length, 2, "sales に2件");
click("#done-close");

/* ------------------------------------------------------------
   5. ダッシュボードの本日集計
------------------------------------------------------------ */
console.log("\n[5] 本日の集計");
click("#back-btn");
await tick(20);
eq($("#today-amount").textContent, "¥2,600", "本日の売上 = 1800 + 800");
eq($("#today-count").textContent, "2", "会計数 2");
eq($("#today-qty").textContent, "4", "点数 4");

/* ------------------------------------------------------------
   6. 販売レポート
------------------------------------------------------------ */
console.log("\n[6] 販売レポート");
click('[data-goto="report"]');
await tick(40);
eq($("#screen-title").textContent, "販売レポート", "レポート画面へ");
eq($("#report-period").textContent, `${today.getFullYear()}年の集計`, "初期表示は年");
eq($("#kpi-sales").textContent, "¥2,600", "年間売上");
eq($("#kpi-cost").textContent, "¥300", "年間原価");
eq($("#kpi-profit").textContent, "¥2,300", "年間粗利");
eq($("#kpi-count").textContent, "2", "会計数");
eq($("#kpi-qty").textContent, "4 点", "販売点数");
ok(!$("#cost-note").hidden, "原価未設定商品があるので注意書きが出る");
ok(!$("#breakdown-card").hidden, "年表示では月別内訳が出る");
ok($("#breakdown-body").textContent.includes(`${today.getMonth() + 1}月`), "当月の行がある");
ok($("#byproduct-body").textContent.includes("ブレンドコーヒー"), "商品別にコーヒー");
ok($("#byproduct-body").textContent.includes("自家製ケーキ"), "商品別にケーキ");
ok($("#sales-log").textContent.includes(`${ymd}-001`), "会計履歴に001");
ok($("#sales-log").textContent.includes(`${ymd}-002`), "会計履歴に002");
ok($("#sales-log").textContent.includes("ブレンドコーヒー×2"), "履歴に商品名と点数");

// 内訳の行タップ → 月表示へドリルダウン
click(`#breakdown-body tr[data-drill]`);
await tick(40);
eq($("#report-period").textContent, `${today.getFullYear()}年${today.getMonth() + 1}月の集計`, "月表示へドリルダウン");
eq($("#kpi-sales").textContent, "¥2,600", "月売上");
ok($("#breakdown-body").textContent.includes(`${today.getDate()}日`), "日別内訳に今日の行");

// さらに日へ
click(`#breakdown-body tr[data-drill]`);
await tick(40);
eq($("#report-period").textContent, `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日の集計`, "日表示へドリルダウン");
ok($("#breakdown-card").hidden, "日表示では内訳を出さない");
eq($("#kpi-sales").textContent, "¥2,600", "日売上");

// 売上のない日
type("#report-date", "2020-01-01");
await tick(40);
eq($("#kpi-sales").textContent, "¥0", "データなしの日は0円");
ok(!$("#report-empty").hidden, "「販売データはありません」表示");

/* ------------------------------------------------------------
   7. 商品を一覧から外す
------------------------------------------------------------ */
console.log("\n[7] 商品の削除（アーカイブ）");
click("#back-btn");
await tick();
click('[data-goto="products"]');
await tick();
click("#product-list [data-del]");
await tick(20);
eq($("#product-count").textContent, "1", "一覧から1件減る");
eq(mock._db.products.filter((p) => p.archived).length, 1, "archived = true になる（行は残る）");
eq(mock._db.sale_items.length, 3, "過去の明細は消えない");

/* ------------------------------------------------------------
   8. ログアウト → 再ログインでデータが見える
------------------------------------------------------------ */
console.log("\n[8] ログアウト / 再ログイン");
click("#logout-btn");
await tick(20);
eq(mock._auth._lastSignOutOpts?.scope, "local", "ログアウトはこの端末だけ（他端末を落とさない）");
ok(!$("#auth-view").hidden && $("#app-view").hidden, "ログイン画面に戻る");
eq($("#login-password").value, "", "パスワード欄がクリアされる");

type("#login-email", "shop@example.com");
type("#login-password", "abc123");
submit("#login-form");
await tick(40);
ok(!$("#app-view").hidden, "再ログインできる");
click('[data-goto="report"]');
await tick(40);
eq($("#report-period").textContent, `${today.getFullYear()}年の集計`, "再ログイン後は期間が今年に戻る");
eq($("#kpi-sales").textContent, "¥2,600", "ログインすれば売上が見える");

/* ------------------------------------------------------------
   9. 複数端末で同じアカウントを使うケース
------------------------------------------------------------ */
console.log("\n[9] 複数端末での同時利用");
const storeMod = await import(`${MOD}/store.js`);
const regMod = await import(`${MOD}/register.js`);

// (a) 別の端末で商品を追加 → こちらでレジ画面に入ると出てくる
mock._db.products.push({ id: "p-other", user_id: "u-1", name: "アイスラテ", price: 600, cost: 200, archived: false, created_at: new Date().toISOString() });
click("#back-btn");
await tick(20);
click('[data-goto="register"]');
await tick(40);
eq($("#reg-product-grid").querySelectorAll(".reg-item").length, 2, "別端末で追加した商品がレジに出る（削除済み1件を除く2件）");
ok($("#reg-product-grid").textContent.includes("アイスラテ"), "追加された商品名が並ぶ");

// (b) 別の端末で会計番号001が先に使われていた場合 → こちらは002になる
const ymd2 = ymd;
mock._db.sales.length = 0;   // 今日のsalesを一旦空にして、別端末の1件だけを置く
mock._db.sales.push({ id: "s-other", user_id: "u-1", receipt_no: `${ymd2}-001`, sold_at: new Date().toISOString(), sold_on: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`, total_qty: 1, total_amount: 600, total_cost: 200, received: 600, change_due: 0 });
pick(1);
await tick();
click("#checkout-btn");
await tick(40);
eq($("#done-receipt").textContent, `${ymd2}-002`, "番号が重複せず次の番号が振られる");
click("#done-close");

// (c) カゴに入れた商品を別端末が削除しても落ちない
pick(1);
await tick();
const inCart = storeMod.store.products[0];
storeMod.store.products = storeMod.store.products.filter((p) => p.id !== inCart.id);   // 別端末の削除が反映された状態
let crashed = false;
try { regMod.render(); } catch { crashed = true; }
ok(!crashed, "カゴの商品が消えても画面が壊れない");
eq($("#cart-qty").textContent, "0", "消えた商品はカゴから外れる");
ok($("#checkout-btn").disabled, "会計ボタンは押せない状態に戻る");

/* ------------------------------------------------------------
   10. hidden属性とCSSの整合性
   （display を指定した要素は [hidden] の上書きが無いと消えない。
     jsdom は hidden プロパティしか見ないので、ここで明示的に確認する）
------------------------------------------------------------ */
console.log("\n[10] hidden属性とCSSの整合性");
const css = readFileSync(`${APP}/style.css`, "utf8");
const override = /\[hidden\][^{]*\{[^}]*display\s*:\s*none\s*!important/.test(css);
ok(override, "[hidden] に display:none !important の上書きがある");

const fresh = new JSDOM(readFileSync(`${APP}/index.html`, "utf8"));
const risky = [];
for (const el of fresh.window.document.querySelectorAll("[hidden]")) {
  for (const cls of el.classList) {
    // .cls { … display: … } のような指定を探す（セレクタが複数並ぶケースも許容）
    if (new RegExp(`\\.${cls}\\b[^{}]*\\{[^}]*display\\s*:`).test(css)) {
      risky.push(`${el.id ? "#" + el.id : el.tagName.toLowerCase()}.${cls}`);
    }
  }
}
ok(override || risky.length === 0, `display指定と衝突する要素: ${risky.join(", ") || "なし"}${risky.length && override ? "（上書きで無効化済み）" : ""}`);

console.log(`\n=== ${passes} passed, ${fails} failed ===`);
process.exit(fails ? 1 : 0);
