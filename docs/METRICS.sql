-- =====================================================================
-- METRICS.sql — подсчёт метрик этапа A.
--
-- Как запускать: Supabase → SQL Editor → New query → вставить ОДИН
-- запрос (от строки «with» до точки с запятой) → Run.
-- Результат можно скачать: кнопка «Download CSV» / «Export» над таблицей.
--
-- В каждом запросе в начале есть блок params:
--   test_start / test_end — окно теста. Всё вне окна (проверки команды)
--                           не считается. Поменяй даты перед подсчётом!
--   excluded              — ID устройств, которые не считать (например,
--                           телефоны команды). Найти их поможет запрос 0.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Запрос 0. Все устройства в окне теста: когда начали, сколько действий.
-- Помогает найти и исключить телефоны команды.
-- ---------------------------------------------------------------------
with params as (
  select timestamptz '2026-11-23 00:00+05' as test_start,
         timestamptz '2026-11-30 23:59+05' as test_end,
         array[]::uuid[]                   as excluded
)
select e.session_id,
       min(e.created_at) as first_action,
       max(e.created_at) as last_action,
       count(*)          as actions,
       string_agg(distinct e.type, ', ') as action_types
from public.events e, params p
where e.created_at between p.test_start and p.test_end
  and e.type <> 'connection_test'
group by e.session_id
order by first_action;


-- ---------------------------------------------------------------------
-- Запрос 1. Воронка: сколько тестеров дошли до каждого шага.
-- «% от увидевших подбор» — доля от тех, кто открыл рекомендации.
-- ---------------------------------------------------------------------
with params as (
  select timestamptz '2026-11-23 00:00+05' as test_start,
         timestamptz '2026-11-30 23:59+05' as test_end,
         array[]::uuid[]                   as excluded
),
ev as (
  select e.* from public.events e, params p
  where e.created_at between p.test_start and p.test_end
    and not (e.session_id = any(p.excluded))
),
steps(n, type, step) as (
  values (1, 'consent_given',      'Дал(а) согласие'),
         (2, 'profile_created',    'Заполнил(а) профиль'),
         (3, 'project_created',    'Описал(а) проект'),
         (4, 'recs_viewed',        'Увидел(а) подбор'),
         (5, 'candidate_opened',   'Открыл(а) карточку кандидата'),
         (6, 'checklist_viewed',   'Открыл(а) чек-лист'),
         (7, 'contact_clicked',    'Нажал(а) «Написать»'),
         (8, 'choice_explained',   'Ответил(а) на вопросы о выборе')
),
counts as (
  select s.n, s.step,
         count(distinct ev.session_id) filter (
           where ev.type <> 'choice_explained'
              or coalesce((ev.payload->>'skipped')::boolean, false) = false
         ) as testers
  from steps s
  left join ev on ev.type = s.type
  group by s.n, s.step
)
select step as "Шаг",
       testers as "Тестеров",
       case when n >= 4 and (select testers from counts where n = 4) > 0
            then round(100.0 * testers / (select testers from counts where n = 4)) || '%'
       end as "% от увидевших подбор"
from counts
order by n;


-- ---------------------------------------------------------------------
-- Запрос 2. Один тестер — одна строка: время заполнения, сколько
-- кандидатов открыл, кому «написал», раскрывал ли «Как считается подбор».
-- «Минут до первого контакта» — это наше «время до первого результата»:
-- от сохранения профиля до первого нажатия «Написать».
-- ---------------------------------------------------------------------
with params as (
  select timestamptz '2026-11-23 00:00+05' as test_start,
         timestamptz '2026-11-30 23:59+05' as test_end,
         array[]::uuid[]                   as excluded
),
ev as (
  select e.* from public.events e, params p
  where e.created_at between p.test_start and p.test_end
    and not (e.session_id = any(p.excluded))
)
select left(session_id::text, 8) as "Тестер",
       max((payload->>'fill_seconds')::int) filter (where type = 'profile_created' and payload->>'version' = '1')
         as "Профиль, сек",
       max((payload->>'fill_seconds')::int) filter (where type = 'project_created' and payload->>'version' = '1')
         as "Проект, сек",
       round(extract(epoch from (
         min(created_at) filter (where type = 'contact_clicked')
         - min(created_at) filter (where type = 'profile_created')
       )) / 60.0, 1) as "Минут до первого контакта",
       count(distinct candidate_id) filter (where type = 'candidate_opened') as "Открыл карточек",
       string_agg(distinct candidate_id, ', ') filter (where type = 'contact_clicked') as "Кому «написал»",
       max((payload->>'checked_items')::int) filter (where type = 'contact_clicked') as "Макс. отметок в чек-листе",
       bool_or(type = 'how_scoring_viewed') as "Смотрел «Как считается»",
       count(*) filter (where type = 'choice_explained' and payload->>'skipped' = 'false') as "Ответов о выборе"
from ev
group by session_id
having bool_or(type = 'consent_given')
order by min(created_at);


