-- =====================================================================
-- annotate-kit — Supabase backend (apply once per project).
--   supabase db push   (or paste into the SQL editor)
--
-- Creates: a global on/off toggle, the annotations table, a private screenshot bucket,
-- Row-Level-Security policies, an author-stamping trigger, and an atomic reply RPC — so the
-- browser client (anon key) is safe to talk to directly.
--
-- Security model (defaults are SAFE):
--   * The tool ships OFF (annotate_settings.enabled = false) → only admins see/use it until an
--     admin flips the toggle. Non-admin read/insert is gated server-side on that toggle.
--   * New marks default to visibility = 'private'. 'public' is an explicit opt-in in the UI.
--   * created_by / created_by_name / created_by_role are STAMPED server-side from the JWT
--     (client-sent values are ignored) and are immutable on update — no author forgery.
--   * Screenshots live in a PRIVATE bucket under `<visibility>/<uid>/…`; private screenshots
--     are readable only by their owner or an admin, public ones by any authenticated user.
--
-- Admin model: a user is an "annotate admin" when their JWT has
--   app_metadata.role = 'admin'   OR   app_metadata.annotate_admin = true
-- (set these in Supabase Auth → user → app_metadata). The client adapter's isAdmin default
-- matches this — change both together if you use a different claim.
-- =====================================================================

-- ── who is an admin (from JWT claims) ────────────────────────────────
create or replace function public.annotate_is_admin() returns boolean
language sql stable as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or (auth.jwt() -> 'app_metadata' ->> 'annotate_admin')::boolean,
    false)
$$;

