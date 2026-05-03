create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.strategy_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null default 'VWAP High Volatility',
  settings jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.market_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  symbol text not null,
  timeframe text not null,
  bars jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  symbol text not null,
  signal text not null,
  reason text not null,
  entry numeric,
  sl numeric,
  tp numeric,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  broker_order_id text,
  client_order_id text unique,
  symbol text not null,
  side text not null,
  qty numeric not null,
  status text not null,
  order_plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  symbol text not null,
  qty numeric not null,
  avg_entry_price numeric,
  current_price numeric,
  unrealized_pl numeric,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.trade_journal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  symbol text not null,
  side text not null,
  qty numeric not null,
  entry numeric,
  exit numeric,
  pnl numeric,
  exit_reason text,
  opened_at timestamptz,
  closed_at timestamptz,
  notes text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.risk_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  status text not null,
  reason text not null,
  order_plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.llm_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  symbol text,
  prompt text,
  analysis text not null,
  model text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.strategy_settings enable row level security;
alter table public.market_snapshots enable row level security;
alter table public.signals enable row level security;
alter table public.orders enable row level security;
alter table public.positions enable row level security;
alter table public.trade_journal enable row level security;
alter table public.risk_events enable row level security;
alter table public.llm_analyses enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "Users read own profile" on public.users;
create policy "Users read own profile" on public.users
  for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users read own strategy settings" on public.strategy_settings;
create policy "Users read own strategy settings" on public.strategy_settings
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users manage own strategy settings" on public.strategy_settings;
create policy "Users manage own strategy settings" on public.strategy_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users read own market snapshots" on public.market_snapshots;
create policy "Users read own market snapshots" on public.market_snapshots
  for select to authenticated
  using (user_id is null or (select auth.uid()) = user_id);

drop policy if exists "Users read own signals" on public.signals;
create policy "Users read own signals" on public.signals
  for select to authenticated
  using (user_id is null or (select auth.uid()) = user_id);

drop policy if exists "Users read own orders" on public.orders;
create policy "Users read own orders" on public.orders
  for select to authenticated
  using (user_id is null or (select auth.uid()) = user_id);

drop policy if exists "Users read own positions" on public.positions;
create policy "Users read own positions" on public.positions
  for select to authenticated
  using (user_id is null or (select auth.uid()) = user_id);

drop policy if exists "Users read own trade journal" on public.trade_journal;
create policy "Users read own trade journal" on public.trade_journal
  for select to authenticated
  using (user_id is null or (select auth.uid()) = user_id);

drop policy if exists "Users read own risk events" on public.risk_events;
create policy "Users read own risk events" on public.risk_events
  for select to authenticated
  using (user_id is null or (select auth.uid()) = user_id);

drop policy if exists "Users read own llm analyses" on public.llm_analyses;
create policy "Users read own llm analyses" on public.llm_analyses
  for select to authenticated
  using (user_id is null or (select auth.uid()) = user_id);

drop policy if exists "Users read own audit logs" on public.audit_logs;
create policy "Users read own audit logs" on public.audit_logs
  for select to authenticated
  using (user_id is null or (select auth.uid()) = user_id);

create index if not exists signals_symbol_created_at_idx on public.signals(symbol, created_at desc);
create index if not exists orders_status_created_at_idx on public.orders(status, created_at desc);
create index if not exists trade_journal_symbol_created_at_idx on public.trade_journal(symbol, created_at desc);
create index if not exists audit_logs_event_created_at_idx on public.audit_logs(event_type, created_at desc);
