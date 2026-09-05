-- Migration to allow 'cancelled' in driver_orders status and dispatch_state check constraints

alter table public.driver_orders
  drop constraint if exists driver_orders_status_check;

alter table public.driver_orders
  add constraint driver_orders_status_check
  check (status in ('pending', 'sent', 'failed', 'cancelled'));

alter table public.driver_orders
  drop constraint if exists driver_orders_dispatch_state_check;

alter table public.driver_orders
  add constraint driver_orders_dispatch_state_check
  check (dispatch_state in ('idle', 'processing', 'sent', 'failed', 'uncertain', 'cancelled'));
