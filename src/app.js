// =====================================================================
// app.js — поведение экранов: переходы, выбор навыков, проверка
// заполнения, сохранение профиля и удаление данных.
//
// Как устроены экраны: все они (и главная тоже) лежат в index.html, видимый — один.
// Какой показывать, решает адрес после «#»: ...github.io/teammate-mvp/#p2
// Поэтому кнопка «Назад» на телефоне тоже работает.
// =====================================================================

const MAX_SKILLS = 5;
const MAX_EXAMPLES = 3;
const MIN_HOURS = 1;
const MAX_HOURS = 40;

// Короткая запись для поиска элемента по id
const $ = (id) => document.getElementById(id);

// Когда тестер открыл первый экран профиля и экран проекта —
// чтобы посчитать время заполнения
let profileStartedAt = null;
let projectStartedAt = null;

// ---------------------------------------------------------------------
// 1. Переходы между экранами
// ---------------------------------------------------------------------
const SCREENS = ["home", "consent", "p1", "p2", "p3", "project", "recs", "candidate", "talk", "data"];

// «Домашний» экран: куда вести человека в зависимости от того, что он уже заполнил
function homeScreen() {
  if (!appState.profileSavedAt) return "p1";
  if (!appState.projectSavedAt) return "project";
  return "recs";
}

// Куда пускать, если человек открыл неподходящий экран
function allowedScreen(wanted) {
  if (wanted === "home") return "home";                              // главная открыта всем
  if (!appState.consentAt) return wanted === "consent" ? "consent" : "home";  // без согласия — главная или согласие
  if (wanted === "consent") return homeScreen();
  if (wanted === "project" && !appState.profileSavedAt) return "p1";  // проект — только после профиля
  if (["recs", "candidate", "talk"].includes(wanted) && !appState.projectSavedAt) return homeScreen();
  if (SCREENS.includes(wanted)) return wanted;
  return homeScreen();                                               // пустой или неизвестный адрес
}

function showScreen() {
  // Адрес вида #candidate/c01: экран «candidate», параметр «c01»
  const [wanted, param] = location.hash.replace("#", "").split("/");
  const screen = allowedScreen(wanted);
  if (screen !== wanted) {
    history.replaceState(null, "", "#" + screen);
  }
  for (const id of SCREENS) $(id).hidden = (id !== screen);
  window.scrollTo(0, 0);

  if (screen === "home") renderHome();
  if (screen === "p1" && !profileStartedAt) profileStartedAt = Date.now();
  if (screen === "project") {
    if (!projectStartedAt) projectStartedAt = Date.now();
    renderProjectHint();
  }
  if (screen === "recs") renderRecs();
  if (screen === "candidate") renderCandidate(param);
  if (screen === "talk") renderTalk(param);
  if (screen === "data") renderDataScreen();
}

function goTo(screen) {
  location.hash = "#" + screen;   // это вызовет событие hashchange → showScreen
}

// ---------------------------------------------------------------------
// 2. Мелкие помощники
// ---------------------------------------------------------------------
let toastTimer = null;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

function showError(id, text) {
  const el = $(id);
  el.textContent = text;
  el.hidden = !text;
  if (text) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

// Сегодняшняя дата в формате 2026-10-15 по местному времени
function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

// Выбранные кнопки (чипы) внутри контейнера
function pressedValues(containerId) {
  return [...$(containerId).querySelectorAll('[aria-pressed="true"]')].map(b => b.dataset.value);
}

function radioValue(name) {
  const checked = document.querySelector('input[name="' + name + '"]:checked');
  return checked ? checked.value : null;
}

// ---------------------------------------------------------------------
// Главная. Кто уже начал — кнопка ведёт туда, где он остановился.
// ---------------------------------------------------------------------
function renderHome() {
  const started = Boolean(appState.consentAt);
  for (const id of ["home-start", "home-start-2"]) {
    $(id).textContent = started ? "Продолжить" : "Найти тиммейтов";
    $(id).href = started ? "#" + homeScreen() : "#consent";
  }
  $("home-data").hidden = !started;
  if (!$("home-ring").firstChild) $("home-ring").appendChild(ringElement(90, 64));
}

// ---------------------------------------------------------------------
// 3. Экран согласия
// ---------------------------------------------------------------------
$("consent-check").addEventListener("change", (e) => {
  $("consent-start").disabled = !e.target.checked;
});

$("consent-start").addEventListener("click", () => {
  updateState({ consentAt: new Date().toISOString() });
  logEvent("consent_given");
  goTo("p1");
});

// ---------------------------------------------------------------------
// 4. Профиль, экран 1: курс, специальность, навыки, примеры
// ---------------------------------------------------------------------

// Курс: можно выбрать только один
$("year").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg");
  if (!btn) return;
  for (const b of $("year").querySelectorAll(".seg")) b.setAttribute("aria-pressed", String(b === btn));
});

