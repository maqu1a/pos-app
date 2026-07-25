-- ============================================================
--  「登録情報を削除する」機能に必要な関数
--  Supabase ダッシュボード → SQL Editor に貼り付けて Run
--
--  ログイン中の本人が、自分のアカウントと自分のデータを削除できるようにする。
--  （auth.users の削除は通常クライアントからできないため、
--    security definer の関数を経由させる。他人のアカウントは消せない）
-- ============================================================

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'ログインしていません';
  end if;

  -- 自分のデータを削除（auth.users の削除でカスケードもされるが明示しておく）
  delete from public.sale_items where user_id = me;
  delete from public.sales      where user_id = me;
  delete from public.products   where user_id = me;

  -- アカウント本体（セッションや認証情報も一緒に消える）
  delete from auth.users where id = me;
end;
$$;

-- 呼べるのはログイン済みユーザーだけ
revoke all on function public.delete_own_account() from public;
revoke all on function public.delete_own_account() from anon;
grant execute on function public.delete_own_account() to authenticated;
