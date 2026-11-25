-- BK Tracker database. Paste into Supabase → SQL Editor → New query → Run.
-- Safe to run again: it only adds what is missing.
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ BEFORE RUNNING: put the email address you will sign in with on the line │
-- │ marked >>> below. Only emails in that list can see or change any data.  │
-- └──────────────────────────────────────────────────────────────────────────┘

create extension if not exists pgcrypto;

-- Who may use the app ------------------------------------------------------
create table if not exists public.allowed_emails (email text primary key);
insert into public.allowed_emails (email) values
  ('YOUR-EMAIL@example.com')   -- >>> replace with your sign-in email
on conflict do nothing;

create or replace function public.is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.allowed_emails
                 where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- Parts: one row per physical part; part_numbers holds every number it goes by
create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.part_numbers (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts on delete cascade,
  number text not null,
  label text,                      -- e.g. "new", "old", "client", or blank
  is_main boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.part_numbers add column if not exists updated_at timestamptz not null default now();
create unique index if not exists part_numbers_number on public.part_numbers (lower(number));
create index if not exists part_numbers_part on public.part_numbers (part_id);

-- Orders (one per quote / PO) ------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  client text not null default 'Burj Khalifa',
  quote_ref text,
  quote_sent date,
  po_number text,
  wet_so text,                     -- WET sales order number (shipping's reference)
  po_date date,
  expected_date date,
  closed boolean not null default false,   -- tick to close an order early (rest cancelled)
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.orders add column if not exists wet_so text;
create unique index if not exists orders_po on public.orders (lower(po_number)) where po_number is not null and po_number <> '';

create table if not exists public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders on delete cascade,
  part_id uuid not null references public.parts on delete restrict,
  ordered_as text,                 -- the number the client used on the PO
  qty numeric not null check (qty >= 0),
  shipped_before numeric not null default 0 check (shipped_before >= 0),  -- shipped before tracking began
  unit_price numeric,
  urgent boolean not null default false,
  expected_date date,
  cancelled boolean not null default false,
  notes text,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists order_lines_order on public.order_lines (order_id);
create index if not exists order_lines_part on public.order_lines (part_id);

-- Deliveries (delivery notes) ------------------------------------------------
create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  dn_number text not null,
  order_id uuid references public.orders on delete set null,
  ship_date date,
  received_date date,
  tracking text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists deliveries_dn on public.deliveries (lower(dn_number));

create table if not exists public.delivery_lines (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries on delete cascade,
  order_line_id uuid references public.order_lines on delete set null,
  part_id uuid not null references public.parts on delete restrict,
  shipped_as text,                 -- the number the company shipped under
  qty numeric not null check (qty >= 0),   -- good quantity received; counts against the order line
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists delivery_lines_delivery on public.delivery_lines (delivery_id);
create index if not exists delivery_lines_line on public.delivery_lines (order_line_id);

-- Problems with a delivery: short, wrong item, damaged ----------------------
create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid references public.deliveries on delete cascade,
  order_line_id uuid references public.order_lines on delete set null,
  kind text not null default 'Short',          -- Short | Wrong item | Damaged | Other
  qty numeric,
  description text,
  status text not null default 'Open',         -- Open | Replacement requested | Resolved
  resolved_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Invoices --------------------------------------------------------------------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null,
  order_id uuid references public.orders on delete set null,
  delivery_id uuid references public.deliveries on delete set null,
  invoice_date date,
  amount numeric,
  currency text not null default 'AED',
  paid boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Documents: links to files kept in SharePoint / OneDrive ---------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text,
  doc_type text not null default 'Other',     -- PO | Quote | Delivery note | Invoice | Photo | Other
  order_id uuid references public.orders on delete cascade,
  delivery_id uuid references public.deliveries on delete set null,
  invoice_id uuid references public.invoices on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Change history ---------------------------------------------------------------
create table if not exists public.history (
  id bigserial primary key,
  at timestamptz not null default now(),
  who text default (auth.jwt() ->> 'email'),
  tbl text not null,
  row_id uuid,
  action text not null,
  old jsonb,
  new jsonb
);
create index if not exists history_row on public.history (row_id);
create index if not exists history_at on public.history (at desc);

create or replace function public.track_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if to_jsonb(new) - 'updated_at' = to_jsonb(old) - 'updated_at' then return new; end if;
    insert into history (tbl, row_id, action, old, new) values (tg_table_name, new.id, 'update', to_jsonb(old), to_jsonb(new));
    return new;
  elsif tg_op = 'INSERT' then
    insert into history (tbl, row_id, action, new) values (tg_table_name, new.id, 'insert', to_jsonb(new));
    return new;
  else
    insert into history (tbl, row_id, action, old) values (tg_table_name, old.id, 'delete', to_jsonb(old));
    return old;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['parts','part_numbers','orders','order_lines','deliveries','delivery_lines','issues','invoices','documents'] loop
    execute format('drop trigger if exists track_before on public.%I', t);
    execute format('drop trigger if exists track_after on public.%I', t);
    execute format('create trigger track_before before update on public.%I for each row execute function public.track_change()', t);
    execute format('create trigger track_after after insert or delete on public.%I for each row execute function public.track_change()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "allowed users" on public.%I', t);
    execute format('create policy "allowed users" on public.%I for all to authenticated using (public.is_allowed()) with check (public.is_allowed())', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end $$;

alter table public.history enable row level security;
drop policy if exists "allowed users read" on public.history;
create policy "allowed users read" on public.history for select to authenticated using (public.is_allowed());
grant select on table public.history to authenticated;

alter table public.allowed_emails enable row level security;  -- nobody reads it from the app

-- Merge two parts into one (keeps every number and every order/delivery line) --
create or replace function public.merge_parts(keep uuid, absorb uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if keep = absorb then raise exception 'Pick two different parts'; end if;
  update part_numbers set part_id = keep, is_main = false where part_id = absorb;
  update order_lines set part_id = keep where part_id = absorb;
  update delivery_lines set part_id = keep where part_id = absorb;
  update parts set notes = nullif(concat_ws(E'\n', (select notes from parts where id = keep), (select notes from parts where id = absorb)), '')
    where id = keep;
  delete from parts where id = absorb;
end $$;
grant execute on function public.merge_parts(uuid, uuid) to authenticated;

-- Daily keep-alive (free Supabase projects pause after a quiet week) -----------
create or replace function public.keepalive() returns timestamptz
language sql stable as $$ select now() $$;
grant execute on function public.keepalive() to anon, authenticated;
