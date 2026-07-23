-- =====================================================================
-- annotate-kit — Supabase backend (apply once per project).
--   supabase db push   (or paste into the SQL editor)
--
-- Creates: the annotations table, a global on/off toggle, a private screenshot bucket,
-- and Row-Level-Security policies so the browser client (anon key) is safe to talk to directly.
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
  created_by      text not null default '',          -- author email (matches auth.email())
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- shapes + visibility + author snapshot + captured element styles
  kind            text default 'pin',                -- 'pin' | 'shape'
  shape_type      text,                              -- 'rect' | 'arrow' | 'circle' | 'freehand'
  x2              integer,
  y2              integer,
  points          jsonb,
  color           text,
  visibility      text default 'public',             -- 'public' | 'private'
  created_by_role text,
  created_by_name text,
  styles          jsonb,
  el_context      jsonb,
  -- auto technical context + captured console/JS errors
  meta            jsonb,
  console_logs    jsonb
);
create index if not exists idx_annotations_status     on public.annotations (status);
create index if not exists idx_annotations_route      on public.annotations (page_route);
create index if not exists idx_annotations_created_by on public.annotations (created_by);

alter table public.annotations enable row level security;
grant select, insert, update, delete on public.annotations to authenticated;

-- See: admins see all; everyone sees their own + public marks.
drop policy if exists annot_select on public.annotations;
create policy annot_select on public.annotations for select to authenticated
  using ( public.annotate_is_admin() or created_by = auth.email() or visibility = 'public' );
-- Insert: only as yourself.
drop policy if exists annot_insert on public.annotations;
create policy annot_insert on public.annotations for insert to authenticated
  with check ( created_by = auth.email() );
-- Edit / delete: your own, or admin.
drop policy if exists annot_update on public.annotations;
create policy annot_update on public.annotations for update to authenticated
  using ( public.annotate_is_admin() or created_by = auth.email() )
  with check ( public.annotate_is_admin() or created_by = auth.email() );
drop policy if exists annot_delete on public.annotations;
create policy annot_delete on public.annotations for delete to authenticated
  using ( public.annotate_is_admin() or created_by = auth.email() );

-- ── global toggle (single row: key='enabled') ────────────────────────
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

insert into public.annotate_settings (key, value) values ('enabled', 'true'::jsonb)
  on conflict (key) do nothing;

-- ── private screenshot bucket + storage policies ─────────────────────
insert into storage.buckets (id, name, public) values ('annotations', 'annotations', false)
  on conflict (id) do nothing;

drop policy if exists annot_obj_read on storage.objects;
create policy annot_obj_read on storage.objects for select to authenticated
  using ( bucket_id = 'annotations' );
drop policy if exists annot_obj_insert on storage.objects;
create policy annot_obj_insert on storage.objects for insert to authenticated
  with check ( bucket_id = 'annotations' );
drop policy if exists annot_obj_delete on storage.objects;
create policy annot_obj_delete on storage.objects for delete to authenticated
  using ( bucket_id = 'annotations' and ( owner = auth.uid() or public.annotate_is_admin() ) );