-- ── global toggle (single row: key='enabled') — ships OFF (admin-only) ────────────────────
-- Created BEFORE annotate_enabled() below, which reads this table (fresh-install ordering).
create table if not exists public.annotate_settings (
  key        text primary key,
  value      jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.annotate_settings enable row level security;
grant select, insert, update on public.annotate_settings to authenticated;

drop policy if exists annot_settings_read on public.annotate_settings;
create policy annot_settings_read on public.annotate_settings for select to authenticated using ( true );
drop policy if exists annot_settings_write on public.annotate_settings;
create policy annot_settings_write on public.annotate_settings for all to authenticated
  using ( public.annotate_is_admin() ) with check ( public.annotate_is_admin() );

-- SAFE default: OFF. An admin turns it on from the panel when the org is ready.
insert into public.annotate_settings (key, value) values ('enabled', 'false'::jsonb)
  on conflict (key) do nothing;

-- ── is the tool globally enabled for non-admins? (server-enforced access gate) ──
create or replace function public.annotate_enabled() returns boolean
language sql stable as $$
  select coalesce(
    (select value::text = 'true' from public.annotate_settings where key = 'enabled'),
    false)
$$;

-- ── annotations table ────────────────────────────────────────────────
create table if not exists public.annotations (
  id              bigint generated always as identity primary key,
  page_route      text not null default '',
  page_title      text not null default '',
  target_selector text not null default '',
  target_text     text not null default '',
  pos_x           numeric not null default 0,
  pos_y           numeric not null default 0,
  viewport_w      integer not null default 0,
  viewport_h      integer not null default 0,
  note            text not null default '',
  type            text not null default 'change',   -- change | add | remove | bug | style | question
  priority        text not null default 'med',      -- low | med | high
  status          text not null default 'open',     -- open | in_progress | done | dismissed
  screenshot_path text,
  replies         jsonb not null default '[]'::jsonb,
  created_by      text not null default '',          -- author email (STAMPED from JWT — see trigger)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- shapes + visibility + author snapshot + captured element styles
  kind            text default 'pin',                -- 'pin' | 'shape'
  shape_type      text,                              -- 'rect' | 'arrow' | 'circle' | 'freehand'
  x2              integer,
  y2              integer,
  points          jsonb,
  color           text,
  visibility      text not null default 'private',   -- 'public' | 'private'  (SAFE default: private)
  created_by_role text,
  created_by_name text,
  styles          jsonb,
  el_context      jsonb,
  -- auto technical context + captured console/JS errors + network calls
  meta            jsonb,
  console_logs    jsonb,
  network_logs    jsonb,
  dom_snapshot    text
);
create index if not exists idx_annotations_status     on public.annotations (status);
create index if not exists idx_annotations_route      on public.annotations (page_route);
create index if not exists idx_annotations_created_by on public.annotations (created_by);

-- Upgrade older installs (columns/defaults may pre-date this migration).
alter table public.annotations alter column visibility set default 'private';
alter table public.annotations add column if not exists network_logs jsonb;
alter table public.annotations add column if not exists dom_snapshot text;

-- ── size guards: reject oversized payloads (abuse / DoS hardening) ────
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'annot_note_len') then
    alter table public.annotations add constraint annot_note_len   check (char_length(note) <= 5000); end if;
  if not exists (select 1 from pg_constraint where conname = 'annot_text_len') then
    alter table public.annotations add constraint annot_text_len   check (char_length(target_text) <= 2000); end if;
  if not exists (select 1 from pg_constraint where conname = 'annot_sel_len') then
    alter table public.annotations add constraint annot_sel_len    check (char_length(target_selector) <= 1000); end if;
  if not exists (select 1 from pg_constraint where conname = 'annot_replies_sz') then
    alter table public.annotations add constraint annot_replies_sz check (pg_column_size(replies) <= 65536); end if;
  if not exists (select 1 from pg_constraint where conname = 'annot_points_sz') then
    alter table public.annotations add constraint annot_points_sz  check (points is null or pg_column_size(points) <= 65536); end if;
  if not exists (select 1 from pg_constraint where conname = 'annot_logs_sz') then
    alter table public.annotations add constraint annot_logs_sz    check (console_logs is null or pg_column_size(console_logs) <= 32768); end if;
  if not exists (select 1 from pg_constraint where conname = 'annot_net_sz') then
    alter table public.annotations add constraint annot_net_sz     check (network_logs is null or pg_column_size(network_logs) <= 32768); end if;
  if not exists (select 1 from pg_constraint where conname = 'annot_dom_len') then
    alter table public.annotations add constraint annot_dom_len    check (dom_snapshot is null or char_length(dom_snapshot) <= 20000); end if;
end $$;

-- ── author-stamping: created_by / name / role come from the verified JWT, never the client;
--    and are immutable across updates (no ownership/authorship forgery) ───────────────────
create or replace function public.annotate_stamp_author() returns trigger
language plpgsql security invoker as $$
begin
  if (tg_op = 'INSERT') then
    new.created_by      := coalesce(auth.email(), '');
    new.created_by_name := coalesce(
      auth.jwt() -> 'user_metadata' ->> 'full_name',
      auth.jwt() -> 'user_metadata' ->> 'name',
      auth.email());
    new.created_by_role := auth.jwt() -> 'app_metadata' ->> 'role';
    new.created_at      := now();
    new.updated_at      := now();
  else -- UPDATE: pin author fields to their original values, bump updated_at
    new.created_by      := old.created_by;
    new.created_by_name := old.created_by_name;
    new.created_by_role := old.created_by_role;
    new.created_at      := old.created_at;
    new.updated_at      := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_annotate_stamp_author on public.annotations;
create trigger trg_annotate_stamp_author
  before insert or update on public.annotations
  for each row execute function public.annotate_stamp_author();

alter table public.annotations enable row level security;
grant select, insert, update, delete on public.annotations to authenticated;

-- See: admins see all; everyone else sees their own + public marks — BUT only while the tool
-- is globally enabled (server-enforced admin-only mode when disabled).
drop policy if exists annot_select on public.annotations;
create policy annot_select on public.annotations for select to authenticated
  using (
    public.annotate_is_admin()
    or ( public.annotate_enabled() and ( created_by = auth.email() or visibility = 'public' ) )
  );
