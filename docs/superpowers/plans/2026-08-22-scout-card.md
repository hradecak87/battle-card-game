# Karta Zvěd Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a special "Zvěd" (Scout) card that players must actively send to reveal the exact unit composition of a foreign/NPC/wild garrison or an incoming attack, replacing today's always-visible exact-card leak with rank-only bucket ranges until a valid (≤10-day) scout report exists.

**Architecture:** New `card_templates.category = 'scout'` (single template, no rank variants). Scouting reuses the existing `troop_movements` infrastructure with three new `kind` values (`'scout'`, `'scout_return'`, `'scout_peek'`) resolved by a new `resolve_due_scouts()` helper called from `resolve_due_movements()` — mirroring the existing `loan`/`loan_return` two-phase pattern. A new `scout_reports` table stores the latest per-(player, target) snapshot with a 10-day expiry. The real fix for today's leak is server-side: `get_visible_territory_cards()` is rewritten to mask unit cards (not just boosts) unless the caller has a valid snapshot for that territory. Frontend: bucket-range display + "Vyslat zvěda" button + counter in `GarrisonModal`/`TerritoryDetailPanel`/`DeclareAttackModal`, a lightweight lightweight rank-weighted army-strength estimate with a disclaimer, and an instant-peek button in `MovementDetailModal`.

**Tech Stack:** Supabase/Postgres (plpgsql migrations), Next.js 14 + TypeScript, Jest.

**Spec:** `docs/superpowers/specs/2026-08-22-scout-card-design.md` — read this first.

**Migration number:** `0081` (next available after `0080`).

---

## Chunk 1: Scout card

### Task 1: Schema — scout card category, movement kinds, `scout_reports` table

**Files:**
- Create: `supabase/migrations/0081_scout_card.sql`
- Create: `supabase/migrations/0081_scout_card.verification.sql`

**Reference for existing patterns:**
- `supabase/migrations/0047_wall_structure_card.sql:1-70` — the "drop every `card_templates` check constraint, re-add the full set" pattern this migration must follow (constraints are all named, e.g. `card_templates_category_check`, and are redefined together each time a category is added).
- `supabase/migrations/0068_troop_lending.sql:15-19` — widening `troop_movements_kind_check`.
- `supabase/migrations/0056_notifications.sql:1-30` — `notifications` table shape + `type` check constraint pattern for the new notification types.
- `supabase/migrations/0002_territories.sql:81-96` — base `troop_movements`/`troop_movement_units` shape and RLS convention (`enable row level security`, no direct client write policies, `select` policies only).

**Steps:**

- [ ] **Step 1: Widen `card_templates` category constraint and insert the scout template**

```sql
do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'card_templates'::regclass
      and contype = 'c'
  loop
    execute format('alter table card_templates drop constraint %I', v_constraint.conname);
  end loop;
end;
$$;

alter table card_templates
  add constraint card_templates_category_check
    check (category in ('unit', 'castle', 'village', 'wall', 'boost', 'scout')),
  add constraint card_templates_rank_check
    check (rank in ('common', 'uncommon', 'rare', 'epic', 'legend')),
  add constraint card_templates_unit_shape_check
    check (category <> 'unit' or (unit_type is not null and base_stats is not null)),
  add constraint card_templates_non_unit_type_check
    check (category = 'unit' or unit_type is null),
  add constraint card_templates_structure_bonus_shape_check
    check (
      category in ('castle', 'village', 'wall')
      or (defense_bonus_pct is null and attack_bonus_pct is null)
    ),
  add constraint card_templates_structure_bonus_required_check
    check (category not in ('castle', 'village', 'wall') or defense_bonus_pct is not null),
  add constraint card_templates_village_attack_check
    check (category <> 'village' or attack_bonus_pct is null),
  add constraint card_templates_wall_attack_required_check
    check (category <> 'wall' or attack_bonus_pct is not null),
  add constraint card_templates_boost_shape_check
    check (
      category <> 'boost'
      or (
        boost_type in ('territorial', 'offensive')
        and effect_kind in ('stat_multiplier', 'instant_effect')
        and unit_type is null
        and base_stats is null
        and defense_bonus_pct is null
        and attack_bonus_pct is null
      )
    ),
  add constraint card_templates_boost_effect_check
    check (
      category <> 'boost'
      or (
        (effect_kind = 'stat_multiplier'
          and instant_effect_kind is null
          and coalesce(pct_str, 0) + coalesce(pct_lng, 0) + coalesce(pct_def, 0) + coalesce(pct_hp, 0) > 0)
        or
        (effect_kind = 'instant_effect'
          and instant_effect_kind = 'steal_unit'
          and pct_str is null and pct_lng is null and pct_def is null and pct_hp is null)
      )
    ),
  add constraint card_templates_scout_shape_check
    check (
      category <> 'scout'
      or (
        unit_type is null
        and defense_bonus_pct is null
        and attack_bonus_pct is null
        and base_stats is not null
        and (base_stats->>'str')::numeric = 0
        and (base_stats->>'lng')::numeric = 0
        and (base_stats->>'def')::numeric = 0
        and (base_stats->>'hp')::numeric = 0
        and (base_stats->>'speed')::numeric = 30
      )
    );

insert into card_templates (
  id, category, unit_type, rank, name, flavor_text, base_stats,
  defense_bonus_pct, attack_bonus_pct, total_supply
)
values (
  'scout', 'scout', null, 'uncommon', 'Zvěd',
  'Rychlý jezdec bez bojové hodnoty, vyslaný jen za jediným účelem: zjistit, co skrývá nepřátelské území.',
  '{"str": 0, "lng": 0, "def": 0, "hp": 0, "speed": 30}'::jsonb,
  null, null, null
)
on conflict (id) do nothing;
```

- [ ] **Step 2: Widen `troop_movements` kind constraint and add the scout-peek target column**

```sql
alter table troop_movements drop constraint troop_movements_kind_check;
alter table troop_movements add constraint troop_movements_kind_check
  check (kind in ('transfer', 'claim', 'attack', 'loan', 'loan_return', 'scout', 'scout_return', 'scout_peek'));

alter table troop_movements
  add column scout_target_movement_id uuid null references troop_movements(id);
```

