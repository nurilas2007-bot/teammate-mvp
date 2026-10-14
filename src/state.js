// =====================================================================
// state.js — что сайт помнит на этом устройстве.
//
// Мы храним в браузере (localStorage) небольшой объект:
//   sessionId  — случайный номер устройства (вместо имени и почты)
//   consentAt  — когда дано согласие
//   profile    — заполненный профиль (нужен потом для подбора кандидатов,
//                потому что читать базу с сайта запрещено)
//   profileSavedAt — когда профиль сохранён в базу
//
// Если браузер не даёт пользоваться localStorage (например, режим
// инкогнито на некоторых телефонах), всё работает «в памяти» до закрытия
// вкладки — сайт не ломается.
// =====================================================================

const STATE_KEY = "teammate_mvp_state_v1";

// Случайный ID формата UUID — такой ждёт база (тип uuid)
function newSessionId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  // Запасной вариант для старых браузеров
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}

function readState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function writeState(state) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (e) {
    // localStorage недоступен — продолжаем работать в памяти
  }
}

// Текущее состояние. Если ID ещё нет — создаём.
const appState = readState();
if (!appState.sessionId) {
  appState.sessionId = newSessionId();
  writeState(appState);
}

// Изменить часть состояния и сразу сохранить
function updateState(changes) {
  Object.assign(appState, changes);
  writeState(appState);
}

// Забыть всё (после удаления данных) и выдать новый ID
function resetState() {
  for (const key of Object.keys(appState)) delete appState[key];
  appState.sessionId = newSessionId();
  writeState(appState);
}