-- Insert: only as yourself, and only while enabled (or admin). created_by is stamped by trigger.
drop policy if exists annot_insert on public.annotations;
create policy annot_insert on public.annotations for insert to authenticated
  with check ( ( public.annotate_is_admin() or public.annotate_enabled() ) and created_by = auth.email() );
-- Edit / delete: your own, or admin.
drop policy if exists annot_update on public.annotations;
create policy annot_update on public.annotations for update to authenticated
  using ( public.annotate_is_admin() or created_by = auth.email() )
  with check ( public.annotate_is_admin() or created_by = auth.email() );
drop policy if exists annot_delete on public.annotations;
create policy annot_delete on public.annotations for delete to authenticated
  using ( public.annotate_is_admin() or created_by = auth.email() );

-- ── atomic reply append (avoids the read-modify-write lost-update race) ───────────────────
create or replace function public.annotate_add_reply(p_id bigint, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- respect the global admin-only toggle (parity with the insert policy)
  if not (public.annotate_is_admin() or public.annotate_enabled()) then
    raise exception 'annotate: tool is disabled (admin-only)';
  end if;
  -- SECURITY DEFINER bypasses RLS, so we re-check the caller may SEE the mark (admin / owner / public):
  -- anyone who can view a mark can reply to it, and the author is stamped from the verified JWT.
  update public.annotations
    set replies = coalesce(replies, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'note',   left(coalesce(p_note, ''), 2000),
          'author', coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', auth.email(), ''),
          'at',     to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
    where id = p_id
      and ( public.annotate_is_admin() or created_by = auth.email() or visibility = 'public' );
  if not found then
    raise exception 'annotate: cannot reply to this mark (not visible or does not exist)';
  end if;
end $$;
grant execute on function public.annotate_add_reply(bigint, text) to authenticated;

-- ── private screenshot bucket (size + mime limited) + storage policies ────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('annotations', 'annotations', false, 5242880, array['image/png','image/jpeg','image/webp'])
  on conflict (id) do update
    set public = false, file_size_limit = 5242880,
        allowed_mime_types = array['image/png','image/jpeg','image/webp'];

-- Screenshots are stored under  <visibility>/<uid>/<file>  (see the adapter). Read is gated by
-- that prefix: 'public/…' is readable by any authenticated user; 'private/…' only by its owner
-- or an admin. Uploads go into the caller's own uid folder; overwrites are forbidden.
drop policy if exists annot_obj_read on storage.objects;
create policy annot_obj_read on storage.objects for select to authenticated
  using (
    bucket_id = 'annotations'
    and ( (storage.foldername(name))[1] = 'public'
          or owner = auth.uid()
          or public.annotate_is_admin() )
  );
drop policy if exists annot_obj_insert on storage.objects;
create policy annot_obj_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'annotations'
    and (storage.foldername(name))[1] in ('public', 'private')
    and (storage.foldername(name))[2] = auth.uid()::text
  );
drop policy if exists annot_obj_delete on storage.objects;
create policy annot_obj_delete on storage.objects for delete to authenticated
  using ( bucket_id = 'annotations' and ( owner = auth.uid() or public.annotate_is_admin() ) );
-- (no UPDATE policy → overwriting an existing object is denied)

-- ── realtime: broadcast row changes so the overlay can update live (safe to keep) ─────────────
do $$ begin
  alter publication supabase_realtime add table public.annotations;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ── OPTIONAL: data retention. Uncomment + schedule with pg_cron to auto-purge old resolved
--    marks and their screenshots. Adjust the interval to your compliance needs.
-- create extension if not exists pg_cron;
-- select cron.schedule('annotate-purge', '0 3 * * *', $purge$
--   delete from public.annotations
--    where status in ('done','dismissed') and updated_at < now() - interval '90 days';
-- $purge$);
