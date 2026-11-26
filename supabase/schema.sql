-- ARMAN GAANE database. Run once in the Supabase SQL Editor.
create extension if not exists pgcrypto;
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text,
 role text not null default 'user' check(role in ('user','music_manager','content_manager','support_admin','super_admin')),
 suspended boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists public.songs (
 id uuid primary key default gen_random_uuid(), title text not null, artist text not null,
 album text, language text, country text, duration_seconds integer,
 cover_url text, audio_url text, provider text not null default 'original_upload',
 rights_status text not null default 'pending' check(rights_status in ('pending','cleared','rejected')),
 published boolean not null default false, created_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);
create table if not exists public.playlists (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(char_length(name) between 1 and 80), is_public boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists public.playlist_songs (
 playlist_id uuid references public.playlists(id) on delete cascade,
 song_id uuid references public.songs(id) on delete cascade, position integer not null default 0,
 primary key(playlist_id,song_id)
);
create table if not exists public.favorites (
 user_id uuid references auth.users(id) on delete cascade, song_id uuid references public.songs(id) on delete cascade,
 created_at timestamptz not null default now(), primary key(user_id,song_id)
);
create table if not exists public.play_history (
 id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
 song_id uuid references public.songs(id) on delete cascade, played_at timestamptz not null default now()
);
create table if not exists public.site_settings (
 key text primary key, value jsonb not null, updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id)
);
create table if not exists public.admin_audit_logs (
 id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id),
 action text not null, target_type text, target_id text, details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
-- Create user profile on signup. Role is always 'user'; never accept role from signup metadata.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id,display_name,role) values(new.id,coalesce(new.raw_user_meta_data->>'display_name',''), 'user') on conflict(id) do nothing; return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
-- Enable row-level security on all user data.
alter table public.profiles enable row level security;
alter table public.songs enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_songs enable row level security;
alter table public.favorites enable row level security;
alter table public.play_history enable row level security;
alter table public.site_settings enable row level security;
alter table public.admin_audit_logs enable row level security;
drop policy if exists "profiles read own" on public.profiles;
create policy "profiles read own" on public.profiles for select to authenticated using(auth.uid()=id);
drop policy if exists "profiles update own display name" on public.profiles;
create policy "profiles update own display name" on public.profiles for update to authenticated using(auth.uid()=id) with check(auth.uid()=id);
drop policy if exists "read published cleared songs" on public.songs;
create policy "read published cleared songs" on public.songs for select to anon,authenticated using(published=true and rights_status='cleared');
drop policy if exists "playlist owner read" on public.playlists;
create policy "playlist owner read" on public.playlists for select to authenticated using(auth.uid()=user_id or is_public=true);
drop policy if exists "playlist owner insert" on public.playlists;
create policy "playlist owner insert" on public.playlists for insert to authenticated with check(auth.uid()=user_id);
drop policy if exists "playlist owner update" on public.playlists;
create policy "playlist owner update" on public.playlists for update to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
drop policy if exists "playlist owner delete" on public.playlists;
create policy "playlist owner delete" on public.playlists for delete to authenticated using(auth.uid()=user_id);
drop policy if exists "playlist songs owner" on public.playlist_songs;
create policy "playlist songs owner" on public.playlist_songs for all to authenticated using(exists(select 1 from public.playlists p where p.id=playlist_id and p.user_id=auth.uid())) with check(exists(select 1 from public.playlists p where p.id=playlist_id and p.user_id=auth.uid()));
drop policy if exists "favorites own all" on public.favorites;
create policy "favorites own all" on public.favorites for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
drop policy if exists "history own all" on public.play_history;
create policy "history own all" on public.play_history for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
-- site_settings and audit logs intentionally have no client policies. Server service role only.
-- Bootstrap first Super Admin manually after signup, from trusted SQL editor:
-- update public.profiles set role='super_admin' where id=(select id from auth.users where email='YOUR_VERIFIED_ADMIN_EMAIL');
-- Do not expose service role key in browser or commit .env files.
