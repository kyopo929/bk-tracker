-- Staged quantities: how many of each open line shipping already has staged and ready to ship.
-- Adds two columns to order lines and fills them from shipping's BDTP Pending Parts List (24 Nov 2026).
-- Run in the BK Tracker project (address contains esyaxplcxvvtjdthidyu). Safe to run twice.

alter table public.order_lines add column if not exists staged_qty numeric;
alter table public.order_lines add column if not exists staged_date date;

update public.order_lines l
set staged_qty = v.staged, staged_date = date '2026-11-24'
from (values
  ('PO5002012', ARRAY['40-01861', '1227'], 20, 20),
  ('PO5002012', ARRAY['40-02616', '1627'], 40, 40),
  ('PO5002012', ARRAY['40-02618', '3388'], 200, 200),
  ('PO5002012', ARRAY['40-02619', '3387'], 200, 200),
  ('PO5002012', ARRAY['40-02625', '2627'], 10, 10),
  ('PO5002012', ARRAY['40-06493', '4186'], 2, 2),
  ('PO5002012', ARRAY['09100', '8482'], 200, 100),
  ('PO5002012', ARRAY['09110', '8481'], 500, 350),
  ('PO5002308', ARRAY['40-04743', '1206'], 50, 50),
  ('PO5002308', ARRAY['00281-1', '1215'], 10, 10),
  ('PO5002308', ARRAY['12850', '1251'], 30, 7),
  ('PO5002308', ARRAY['40-02625', '2627'], 20, 10),
  ('PO5002308', ARRAY['40-08136', '1085'], 2, 2),
  ('PO5002438', ARRAY['40-06439', '2427'], 1, 1),
  ('PO5002438', ARRAY['41-02084', '5899'], 4, 1),
  ('PO5002512', ARRAY['40-04743', '1206'], 50, 50),
  ('PO5002512', ARRAY['40-08136', '1085'], 1, 1),
  ('PO5002512', ARRAY['00281-1', '1215'], 20, 20),
  ('PO5002512', ARRAY['30-02138', '4851'], 500, 26),
  ('PO5002613', ARRAY['40-18442', '1167'], 3500, 600),
  ('PO5002613', ARRAY['10881', '1416'], 200, 30),
  ('PO5002668', ARRAY['40-05269', '3833'], 3, 2),
  ('PO5002668', ARRAY['40-05793', '5270'], 100, 29),
  ('PO5002668', ARRAY['40-05794', '5271'], 100, 54)
) as v(po, nums, pending, staged)
join public.orders o on o.po_number = v.po
where l.order_id = o.id
  and l.part_id in (select part_id from public.part_numbers where lower(number) = any (select lower(unnest(v.nums))))
  and l.staged_qty is null
  and not l.cancelled
  and l.qty - l.shipped_before - coalesce((select sum(d.qty) from public.delivery_lines d where d.order_line_id = l.id), 0) > 0;