// Создаём кнопки-чипы из списка (SKILLS и ROLES лежат в config.js)
function buildChips(containerId, items, maxSelected) {
  const box = $(containerId);
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.dataset.value = item;
    btn.setAttribute("aria-pressed", "false");
    btn.textContent = item;
    box.appendChild(btn);
  }
  box.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    const isOn = btn.getAttribute("aria-pressed") === "true";
    if (!isOn && maxSelected && pressedValues(containerId).length >= maxSelected) {
      toast("Можно выбрать до " + maxSelected);
      return;
    }
    btn.setAttribute("aria-pressed", String(!isOn));
  });
}
buildChips("skills", SKILLS, MAX_SKILLS);
buildChips("roles", ROLES, null);

// Примеры задач: карточка с двумя полями
let exampleCounter = 0;
function addExample(task, did) {
  exampleCounter++;
  const n = exampleCounter;
  const card = document.createElement("div");
  card.className = "card example";
  card.innerHTML =
    '<div class="example-head"><b>Пример</b>' +
    '<button type="button" class="remove">Удалить</button></div>' +
    '<label class="hint" for="ex-task-' + n + '">Какая была задача</label>' +
    '<input class="field ex-task" id="ex-task-' + n + '" type="text" maxlength="150" placeholder="Например, групповой кейс по маркетингу">' +
    '<label class="hint" for="ex-did-' + n + '">Что сделал(а) лично ты</label>' +
    '<textarea class="field ex-did" id="ex-did-' + n + '" rows="2" maxlength="150" placeholder="Например, свёл(а) ответы опроса в таблицу"></textarea>';
  // Значения вставляем отдельно, а не в HTML выше, — так спецсимволы не сломают разметку
  card.querySelector(".ex-task").value = task || "";
  card.querySelector(".ex-did").value = did || "";
  card.querySelector(".remove").addEventListener("click", () => {
    card.remove();
    updateAddButton();
  });
  $("examples").appendChild(card);
  updateAddButton();
  return card;
}

function updateAddButton() {
  $("add-example").hidden = $("examples").children.length >= MAX_EXAMPLES;
}

$("add-example").addEventListener("click", () => {
  addExample().querySelector(".ex-task").focus();
});

// Собираем примеры. Пустые карточки пропускаем.
// Возвращает null, если пример заполнен наполовину.
function collectExamples() {
  const result = [];
  for (const card of $("examples").children) {
    const task = card.querySelector(".ex-task").value.trim();
    const did = card.querySelector(".ex-did").value.trim();
    if (!task && !did) continue;
    if (!task || !did) return null;
    result.push({ task: task, did: did });
  }
  return result;
}

$("p1-next").addEventListener("click", () => {
  if (pressedValues("year").length === 0) return showError("p1-error", "Выбери курс");
  if (pressedValues("skills").length === 0) return showError("p1-error", "Выбери хотя бы один навык");
  if (collectExamples() === null) return showError("p1-error", "В примере заполни обе строки — или удали его");
  showError("p1-error", "");
  goTo("p2");
});

// ---------------------------------------------------------------------
// 5. Профиль, экран 2: роли и привычки
// ---------------------------------------------------------------------
$("p2-next").addEventListener("click", () => {
  if (pressedValues("roles").length === 0) return showError("p2-error", "Выбери хотя бы одну роль");
  for (const name of ["work_rhythm", "comm_pref", "shares_drafts", "goal"]) {
    if (!radioValue(name)) return showError("p2-error", "Ответь на все вопросы на этом экране");
  }
  showError("p2-error", "");
  goTo("p3");
});

// ---------------------------------------------------------------------
// 6. Профиль, экран 3: время и сохранение
// ---------------------------------------------------------------------
let hours = 5;
function setHours(value) {
  hours = Math.min(MAX_HOURS, Math.max(MIN_HOURS, value));
  $("hours").textContent = hours;
}
$("hours-minus").addEventListener("click", () => setHours(hours - 1));
$("hours-plus").addEventListener("click", () => setHours(hours + 1));

$("until").min = todayISO();

// Собираем всё, что заполнено на трёх экранах, в один объект.
// Названия полей совпадают с колонками таблицы profiles в базе.
function collectProfile() {
  return {
    year: Number(pressedValues("year")[0]),
    major: $("major").value.trim() || null,
    skills: pressedValues("skills"),
    task_examples: collectExamples() || [],
    preferred_roles: pressedValues("roles"),
    work_rhythm: radioValue("work_rhythm"),
    comm_pref: radioValue("comm_pref"),
    shares_drafts: radioValue("shares_drafts") === "true",
    goal: radioValue("goal"),
    hours_per_week: hours,
    available_until: $("until").value
  };
}

