-- Shipping hand-shake, Jino's decisions (24 Nov 2026).
-- Run AFTER 2026-11-24-shipping-numbers.sql, in the BK Tracker project (address contains esyaxplcxvvtjdthidyu).
-- Safe to run twice.

begin;

-- 1. PO5002012, nozzle base 8481/09110: 500 is the right quantity (not 440).
update public.order_lines l
set qty = 500,
    notes = concat_ws(' ', nullif(l.notes, ''), 'Qty 500 confirmed by Jino 24 Nov 2026 (was 440; client counts 60 as received).')
from public.orders o
where o.id = l.order_id and o.po_number = 'PO5002012'
  and l.part_id = (select part_id from public.part_numbers where lower(number) = '09110')
  and l.qty = 440;

-- 2. PO5002438: circuit breakers 6380 (x2) and transformers 9494 (x16) are still backordered and must be delivered.
--    They stay outstanding in the app; note that shipping's SO 6854 is missing them.
update public.order_lines l
set notes = concat_ws(' ', nullif(l.notes, ''), 'Still backordered. Not on WET SO 6854 as of 24 Nov 2026: shipping to add.')
from public.orders o
where o.id = l.order_id and o.po_number = 'PO5002438'
  and l.part_id in (select part_id from public.part_numbers where number in ('6380', '9494'))
  and coalesce(l.notes, '') not like '%Not on WET SO 6854%';

-- 3. PO5002308: the line is 2240 poly tubing (WET 40-03793), not 2204.
insert into public.part_numbers (part_id, number, label, is_main)
select part_id, '40-03793', 'new', false from public.part_numbers where number = '2240'
  and not exists (select 1 from public.part_numbers where lower(number) = '40-03793');
update public.order_lines l
set part_id = (select part_id from public.part_numbers where number = '2240'),
    ordered_as = '2240',
    notes = concat_ws(' ', nullif(l.notes, ''), 'Was 2204 in SharePoint (typo); shipping SO 7570 has 2240WC.')
from public.orders o
where o.id = l.order_id and o.po_number = 'PO5002308'
  and l.part_id = (select part_id from public.part_numbers where number = '2204');

-- 4. Lamp 1167: the 90W lamp (40-18442) replaces the 100W (1000807). Same part.
insert into public.part_numbers (part_id, number, label, is_main)
select part_id, '1000807', 'old', false from public.part_numbers where number = '40-18442'
  and not exists (select 1 from public.part_numbers where lower(number) = '1000807');
update public.part_numbers set label = 'client' where number = '1167';
update public.parts set notes = concat_ws(E'\n', nullif(notes, ''), '90W 40-18442 replaces the 100W 1000807 (Jino, 24 Nov 2026). Client orders both as 1167WC.')
where id = (select part_id from public.part_numbers where number = '40-18442')
  and coalesce(notes, '') not like '%replaces the 100W%';

commit;
