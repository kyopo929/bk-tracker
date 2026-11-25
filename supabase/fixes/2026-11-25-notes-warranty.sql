-- Notes on order lines and parts, and warranty claims on problems.
-- Run in the BK Tracker project: https://supabase.com/dashboard/project/esyaxplcxvvtjdthidyu/sql/new
-- Safe to run twice.

-- 1. Notes: a running thread on an order line or a part (who + when on every entry).
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  order_line_id uuid references public.order_lines on delete cascade,
  part_id uuid references public.parts on delete cascade,
  body text not null,
  who text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_line on public.notes (order_line_id);
create index if not exists notes_part on public.notes (part_id);

drop trigger if exists track_before on public.notes;
drop trigger if exists track_after on public.notes;
create trigger track_before before update on public.notes for each row execute function public.track_change();
create trigger track_after after insert or delete on public.notes for each row execute function public.track_change();
alter table public.notes enable row level security;
drop policy if exists "allowed users" on public.notes;
create policy "allowed users" on public.notes for all to authenticated using (public.is_allowed()) with check (public.is_allowed());
grant select, insert, update, delete on table public.notes to authenticated;

-- 2. Warranty claims are problems of kind 'Warranty claim', with a few extra fields.
alter table public.issues add column if not exists part_id uuid references public.parts on delete set null;
alter table public.issues add column if not exists claim_ref text;     -- claim / RMA number
alter table public.issues add column if not exists failed_date date;   -- when the part failed in service

-- Merging parts keeps notes and claims with the part that stays.
create or replace function public.merge_parts(keep uuid, absorb uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if keep = absorb then raise exception 'Pick two different parts'; end if;
  update part_numbers set part_id = keep, is_main = false where part_id = absorb;
  update order_lines set part_id = keep where part_id = absorb;
  update delivery_lines set part_id = keep where part_id = absorb;
  update notes set part_id = keep where part_id = absorb;
  update issues set part_id = keep where part_id = absorb;
  update parts set notes = nullif(concat_ws(E'\n', (select notes from parts where id = keep), (select notes from parts where id = absorb)), '')
    where id = keep;
  delete from parts where id = absorb;
end $$;