$("p3-save").addEventListener("click", async () => {
  const until = $("until").value;
  if (!until) return showError("p3-error", "Укажи, до какого числа ты свободен(на)");
  if (until < todayISO()) return showError("p3-error", "Дата не может быть в прошлом");
  showError("p3-error", "");

  const profile = collectProfile();
  const button = $("p3-save");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Сохраняю…";

  try {
    await dbInsert("profiles", Object.assign({
      session_id: appState.sessionId,
      consent_at: appState.consentAt
    }, profile));

    const version = (appState.profileVersion || 0) + 1;
    updateState({ profile: profile, profileSavedAt: new Date().toISOString(), profileVersion: version });
    logEvent("profile_created", {
      version: version,
      skills_count: profile.skills.length,
      examples_count: profile.task_examples.length,
      fill_seconds: profileStartedAt ? Math.round((Date.now() - profileStartedAt) / 1000) : null
    });
    profileStartedAt = null;
    goTo("project");
  } catch (e) {
    console.error(e);
    showError("p3-error", "Не получилось сохранить. Проверь интернет и нажми ещё раз. (" + e.message + ")");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = "Сохранить профиль";
  }
});

// Если профиль уже есть — заполняем им формы (для «Изменить профиль»)
function fillFormsFromProfile(p) {
  if (!p) return;
  for (const b of $("year").querySelectorAll(".seg")) b.setAttribute("aria-pressed", String(Number(b.dataset.value) === p.year));
  $("major").value = p.major || "";
  for (const b of $("skills").querySelectorAll(".chip")) b.setAttribute("aria-pressed", String(p.skills.includes(b.dataset.value)));
  for (const b of $("roles").querySelectorAll(".chip")) b.setAttribute("aria-pressed", String(p.preferred_roles.includes(b.dataset.value)));
  $("examples").innerHTML = "";
  for (const ex of p.task_examples) addExample(ex.task, ex.did);
  const radios = { work_rhythm: p.work_rhythm, comm_pref: p.comm_pref, shares_drafts: String(p.shares_drafts), goal: p.goal };
  for (const name in radios) {
    const input = document.querySelector('input[name="' + name + '"][value="' + radios[name] + '"]');
    if (input) input.checked = true;
  }
  setHours(p.hours_per_week);
  $("until").value = p.available_until;
}

// ---------------------------------------------------------------------
// 7. Проект: что нужно команде
// ---------------------------------------------------------------------
const SKILLS_VISIBLE = 6;   // сколько навыков видно до «Показать все навыки»

buildChips("pr-skills", SKILLS, MAX_SKILLS);
buildChips("pr-roles", ROLES, null);

// Показываем первые 6 навыков (и все уже выбранные), остальные — по кнопке
function collapseProjectSkills() {
  const chips = $("pr-skills").querySelectorAll(".chip");
  chips.forEach((chip, i) => {
    chip.hidden = i >= SKILLS_VISIBLE && chip.getAttribute("aria-pressed") !== "true";
  });
  $("pr-skills-more").hidden = ![...chips].some(c => c.hidden);
}
$("pr-skills-more").addEventListener("click", () => {
  for (const chip of $("pr-skills").querySelectorAll(".chip")) chip.hidden = false;
  $("pr-skills-more").hidden = true;
});

$("pr-deadline").min = todayISO();

// Подпись внизу экрана: ритм и цель берём из профиля, а не спрашиваем ещё раз
const RHYTHM_TEXT = { gradually: "понемногу, заранее", near_deadline: "ближе к дедлайну", mixed: "по-разному" };
const GOAL_TEXT = { max_grade: "максимальная оценка", solid_pass: "уверенно сдать", learn_skill: "научиться новому" };
function renderProjectHint() {
  const p = appState.profile;
  if (!p) return;
  $("pr-from-profile").textContent = "Ритм работы и цель возьмём из твоего профиля: " +
    RHYTHM_TEXT[p.work_rhythm] + ", " + GOAL_TEXT[p.goal] + ".";
}

// Целое число из поля, или null, если введено не число
function intFromField(id) {
  const value = $(id).value.trim();
  return /^\d+$/.test(value) ? Number(value) : null;
}

// Названия полей совпадают с колонками таблицы projects в базе
function collectProject() {
  return {
    title: $("pr-title").value.trim(),
    course: $("pr-course").value.trim() || null,
    description: $("pr-desc").value.trim() || null,
    needed_skills: pressedValues("pr-skills"),
    needed_roles: pressedValues("pr-roles"),
    team_size: intFromField("pr-size"),
    deadline: $("pr-deadline").value,
    desired_rhythm: appState.profile.work_rhythm,
    desired_goal: appState.profile.goal,
    min_hours_per_week: intFromField("pr-hours")
  };
}

