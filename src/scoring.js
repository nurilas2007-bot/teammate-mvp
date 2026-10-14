// =====================================================================
// scoring.js — подбор кандидатов. Здесь нет ни экранов, ни базы:
// на вход — кандидаты, проект и профиль тестера, на выход — список
// с баллами и объяснениями. Поэтому эту часть легко проверить отдельно
// (см. tests/scoring-test.html).
//
// Как считается совпадение (всего 100 баллов):
//   Навыки     30 — доля нужных проекту навыков, которые есть у кандидата
//   Опыт (ИИ)  20 — делал ли кандидат похожую работу: ИИ читает его
//                   примеры задач и сравнивает с описанием проекта
//                   (20 — очень похоже, 10 — частично, 0 — не похоже)
//   Время      20 — хватает ли часов в неделю; 0, если свободен меньше, чем до дедлайна
//   Роль       10 — хотя бы одна нужная роль среди его любимых ролей
//   Ритм       10 — совпадает с ритмом проекта (5, если у кого-то «по-разному»)
//   Цель        5 — та же цель
//   Связь       5 — удобный формат общения совпадает с твоим
//
// Если ИИ недоступен, «Опыт» не считается, а остальные 80 баллов
// пересчитываются на 100 — чтобы подбор работал и без ИИ.
//
// Кого не показываем вообще:
//   — тех, кто не ищет команду;
//   — тех, у кого нет ни одного нужного навыка (решение от 15.10).
// =====================================================================

const SCORE_WEIGHTS = { skills: 30, experience: 20, time: 20, roles: 10, rhythm: 10, goal: 5, comm: 5 };
const EXPERIENCE_POINTS = [0, 10, 20];   // уровень ИИ 0, 1, 2 → баллы
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

