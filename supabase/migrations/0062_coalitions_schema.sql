-- Coalitions schema + RLS foundations, plus widened diplomacy/world-event
-- CHECK constraints for coalition and non-aggression support.

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
    'peace_signed',
    'claim_started',
    'coalition_created',
    'coalition_member_joined',
    'coalition_member_left',
    'coalition_member_kicked',
    'coalition_leadership_transferred',
    'coalition_disbanded',
    'coalition_war_declared',
    'coalition_peace_signed',
    'non_aggression_signed',
    'non_aggression_broken'
  ));

alter table diplomacy_relations
  drop constraint if exists diplomacy_relations_state_check;

alter table diplomacy_relations
  add constraint diplomacy_relations_state_check
  check (state in ('war', 'non_aggression'));

alter table diplomacy_offers
  drop constraint if exists diplomacy_offers_kind_check;

alter table diplomacy_offers
  add constraint diplomacy_offers_kind_check
  check (kind in ('white_peace', 'tribute_peace', 'non_aggression'));

create table coalitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  leader_id uuid not null references players(id),
  created_at timestamptz not null default now(),
  disbanded_at timestamptz
);

create table coalition_members (
  coalition_id uuid not null references coalitions(id),
  player_id uuid not null unique references players(id),
  joined_at timestamptz not null default now(),
  primary key (coalition_id, player_id)
);

create table coalition_invites (
  id uuid primary key default gen_random_uuid(),
  coalition_id uuid not null references coalitions(id),
  invited_player_id uuid not null references players(id),
  invited_by uuid not null references players(id),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz not null default now()
);

create table coalition_join_requests (
  id uuid primary key default gen_random_uuid(),
  coalition_id uuid not null references coalitions(id),
  player_id uuid not null references players(id),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz not null default now()
);

create unique index coalitions_active_name_idx
  on coalitions (name)
  where disbanded_at is null;

create index coalition_members_coalition_id_idx
  on coalition_members (coalition_id);

create unique index coalition_invites_pending_coalition_player_idx
  on coalition_invites (coalition_id, invited_player_id)
  where status = 'pending';

create unique index coalition_join_requests_pending_coalition_player_idx
  on coalition_join_requests (coalition_id, player_id)
  where status = 'pending';

alter table coalitions enable row level security;
alter table coalition_members enable row level security;
alter table coalition_invites enable row level security;
alter table coalition_join_requests enable row level security;

revoke all on coalitions from public, anon, authenticated;
revoke all on coalition_members from public, anon, authenticated;
revoke all on coalition_invites from public, anon, authenticated;
revoke all on coalition_join_requests from public, anon, authenticated;

grant select on coalitions to authenticated;
grant select on coalition_members to authenticated;
grant select on coalition_invites to authenticated;
grant select on coalition_join_requests to authenticated;

create policy coalitions_select_authenticated
  on coalitions
  for select
  to authenticated
  using (auth.uid() is not null);

create policy coalition_members_select_authenticated
  on coalition_members
  for select
  to authenticated
  using (auth.uid() is not null);

create policy coalition_invites_select_participants
  on coalition_invites
  for select
  to authenticated
  using (
    auth.uid() = invited_player_id
    or auth.uid() in (
      select leader_id
      from coalitions
      where id = coalition_id
    )
  );

create policy coalition_join_requests_select_participants
  on coalition_join_requests
  for select
  to authenticated
  using (
    auth.uid() = player_id
    or auth.uid() in (
      select leader_id
      from coalitions
      where id = coalition_id
    )
  );
