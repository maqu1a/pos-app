-- ============================================================
--  KaikeiPOS — Supabase スキーマ
--  Supabase ダッシュボード → SQL Editor に貼り付けて Run するだけ
--  （ユーザー登録・ログインは Supabase Auth の auth.users を使う）
-- ============================================================

-- ------------------------------------------------------------
-- 商品マスタ
-- ------------------------------------------------------------
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(btrim(name)) > 0),
  price       integer not null check (price >= 0),   -- 税込の販売金額（円・整数）
  cost        integer check (cost >= 0),             -- 原価（任意。null = 未設定）
  archived    boolean not null default false,        -- 一覧から外した商品（過去の売上は残す）
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 会計（レシート1枚 = 1行）
-- ------------------------------------------------------------
create table if not exists public.sales (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  receipt_no    text not null,                 -- 会計番号 例: 20260725-001
  sold_at       timestamptz not null default now(),
  sold_on       date not null,                 -- 端末のローカル日付（レポート集計用）
  total_qty     integer not null,              -- 合計点数
  total_amount  integer not null,              -- 合計金額（売上）
  total_cost    integer not null default 0,    -- 原価合計（未設定商品は0で計上）
  received      integer,                       -- お預かり
  change_due    integer,                       -- おつり
  constraint sales_receipt_no_unique unique (user_id, receipt_no)
);

-- ------------------------------------------------------------
-- 会計の明細（商品名・金額・原価は販売時点の値をコピーして保存）
-- ------------------------------------------------------------
create table if not exists public.sale_items (
  id          bigserial primary key,
  sale_id     uuid not null references public.sales(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,
  name        text not null,
  price       integer not null,
  cost        integer not null default 0,
  qty         integer not null check (qty > 0)
);

-- ------------------------------------------------------------
-- インデックス
-- ------------------------------------------------------------
create index if not exists products_user_idx    on public.products (user_id, archived, created_at);
create index if not exists sales_user_date_idx  on public.sales (user_id, sold_on);
create index if not exists sale_items_sale_idx  on public.sale_items (sale_id);
create index if not exists sale_items_user_idx  on public.sale_items (user_id);

-- ============================================================
--  RLS（行レベルセキュリティ）
--  ログインしている本人の行だけ読み書きできる。
--  ※ これが有効な限り、anon キーを公開リポジトリに置いても
--     他人のデータは読めない。
-- ============================================================
alter table public.products   enable row level security;
alter table public.sales      enable row level security;
alter table public.sale_items enable row level security;

drop policy if exists "products_owner" on public.products;
create policy "products_owner" on public.products
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "sales_owner" on public.sales;
create policy "sales_owner" on public.sales
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "sale_items_owner" on public.sale_items;
create policy "sale_items_owner" on public.sale_items
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
