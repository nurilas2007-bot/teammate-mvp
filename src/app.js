// =====================================================================
// app.js — поведение экранов: переходы, выбор навыков, проверка
// заполнения, сохранение профиля и удаление данных.
//
// Как устроены экраны: все они лежат в index.html, видимый — один.
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
const SCREENS = ["consent", "p1", "p2", "p3", "project", "ready", "data"];

// «Домашний» экран: куда вести человека в зависимости от того, что он уже заполнил
function homeScreen() {
  if (!appState.profileSavedAt) return "p1";
  if (!appState.projectSavedAt) return "project";
  return "ready";
}

// Куда пускать, если человек открыл неподходящий экран
function allowedScreen(wanted) {
  if (!appState.consentAt) return "consent";                         // без согласия — только согласие
  if (wanted === "consent") return homeScreen();
  if (wanted === "project" && !appState.profileSavedAt) return "p1";  // проект — только после профиля
  if (wanted === "ready" && !appState.projectSavedAt) return homeScreen();
  if (SCREENS.includes(wanted)) return wanted;
  return homeScreen();                                               // пустой или неизвестный адрес
}

function showScreen() {
  const wanted = location.hash.replace("#", "");
  const screen = allowedScreen(wanted);
  if (screen !== wanted) {
    history.replaceState(null, "", "#" + screen);
  }
  for (const id of SCREENS) $(id).hidden = (id !== screen);
  window.scrollTo(0, 0);

  if (screen === "p1" && !profileStartedAt) profileStartedAt = Date.now();
  if (screen === "project") {
    if (!projectStartedAt) projectStartedAt = Date.now();
    renderProjectHint();
  }
  if (screen === "ready") $("ready-title").textContent = "Готово! Проект «" + appState.project.title + "» сохранён";
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
    goTo("ready");
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

$("edit-project").addEventListener("click", () => goTo("project"));

// ---------------------------------------------------------------------
// 8. Мои данные и удаление
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
// 9. Запуск
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
