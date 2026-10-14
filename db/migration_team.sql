-- =====================================================================
-- Обновление базы для «Собери мне команду» (15.10.2026).
-- Разрешаем новое событие team_built. Запустить один раз:
-- Supabase → SQL Editor → New query → вставить → Run.
-- Повторный запуск ничего не ломает.
-- =====================================================================
alter table public.events drop constraint if exists events_type_check;
alter table public.events add constraint events_type_check check (type in (
  'connection_test', 'session_started', 'consent_given',
  'profile_created', 'project_created', 'recs_viewed',
  'candidate_opened', 'how_scoring_viewed', 'checklist_viewed',
  'contact_clicked', 'choice_explained',
  'team_built'          -- нажал «Собери мне команду»
));
