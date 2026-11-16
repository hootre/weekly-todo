-- =========================================================
--  위클리 (Weekly To-Do) — Supabase schema
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 Run.
--  여러 번 실행해도 안전하도록 작성됨.
-- =========================================================

create extension if not exists pgcrypto;
create extension if not exists http with schema extensions;

-- ---------- 멤버 (첫 가입자 = 관리자, 이후 가입자는 승인 필요) ----------
create table if not exists public.members (
  user_id      uuid primary key references auth.users on delete cascade,
  email        text,
  display_name text,
  role         text not null default 'member',   -- owner | member
  approved     boolean not null default false,
  created_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  select not exists (select 1 from public.members) into first_user;
  insert into public.members (user_id, email, display_name, role, approved)
  values (new.id, new.email, split_part(new.email, '@', 1),
          case when first_user then 'owner' else 'member' end, first_user)
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and approved);
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and approved and role = 'owner');
$$;

create or replace function public.set_my_name(p_name text)
returns void language sql security definer set search_path = public as $$
  update public.members set display_name = left(trim(p_name), 30) where user_id = auth.uid();
$$;

-- ---------- 할 일 (작업) ----------
create table if not exists public.tasks (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  project    text,
  status     text,                       -- 기획 | 촬영 | 편집 | 수정대기 | 완료 | null
  ok         boolean not null default false,  -- 오케이(컨펌)
  memo       text,
  due_date   date,                       -- 마감일 / 캘린더 시작일
  end_date   date,                       -- 캘린더 종료일(포함)
  location   text,
  detail     text,                       -- 캘린더 설명
  source     text not null default 'manual',  -- manual | gcal
  ext_id     text unique,                -- gcal:<UID>
  sort       double precision not null default 0,
  archived   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- 요일 배정 ----------
create table if not exists public.plans (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid references public.tasks on delete cascade,
  title      text,                       -- 작업과 연결되지 않은 자유 항목
  goal       text,                       -- 그날 목표 (완료, 완성, 기획…)
  day        date not null,
  done       boolean not null default false,
  sort       double precision not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists plans_day_idx on public.plans (day);
create index if not exists plans_task_idx on public.plans (task_id);

-- ---------- 메모 (주간 메모 / 요일 메모·휴식) ----------
create table if not exists public.notes (
  key        text primary key,           -- week:YYYY-MM-DD | day:YYYY-MM-DD
  content    text,
  rest       boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ---------- 설정 ----------
create table if not exists public.settings (
  key   text primary key,
  value text
);

-- updated_at 자동 갱신
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();
drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();

-- ---------- RLS ----------
alter table public.members  enable row level security;
alter table public.tasks    enable row level security;
alter table public.plans    enable row level security;
alter table public.notes    enable row level security;
alter table public.settings enable row level security;

drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
  using (user_id = auth.uid() or public.is_member());
drop policy if exists members_owner_update on public.members;
create policy members_owner_update on public.members for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
drop policy if exists members_owner_delete on public.members;
create policy members_owner_delete on public.members for delete to authenticated
  using (public.is_owner() and user_id <> auth.uid());

do $$
declare t text;
begin
  foreach t in array array['tasks','plans','notes','settings'] loop
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_member()) with check (public.is_member())', t || '_all', t);
  end loop;
end $$;

-- ---------- 실시간 동기화 ----------
do $$
declare t text;
begin
  foreach t in array array['tasks','plans','notes'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- 구글 캘린더 iCal 가져오기 ----------
create or replace function public.fetch_ics()
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  u text;
  r extensions.http_response;
begin
  if not public.is_member() then
    raise exception '권한이 없어요';
  end if;
  select value into u from public.settings where key = 'ics_url';
  if coalesce(u, '') = '' then
    raise exception '설정에서 구글 캘린더 iCal 주소를 먼저 넣어주세요';
  end if;
  if u !~ '^https://calendar\.google\.com/calendar/ical/' then
    raise exception '구글 캘린더 iCal 주소(https://calendar.google.com/calendar/ical/...)만 사용할 수 있어요';
  end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '20000');
  select * into r from extensions.http_get(u);
  if r.status <> 200 then
    raise exception '캘린더 요청 실패 (HTTP %)', r.status;
  end if;
  return r.content;
end $$;

revoke all on function public.fetch_ics() from public, anon;
grant execute on function public.fetch_ics() to authenticated;
grant execute on function public.set_my_name(text) to authenticated;

-- ---------- 권한 (Data API 노출 설정과 무관하게 동작하도록 명시) ----------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.members, public.tasks, public.plans, public.notes, public.settings to authenticated;
