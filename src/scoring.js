// =====================================================================
// scoring.js — подбор кандидатов. Здесь нет ни экранов, ни базы:
// на вход — кандидаты, проект и профиль тестера, на выход — список
// с баллами и объяснениями. Поэтому эту часть легко проверить отдельно
// (см. tests/scoring-test.html).
//
// Как считается совпадение (всего 100 баллов):
//   Навыки  40 — доля нужных проекту навыков, которые есть у кандидата
//   Роль    15 — хотя бы одна нужная роль среди его любимых ролей
//   Время   20 — хватает ли часов в неделю; 0, если свободен меньше, чем до дедлайна
//   Ритм    10 — совпадает с ритмом проекта (5, если у кого-то «по-разному»)
//   Цель    10 — та же цель
//   Связь    5 — удобный формат общения совпадает с твоим
//
// Кого не показываем вообще:
//   — тех, кто не ищет команду;
//   — тех, у кого нет ни одного нужного навыка (решение от 15.10).
// =====================================================================

const SCORE_WEIGHTS = { skills: 40, roles: 15, time: 20, rhythm: 10, goal: 10, comm: 5 };
const TOP_N = 5;

const RHYTHM_SHORT = { gradually: "работает заранее", near_deadline: "ближе к дедлайну", mixed: "ритм по-разному" };
const RHYTHM_LONG = { gradually: "Делает свою часть понемногу, начиная заранее", near_deadline: "Делает свою часть ближе к дедлайну", mixed: "Ритм работы по-разному" };
const GOAL_LABEL = { max_grade: "максимальная оценка", solid_pass: "уверенно сдать", learn_skill: "научиться новому" };
const COMM_LABEL = { messages: "сообщения", calls: "созвоны", both: "сообщения и созвоны" };

// "2026-12-20" → "20.12"
function shortDate(iso) {
  const parts = iso.split("-");
  return parts[2] + "." + parts[1];
}

// Посчитать совпадение одного кандидата с проектом
function scoreCandidate(c, project, tester) {
  const W = SCORE_WEIGHTS;
  const matchedSkills = project.needed_skills.filter(s => c.skills.includes(s));
  const missingSkills = project.needed_skills.filter(s => !c.skills.includes(s));
  const matchedRoles = project.needed_roles.filter(r => c.preferred_roles.includes(r));
  const busyBeforeDeadline = c.available_until < project.deadline;
  const enoughHours = c.hours_per_week >= project.min_hours_per_week;

  const parts = {
    skills: W.skills * matchedSkills.length / project.needed_skills.length,
    roles: matchedRoles.length > 0 ? W.roles : 0,
    time: busyBeforeDeadline ? 0 : (enoughHours ? W.time : W.time * c.hours_per_week / project.min_hours_per_week),
    rhythm: c.work_rhythm === project.desired_rhythm ? W.rhythm
      : (c.work_rhythm === "mixed" || project.desired_rhythm === "mixed" ? W.rhythm / 2 : 0),
    goal: c.goal === project.desired_goal ? W.goal : 0,
    comm: (c.comm_pref === tester.comm_pref || c.comm_pref === "both" || tester.comm_pref === "both") ? W.comm : 0
  };
  for (const key in parts) parts[key] = Math.round(parts[key]);
  const total = Object.values(parts).reduce((a, b) => a + b, 0);

  // Короткие теги для карточки: hits — совпало, misses — расходится
  const hits = [];
  const misses = [];
  for (const s of matchedSkills) hits.push(s);
  if (matchedRoles.length) hits.push("роль: " + matchedRoles.join(", ").toLowerCase());
  if (busyBeforeDeadline) misses.push("свободен(на) только до " + shortDate(c.available_until));
  else if (!enoughHours) misses.push(c.hours_per_week + " ч/нед из " + project.min_hours_per_week);
  else hits.push(c.hours_per_week + " ч/нед до " + shortDate(c.available_until));
  if (parts.rhythm === W.rhythm) hits.push(RHYTHM_SHORT[c.work_rhythm] + ", как ты");
  else if (parts.rhythm === 0) misses.push(RHYTHM_SHORT[c.work_rhythm]);
  if (parts.goal) hits.push("цель та же");
  else misses.push("цель: " + GOAL_LABEL[c.goal]);
  if (!parts.comm) misses.push("предпочитает " + COMM_LABEL[c.comm_pref]);

  // Что о человеке неизвестно. Первые пункты зависят от профиля, последние — всегда.
  const unknowns = [];
  const shortUnknowns = [];   // то же коротко — для карточки в списке
  if (missingSkills.length) {
    const names = missingSkills.map(s => "«" + s + "»").join(", ");
    const word = missingSkills.length === 1 ? "навыка " : "навыков ";
    unknowns.push("Нет " + word + names + " — для этого нужен кто-то ещё");
    shortUnknowns.push("нет " + word + names);
  }
  if (c.task_examples.length === 0) {
    unknowns.push("Нет примеров выполненных задач — непонятно, что человек уже делал");
    shortUnknowns.push("нет примеров задач");
  }
  unknowns.push("Всё в профиле человек написал о себе сам, это не проверено");
  unknowns.push("Как принимает замечания и предупредит ли, если не успевает, профиль не покажет. Обсудите в первом разговоре");

  return {
    candidate: c,
    total: total,
    parts: parts,
    matchedSkills: matchedSkills,
    missingSkills: missingSkills,
    hits: hits,
    misses: misses,
    unknowns: unknowns,
    shortUnknowns: shortUnknowns
  };
}

// Число от 0 до 1, которое зависит только от текста.
// Нужно, чтобы при равных баллах порядок был «случайным», но одинаковым
// для одного тестера при каждом открытии.
function stableRandom(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

// Главная функция: отфильтровать, посчитать, отсортировать, взять первых TOP_N
function recommend(candidates, project, tester, seed) {
  return candidates
    .filter(c => c.looking_for_team)
    .filter(c => project.needed_skills.some(s => c.skills.includes(s)))
    .map(c => scoreCandidate(c, project, tester))
    .sort((a, b) => (b.total - a.total) ||
      (stableRandom(seed + a.candidate.id) - stableRandom(seed + b.candidate.id)))
    .slice(0, TOP_N);
}