// Проверка. Возвращает текст ошибки или пустую строку, если всё в порядке.
function validateProject(pr) {
  if (!pr.title) return "Напиши название проекта";
  if (!pr.description || pr.description.length < 20) return "Опиши задачу хотя бы одним предложением — по нему ИИ сравнит опыт кандидатов";
  if (pr.needed_skills.length === 0) return "Выбери хотя бы один навык, которого не хватает команде";
  if (pr.needed_roles.length === 0) return "Выбери хотя бы одну роль";
  if (!pr.deadline) return "Укажи дедлайн";
  if (pr.deadline < todayISO()) return "Дедлайн не может быть в прошлом";
  if (pr.min_hours_per_week === null || pr.min_hours_per_week < 1 || pr.min_hours_per_week > 40) return "Часов в неделю: число от 1 до 40";
  if (pr.team_size === null || pr.team_size < 2 || pr.team_size > 15) return "Размер команды: число от 2 до 15";
  return "";
}

$("pr-save").addEventListener("click", async () => {
  const project = collectProject();
  const problem = validateProject(project);
  if (problem) return showError("pr-error", problem);
  showError("pr-error", "");

  const button = $("pr-save");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Сохраняю…";

  try {
    await dbInsert("projects", Object.assign({ session_id: appState.sessionId }, project));

    const version = (appState.projectVersion || 0) + 1;
    updateState({ project: project, projectSavedAt: new Date().toISOString(), projectVersion: version });
    logEvent("project_created", {
      version: version,
      skills_count: project.needed_skills.length,
      roles_count: project.needed_roles.length,
      fill_seconds: projectStartedAt ? Math.round((Date.now() - projectStartedAt) / 1000) : null
    });
    projectStartedAt = null;
    goTo("recs");
  } catch (e) {
    console.error(e);
    showError("pr-error", "Не получилось сохранить. Проверь интернет и нажми ещё раз. (" + e.message + ")");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = "Найти тиммейтов";
  }
});

// Если проект уже есть — заполняем им форму (для «Изменить проект»)
function fillProjectForm(pr) {
  if (pr) {
    $("pr-title").value = pr.title;
    $("pr-course").value = pr.course || "";
    $("pr-desc").value = pr.description || "";
    for (const b of $("pr-skills").querySelectorAll(".chip")) b.setAttribute("aria-pressed", String(pr.needed_skills.includes(b.dataset.value)));
    for (const b of $("pr-roles").querySelectorAll(".chip")) b.setAttribute("aria-pressed", String(pr.needed_roles.includes(b.dataset.value)));
    $("pr-deadline").value = pr.deadline;
    $("pr-hours").value = pr.min_hours_per_week;
    $("pr-size").value = pr.team_size;
  }
  collapseProjectSkills();
}

// ---------------------------------------------------------------------
// 8. Рекомендации и карточка кандидата
// ---------------------------------------------------------------------
const AVATAR_COLORS = ["#FFB3D9", "#9BD8FF", "#D7FF3A", "#FFFFFF", "#FFD59B"];
const PART_LABELS = [
  ["skills", "Навыки"], ["experience", "Опыт (ИИ)"], ["time", "Время"], ["roles", "Роль"],
  ["rhythm", "Ритм работы"], ["goal", "Цель"], ["comm", "Связь"]
];

// Список кандидатов загружаем один раз из data/candidates.json
let candidatesPromise = null;
function loadCandidates() {
  if (!candidatesPromise) {
    candidatesPromise = fetch("data/candidates.json")
      .then(r => {
        if (!r.ok) throw new Error("файл кандидатов не найден (" + r.status + ")");
        return r.json();
      })
      .then(data => data.candidates)
      .catch(e => { candidatesPromise = null; throw e; });
  }
  return candidatesPromise;
}

// Последний посчитанный список: нужен карточке кандидата
let currentRecs = [];
let aiStatus = null;   // как прошёл последний запрос к ИИ: { ok, ms, model, error }

// ---- ИИ: оценка опыта по примерам задач ----
// Серверная функция match-experience в Supabase (supabase/functions/...).
// Ключ ИИ-сервиса хранится там, а не на сайте.
const AI_URL = SUPABASE_URL + "/functions/v1/match-experience";
const AI_TIMEOUT_MS = 25000;
let aiPromise = null;      // запрос, который уже идёт (чтобы не спрашивать ИИ дважды)
let aiPromiseKey = null;

