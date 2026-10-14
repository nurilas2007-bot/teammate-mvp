-- =====================================================================
-- Шаг 1. Таблицы базы данных для этапа A (прототип-тест).
-- Как запустить: Supabase → SQL Editor → New query → вставить весь файл → Run.
-- Файл можно запускать повторно: он ничего не сломает.
--
-- Принципы:
--  * Храним минимум: без имён, почты и телефонов тестеров.
--    Тестер опознаётся только случайным ID устройства (session_id).
--  * Сайт может только ДОБАВЛЯТЬ строки. Читать, менять и удалять чужие
--    данные с сайта нельзя (это обеспечивает RLS — Row Level Security).
--  * Профиль и проект не редактируются: при изменении добавляется новая
--    версия, для анализа берём последнюю по created_at.
-- =====================================================================


-- ---------- 1. Профили тестеров ----------
create table if not exists public.profiles (
  id              bigint generated always as identity primary key,
  session_id      uuid        not null,
  created_at      timestamptz not null default now(),
  consent_at      timestamptz not null,                 -- когда дано согласие
  year            smallint    check (year between 1 and 4),
  major           text        check (char_length(major) <= 80),
  skills          text[]      not null default '{}' check (cardinality(skills) <= 20),
  task_examples   jsonb       not null default '[]'::jsonb
                              check (jsonb_typeof(task_examples) = 'array'
                                     and jsonb_array_length(task_examples) <= 3
                                     and octet_length(task_examples::text) < 3000),
  preferred_roles text[]      not null default '{}' check (cardinality(preferred_roles) <= 10),
  work_rhythm     text        check (work_rhythm in ('gradually', 'near_deadline', 'mixed')),
  comm_pref       text        check (comm_pref in ('messages', 'calls', 'both')),
  shares_drafts   boolean,
  goal            text        check (goal in ('max_grade', 'solid_pass', 'learn_skill')),
  hours_per_week  smallint    check (hours_per_week between 0 and 60),
  available_until date
);


-- ---------- 2. Проекты, которые описывают тестеры ----------
create table if not exists public.projects (
  id                 bigint generated always as identity primary key,
  session_id         uuid        not null,
  created_at         timestamptz not null default now(),
  title              text        check (char_length(title) <= 120),
  course             text        check (char_length(course) <= 120),
  description        text        check (char_length(description) <= 1000),
  needed_skills      text[]      not null default '{}' check (cardinality(needed_skills) <= 20),
  needed_roles       text[]      not null default '{}' check (cardinality(needed_roles) <= 10),
  team_size          smallint    check (team_size between 2 and 15),
  deadline           date,
  desired_rhythm     text        check (desired_rhythm in ('gradually', 'near_deadline', 'mixed')),
  desired_goal       text        check (desired_goal in ('max_grade', 'solid_pass', 'learn_skill')),
  min_hours_per_week smallint    check (min_hours_per_week between 0 and 60)
);


-- ---------- 3. События для метрик ----------
create table if not exists public.events (
  id           bigint generated always as identity primary key,
  session_id   uuid        not null,
  created_at   timestamptz not null default now(),
  type         text        not null check (type in (
                 'connection_test',     -- проверка связи (шаг 1)
                 'session_started',     -- открыл сайт
                 'consent_given',       -- дал согласие
                 'profile_created',     -- сохранил профиль
                 'project_created',     -- описал проект
                 'recs_viewed',         -- увидел рекомендации
                 'candidate_opened',    -- открыл карточку кандидата
                 'how_scoring_viewed',  -- открыл «Как считается подбор»
                 'checklist_viewed',    -- увидел чек-лист
                 'contact_clicked',     -- нажал «Написать»
                 'choice_explained'     -- объяснил выбор и что неизвестно
               )),
  candidate_id text        check (char_length(candidate_id) <= 20),
  payload      jsonb       not null default '{}'::jsonb
                           check (octet_length(payload::text) < 4000)
);


-- Индексы ускоряют поиск строк одного тестера (нужно для удаления данных)
create index if not exists profiles_session_idx on public.profiles (session_id);
create index if not exists projects_session_idx on public.projects (session_id);
create index if not exists events_session_idx   on public.events   (session_id);


-- ---------- 4. Защита: только добавление ----------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.events   enable row level security;

drop policy if exists "site can insert" on public.profiles;
drop policy if exists "site can insert" on public.projects;
drop policy if exists "site can insert" on public.events;

create policy "site can insert" on public.profiles for insert to anon with check (true);
create policy "site can insert" on public.projects for insert to anon with check (true);
create policy "site can insert" on public.events   for insert to anon with check (true);
-- Явно разрешаем сайту (роль anon) только добавление строк.
grant usage on schema public to anon;
grant insert on public.profiles, public.projects, public.events to anon;
-- Политик на чтение, изменение и удаление нет — значит, с сайта это запрещено.
-- Вы (команда) видите всё в Supabase → Table Editor.


-- ---------- 5. Кнопка «удалить мои данные» ----------
-- Удаляет все строки одного тестера. Знать его session_id может только
-- его собственное устройство, поэтому удалить чужие данные нельзя.
create or replace function public.delete_my_data(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.events   where session_id = p_session_id;
  delete from public.projects where session_id = p_session_id;
  delete from public.profiles where session_id = p_session_id;
end;
$$;

revoke all on function public.delete_my_data(uuid) from public;
grant execute on function public.delete_my_data(uuid) to anon;
