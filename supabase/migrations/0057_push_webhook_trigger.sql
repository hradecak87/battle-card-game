-- Workaround for a Supabase platform bug where the `supabase_functions`
-- schema (used internally by the Dashboard's "Database Webhooks" GUI
-- feature) was never provisioned for this project, making that feature
-- unusable (confirmed via https://github.com/supabase/supabase/issues/48870
-- — Supabase's own team says the only "official" fix is to open a support
-- ticket and have staff manually create the schema).
--
-- `pg_net` itself (the extension the GUI feature is built on top of) DOES
-- work fine on this project, so this migration replicates the exact same
-- behavior a Dashboard webhook would have given us — a trigger on
-- `notifications` that POSTs to /api/push/send on INSERT/UPDATE — using
-- `net.http_post(...)` directly, bypassing the broken `supabase_functions`
-- wrapper entirely.
--
-- The webhook URL + shared secret are intentionally NOT set by this
-- migration (this file is committed to git, and the secret must never be).
-- They're stored in the `push_webhook_config` singleton table below, which
-- starts empty; a separate, un-committed script populates the one config
-- row directly against the live database (mirrors how VAPID keys /
-- SUPABASE_DB_URL are handled elsewhere in this project — see
-- docs/superpowers/PROGRESS.md's "no psql available" note). If the config
-- row is missing (e.g. in a fresh/local environment), the trigger quietly
-- no-ops instead of erroring.

create table push_webhook_config (
  id boolean primary key default true,
  url text not null,
  secret text not null,
  constraint push_webhook_config_singleton check (id)
);

create or replace function _notify_push_webhook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config push_webhook_config%rowtype;
begin
  select * into v_config from push_webhook_config where id = true;

  if not found then
    return new;
  end if;

  perform net.http_post(
    url := v_config.url,
    body := jsonb_build_object(
      'type', tg_op,
      'table', 'notifications',
      'record', to_jsonb(new)
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-webhook-secret', v_config.secret
    )
  );

  return new;
end;
$$;

create trigger notifications_push_webhook
after insert or update on notifications
for each row execute function _notify_push_webhook();
