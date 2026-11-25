-- Adds the WET sales order number (shipping's reference) to orders, and fills it in
-- from shipping's BDTP Pending Parts List (24 Nov 2026). Run in the BK Tracker project
-- (address contains esyaxplcxvvtjdthidyu). Safe to run twice.

alter table public.orders add column if not exists wet_so text;

update public.orders o set wet_so = v.so
from (values
  ('PO5002012', '7195'), ('PO5002308', '7570'), ('PO5002393', '6542'), ('PO5002438', '6854'),
  ('PO5002512', '7576'), ('PO5002613', '7527'), ('PO5002668', '7569'), ('PO5002695', '7573')
) as v(po, so)
where o.po_number = v.po and (o.wet_so is null or o.wet_so = '');