-- ---------------------------------------------------------------------
-- Запрос 3. Ответы на вопросы о выборе — для ручной оценки.
-- Скачай как CSV, открой в Google Таблицах и заполни две последние
-- колонки «да» / «нет» вдвоём, независимо друг от друга, потом сверьтесь:
--   «Объяснил через профиль» — да, если причина опирается на данные
--      профиля (навыки, примеры задач, время, ритм, цель), а не «просто понравился».
--   «Назвал недостающее» — да, если назвал конкретную информацию,
--      которой не хватило.
-- ---------------------------------------------------------------------
with params as (
  select timestamptz '2026-11-23 00:00+05' as test_start,
         timestamptz '2026-11-30 23:59+05' as test_end,
         array[]::uuid[]                   as excluded
)
select left(e.session_id::text, 8)        as "Тестер",
       e.created_at                       as "Когда",
       e.candidate_id                     as "Кандидат",
       (e.payload->>'position')::int      as "Место в списке",
       (e.payload->>'score')::int         as "Балл",
       e.payload->>'why'                  as "Почему выбрал(а)",
       e.payload->>'missing'              as "Чего не хватило",
       ''                                 as "Объяснил через профиль (да/нет)",
       ''                                 as "Назвал недостающее (да/нет)"
from public.events e, params p
where e.type = 'choice_explained'
  and e.payload->>'skipped' = 'false'
  and e.created_at between p.test_start and p.test_end
  and not (e.session_id = any(p.excluded))
order by e.session_id, e.created_at;


-- ---------------------------------------------------------------------
-- Запрос 4. Кандидаты: кого открывали и кому «писали», на каком месте
-- в списке они стояли и какой опыт у них нашёл ИИ. Если «пишут» только
-- первому — возможно, люди просто доверяют порядку, а не читают профиль.
-- ---------------------------------------------------------------------
with params as (
  select timestamptz '2026-11-23 00:00+05' as test_start,
         timestamptz '2026-11-30 23:59+05' as test_end,
         array[]::uuid[]                   as excluded
),
ev as (
  select e.* from public.events e, params p
  where e.created_at between p.test_start and p.test_end
    and not (e.session_id = any(p.excluded))
    and e.candidate_id is not null
)
select candidate_id as "Кандидат",
       count(distinct session_id) filter (where type = 'candidate_opened') as "Открыли (тестеров)",
       count(distinct session_id) filter (where type = 'contact_clicked')  as "«Написали» (тестеров)",
       round(avg((payload->>'position')::numeric) filter (where type = 'candidate_opened'), 1) as "Среднее место в списке",
       round(avg((payload->>'score')::numeric) filter (where type = 'candidate_opened'))       as "Средний балл",
       round(avg((payload->>'ai_level')::numeric) filter (where type = 'contact_clicked'), 1)  as "Опыт по ИИ у выбранных (0–2)"
from ev
group by candidate_id
order by "«Написали» (тестеров)" desc, "Открыли (тестеров)" desc;


-- ---------------------------------------------------------------------
-- Запрос 5. Как работал ИИ: сколько раз ответил, сколько не ответил,
-- среднее время ответа. Нужно для отчёта и для декларации об ИИ.
-- ---------------------------------------------------------------------
with params as (
  select timestamptz '2026-11-23 00:00+05' as test_start,
         timestamptz '2026-11-30 23:59+05' as test_end,
         array[]::uuid[]                   as excluded
)
select count(*) filter (where (e.payload->'ai'->>'ok')::boolean)                         as "ИИ ответил",
       count(*) filter (where (e.payload->'ai'->>'ok')::boolean = false)                 as "ИИ не ответил",
       round(avg((e.payload->'ai'->>'ms')::numeric) filter (where (e.payload->'ai'->>'ok')::boolean
             and e.payload->'ai'->>'ms' is not null) / 1000, 1)                          as "Среднее время ответа, сек",
       string_agg(distinct e.payload->'ai'->>'error', ' | ')                            as "Ошибки"
from public.events e, params p
where e.type = 'recs_viewed'
  and e.created_at between p.test_start and p.test_end
  and not (e.session_id = any(p.excluded));


-- ---------------------------------------------------------------------
-- Запрос 6. «Собери мне команду»: сколько тестеров нажали, сколько
-- навыков в среднем закрыла команда, ответил ли ИИ.
-- ---------------------------------------------------------------------
with params as (
  select timestamptz '2026-11-23 00:00+05' as test_start,
         timestamptz '2026-11-30 23:59+05' as test_end,
         array[]::uuid[]                   as excluded
)
select count(distinct e.session_id)                                                         as "Тестеров собрали команду",
       round(avg((e.payload->>'covered')::numeric / nullif((e.payload->>'needed')::numeric, 0)) * 100) || '%'
                                                                                           as "Закрыто навыков в среднем",
       count(*) filter (where (e.payload->'ai'->>'ok')::boolean)                            as "ИИ объяснил",
       count(*) filter (where (e.payload->'ai'->>'ok')::boolean = false)                    as "Без ИИ (запасной режим)"
from public.events e, params p
where e.type = 'team_built'
  and e.created_at between p.test_start and p.test_end
  and not (e.session_id = any(p.excluded));
