-- Players & Accounts — schema migration (design spec §2)
--
-- NOT YET APPLIED: no Supabase project exists yet for this game. Once the
-- user provisions one, apply with `supabase db push` (or paste into the
-- SQL editor) as the first migration. This file is written and reviewed
-- now so the data model is locked in and version-controlled ahead of time.
--
-- NOTE: `complete_kingdom_onboarding` defined below is later REDEFINED
-- (via `create or replace`) in 0002_territories.sql (Territory Map spec
-- §5) to atomically also assign a home territory + starter army. Apply
-- 0002 immediately after this file — the version below is superseded.

-- ---------------------------------------------------------------------
-- 1. Nation enum (§2, §3) — rejects invalid values at the schema level,
--    which is what makes "signup rolls back on an invalid nation" true.
-- ---------------------------------------------------------------------
create type nation_id as enum (
  'england', 'francia', 'hre', 'byzantium', 'mongol_horde', 'scandinavia'
);

-- ---------------------------------------------------------------------
-- 2. players table — 1:1 extension of Supabase-managed auth.users (§2)
-- ---------------------------------------------------------------------
create table players (
  id uuid primary key references auth.users(id),
  display_name text not null,
  nation nation_id not null,
  kingdom_name text,
  coat_of_arms_id text,
  onboarding_completed boolean not null default false,
  xp integer not null default 0,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  total_playtime_seconds integer not null default 0
);

-- Case-insensitive uniqueness (§2): "Jan" and "jan" can't coexist.
create unique index players_display_name_lower_idx on players (lower(display_name));
-- Partial: many players haven't onboarded yet and share the null value.
create unique index players_kingdom_name_lower_idx on players (lower(kingdom_name))
  where kingdom_name is not null;

-- ---------------------------------------------------------------------
-- 3. auth.users -> players sync trigger (§2.1)
-- ---------------------------------------------------------------------
create function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.players (id, display_name, nation)
  values (
    new.id,
    trim(new.raw_user_meta_data ->> 'display_name'),
    (new.raw_user_meta_data ->> 'nation')::nation_id
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ---------------------------------------------------------------------
-- 4. Row-Level Security (§2.2)
-- ---------------------------------------------------------------------
alter table players enable row level security;

-- Public, unrestricted select: leaderboard + individual profile pages are
-- intentionally viewable without logging in.
create policy players_select_all on players
  for select
  using (true);

-- Deliberately no `update`/`insert`/`delete` policy: all writes go through
-- the security definer RPC functions below, each of which independently
-- checks auth.uid() = id before touching anything. This is what prevents a
-- client from directly rewriting their own xp, last_seen_at,
-- total_playtime_seconds, onboarding_completed, or nation.

-- ---------------------------------------------------------------------
-- 5. RPC functions (§2.2, §4, §6)
-- ---------------------------------------------------------------------

-- Coat-of-arms ids must match the fixed catalog in lib/players/coats-of-arms.tsx.
-- Kept here as a single source of truth for the two RPCs below to validate
-- against; update this list if the catalog in that file ever changes.
create function is_valid_coat_of_arms_id(id text)
returns boolean
language sql
immutable
as $$
  select id = any (array[
    'lion-gold', 'cross-white', 'stripes-red', 'chevron-blue', 'eagle-black',
    'diamonds-purple', 'sun-orange', 'wolf-grey', 'tower-brown', 'anchor-navy',
    'stars-navy', 'axe-crossed', 'boar-forest', 'castle-grey', 'griffin-teal',
    'rose-pink', 'hammer-iron', 'wave-blue', 'oak-green', 'crown-royal',
    'phoenix-crimson'
  ]);
$$;

-- One-time kingdom onboarding (§4). Only settable while
-- onboarding_completed = false; validates coat_of_arms_id, trims/length-
-- checks kingdom_name (uniqueness is enforced by the index above).
create function complete_kingdom_onboarding(new_kingdom_name text, new_coat_of_arms_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  trimmed_name text := trim(new_kingdom_name);
begin
  if not is_valid_coat_of_arms_id(new_coat_of_arms_id) then
    raise exception 'invalid coat_of_arms_id: %', new_coat_of_arms_id;
  end if;
  if char_length(trimmed_name) < 3 or char_length(trimmed_name) > 30 then
    raise exception 'kingdom_name must be 3-30 characters';
  end if;

  update players
  set kingdom_name = trimmed_name,
      coat_of_arms_id = new_coat_of_arms_id,
      onboarding_completed = true
  where id = auth.uid()
    and onboarding_completed = false;

  if not found then
    raise exception 'onboarding already completed or player not found';
  end if;
end;
$$;

-- Editable-anytime version used from /profile/me once onboarding is done
-- (§4). Same validation rules as complete_kingdom_onboarding, no separate
-- looser "edit" path.
create function update_kingdom(new_kingdom_name text, new_coat_of_arms_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  trimmed_name text := trim(new_kingdom_name);
begin
  if not is_valid_coat_of_arms_id(new_coat_of_arms_id) then
    raise exception 'invalid coat_of_arms_id: %', new_coat_of_arms_id;
  end if;
  if char_length(trimmed_name) < 3 or char_length(trimmed_name) > 30 then
    raise exception 'kingdom_name must be 3-30 characters';
  end if;

  update players
  set kingdom_name = trimmed_name,
      coat_of_arms_id = new_coat_of_arms_id
  where id = auth.uid();
end;
$$;

-- Presence + playtime heartbeat (§6). Concurrency-safe (simple atomic
-- += inside the RPC) but not idempotent — see §6 for the accepted
-- multi-tab overcounting trade-off.
create function heartbeat()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update players
  set last_seen_at = now(),
      total_playtime_seconds = total_playtime_seconds + 30
  where id = auth.uid();
end;
$$;

-- No RPC exists for mutating xp (§2.2) — later subsystems that actually
-- award XP will add their own security definer function when that trigger
-- logic is designed. No delete policy/function — accounts aren't
-- deletable in this MVP.