- [ ] **Step 3: Create `scout_reports` table with RLS**

```sql
create table scout_reports (
  id bigserial primary key,
  scout_player_id uuid not null references players(id),
  target_territory_id integer references territories(id),
  target_movement_id uuid references troop_movements(id),
  captured_at timestamptz not null default now(),
  expires_at timestamptz not null,
  snapshot jsonb not null,
  check (
    (target_territory_id is not null and target_movement_id is null)
    or (target_territory_id is null and target_movement_id is not null)
  )
);

create unique index scout_reports_territory_unique_idx
  on scout_reports (scout_player_id, target_territory_id)
  where target_territory_id is not null;

create unique index scout_reports_movement_unique_idx
  on scout_reports (scout_player_id, target_movement_id)
  where target_movement_id is not null;

create index scout_reports_expiry_idx on scout_reports (expires_at);

alter table scout_reports enable row level security;

create policy scout_reports_select_own on scout_reports
  for select using (scout_player_id = auth.uid());
```

No insert/update/delete policies are added — every write goes through
`security definer` RPCs added in Task 3, matching the `notifications`/
`card_templates` convention (see `0002_territories.sql:107-115`).

- [ ] **Step 4: Widen the `notifications` type check constraint**

```sql
alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (
    type in (
      'attack_incoming', 'war_declared', 'battle_resolved', 'territory_lost',
      'trade_offer_received', 'trade_offer_accepted', 'trade_offer_rejected',
      'peace_offer_received', 'level_up', 'dm_message', 'attack_cancelled',
      'loan_arrived', 'loan_returned', 'loan_auto_recalled',
      'scout_killed', 'scout_detected', 'scout_returned'
    )
  );
```

(Confirm the exact current constraint name via `select conname from
pg_constraint where conrelid = 'notifications'::regclass and contype =
'c'` before writing this — it may differ from `notifications_type_check`
if a later migration renamed it; grep `supabase/migrations/*.sql` for
`notifications_type_check` to confirm no rename happened after `0056`.)

- [ ] **Step 5: Write the verification SQL**

Cover: `card_templates` accepts `category = 'scout'` and the `scout`
template row exists with the exact expected `base_stats`; the scout shape
constraint rejects a second `scout`-category row with non-zero
`str`/`lng`/`def`/`hp` or `speed <> 30`; `troop_movements` accepts the
three new `kind` values; `scout_reports` unique indexes reject a second
territory-targeted row for the same `(scout_player_id,
target_territory_id)` but allow a different `target_territory_id` or a
movement-targeted row for the same player; the `check` constraint on
`scout_reports` rejects a row with both or neither of
`target_territory_id`/`target_movement_id` set; `notifications` accepts
the 3 new types.

- [ ] **Step 6: Apply migration + verification against the live Supabase project**

