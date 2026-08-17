-- ---------------------------------------------------------------------------
-- 0006_debug_speed_up_movement.sql
--
-- TEST-ONLY convenience RPC, added at the user's explicit request during
-- live playtesting: shrinks the caller's own in-flight movement/claim
-- timers down to ~10-20 seconds instead of waiting the real (hours/days)
-- duration out. Only ever touches rows owned by the calling player
-- (`troop_movements.player_id = auth.uid()` / `claim_locked_by = auth.uid()`),
-- so it cannot be used to interfere with anyone else's timers. This is a
-- deliberate gameplay-balance bypass for testing convenience — remove or
-- gate behind a feature flag before any real public launch.
-- ---------------------------------------------------------------------------
create or replace function debug_speed_up_movement(p_movement_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  caller uuid := auth.uid();
  v_movement record;
begin
  select * into v_movement
  from troop_movements
  where id = p_movement_id and player_id = caller;
  if not found then
    raise exception 'movement not found or not owned by caller';
  end if;

  if v_movement.status = 'in_transit' then
    update troop_movements
    set transfer_arrives_at = now() + interval '10 seconds'
    where id = p_movement_id;

    if v_movement.kind = 'claim' then
      -- Shrink both stages: troops arrive in 10s, occupation (the long
      -- wait) finishes 10s after that — still visibly two separate steps.
      update territories
      set claim_transfer_arrives_at = now() + interval '10 seconds',
          claim_occupation_completes_at = now() + interval '20 seconds'
      where id = v_movement.destination_territory_id and claim_locked_by = caller;
    end if;
  elsif v_movement.status = 'occupying' and v_movement.kind = 'claim' then
    -- Troops already arrived; only the remaining occupation wait is left.
    update territories
    set claim_occupation_completes_at = now() + interval '10 seconds'
    where id = v_movement.destination_territory_id and claim_locked_by = caller;
  else
    raise exception 'movement is not in a speed-up-able state';
  end if;

  perform resolve_due_movements();
end;
$$;
