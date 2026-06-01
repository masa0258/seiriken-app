-- 顧客向け呼び出し状況ページ用 Supabase セットアップ
-- Supabase ダッシュボード → SQL Editor に貼り付けて一度実行する。
-- 実行前に下の '★ここに秘密キーを設定★' を任意の長い文字列に置き換えること。

-- 1. 状況テーブル（1行のみ）
create table if not exists public.queue_status (
  id              text primary key,
  calling_number  int,
  recent_called   jsonb  not null default '[]'::jsonb,
  waiting_numbers jsonb  not null default '[]'::jsonb,
  waiting_count   int    not null default 0,
  last_issued     int    not null default 0,
  avg_serve_ms    bigint,
  updated_at      timestamptz not null default now()
);

-- 初期行（id='main' 固定）
insert into public.queue_status (id) values ('main')
  on conflict (id) do nothing;

-- 2. 秘密キー保管テーブル（anon は読めない）
create table if not exists public.private_config (
  id     text primary key,
  secret text not null
);

insert into public.private_config (id, secret)
  values ('main', '★ここに秘密キーを設定★')
  on conflict (id) do update set secret = excluded.secret;

-- 3. RLS（行レベルセキュリティ）
alter table public.queue_status  enable row level security;
alter table public.private_config enable row level security;

-- anon は queue_status の SELECT のみ許可
drop policy if exists "anon read queue_status" on public.queue_status;
create policy "anon read queue_status" on public.queue_status
  for select to anon using (true);

-- private_config はポリシーを作らない（RLS有効＋ポリシー無し＝anonアクセス拒否）。
-- 念のためテーブル権限も剥奪（多層防御）。
revoke all on table public.private_config from anon, authenticated;

-- 4. publish_status RPC（SECURITY DEFINER で秘密キー照合）
create or replace function public.publish_status(
  p_secret  text,
  p_calling int,
  p_recent  jsonb,
  p_waiting jsonb,
  p_count   int,
  p_last    int,
  p_avg     bigint
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select secret into v_secret from public.private_config where id = 'main';
  if v_secret is null or p_secret is distinct from v_secret then
    raise exception 'unauthorized';
  end if;
  insert into public.queue_status as q (
    id, calling_number, recent_called, waiting_numbers,
    waiting_count, last_issued, avg_serve_ms, updated_at
  ) values (
    'main', p_calling, coalesce(p_recent, '[]'::jsonb), coalesce(p_waiting, '[]'::jsonb),
    coalesce(p_count, 0), coalesce(p_last, 0), p_avg, now()
  )
  on conflict (id) do update set
    calling_number  = excluded.calling_number,
    recent_called   = excluded.recent_called,
    waiting_numbers = excluded.waiting_numbers,
    waiting_count   = excluded.waiting_count,
    last_issued     = excluded.last_issued,
    avg_serve_ms    = excluded.avg_serve_ms,
    updated_at      = now();
end;
$$;

-- anon に RPC の実行のみ許可（秘密キーが無ければ更新できない）
grant execute on function public.publish_status(text,int,jsonb,jsonb,int,int,bigint) to anon;
