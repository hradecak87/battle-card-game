-- Player search RPC — replaces raw "paste a player's UUID" text fields in
-- diplomacy (invite/war/peace/pact targets) with a single free-text search
-- across display name, kingdom name, and email.
--
-- Email is used only as a match criterion; it is never returned to the
-- caller (privacy) — matches `players_select_all`'s existing public-read
-- posture for display_name/kingdom_name, but email lives on auth.users,
-- which is not publicly readable, so this must be `security definer`.

create or replace function search_players(p_query text, p_limit integer default 8)
returns table (
  id uuid,
  display_name text,
  kingdom_name text,
  nation nation_id,
  is_online boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_trimmed text := trim(coalesce(p_query, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 25);
begin
  if v_caller is null then
    raise exception 'must be authenticated';
  end if;

  if char_length(v_trimmed) < 2 then
    return;
  end if;

  return query
    select
      p.id,
      p.display_name,
      p.kingdom_name,
      p.nation,
      coalesce(p.last_seen_at >= now() - interval '2 minutes', false) as is_online
    from players p
    join auth.users u on u.id = p.id
    where p.id <> v_caller
      and p.is_npc = false
      and (
        p.display_name ilike '%' || v_trimmed || '%'
        or p.kingdom_name ilike '%' || v_trimmed || '%'
        or u.email ilike '%' || v_trimmed || '%'
      )
    order by p.display_name
    limit v_limit;
end;
$$;

revoke execute on function search_players(text, integer) from public, anon;
grant execute on function search_players(text, integer) to authenticated;
