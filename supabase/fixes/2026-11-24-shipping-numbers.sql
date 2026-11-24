-- Shipping hand-shake fixes, 24 Nov 2026 (from BDTP Pending Parts List vs BK Tracker).
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run twice: it skips what is already there.
-- NOT included (your decisions first): 8481 qty on PO5002012, 6380/9494 on PO5002438, 2204→2240 on PO5002308, lamp 1000807.

begin;

-- 0. Bug fix: editing a part number failed (missing column used by the change history).
alter table public.part_numbers add column if not exists updated_at timestamptz not null default now();

-- 1. Add the WET item numbers (and extra client WC numbers) shipping uses, to the part they belong to.
insert into public.part_numbers (part_id, number, label, is_main)
select pn.part_id, v.num, v.label, false
from (values
  ('1085', '40-08136', 'new'),
  ('1227', '40-01861', 'new'),
  ('1367', '13550', 'new'),
  ('1463', '15200', 'new'),
  ('1621', '40-19483', 'new'),
  ('1890', '36290', 'new'),
  ('1907', '41-01493', 'new'),
  ('1907', '4469', 'client'),
  ('2043', '40-05808', 'new'),
  ('22871', '4125', 'client'),
  ('2423', '40-05251', 'new'),
  ('2427', '40-06439', 'new'),
  ('2628', '40-02624', 'new'),
  ('30-05520', '30-05520-1', 'new'),
  ('3048', '40-00250', 'new'),
  ('3386', '40-02617', 'new'),
  ('3387', '40-02619', 'new'),
  ('3388', '40-02618', 'new'),
  ('3831', '1224', 'client'),
  ('3831', '3813', 'client'),
  ('3831', '41-02404', 'new'),
  ('3833', '40-05269', 'new'),
  ('40-00967', '36220', 'new'),
  ('40-03596', '4831', 'client'),
  ('40-05037', '1898', 'client'),
  ('4295', '41-02896', 'new'),
  ('4300', '57630-2', 'new'),
  ('4349', '40-03516', 'new'),
  ('4373', '40-18917', 'new'),
  ('4374', '40-06862', 'new'),
  ('4375', '40-06863', 'new'),
  ('4851', '30-02138', 'new'),
  ('5270', '40-05793', 'new'),
  ('5271', '40-05794', 'new'),
  ('5899', '41-02084', 'new'),
  ('5972', '40-05273', 'new'),
  ('6479', '40-19482', 'new'),
  ('6483', '40-08041', 'new'),
  ('8519', '40-17507', 'new'),
  ('8520', '40-19484', 'new'),
  ('9470', '40-00878', 'new')
) as v(existing, num, label)
join public.part_numbers pn on lower(pn.number) = lower(v.existing)
where not exists (select 1 from public.part_numbers x where lower(x.number) = lower(v.num));

-- 2. Shipping confirms 1680WC = 40-00630: merge 1680 into 40-00630 (keeps every order line).
do $$
declare keep uuid; absorb uuid;
begin
  select part_id into keep from public.part_numbers where lower(number) = '40-00630';
  select part_id into absorb from public.part_numbers where lower(number) = '1680';
  if keep is not null and absorb is not null and keep <> absorb then
    perform public.merge_parts(keep, absorb);
    update public.part_numbers set label = 'client' where lower(number) = '1680';
    update public.part_numbers set label = 'new' where lower(number) = '40-00630';
  end if;
end $$;

commit;