// Посчитать совпадение одного кандидата с проектом.
// ai — ответы ИИ по кандидатам { c01: {level, quote, reason}, … } или null, если ИИ недоступен.
function scoreCandidate(c, project, tester, ai) {
  const W = SCORE_WEIGHTS;
  const matchedSkills = project.needed_skills.filter(s => c.skills.includes(s));
  const missingSkills = project.needed_skills.filter(s => !c.skills.includes(s));
  const matchedRoles = project.needed_roles.filter(r => c.preferred_roles.includes(r));
  const busyBeforeDeadline = c.available_until < project.deadline;
  const enoughHours = c.hours_per_week >= project.min_hours_per_week;

  const aiResult = ai ? (ai[c.id] || { level: 0, quote: "", reason: "" }) : null;

  const parts = {
    skills: W.skills * matchedSkills.length / project.needed_skills.length,
    experience: aiResult ? EXPERIENCE_POINTS[aiResult.level] : null,
    roles: matchedRoles.length > 0 ? W.roles : 0,
    time: busyBeforeDeadline ? 0 : (enoughHours ? W.time : W.time * c.hours_per_week / project.min_hours_per_week),
    rhythm: c.work_rhythm === project.desired_rhythm ? W.rhythm
      : (c.work_rhythm === "mixed" || project.desired_rhythm === "mixed" ? W.rhythm / 2 : 0),
    goal: c.goal === project.desired_goal ? W.goal : 0,
    comm: (c.comm_pref === tester.comm_pref || c.comm_pref === "both" || tester.comm_pref === "both") ? W.comm : 0
  };
  for (const key in parts) if (parts[key] !== null) parts[key] = Math.round(parts[key]);
  const sum = Object.values(parts).reduce((a, b) => a + (b || 0), 0);
  // Без ИИ максимум 80 — пересчитываем на 100
  const total = aiResult ? sum : Math.round(sum * 100 / (100 - W.experience));

  // Короткие теги для карточки: hits — совпало, misses — расходится
  const hits = [];
  const misses = [];
  if (aiResult && aiResult.level === 2) hits.push("ИИ: делал(а) очень похожее");
  if (aiResult && aiResult.level === 1) hits.push("ИИ: делал(а) похожее");
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
  if (aiResult && aiResult.level === 0 && c.task_examples.length) misses.push("ИИ: похожего опыта нет");

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
  if (!aiResult) unknowns.push("ИИ сейчас недоступен — опыт по примерам задач не оценён");
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
    shortUnknowns: shortUnknowns,
    ai: aiResult   // null — ИИ не отвечал
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

// Кто вообще может попасть в подборку: ищет команду и умеет хоть что-то из нужного.
// Только их примеры отправляем ИИ.
function eligible(candidates, project) {
  return candidates
    .filter(c => c.looking_for_team)
    .filter(c => project.needed_skills.some(s => c.skills.includes(s)));
}

// Все подходящие кандидаты, от лучшего совпадения к худшему
function rankAll(candidates, project, tester, seed, ai) {
  return eligible(candidates, project)
    .map(c => scoreCandidate(c, project, tester, ai || null))
    .sort((a, b) => (b.total - a.total) ||
      (stableRandom(seed + a.candidate.id) - stableRandom(seed + b.candidate.id)));
}

// Главная функция: отфильтровать, посчитать, отсортировать, взять первых TOP_N
function recommend(candidates, project, tester, seed, ai) {
  return rankAll(candidates, project, tester, seed, ai).slice(0, TOP_N);
}

// =====================================================================
// Подбор КОМАНДЫ («Собери мне команду»).
// Состав выбирает этот код, а не ИИ — так ИИ не может выдумать участника.
// ИИ потом только объясняет, почему команда сработает (см. app.js).
//
// Как выбираем: по одному человеку за раз берём того, кто добавит
// больше всего ещё не закрытых нужных навыков; при равенстве — того,
// кто свободен до дедлайна, потом — с большим баллом совпадения.
// Мест в команде: размер команды минус ты, но не больше 3.
// =====================================================================
function buildTeam(candidates, project, tester, seed, ai) {
  const pool = eligible(candidates, project).map(c => scoreCandidate(c, project, tester, ai || null));
  const slots = Math.max(1, Math.min(3, (project.team_size || 4) - 1));
  const covered = new Set();
  const members = [];

  while (members.length < slots && pool.length) {
    const ranked = pool.map(rec => ({
      rec: rec,
      newSkills: rec.matchedSkills.filter(s => !covered.has(s)),
      available: rec.parts.time > 0 ? 1 : 0
    })).sort((a, b) =>
      (b.newSkills.length - a.newSkills.length) ||
      (b.available - a.available) ||
      (b.rec.total - a.rec.total) ||
      (stableRandom(seed + a.rec.candidate.id) - stableRandom(seed + b.rec.candidate.id)));
    const best = ranked[0];
    members.push({ rec: best.rec, brings: best.newSkills });
    for (const s of best.rec.matchedSkills) covered.add(s);
    pool.splice(pool.indexOf(best.rec), 1);
  }

  // Риски считаем правилами, а не ИИ: это факты из профилей
  const risks = [];
  for (const m of members) {
    const c = m.rec.candidate;
    if (c.available_until < project.deadline) {
      risks.push(c.name + ": свободен(на) только до " + shortDate(c.available_until) + " — раньше дедлайна");
    } else if (c.hours_per_week < project.min_hours_per_week) {
      risks.push(c.name + ": может " + c.hours_per_week + " ч/нед из нужных " + project.min_hours_per_week);
    }
    if (c.work_rhythm === "near_deadline" && project.desired_rhythm === "gradually") {
      risks.push(c.name + ": обычно работает ближе к дедлайну — договоритесь о сроке черновиков");
    }
    if (c.goal !== project.desired_goal) {
      risks.push(c.name + ": другая цель — " + GOAL_LABEL[c.goal]);
    }
  }

  return {
    members: members,
    covered: project.needed_skills.filter(s => covered.has(s)),
    missing: project.needed_skills.filter(s => !covered.has(s)),
    risks: risks
  };
}
