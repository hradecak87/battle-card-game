-- Diplomacy schema + RLS.
-- War is represented by the presence of a row in diplomacy_relations.
-- No row means peace.

alter table world_events
  drop constraint if exists world_events_event_type_check;

alter table world_events
  add constraint world_events_event_type_check
  check (event_type in (
    'attack_declared',
    'territory_claimed',
    'battle_won',
    'battle_surrendered',
    'territory_abandoned',
    'attack_recalled',
    'king_relocated',
    'player_leveled_up',
    'player_joined',
    'war_declared',
    'peace_signed'
  ));

create table diplomacy_relations (
  player_a_id uuid not null references players(id) on delete cascade,
  player_b_id uuid not null references players(id) on delete cascade,
  state text not null default 'war' check (state = 'war'),
  war_started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (player_a_id, player_b_id),
  check (player_a_id < player_b_id)
);

create table diplomacy_offers (
  id uuid primary key default gen_random_uuid(),
  initiator_id uuid not null references players(id) on delete cascade,
  target_id uuid not null references players(id) on delete cascade,
  kind text not null check (kind in ('white_peace', 'tribute_peace')),
  offered_card_ids uuid[] not null default '{}'::uuid[],
  offered_territory_id integer references territories(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '3 days'),
  resolved_at timestamptz,
  check (initiator_id <> target_id)
);

create unique index diplomacy_offers_pending_initiator_target_idx
  on diplomacy_offers (initiator_id, target_id)
  where status = 'pending';

create index diplomacy_relations_player_a_idx
  on diplomacy_relations (player_a_id, war_started_at desc);

create index diplomacy_relations_player_b_idx
  on diplomacy_relations (player_b_id, war_started_at desc);

create index diplomacy_offers_target_status_idx
  on diplomacy_offers (target_id, status, created_at desc);

create index diplomacy_offers_initiator_status_idx
  on diplomacy_offers (initiator_id, status, created_at desc);

create index diplomacy_offers_pair_status_idx
  on diplomacy_offers (initiator_id, target_id, status, created_at desc);

create index diplomacy_offers_expires_idx
  on diplomacy_offers (expires_at)
  where status = 'pending';

alter table diplomacy_relations enable row level security;
alter table diplomacy_offers enable row level security;

revoke all on diplomacy_relations from public, anon, authenticated;
revoke all on diplomacy_offers from public, anon, authenticated;

grant select on diplomacy_relations to authenticated;
grant select on diplomacy_offers to authenticated;

create policy diplomacy_relations_select_participants
  on diplomacy_relations
  for select
  to authenticated
  using (auth.uid() in (player_a_id, player_b_id));

create policy diplomacy_offers_select_participants
  on diplomacy_offers
  for select
  to authenticated
  using (auth.uid() in (initiator_id, target_id));
