-- Backlog #15: dynamic total_supply for rare/epic/legend cards.
--
-- Confirmed scope (user decision): formula-only display update, no new
-- supply-cap ENFORCEMENT (nothing in the codebase currently enforces
-- total_supply at all -- see PROGRESS.md notes). This migration only makes
-- the *number* grow with the player base, so it stops looking like an
-- arbitrary static value as the community grows. Recomputed on every new
-- player registration (no cron/scheduled-job infrastructure exists yet in
-- this project, so a registration-triggered recompute is the natural hook).
--
-- Formula: total_supply = base_total_supply + floor(player_count / divisor)
-- where divisor is smaller for higher ranks (so common-ish "rare" grows
-- fastest, "legend" grows slowest, keeping the relative scarcity feel
-- intact). Divisors are named constants below for easy future tuning.

-- ---------------------------------------------------------------------
-- 1. Preserve the original static values as the growth baseline.
-- ---------------------------------------------------------------------
alter table card_templates add column if not exists base_total_supply integer;

update card_templates
set base_total_supply = total_supply
where rank in ('rare', 'epic', 'legend') and base_total_supply is null;

comment on column card_templates.base_total_supply is
  'Original static total_supply value from catalog generation. total_supply '
  'is recomputed from this baseline as the player base grows (see '
  '_recompute_card_supply()); base_total_supply itself never changes.';

-- ---------------------------------------------------------------------
-- 2. Recompute function -- rare grows fastest, legend slowest.
-- ---------------------------------------------------------------------
create or replace function _recompute_card_supply()
returns void
language plpgsql
security definer
as $$
declare
  player_count integer;
  rare_divisor constant integer := 2;   -- +1 rare supply per 2 new players
  epic_divisor constant integer := 5;   -- +1 epic supply per 5 new players
  legend_divisor constant integer := 20; -- +1 legend supply per 20 new players
begin
  select count(*) into player_count from players;

  update card_templates
  set total_supply = base_total_supply + floor(player_count::numeric / rare_divisor)::integer
  where rank = 'rare' and base_total_supply is not null;

  update card_templates
  set total_supply = base_total_supply + floor(player_count::numeric / epic_divisor)::integer
  where rank = 'epic' and base_total_supply is not null;

  update card_templates
  set total_supply = base_total_supply + floor(player_count::numeric / legend_divisor)::integer
  where rank = 'legend' and base_total_supply is not null;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Recompute automatically on new player registration.
--    Statement-level (not row-level): the count-based formula only needs
--    to run once per registering batch, and doesn't need NEW/OLD row data.
-- ---------------------------------------------------------------------
create or replace function _trg_recompute_card_supply()
returns trigger
language plpgsql
security definer
as $$
begin
  perform _recompute_card_supply();
  return null;
end;
$$;

drop trigger if exists on_player_created_recompute_supply on players;
create trigger on_player_created_recompute_supply
  after insert on players
  for each statement execute procedure _trg_recompute_card_supply();

-- ---------------------------------------------------------------------
-- 4. One-off backfill: recompute immediately against the current player
--    count, so total_supply reflects reality right after this migration
--    instead of waiting for the next registration.
-- ---------------------------------------------------------------------
select _recompute_card_supply();