// Цитата ИИ должна дословно стоять в примерах кандидата — вторая проверка, уже на сайте
function quoteIsReal(quote, c) {
  const norm = t => String(t).toLowerCase().replace(/[«»"“”„]/g, "").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  const source = norm(c.task_examples.map(e => e.task + " " + e.did).join(" "));
  return quote.length >= 8 && source.includes(norm(quote));
}

async function askAi(candidates) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const pr = appState.project;
    const response = await fetch(AI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: dbHeaders(),
      body: JSON.stringify({
        project: { title: pr.title, description: pr.description, needed_skills: pr.needed_skills },
        candidates: candidates.map(c => ({ id: c.id, examples: c.task_examples }))
      })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error((data && data.error) || ("код " + response.status));
    // Оборванный или пустой ответ — это ошибка, а не «ни у кого нет опыта»
    if (!data || !Array.isArray(data.results)) throw new Error("неполный ответ ИИ");
    const results = {};
    for (const r of data.results || []) {
      const c = candidates.find(x => x.id === r.id);
      if (!c) continue;
      const real = r.level > 0 && r.verified !== false && quoteIsReal(r.quote || "", c);
      results[r.id] = real
        ? { level: r.level, quote: r.quote, reason: r.reason || "" }
        : { level: 0, quote: "", reason: "" };
    }
    aiStatus = { ok: true, ms: Date.now() - started, model: data.model || null };
    // Запоминаем ответ для этой версии проекта: подбор не будет «прыгать» при повторном открытии
    updateState({ ai: { key: aiPromiseKey, results: results } });
    return results;
  } catch (e) {
    console.warn("ИИ недоступен:", e.message);
    aiStatus = { ok: false, ms: Date.now() - started, error: String(e.message).slice(0, 200) };
    return null;   // подбор посчитается без ИИ
  } finally {
    clearTimeout(timer);
  }
}

function aiResultsFor(candidates) {
  const key = (appState.projectVersion || 0) + ":" + appState.projectSavedAt;
  if (appState.ai && appState.ai.key === key) {
    aiStatus = aiStatus || { ok: true, cached: true };
    return Promise.resolve(appState.ai.results);
  }
  if (aiPromise && aiPromiseKey === key) return aiPromise;
  aiPromiseKey = key;
  aiPromise = askAi(candidates).then(r => { if (r === null) aiPromise = null; return r; });
  return aiPromise;
}

async function computeRecs() {
  const candidates = await loadCandidates();
  const ai = await aiResultsFor(eligible(candidates, appState.project));
  currentRecs = recommend(candidates, appState.project, appState.profile, appState.sessionId, ai);
  return currentRecs;
}

// Создать элемент с классом и текстом. textContent безопасен:
// любой текст показывается как текст, а не как разметка.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Кольцо с баллом: маленькое (64) для списка, большое (96) для карточки
function ringElement(score, size) {
  const big = size > 70;
  const outer = size / 2 - 2;
  const inner = big ? 36 : 23;
  const width = big ? 7 : 5;
  const circle = 2 * Math.PI * inner;
  const c = size / 2;
  const box = el("div", "ring");
  box.style.width = size + "px";
  box.style.height = size + "px";
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", "Совпадение с проектом " + score + " из 100");
  box.innerHTML =
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' +
    '<circle cx="' + c + '" cy="' + c + '" r="' + outer + '" fill="#D7FF3A" stroke="#0E0E10" stroke-width="2"/>' +
    '<circle cx="' + c + '" cy="' + c + '" r="' + inner + '" fill="none" stroke="#0E0E10" stroke-opacity="0.15" stroke-width="' + width + '"/>' +
    '<circle cx="' + c + '" cy="' + c + '" r="' + inner + '" fill="none" stroke="#0E0E10" stroke-width="' + width + '" stroke-linecap="round"' +
    ' stroke-dasharray="' + (circle * score / 100).toFixed(1) + ' ' + circle.toFixed(1) + '" transform="rotate(-90 ' + c + ' ' + c + ')"/>' +
    '</svg><b style="font-size:' + (big ? 24 : 17) + 'px">' + score + (big ? "<small>из 100</small>" : "") + "</b>";
  return box;
}

function subtitle(c) {
  return c.year + " курс" + (c.major ? " · " + c.major : "");
}

function recCard(rec, index) {
  const c = rec.candidate;
  const card = el("article", "card rec");

  const head = el("div", "rec-head");
  const ava = el("div", "ava", c.name.charAt(0));
  ava.style.background = AVATAR_COLORS[index % AVATAR_COLORS.length];
  ava.setAttribute("aria-hidden", "true");
  const who = el("div", "grow");
  who.appendChild(el("h2", "rec-name", c.name));
  who.appendChild(el("div", "hint", subtitle(c)));
  head.append(ava, who, ringElement(rec.total, 64));
  card.appendChild(head);

  const tags = el("div", "tags");
  for (const t of rec.hits) tags.appendChild(el("span", t.startsWith("ИИ:") ? "tag ai" : "tag hit", t));
  for (const t of rec.misses) tags.appendChild(el("span", "tag miss", t));
  card.appendChild(tags);

  // Что нашёл ИИ: дословная цитата из примера кандидата
  if (rec.ai && rec.ai.level > 0) {
    const note = el("div", "ai-note");
    note.append(el("span", "ai-badge", "ИИ"), el("span", "", "«" + rec.ai.quote + "» — " + rec.ai.reason));
    card.appendChild(note);
  }

  if (rec.shortUnknowns.length) {
    card.appendChild(el("div", "unk", "Неизвестно: " + rec.shortUnknowns.join("; ")));
  }

  const go = el("a", "go", "Смотреть профиль");
  go.href = "#candidate/" + c.id;
  card.appendChild(go);
  return card;
}

let recsRun = 0;   // номер последнего запуска: если экран перерисовали ещё раз, старый результат не показываем

async function renderRecs() {
  const run = ++recsRun;
  const list = $("recs-list");
  list.innerHTML = "";
  showError("recs-error", "");
  $("recs-project").textContent = appState.project.title;
  $("recs-ai-off").hidden = true;
  $("recs-empty").hidden = true;
  $("recs-loading").hidden = false;   // «ИИ читает примеры…»
  try {
    const recs = await computeRecs();
    if (run !== recsRun) return;
    list.innerHTML = "";
    $("recs-loading").hidden = true;
    $("recs-ai-off").hidden = !(recs.length && recs[0].ai === null);
    recs.forEach((rec, i) => list.appendChild(recCard(rec, i)));
    $("recs-count").textContent = recs.length + " " + plural(recs.length, "кандидат", "кандидата", "кандидатов");
    $("recs-empty").hidden = recs.length > 0;
    $("recs-legend").hidden = recs.length === 0;
    logEvent("recs_viewed", {
      project_version: appState.projectVersion,
      shown: recs.map(r => ({ id: r.candidate.id, score: r.total, ai_level: r.ai ? r.ai.level : null })),
      ai: aiStatus
    });
  } catch (e) {
    console.error(e);
    if (run !== recsRun) return;
    $("recs-loading").hidden = true;
    showError("recs-error", "Не получилось загрузить кандидатов. Обнови страницу. (" + e.message + ")");
  }
}

// 1 кандидат, 2 кандидата, 5 кандидатов
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// «Как считается подбор»: записываем, что человек раскрыл объяснение
let howLogged = false;
$("how").addEventListener("toggle", () => {
  if ($("how").open && !howLogged) {
    howLogged = true;
    logEvent("how_scoring_viewed");
  }
});

const DRAFTS_TEXT = { true: "показывает черновики", false: "показывает готовое" };

function renderAiBlock(rec) {
  const c = rec.candidate;
  let reason, quote = "";
  if (rec.ai === null) reason = "ИИ сейчас не ответил, поэтому опыт по примерам задач не оценён.";
  else if (c.task_examples.length === 0) reason = "Примеров выполненных задач нет — ИИ нечего сравнивать с твоим проектом.";
  else if (rec.ai.level === 0) reason = "В примерах задач ИИ не нашёл работы, похожей на твой проект.";
  else {
    reason = (rec.ai.level === 2 ? "Делал(а) очень похожую работу. " : "Делал(а) похожую работу. ") + rec.ai.reason;
    quote = "«" + rec.ai.quote + "»";
  }
  $("cand-ai-reason").textContent = reason;
  $("cand-ai-quote").textContent = quote;
}

async function renderCandidate(id) {
  // Если страницу открыли сразу по ссылке на кандидата — сначала считаем список
  if (!currentRecs.length) {
    try { await computeRecs(); } catch (e) { return goTo("recs"); }
  }
  const position = currentRecs.findIndex(r => r.candidate.id === id);
  if (position === -1) return goTo("recs");   // такого кандидата нет в подборке
  const rec = currentRecs[position];
  const c = rec.candidate;

  $("cand-name").textContent = c.name;
  $("cand-sub").textContent = subtitle(c) + " · ищет команду";
  $("cand-ring").replaceChildren(ringElement(rec.total, 96));

  const parts = $("cand-parts");
  parts.innerHTML = "";
  for (const [key, label] of PART_LABELS) {
    const row = el("div", "part");
    const track = el("div", "track");
    const fill = el("div", "fill");
    const value = rec.parts[key];   // null — ИИ не отвечал
    fill.style.width = Math.round(100 * (value || 0) / SCORE_WEIGHTS[key]) + "%";
    track.appendChild(fill);
    row.append(el("span", "", label), track, el("span", "val", (value === null ? "—" : value) + "/" + SCORE_WEIGHTS[key]));
    parts.appendChild(row);
  }

  renderAiBlock(rec);

  const examples = $("cand-examples");
  examples.innerHTML = "";
  if (c.task_examples.length === 0) {
    examples.appendChild(el("p", "hint", "Примеров выполненных задач в профиле нет."));
  }
  for (const ex of c.task_examples) {
    const box = el("div", "ex");
    box.append(el("b", "", ex.task), el("span", "", ex.did));
    examples.appendChild(box);
  }

  const facts = $("cand-facts");
  facts.innerHTML = "";
  for (const s of c.skills) facts.appendChild(el("span", rec.matchedSkills.includes(s) ? "tag hit" : "tag", s));
  for (const t of [
    RHYTHM_SHORT[c.work_rhythm],
    COMM_LABEL[c.comm_pref],
    DRAFTS_TEXT[c.shares_drafts],
    "цель: " + GOAL_LABEL[c.goal],
    "роли: " + c.preferred_roles.join(", ").toLowerCase(),
    c.hours_per_week + " ч/нед до " + shortDate(c.available_until)
  ]) facts.appendChild(el("span", "tag", t));

  const unknowns = $("cand-unknowns");
  unknowns.innerHTML = "";
  for (const u of rec.unknowns) unknowns.appendChild(el("li", "", u));

  $("cand-prepare").href = "#talk/" + c.id;
  logEvent("candidate_opened", { position: position + 1, score: rec.total }, c.id);
}

// ---------------------------------------------------------------------
// 9. Чек-лист и письмо кандидату
// ---------------------------------------------------------------------
let talkRec = null;          // кому пишем сейчас
let talkDefaultBody = "";    // исходный текст письма — чтобы понять, правил ли его тестер

// "2026-12-10" → "10.12.2026"
function fullDate(iso) {
  const p = iso.split("-");
  return p[2] + "." + p[1] + "." + p[0];
}

// Черновик письма из данных проекта и того, что у кандидата совпало
function draftMail(rec) {
  const pr = appState.project;
  const need = rec.matchedSkills.map(s => s.toLowerCase()).join(", ");
  const subject = "Ищу тиммейта: " + pr.title;
  const body =
    "Привет! Нашёл(а) тебя на платформе поиска тиммейтов. " +
    "Делаю проект «" + pr.title + "»" + (pr.course ? " по курсу «" + pr.course + "»" : "") +
    ", дедлайн " + fullDate(pr.deadline) + ". " +
    "Нужен человек, который умеет: " + need + ". " +
    "Есть время коротко списаться или созвониться на этой неделе?";
  return { subject: subject, body: body };
}

// Ссылки, которые открывают готовое письмо.
// mailto: — почтовое приложение телефона (в том числе Outlook).
// outlook.office.com — Outlook в браузере для университетских аккаунтов.
// На этапе A не используются: у демо-кандидатов нет настоящих адресов.
function mailLinks(to, subject, body) {
  const q = "subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  return {
    app: "mailto:" + encodeURIComponent(to) + "?" + q,
    web: "https://outlook.office.com/mail/deeplink/compose?to=" + encodeURIComponent(to) + "&" + q
  };
}

