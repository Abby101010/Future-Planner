-- Rename goals.metadata → goals.payload so every entity table in this
-- schema uses the same name for its variable-shape jsonb blob. Every
-- other 0002 table already uses `payload`; `goals` was the lone outlier.
--
-- Idempotent-within-a-single-apply: if the rename already ran (e.g. a
-- prior crash mid-migration), skip.

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'goals' and column_name = 'metadata'
  ) and not exists (
    select 1 from information_schema.columns
     where table_name = 'goals' and column_name = 'payload'
  ) then
    alter table goals rename column metadata to payload;
  end if;
end $$;
