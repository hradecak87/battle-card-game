-- World activity feed: append-only event log + RLS lockdown.
-- No deletion/pruning for now (future admin cap tool is out of scope).

create table world_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in (
    'attack_declared',
    'territory_claimed',
    'battle_won',
    'battle_surrendered',
    'territory_abandoned',
    'attack_recalled',
    'king_relocated',
    'player_leveled_up',
    'player_joined'
  )),
  created_at timestamptz not null default now(),
  payload jsonb not null
);

create index world_events_created_at_idx
  on world_events (created_at desc, id desc);

alter table world_events enable row level security;

revoke all on world_events from public, anon, authenticated;