async function renderTalk(id) {
  if (!currentRecs.length) {
    try { await computeRecs(); } catch (e) { return goTo("recs"); }
  }
  const rec = currentRecs.find(r => r.candidate.id === id);
  if (!rec) return goTo("recs");
  const c = rec.candidate;

  // Новый кандидат — чистый чек-лист и свежий черновик письма
  if (!talkRec || talkRec.candidate.id !== id) {
    for (const box of $("checklist").querySelectorAll("input")) box.checked = false;
    const mail = draftMail(rec);
    talkDefaultBody = mail.body;
    $("mail-subject").textContent = mail.subject;
    $("mail-body").value = mail.body;
  }
  talkRec = rec;
  $("talk-name").textContent = c.name;
  $("talk-back").href = "#candidate/" + c.id;
  $("mail-to").textContent = c.contact.value;
  logEvent("checklist_viewed", {}, c.id);
}

async function contactClicked(channel) {
  const c = talkRec.candidate;
  const body = $("mail-body").value.trim();
  await logEvent("contact_clicked", {
    channel: channel,                                                      // "mail_app" или "outlook_web"
    checked_items: $("checklist").querySelectorAll("input:checked").length,
    text_edited: body !== talkDefaultBody,
    is_synthetic: c.is_synthetic === true,
    score: talkRec.total,
    ai_level: talkRec.ai ? talkRec.ai.level : null
  }, c.id);

  if (c.is_synthetic) {
    // Демо-кандидат: письмо не открываем, объясняем почему и задаём два вопроса
    askWhy(talkRec);
    return;
  }
  const links = mailLinks(c.contact.value, $("mail-subject").textContent, body);
  if (channel === "mail_app") location.href = links.app;
  else window.open(links.web, "_blank", "noopener");
}

