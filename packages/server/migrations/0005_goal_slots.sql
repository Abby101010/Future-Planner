-- Add goal_slot column: active goals occupy one of 3 named slots;
-- NULL means parked (excluded from daily task generation).
alter table goals add column if not exists goal_slot text;
