// =====================================================================
// db.js — всё общение с базой Supabase.
//
// Supabase умеет принимать обычные веб-запросы (это называется REST API),
// поэтому отдельная библиотека не нужна: хватает встроенной функции fetch.
// Адрес базы и ключ берутся из config.js (SUPABASE_URL, SUPABASE_KEY).
//
// Что умеем:
//   dbInsert(table, row)  — добавить строку в таблицу
//   logEvent(type, ...)   — записать событие для метрик (тихо, без ошибок)
//   deleteMyData(id)      — удалить все строки этого устройства
// Читать из базы сайт не может — так настроены правила доступа (RLS).
// =====================================================================

function dbHeaders() {
  return {
    "apikey": SUPABASE_KEY,
    "Authorization": "Bearer " + SUPABASE_KEY,
    "Content-Type": "application/json"
  };
}

// Понятное сообщение об ошибке вместо технического текста
async function dbError(response) {
  let details = "";
  try {
    const body = await response.json();
    details = body.message || body.hint || "";
  } catch (e) { /* ответ не в формате JSON */ }
  const error = new Error("Ошибка базы (" + response.status + ")" + (details ? ": " + details : ""));
  error.status = response.status;
  return error;
}

// Добавить строку. "return=minimal" — база ничего не присылает в ответ
// (присылать ей и нельзя: чтение запрещено).
async function dbInsert(table, row) {
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + table, {
    method: "POST",
    headers: Object.assign(dbHeaders(), { "Prefer": "return=minimal" }),
    body: JSON.stringify(row)
  });
  if (!response.ok) throw await dbError(response);
}

// Событие для метрик. Если запись не удалась (плохая связь),
// тестер ничего не замечает — пишем предупреждение только в консоль.
async function logEvent(type, payload, candidateId) {
  try {
    await dbInsert("events", {
      session_id: appState.sessionId,
      type: type,
      candidate_id: candidateId || null,
      payload: payload || {}
    });
  } catch (e) {
    console.warn("Событие не записано:", type, e.message);
  }
}

// Вызываем функцию delete_my_data, которую создал schema.sql
async function deleteMyData(sessionId) {
  const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/delete_my_data", {
    method: "POST",
    headers: dbHeaders(),
    body: JSON.stringify({ p_session_id: sessionId })
  });
  if (!response.ok) throw await dbError(response);
}