$("mail-app").addEventListener("click", () => contactClicked("mail_app"));
$("mail-web").addEventListener("click", () => contactClicked("outlook_web"));

// Окно поверх экрана. Старые браузеры без showModal просто покажут его.
function openDialog(d) {
  if (typeof d.showModal === "function") d.showModal();
  else d.setAttribute("open", "");
}
function closeDialog(d) {
  if (typeof d.close === "function") d.close();
  else d.removeAttribute("open");
}
// ---------------------------------------------------------------------
// 10. Два вопроса после выбора — главный замер этапа A:
//     может ли человек объяснить выбор и назвать, чего не хватило
// ---------------------------------------------------------------------
let answerFor = null;   // о каком кандидате спрашиваем; null — уже ответили

function askWhy(rec) {
  const c = rec.candidate;
  answerFor = {
    id: c.id,
    score: rec.total,
    position: currentRecs.findIndex(r => r.candidate.id === c.id) + 1,
    aiLevel: rec.ai ? rec.ai.level : null
  };
  $("demo-text").textContent = c.name + " — демо-профиль, такого человека нет, поэтому письмо не отправится. " +
    "Твой выбор мы засчитали. Ответь на два коротких вопроса — так мы поймём, работает ли подбор.";
  $("why-label").textContent = "Почему именно " + c.name + "?";
  $("why").value = "";
  $("missing").value = "";
  openDialog($("demo-dialog"));
}