Follow the same process used for `0080` earlier in this session: a small
throwaway Node script using `pg` + `SUPABASE_DB_URL` from `.env.local` (no
`dotenv` dependency installed — parse the file's `KEY=value` lines
manually), reading and executing the migration then verification SQL file
contents, then deleting the throwaway script. Do this only after Task 1
through the final task are all committed and the full test suite/build
pass — apply once at the end, not per-task, to avoid a half-migrated live
schema if a later task's design changes something from an earlier one.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0081_scout_card.sql supabase/migrations/0081_scout_card.verification.sql
git commit -m "feat: add scout card schema, movement kinds, and scout_reports table"
```

---

### Task 2: `send_scout` / `send_scout_peek` RPCs

**Files:**
- Modify: `supabase/migrations/0081_scout_card.sql` (append)

**Reference:**
- `supabase/migrations/0020_speed_attribute.sql:200-275` (`start_transfer`) — the shape to follow: validate caller owns the territory/card, card is `status = 'stationed'`, compute `transfer_hrs` via `_min_group_speed` + the shared distance formula, insert `troop_movements` + `troop_movement_units`, flip the card to `status = 'in_transit'`.
- `supabase/migrations/0068_troop_lending.sql` (`lend_troops`) — closest existing analogue for "insert a new movement kind with an extra piece of context beyond origin/destination".

**Steps:**

- [ ] **Step 1: Write `send_scout(p_target_territory_id integer, p_card_instance_id uuid)`**

```sql
create or replace function send_scout(
  p_target_territory_id integer,
  p_card_instance_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_home_id integer;
  v_from_x smallint; v_from_y smallint;
  v_to_x smallint; v_to_y smallint;
  v_distance numeric;
  v_speed_mult numeric;
  v_transfer_hrs numeric;
  v_arrives_at timestamptz;
  v_movement_id uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  perform resolve_due_movements();

  select id, x, y into v_home_id, v_from_x, v_from_y
  from territories where owner_id = v_caller and is_home;
  if v_home_id is null then
    raise exception 'no home territory found';
  end if;

  perform 1 from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_card_instance_id
    and ci.owner_id = v_caller
    and ci.status = 'stationed'
    and ci.stationed_territory_id = v_home_id
    and ct.category = 'scout'
  for update of ci;
  if not found then
    raise exception 'card is not an available scout stationed at your home territory';
  end if;

  select x, y into v_to_x, v_to_y from territories where id = p_target_territory_id;
  if v_to_x is null then
    raise exception 'target territory % not found', p_target_territory_id;
  end if;

  v_distance := greatest(abs(v_to_x - v_from_x), abs(v_to_y - v_from_y));
  -- NOTE: do NOT call `_min_group_speed()` here — it filters
  -- `ct.category = 'unit'` (see 0020_speed_attribute.sql) and returns
  -- NULL for a scout-only array, which would make `v_speed_mult`/
  -- `v_transfer_hrs` NULL too. The scout template's speed is a fixed
  -- constant (30) by design, so inline the same clamped-multiplier
  -- formula directly instead of going through that unit-only helper.
  v_speed_mult := least(3.0, greatest(0.4, 5.0 / 30.0));
  v_transfer_hrs := greatest(0.25, v_distance * 0.3 * v_speed_mult);
  v_arrives_at := now() + (v_transfer_hrs || ' hours')::interval;

  insert into troop_movements (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
  values (v_caller, 'scout', v_home_id, p_target_territory_id, v_arrives_at)
  returning id into v_movement_id;

  insert into troop_movement_units (movement_id, card_instance_id)
  values (v_movement_id, p_card_instance_id);

  update card_instances set status = 'in_transit' where instance_id = p_card_instance_id;

  return v_movement_id;
end;
$$;
```

(The `transfer_hrs` clamped-multiplier formula constants must match
whatever `start_transfer`'s current live version uses — re-check
`supabase/migrations/0020_speed_attribute.sql` for the exact formula
shape at implementation time in case a later migration tweaked it, and
copy that exact expression rather than the one above if it differs. Do
NOT replace the inlined `5.0 / 30.0` with a call to `_min_group_speed()`
— confirmed that helper hard-filters `ct.category = 'unit'` and returns
NULL for a scout-only card array.)

- [ ] **Step 2: Write `send_scout_peek(p_target_movement_id uuid, p_card_instance_id uuid)`**

```sql
create or replace function send_scout_peek(
  p_target_movement_id uuid,
  p_card_instance_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_home_id integer;
  v_target_owner uuid;
  v_movement_id uuid;
  v_delay_hrs numeric;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  perform resolve_due_movements();

  select id into v_home_id from territories where owner_id = v_caller and is_home;
  if v_home_id is null then
    raise exception 'no home territory found';
  end if;

  perform 1 from card_instances ci
  join card_templates ct on ct.id = ci.template_id
  where ci.instance_id = p_card_instance_id
    and ci.owner_id = v_caller
    and ci.status = 'stationed'
    and ci.stationed_territory_id = v_home_id
    and ct.category = 'scout'
  for update of ci;
  if not found then
    raise exception 'card is not an available scout stationed at your home territory';
  end if;

  select destination_territory_id into v_target_owner
  from troop_movements
  where id = p_target_movement_id and kind = 'attack' and status = 'in_transit';
  if v_target_owner is null then
    raise exception 'target attack movement not found or no longer in transit';
  end if;
  perform 1 from territories where id = v_target_owner and owner_id = v_caller;
  if not found then
    raise exception 'target movement is not attacking your territory';
  end if;

  v_delay_hrs := 1 + random() * 2; -- 1-3 hours

  insert into troop_movements
    (player_id, kind, origin_territory_id, destination_territory_id,
     transfer_arrives_at, scout_target_movement_id)
  values
    (v_caller, 'scout_peek', v_home_id, v_home_id,
     now() + (v_delay_hrs || ' hours')::interval, p_target_movement_id)
  returning id into v_movement_id;

  insert into troop_movement_units (movement_id, card_instance_id)
  values (v_movement_id, p_card_instance_id);

  update card_instances set status = 'in_transit' where instance_id = p_card_instance_id;

  return v_movement_id;
end;
$$;
```

- [ ] **Step 3: Append verification cases**

Cover: `send_scout` rejects a card that isn't category `scout`, rejects a
card not stationed at the caller's home, computes a distance-scaled
`transfer_arrives_at`; `send_scout_peek` rejects a target movement that
isn't `kind = 'attack'`/`in_transit`, rejects a target movement not
aimed at the caller's own territory, produces a `transfer_arrives_at`
between 1 and 3 hours from now.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0081_scout_card.sql supabase/migrations/0081_scout_card.verification.sql
git commit -m "feat: add send_scout and send_scout_peek RPCs"
```

---

### Task 3: Resolution — `resolve_due_scouts()`, risk rolls, snapshot creation, expiry

**Files:**
- Modify: `supabase/migrations/0081_scout_card.sql` (append)

**Reference:**
- `supabase/migrations/0056_notifications.sql:182-206` (`_notify`) — signature and usage.
- `supabase/migrations/0068_troop_lending.sql` Task 2 (loan arrival → loan_return creation) — the closest existing two-phase-movement completion pattern to mirror.
- Current source-of-truth for `resolve_due_movements()`: as of this session, `supabase/migrations/0076_npc_daily_reward.sql` (highest-numbered migration defining it). **Re-confirm via `grep -rn "create or replace function resolve_due_movements" supabase/migrations/` before editing** — a later migration between `0076` and `0081` may have redefined it since; always copy the actual latest full body into the new `create or replace function`.

**Steps:**

- [ ] **Step 1: Write `resolve_due_scouts()`**

A dedicated helper, called from the top of `resolve_due_movements()`
alongside the existing `perform resolve_due_npc_*()` calls — scouting
never touches battles/claims, so isolating it keeps the already-huge
`resolve_due_movements()` body untouched except for one new line.

```sql
create or replace function resolve_due_scouts()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scout record;
  v_card_instance_id uuid;
  v_killed boolean;
  v_detected boolean;
  v_target_owner uuid;
  v_target_owner_display text;
  v_caller_display text;
  v_return_hrs numeric;
  v_distance numeric;
  v_from_x smallint; v_from_y smallint;
  v_to_x smallint; v_to_y smallint;
  v_movement_id uuid;
  v_snapshot jsonb;
  v_target_territory_id integer;
  v_target_still_active boolean;
begin
  -- ---- Outbound 'scout' arrivals: risk rolls, then either death or a
  -- ---- 'scout_return' leg home. ----
  for v_scout in
    select id, player_id, origin_territory_id, destination_territory_id
    from troop_movements
    where kind = 'scout' and status = 'in_transit' and transfer_arrives_at <= now()
  loop
    update troop_movements set status = 'completed' where id = v_scout.id;

    select card_instance_id into v_card_instance_id
    from troop_movement_units where movement_id = v_scout.id;

    select owner_id into v_target_owner from territories where id = v_scout.destination_territory_id;
    select display_name into v_caller_display from players where id = v_scout.player_id;

    v_killed := random() < 0.20;
    if v_killed then
      -- The card's own troop_movement_units row (this very movement)
      -- still references it, and card_instances has no ON DELETE CASCADE
      -- from that FK (see 0002_territories.sql) — delete the join row
      -- first so the card delete doesn't hit a foreign_key_violation.
      -- (Mirrors the try/delete-then-orphan-on-FK-violation pattern used
      -- for wild-garrison card removal in 0047_wall_structure_card.sql.)
      delete from troop_movement_units where card_instance_id = v_card_instance_id;
      begin
        delete from card_instances where instance_id = v_card_instance_id;
      exception
        when foreign_key_violation then
          -- Mirrors the orphan-fallback in 0047_wall_structure_card.sql:
          -- card_instances_status_check only allows
          -- ('stationed','in_transit','deposit') — no 'lost' status
          -- exists, so orphan it with a null station instead.
          update card_instances
          set owner_id = null, stationed_territory_id = null, status = 'stationed'
          where instance_id = v_card_instance_id;
      end;
      perform _notify(v_scout.player_id, 'scout_killed',
        jsonb_build_object('territory_id', v_scout.destination_territory_id));
    end if;

    if v_target_owner is not null then
      v_detected := random() < 0.50;
      if v_detected then
        perform _notify(v_target_owner, 'scout_detected', jsonb_build_object(
          'territory_id', v_scout.destination_territory_id,
          'scout_player_id', v_scout.player_id,
          'scout_display_name', v_caller_display
        ));
      end if;
    end if;

    if not v_killed then
      select x, y into v_from_x, v_from_y from territories where id = v_scout.destination_territory_id;
      select x, y into v_to_x, v_to_y from territories where id = v_scout.origin_territory_id;
      v_distance := greatest(abs(v_to_x - v_from_x), abs(v_to_y - v_from_y));
      -- Same fixed speed=30 formula as send_scout — do not call
      -- _min_group_speed() (unit-only, see Task 2 note).
      v_return_hrs := greatest(0.25, v_distance * 0.3 * least(3.0, greatest(0.4, 5.0 / 30.0)));

      insert into troop_movements (player_id, kind, origin_territory_id, destination_territory_id, transfer_arrives_at)
      values (v_scout.player_id, 'scout_return', v_scout.destination_territory_id, v_scout.origin_territory_id,
              now() + (v_return_hrs || ' hours')::interval)
      returning id into v_movement_id;

      insert into troop_movement_units (movement_id, card_instance_id)
      values (v_movement_id, v_card_instance_id);
      -- Card stays 'in_transit'. Do NOT rely on the kind-agnostic
      -- restationing update later in resolve_due_movements() to pick
      -- this up when scout_return matures — that update only matches
      -- rows still `status = 'in_transit'`, but this same function's
      -- scout_return-arrival loop below marks the row 'completed' before
      -- that generic update runs (resolve_due_scouts() is called at the
      -- very top of resolve_due_movements()). The scout_return loop below
      -- explicitly restations the card itself for this reason.
    end if;
  end loop;

  -- ---- 'scout_return' arrivals: card is home, capture the snapshot. ----
  for v_scout in
    select id, player_id, origin_territory_id, destination_territory_id
    from troop_movements
    where kind = 'scout_return' and status = 'in_transit' and transfer_arrives_at <= now()
  loop
    update troop_movements set status = 'completed' where id = v_scout.id;

    -- Explicit restation: the generic kind-agnostic restationing update
    -- further down in resolve_due_movements() won't see this row anymore
    -- once it's 'completed' above, so it must happen here.
    update card_instances ci
    set status = 'stationed', stationed_territory_id = v_scout.destination_territory_id
    from troop_movement_units tmu
    where tmu.movement_id = v_scout.id and ci.instance_id = tmu.card_instance_id;

    select destination_territory_id into v_target_territory_id
    from troop_movements sc
    join troop_movement_units tmu on tmu.movement_id = sc.id
    where sc.kind = 'scout' and sc.status = 'completed'
      and tmu.card_instance_id in (
        select card_instance_id from troop_movement_units where movement_id = v_scout.id
      )
    order by sc.transfer_arrives_at desc
    limit 1;

    select coalesce(jsonb_agg(jsonb_build_object(
      'template_id', ct.id, 'category', ct.category, 'unit_type', ct.unit_type,
      'rank', ct.rank, 'name', ct.name
    )), '[]'::jsonb) into v_snapshot
    from card_instances ci
    join card_templates ct on ct.id = ci.template_id
    where ci.stationed_territory_id = v_target_territory_id
      and ci.status = 'stationed'
      and ct.category = 'unit';

    insert into scout_reports (scout_player_id, target_territory_id, captured_at, expires_at, snapshot)
    values (v_scout.player_id, v_target_territory_id, now(), now() + interval '10 days', v_snapshot)
    on conflict (scout_player_id, target_territory_id) where target_territory_id is not null
    do update set captured_at = excluded.captured_at, expires_at = excluded.expires_at, snapshot = excluded.snapshot;

    perform _notify(v_scout.player_id, 'scout_returned', jsonb_build_object('territory_id', v_target_territory_id));
  end loop;

  -- ---- 'scout_peek' resolutions: instant risk roll + immediate snapshot. ----
  for v_scout in
    select id, player_id, scout_target_movement_id
    from troop_movements
    where kind = 'scout_peek' and status = 'in_transit' and transfer_arrives_at <= now()
  loop
    update troop_movements set status = 'completed' where id = v_scout.id;

    select card_instance_id into v_card_instance_id
    from troop_movement_units where movement_id = v_scout.id;

    v_killed := random() < 0.20;
    if v_killed then
      delete from troop_movement_units where card_instance_id = v_card_instance_id;
      begin
        delete from card_instances where instance_id = v_card_instance_id;
      exception
        when foreign_key_violation then
          update card_instances
          set owner_id = null, stationed_territory_id = null, status = 'stationed'
          where instance_id = v_card_instance_id;
      end;
      perform _notify(v_scout.player_id, 'scout_killed', jsonb_build_object('movement_id', v_scout.scout_target_movement_id));
    else
      update card_instances set status = 'stationed' where instance_id = v_card_instance_id;
    end if;

    select player_id into v_target_owner
    from troop_movements where id = v_scout.scout_target_movement_id;
    if v_target_owner is not null then
      v_detected := random() < 0.50;
      if v_detected then
        select display_name into v_caller_display from players where id = v_scout.player_id;
        perform _notify(v_target_owner, 'scout_detected', jsonb_build_object(
          'movement_id', v_scout.scout_target_movement_id,
          'scout_player_id', v_scout.player_id,
          'scout_display_name', v_caller_display
        ));
      end if;
    end if;

    if not v_killed then
      select status = 'in_transit' into v_target_still_active
      from troop_movements where id = v_scout.scout_target_movement_id;

      if coalesce(v_target_still_active, false) then
        select coalesce(jsonb_agg(jsonb_build_object(
          'template_id', ct.id, 'category', ct.category, 'unit_type', ct.unit_type,
          'rank', ct.rank, 'name', ct.name
        )), '[]'::jsonb) into v_snapshot
        from troop_movement_units tmu
        join card_instances ci on ci.instance_id = tmu.card_instance_id
        join card_templates ct on ct.id = ci.template_id
        where tmu.movement_id = v_scout.scout_target_movement_id
          and ct.category = 'unit';

        insert into scout_reports (scout_player_id, target_movement_id, captured_at, expires_at, snapshot)
        values (v_scout.player_id, v_scout.scout_target_movement_id, now(), now() + interval '10 days', v_snapshot)
        on conflict (scout_player_id, target_movement_id) where target_movement_id is not null
        do update set captured_at = excluded.captured_at, expires_at = excluded.expires_at, snapshot = excluded.snapshot;

        perform _notify(v_scout.player_id, 'scout_returned', jsonb_build_object('movement_id', v_scout.scout_target_movement_id));
      end if;
      -- else: target attack already resolved/cancelled — no snapshot,
      -- no notification, card is simply back home 'stationed' (see above).
    end if;
  end loop;

  delete from scout_reports where expires_at <= now();
end;
$$;
```

- [ ] **Step 2: Wire `resolve_due_scouts()` into `resolve_due_movements()`**

Re-copy the full current body of `resolve_due_movements()` (per the
re-confirm note above) into a new `create or replace function
resolve_due_movements()` in this migration, adding exactly one line among
the existing `perform resolve_due_npc_*();` calls near the top:

```sql
  perform resolve_due_scouts();
```

Do not change anything else in that function — scouts are fully handled
by the new helper and never touch `battles`/claim logic.

- [ ] **Step 3: Append verification cases**

Cover: a `scout` movement past its `transfer_arrives_at` resolves
(deterministically test both branches by forcing `random()` — since
`random()` can't be pinned in plain SQL, structure this as: run the
resolver many times in a loop against freshly-inserted fixture rows and
assert both outcomes occur across enough iterations, OR — preferred,
simpler — temporarily monkeypatch by testing the **deterministic**
parts only: assert that after resolution the movement is `completed`,
that on the surviving path a `scout_return` row is created with correct
origin/destination swap and plausible duration, and that a manually
inserted `card_instances` row disappears when directly asserting the
"killed" code path by testing `resolve_due_scouts()`'s behavior with
`v_killed` forced — since forcing isn't feasible from SQL alone, instead
assert probabilistically over ~50 fixture scouts that killed-count falls
in a wide sanity band (e.g. 2-20 out of 50), which is enough to catch a
gross logic inversion without being flaky). Also cover: `scout_return`
arrival creates a `scout_reports` row with the right `snapshot` contents
matching the target territory's actual stationed unit cards at capture
time; a second scout to the same territory replaces (not duplicates) the
row; `scout_peek` whose target movement no longer exists/`in_transit`
produces no `scout_reports` row and returns the card to `stationed`;
expired `scout_reports` rows are deleted by the next resolver run.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0081_scout_card.sql supabase/migrations/0081_scout_card.verification.sql
git commit -m "feat: resolve scout arrivals, risk rolls, snapshots, and expiry"
```

---

### Task 4: Close the info-leak — mask units in `get_visible_territory_cards()`

**Files:**
- Modify: `supabase/migrations/0081_scout_card.sql` (append)

**Reference:**
- `supabase/migrations/0068_troop_lending.sql:310-395` — current full body of `get_visible_territory_cards()` (the boost-masking `case when ct.category = 'boost' and ci.owner_id is distinct from caller` branches to extend). **Re-confirm this is still the latest definition** via `grep -rn "create or replace function get_visible_territory_cards" supabase/migrations/` before editing, same caveat as Task 3.

**Steps:**

- [ ] **Step 1: Extend the masking condition to cover units without a valid snapshot**

Copy the current full function body into a new `create or replace
function get_visible_territory_cards(p_territory_id integer)` and change
every `ct.category = 'boost' and ci.owner_id is distinct from caller`
condition to also mask unit cards under the new rule. Add a CTE/subquery
at the top of the function body computing whether the caller has a valid
snapshot for this territory:

```sql
  v_has_valid_scout_report boolean;
begin
  ...
  select exists (
    select 1 from scout_reports
    where scout_player_id = caller
      and target_territory_id = p_territory_id
      and expires_at > now()
  ) into v_has_valid_scout_report;
```

Then change the masking predicate from `ct.category = 'boost' and
ci.owner_id is distinct from caller` to:

```sql
  (ct.category = 'boost' and ci.owner_id is distinct from caller)
  or (ct.category = 'unit' and ci.owner_id is distinct from caller and not v_has_valid_scout_report)
```

reusing the exact same `'masked-boost'`/`is_masked`/`jsonb_build_object`
null-out shape already used for boosts — for masked units, build an
equivalent `'masked-unit'` id with `rank` preserved (needed for the
client's bucket-range grouping) and everything else null, mirroring the
boost branch's `jsonb_build_object` field-for-field.

- [ ] **Step 2: Append verification cases**

Cover: a caller with no scout report sees `is_masked = true` /
`'masked-unit'` template id (with `rank` intact) for another player's
unit cards on a territory they don't own; a caller with a valid,
unexpired `scout_reports` row sees the real `unit_type`/`base_stats`/
`name`; an expired `scout_reports` row (`expires_at <= now()`) falls back
to masked; the caller's own cards are never masked regardless of scout
report state; boost masking behavior is unchanged (still boost-owner
based, ignores scout reports).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0081_scout_card.sql supabase/migrations/0081_scout_card.verification.sql
git commit -m "feat: mask unit cards in get_visible_territory_cards without a valid scout report"
```

---

### Task 5: Reward hooks — daily reward, battle win, structure conquest

**Files:**
- Modify: `supabase/migrations/0081_scout_card.sql` (append)

**Reference:**
- `supabase/migrations/0030_wire_card_limit.sql:106-...` (`claim_daily_reward` — **confirmed current source-of-truth**: also defined in `0013_level_up_cards.sql`, but `0030` is the highest-numbered redefinition as of this session; **re-confirm via `grep -rn "create or replace function claim_daily_reward" supabase/migrations/*.sql`** before editing in case a later migration redefined it again) — the `mod(v_new_streak, 7) = 0` weekly-bonus branch to copy as the pattern for a new `mod(v_new_streak, 2) = 0` branch.
- Current source-of-truth for `_finalize_battle`: as of this session, `supabase/migrations/0035_wire_world_events.sql` (highest-numbered migration defining it — **re-confirm via grep before editing**, same caveat as Tasks 3-4). The XP-award block (§A in `0009_structure_card_rewards.sql`, still present in later versions) is where the 5% scout drop attaches, guarded the same way as the existing 1% structure-card bonus (§C) — independent `if random() < 0.05 then ... end if;`.
- `complete_kingdom_onboarding` — **confirmed current source-of-truth**: defined in `0002_territories.sql`, `0009_structure_card_rewards.sql`, and `0027_npc_kingdoms.sql`; `0027` is the highest-numbered redefinition as of this session; **re-confirm via `grep -rn "create or replace function complete_kingdom_onboarding" supabase/migrations/*.sql`** before editing.
- Wild-garrison/village/castle conquest reward site: `supabase/migrations/0077_npc_wild_garrison_conquest.sql` for the wild-conquest path; confirm whether "zabrání vesnice/hradu" (claim conquest of a structured but unowned tile) shares the same `_finalize_battle` no-combat-capture path (likely yes, since claims funnel through the same battle-resolution function per `0009`'s `_capture` branch) — if so, no separate hook is needed beyond the one in `_finalize_battle`.

**Steps:**

- [ ] **Step 1: Extend `claim_daily_reward()` with the every-2nd-day scout grant**

Copy the current full function body into a new `create or replace
function claim_daily_reward()`, adding after the existing `mod(v_new_streak,
7) = 0` block:

```sql
  if mod(v_new_streak, 2) = 0 then
    insert into card_instances (template_id, owner_id, stationed_territory_id, status)
    values ('scout', v_player_id, null, 'stationed');

    v_granted_cards := v_granted_cards || jsonb_build_array(
      jsonb_build_object('template_id', 'scout', 'rank', 'uncommon')
    );
  end if;
```

- [ ] **Step 2: Add the starter-kit scout card**

In `complete_kingdom_onboarding()` (current source-of-truth
`0027_npc_kingdoms.sql` as of this session — re-confirm via grep per the
Reference note above), add one line granting 1 scout card alongside the
existing castle-common/village-common starter grants:

```sql
  insert into card_instances (template_id, owner_id, stationed_territory_id, status)
  values ('scout', caller, null, 'stationed');
```

- [ ] **Step 3: Add the 5% battle-win scout drop to `_finalize_battle`**

Copy the current full function body into a new `create or replace
function _finalize_battle(...)`, adding right after the existing §C 1%
structure-card bonus block (guarded the same way, independent roll):

```sql
      if random() < 0.05 then
        insert into card_instances (template_id, owner_id, stationed_territory_id, status)
        values ('scout', v_winner_id, null, 'stationed');
      end if;
```

- [ ] **Step 4: Confirm/hook the wild-garrison and structure-claim-conquest reward paths**

Check whether `0077_npc_wild_garrison_conquest.sql`'s conquest resolution
calls into `_finalize_battle` (no-combat-capture path) or has its own
separate reward-granting code. If it reuses `_finalize_battle`, Step 3
already covers it — no further change needed. If it has a separate reward
block, add the identical `if random() < 0.05 then ... end if;` scout-drop
there too, redefining that function in this migration file.

- [ ] **Step 5: Append verification cases**

Cover: `claim_daily_reward()` grants a scout card on streak day 2 (and
every even day thereafter) but not on odd days; `complete_kingdom_onboarding`
grants exactly 1 starter scout card; a forced/simulated battle win runs
the 5% roll independently of the existing 1% structure roll (both can
fire on the same win).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0081_scout_card.sql supabase/migrations/0081_scout_card.verification.sql
git commit -m "feat: wire scout card into daily reward, onboarding, and battle-win drops"
```

---

### Task 6: Frontend types, guards, and API wrappers

**Files:**
- Modify: `lib/cards/types.ts`
- Modify: `lib/territories/api.ts`
- Modify: `lib/notifications/types.ts`
- Modify: `components/notifications/notificationLabel.ts`
- Test: `lib/cards/types.test.ts` (create if it doesn't already exist — check first)

**Steps:**

- [ ] **Step 1: Add the `ScoutCardTemplate` type + `isScoutTemplate` guard**

In `lib/cards/types.ts`, add:

```ts
export interface ScoutCardTemplate {
  id: 'scout'
  category: 'scout'
  rank: Rank
  name: string
  flavorText: string
  totalSupply: null
}

export type CardTemplate = UnitCardTemplate | StructureCardTemplate | BoostCardTemplate | ScoutCardTemplate

export function isScoutTemplate(template: CardTemplate): template is ScoutCardTemplate {
  return template.category === 'scout'
}
```

- [ ] **Step 2: Update every existing `isUnitTemplate`-based troop filter to also exclude scout**

Since `CardTemplate` widened, TypeScript will already force `category`
narrowing everywhere it's discriminated — but explicitly grep for every
place that filters "non-unit" or "anything sendable to
claim/transfer/attack" (`TerritoryDetailPanel.tsx`'s
`originInstances.filter((o) => isUnitTemplate(o.template))`,
`DeclareAttackModal.tsx`'s equivalent, `TransferModal.tsx`,
`LendModal.tsx`) and confirm each one already uses `isUnitTemplate` (an
allowlist, not a denylist) so scout cards are automatically excluded with
no code change needed there. Only add an explicit exclusion if any of
these use a denylist pattern instead (e.g. "everything that isn't a
structure card") — fix any such spot found to filter on `isUnitTemplate`
instead.

- [ ] **Step 3: Add API wrappers in `lib/territories/api.ts`**

```ts
export async function sendScout(targetTerritoryId: number, cardInstanceId: string) {
  return supabase.rpc('send_scout', {
    p_target_territory_id: targetTerritoryId,
    p_card_instance_id: cardInstanceId,
  }) as unknown as Promise<{ data: string | null; error: { message: string } | null }>
}

export async function sendScoutPeek(targetMovementId: string, cardInstanceId: string) {
  return supabase.rpc('send_scout_peek', {
    p_target_movement_id: targetMovementId,
    p_card_instance_id: cardInstanceId,
  }) as unknown as Promise<{ data: string | null; error: { message: string } | null }>
}
```

(Follow the exact return-type-casting convention already used by
`getCardInstancesAtTerritory`/`getMovementCards` just above in the same
file.)

- [ ] **Step 4: Add the 3 new notification types**

In `lib/notifications/types.ts`, add `'scout_killed' | 'scout_detected' |
'scout_returned'` to `NotificationType`, plus payload interfaces:

```ts
export interface ScoutKilledNotificationPayload {
  territory_id?: number
  movement_id?: string
}

export interface ScoutDetectedNotificationPayload {
  territory_id?: number
  movement_id?: string
  scout_player_id: string
  scout_display_name: string
}

export interface ScoutReturnedNotificationPayload {
  territory_id?: number
  movement_id?: string
}
```

and the matching `NotificationPayloadByType` entries. In
`components/notifications/notificationLabel.ts`, add:

```ts
    case 'scout_killed':
      return 'Zvěd byl zabit/chycen'
    case 'scout_detected':
      return 'Byl jsi odhalen jako zvěd'
    case 'scout_returned':
      return 'Zvěd se vrátil s hlášením'
```

- [ ] **Step 5: Run `tsc --noEmit` to confirm the widened `CardTemplate` union doesn't break any existing exhaustive switch/discriminated-union code**

Run: `npx tsc --noEmit`
Fix any new compile errors surfaced by the added `ScoutCardTemplate` arm
(likely in `NonUnitTradingCard.tsx`'s category switch, addressed in Task
7 anyway).

- [ ] **Step 6: Commit**

```bash
git add lib/cards/types.ts lib/territories/api.ts lib/notifications/types.ts components/notifications/notificationLabel.ts
git commit -m "feat: add scout card types, API wrappers, and notification types"
```

---

### Task 7: Scout card rendering + lightweight army-strength estimate

**Files:**
- Modify: `components/cards/NonUnitTradingCard.tsx`
- Test: `components/cards/NonUnitTradingCard.test.tsx`
- Modify: `lib/battles/armyStrength.ts`
- Test: `lib/battles/armyStrength.test.ts`

**Reference:**
- `components/cards/NonUnitTradingCard.tsx`'s existing per-category switch (structure vs. boost art) from the prior boost-card session — add a third `category === 'scout'` arm.

**Steps:**

- [ ] **Step 1: Write the failing test for scout card rendering**

```ts
it('renders a scout card with a placeholder icon and no stat numbers', () => {
  render(<NonUnitTradingCard template={scoutTemplate} />)
  expect(screen.getByText('Zvěd')).toBeInTheDocument()
  // stat cells render but show no numeric value (placeholder dash), per spec §1
})
```

- [ ] **Step 2: Run it, confirm it fails** (scout category not yet handled in the component's switch).

- [ ] **Step 3: Add the scout render arm to `NonUnitTradingCard.tsx`**

Mirror the existing structure/boost card layout (image top-left rarity
badge, title, type, flavor text, divider, stat row) but with a simple
placeholder icon (e.g. an emoji `🕵️` or a generic silhouette, matching
this project's established "placeholder now, real art later" convention
from the earlier boost-card session) and every stat cell rendering with
no numeric value.

- [ ] **Step 4: Run the test, confirm it passes.**

- [ ] **Step 5: Write the failing test for the lightweight army-strength estimate**

In `lib/battles/armyStrength.ts`, add:

```ts
export type RankBucketCounts = Partial<Record<Rank, number>>

const RANK_WEIGHT: Record<Rank, number> = { common: 1, uncommon: 2, rare: 3, epic: 5, legend: 8 }
const BUCKET_MIDPOINTS = [3, 8, 13] // matches the 1-5/6-10/11+ pip buckets

export function compareArmyStrengthLightweight(params: {
  attackerCards: ArmyStrengthCard[]
  defenderBuckets: RankBucketCounts // pip-bucket counts (1 = 1-5, 2 = 6-10, 3 = 11+), keyed by rank
}): ArmyStrengthResult
```

Test: given a known attacker card list and a known bucket map, the
returned `label`/`ratio` match a hand-computed expectation.

- [ ] **Step 6: Run it, confirm it fails.**

- [ ] **Step 7: Implement `compareArmyStrengthLightweight`**

Weight attacker cards the same way `cardPower`/rank-scaling already does
(reuse `computeEffectiveStats`/`cardPower` for the attacker side, since
those cards ARE known), but for the defender side sum
`RANK_WEIGHT[rank] * BUCKET_MIDPOINTS[bucketIndex]` per rank present in
`defenderBuckets`. Reuse the same `ratio`/`label` thresholds as
`compareArmyStrength`.

- [ ] **Step 8: Run the test, confirm it passes.**

- [ ] **Step 9: Commit**

```bash
git add components/cards/NonUnitTradingCard.tsx components/cards/NonUnitTradingCard.test.tsx lib/battles/armyStrength.ts lib/battles/armyStrength.test.ts
git commit -m "feat: add scout card rendering and lightweight army-strength estimate"
```

---

### Task 8: UI wiring — bucket display, scout buttons, snapshot display

**Files:**
- Modify: `components/territories/GarrisonModal.tsx`
- Modify: `components/territories/TerritoryDetailPanel.tsx`
- Modify: `components/territories/DeclareAttackModal.tsx`
- Modify: `components/territories/MovementDetailModal.tsx`
- Test: each corresponding `.test.tsx` file

**Steps:**

- [ ] **Step 1: Add a shared bucket-range formatting helper**

Create `lib/territories/garrisonBuckets.ts` (new small focused file, per
this project's "smaller focused files" convention) exporting a function
that takes the already-masked `card_templates` rows (now including
`'masked-unit'` rows with `rank` preserved, from Task 4) and groups them
into the same "1-5 / 6-10 / 11+ common, ..." text used by the map pips
(`getGarrisonPipCount` in `MapViewport.tsx` — reuse or mirror its
threshold logic rather than reinventing it).

- [ ] **Step 2: Write failing tests for the bucket helper, implement, pass, commit**

Standard TDD cycle; test a few rank/count combinations map to the
expected human-readable string ("6–10 common, 1–5 uncommon").

- [ ] **Step 3: Wire bucket display + "Vyslat zvěda" button into `GarrisonModal`/`TerritoryDetailPanel`**

Where these components currently render the (now server-side-masked)
card list for a non-owned territory, detect masked rows (`is_masked` /
`'masked-unit'` id) and render the bucket-range text instead of a card
grid for those; keep the real `TradingCard` grid path for unmasked rows
(this now automatically happens once Task 4 ships, with zero extra
client logic needed to "hide" anything — the RPC already returns masked
data). Add the "Vyslat zvěda" button (calling `sendScout` from Task 6)
next to the bucket display, disabled when the player owns zero scout
cards (check via the already-loaded "my card instances" list, filtering
`category === 'scout' && status === 'stationed'`), showing the owned
count as "(N ks)".

- [ ] **Step 4: Wire the disclaimer + bucket fallback + scout button into `DeclareAttackModal`**

The `defenderInstances` data is unchanged in shape (Task 4 handles
masking server-side), so the existing card-grid render path already
naturally becomes bucket-appropriate once masked rows are detected the
same way as Step 3. Swap `compareArmyStrength` for
`compareArmyStrengthLightweight` (Task 7) when any defender card is
masked, and render the "⚠ Odhad — neznáš přesná vojska nepřítele"
disclaimer next to the `armyStrength` display in that case.

- [ ] **Step 5: Wire the instant-peek button into `MovementDetailModal`**

Add a "Vyslat zvěda" button next to the existing "Složení útočící armády
zůstává skryté do začátku bitvy." message (only for `arrow.category ===
'incoming'`, not `'ally-incoming'` — spying on an ally's incoming attack
isn't in scope), calling `sendScoutPeek` (Task 6) with the arrow's
`movementId`. If a valid `scout_reports` snapshot already exists for that
`target_movement_id` (fetch via a small new query — either extend
`getMovementCards` to also check `scout_reports` or add a dedicated
lookup), replace the hidden-composition message with the real card grid
+ captured-at timestamp instead.

- [ ] **Step 6: Update each component's existing test file**

Add/adjust test cases for: bucket text rendering when a masked row is
present, real card grid rendering when unmasked (already covered by most
existing tests, keep them green), scout button presence/disabled state
based on owned scout-card count, disclaimer text presence in
`DeclareAttackModal` when using the lightweight estimate.

- [ ] **Step 7: Run the full test suite**

Run: `npx jest`
Expected: all suites pass (fix any regressions from the `CardTemplate`
union widening or masked-row shape changes before proceeding).

- [ ] **Step 8: Commit**

```bash
git add lib/territories/garrisonBuckets.ts lib/territories/garrisonBuckets.test.ts components/territories/GarrisonModal.tsx components/territories/GarrisonModal.test.tsx components/territories/TerritoryDetailPanel.tsx components/territories/TerritoryDetailPanel.test.tsx components/territories/DeclareAttackModal.tsx components/territories/DeclareAttackModal.test.tsx components/territories/MovementDetailModal.tsx components/territories/MovementDetailModal.test.tsx
git commit -m "feat: wire scout buttons, bucket ranges, and snapshot display into map UI"
```

---

### Task 9: Full verification, live migration apply, docs update

**Files:**
- Modify: `docs/superpowers/PROGRESS.md`

**Steps:**

- [ ] **Step 1: Run the full test suite**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 2: Run the type check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run the build**

Check for stale `next dev`/`next build` node processes first (per this
project's known environment gotcha — see `PROGRESS.md`/project
instructions), then:
Run: `npm run build`
Expected: all routes compile/prerender successfully.

- [ ] **Step 4: Apply `0081_scout_card.sql` + its verification file to the live Supabase project**

Use the same throwaway-`pg`-script approach as the `0080` migration
earlier in this session (parse `.env.local` manually for
`SUPABASE_DB_URL`, no `dotenv` dependency). Delete the throwaway script
afterward.

- [ ] **Step 5: Update `docs/superpowers/PROGRESS.md`**

Add an entry describing the scout card feature, its scope, and the key
technical decisions (server-side masking fix in
`get_visible_territory_cards()`, scout/scout_return/scout_peek movement
kinds, `scout_reports` table + 10-day expiry, 20%/50% independent risk
rolls, reward integration points), following this file's existing entry
format/conventions.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/PROGRESS.md
git commit -m "docs: update PROGRESS.md for scout card feature"
```

- [ ] **Step 7: Push to `origin/main`** (only if the user has explicitly asked for this session's work to be pushed — otherwise stop here and report completion, per this project's standing convention of never pushing without explicit confirmation).