function saveAnswer(why, missing, skipped) {
  if (!answerFor) return;           // защита от двойной записи
  const a = answerFor;
  answerFor = null;
  logEvent("choice_explained", {
    skipped: skipped,
    why: why,
    missing: missing,
    score: a.score,
    ai_level: a.aiLevel,
    position: a.position
  }, a.id);
}

$("answer-send").addEventListener("click", () => {
  const why = $("why").value.trim();
  const missing = $("missing").value.trim();
  if (!why && !missing) {
    toast("Напиши хотя бы один ответ или нажми «Пропустить»");
    return;
  }
  saveAnswer(why, missing, false);
  closeDialog($("demo-dialog"));
  toast("Спасибо! Ответ сохранён");
  goTo("recs");
});

$("answer-skip").addEventListener("click", () => {
  saveAnswer("", "", true);
  closeDialog($("demo-dialog"));
});

// Окно закрыли кнопкой «Назад» на телефоне или клавишей Esc — считаем пропуском
$("demo-dialog").addEventListener("close", () => saveAnswer("", "", true));

// ---------------------------------------------------------------------
// 11. Мои данные и удаление
// ---------------------------------------------------------------------
function renderDataScreen() {
  const list = $("data-list");
  list.innerHTML = "";
  const lines = [];
  const p = appState.profile;
  if (p && appState.profileSavedAt) {
    lines.push("Профиль: " + p.year + " курс" + (p.major ? ", " + p.major : "") +
      ", навыков: " + p.skills.length + ", примеров задач: " + p.task_examples.length);
  } else {
    lines.push("Профиля пока нет");
  }
  if (appState.project && appState.projectSavedAt) {
    lines.push("Проект «" + appState.project.title + "»");
  }
  lines.push("Отметка о согласии и твои действия на сайте");
  for (const text of lines) {
    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  }
  $("data-back").href = "#" + homeScreen();
  showError("data-error", "");
}

$("delete-data").addEventListener("click", async () => {
  if (!confirm("Удалить все твои данные? Отменить нельзя.")) return;
  const button = $("delete-data");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    await deleteMyData(appState.sessionId);
    resetState();
    // Перезагружаем страницу, чтобы очистить формы: следующий человек
    // на этом телефоне начнёт с нуля. Флажок нужен, чтобы после
    // перезагрузки показать сообщение «Данные удалены».
    try { sessionStorage.setItem("justDeleted", "1"); } catch (e) {}
    location.hash = "#consent";
    location.reload();
  } catch (e) {
    console.error(e);
    showError("data-error", "Не получилось удалить. Проверь интернет и попробуй ещё раз. (" + e.message + ")");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
});

// ---------------------------------------------------------------------
// 12. Запуск
// ---------------------------------------------------------------------
fillFormsFromProfile(appState.profile);
fillProjectForm(appState.project);
if (appState.consentAt) logEvent("session_started");
window.addEventListener("hashchange", showScreen);
showScreen();
try {
  if (sessionStorage.getItem("justDeleted")) {
    sessionStorage.removeItem("justDeleted");
    toast("Данные удалены");
  }
} catch (e) {}
