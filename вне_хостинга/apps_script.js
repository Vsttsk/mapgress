// ============================================================
// Google Apps Script — REST API для "Монитор Лента"
// Вставить в Google Apps Script (script.google.com)
// ============================================================

// ID таблицы: https://docs.google.com/spreadsheets/d/1BNRMQp1YS6AGLEGT_vw0BcVRSpbMP3q6oXxVZ2dlvxc/edit
const SPREADSHEET_ID = '1BNRMQp1YS6AGLEGT_vw0BcVRSpbMP3q6oXxVZ2dlvxc';

// Режим «Потребность»: имя листа и колонка ТК
const SHEET_DEMAND = 'Потребность';
const TK_COLUMN_NAMES = ['tk', 'тк'];

// Режим «Аналитика»: имя листа
const SHEET_ANALYTICS = 'Аналитика';

// ------------------------------------------------------------
// GET — вернуть все данные в формате JSON (или потребность при ?mode=demand, аналитика при ?mode=analytics)
// ------------------------------------------------------------
function doGet(e) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    if (e && e.parameter && e.parameter.mode === 'analytics') {
      const positions = getSheetData(ss, 'store_positions');
      const analyticsByTk = getAnalyticsByTk(ss);
      const stores = positions.map(function (row) {
        const tk = normalizeTk(row.tk);
        if (tk == null) return null;
        const a = analyticsByTk[String(tk)];
        return {
          tk: tk,
          lat: Number(row.lat) || null,
          lng: Number(row.lng) || null,
          avgShift: a ? a.avgShift : null,
          avgFotWeek: a ? a.avgFotWeek : null
        };
      }).filter(function (s) { return s != null; });
      return jsonResponse({ stores: stores });
    }

    if (e && e.parameter && e.parameter.mode === 'demand') {
      const positions = getSheetData(ss, 'store_positions');
      const demandByTk = getDemandByTk(ss);
      const stores = positions.map(function (row) {
        const tk = normalizeTk(row.tk);
        if (tk == null) return null;
        const demand = demandByTk[String(tk)] || [];
        return {
          tk: tk,
          lat: Number(row.lat) || null,
          lng: Number(row.lng) || null,
          has_demand: demand.length > 0,
          demand: demand
        };
      }).filter(function (s) { return s != null; });
      return jsonResponse({ stores: stores });
    }

    const data = {
      visits:          getSheetData(ss, 'visits'),
      tasks:           getSheetData(ss, 'tasks'),
      plans:           getSheetData(ss, 'plans'),
      store_positions: getSheetData(ss, 'store_positions'),
      highlighted:     getSheetData(ss, 'highlighted').map(r => Number(r.tk)).filter(Boolean)
    };
    return jsonResponse(data);
  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
}

// ------------------------------------------------------------
// POST — сохранить данные (принимает JSON в теле запроса)
// ------------------------------------------------------------
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // Лёгкое логирование: просто дописываем строку в лист "log"
    if (data.action === 'append_visit') {
      appendVisitLog(ss, data.visit);
      return jsonResponse({ success: true });
    }

    if (data.visits !== undefined)
      setSheetData(ss, 'visits', data.visits,
        ['tk', 'date', 'user', 'comment', 'our_presence', 'other_presence', 'timestamp']);

    if (data.tasks !== undefined)
      setSheetData(ss, 'tasks', data.tasks,
        ['tk', 'text', 'done']);

    if (data.plans !== undefined)
      setSheetData(ss, 'plans', data.plans,
        ['tk', 'date', 'note', 'timestamp']);

    if (data.store_positions !== undefined)
      setSheetData(ss, 'store_positions', data.store_positions,
        ['tk', 'lat', 'lng']);

    if (data.highlighted !== undefined)
      setSheetData(ss, 'highlighted', data.highlighted.map(tk => ({ tk })), ['tk']);

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ------------------------------------------------------------
// Вспомогательные функции
// ------------------------------------------------------------

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Читает лист и возвращает массив объектов [{колонка: значение}, ...]
function getSheetData(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0];
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      let val = row[i];
      // Преобразуем строки "true"/"false" обратно в булевы значения
      if (val === 'true')  val = true;
      if (val === 'false') val = false;
      obj[h] = val;
    });
    return obj;
  });
}

// Дописывает строку лога посещения (не перезаписывает, а appendRow)
function appendVisitLog(ss, visit) {
  let sheet = ss.getSheetByName('log');
  if (!sheet) {
    sheet = ss.insertSheet('log');
    sheet.appendRow(['время_записи', 'пользователь', 'тк', 'дата_визита', 'наш_офис', 'другой_офис', 'комментарий']);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
  }
  sheet.appendRow([
    new Date(),
    String(visit.user  || ''),
    String(visit.tk    || ''),
    String(visit.date  || ''),
    visit.our_presence   ? 'да' : 'нет',
    visit.other_presence ? 'да' : 'нет',
    String(visit.comment || '')
  ]);
}

// Полностью перезаписывает лист данными из массива объектов
function setSheetData(ss, sheetName, rows, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);

  sheet.clearContents();

  const values = [
    headers,
    ...rows.map(row => headers.map(h => {
      const v = row[h];
      return (v === undefined || v === null) ? '' : String(v);
    }))
  ];

  sheet.getRange(1, 1, values.length, headers.length).setValues(values);
}

// --------------- Режим «Потребность» ---------------
function normalizeTk(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? String(val).trim() : n;
}

function findTkColumnIndex(headers) {
  for (var i = 0; i < headers.length; i++) {
    const lower = String(headers[i]).toLowerCase();
    if (TK_COLUMN_NAMES.indexOf(lower) !== -1) return i;
  }
  return 0;
}

function getDemandByTk(ss) {
  const sheet = ss.getSheetByName(SHEET_DEMAND);
  if (!sheet) return {};

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return {};

  const headers = values[0].map(function (h) { return h != null ? String(h).trim() : ''; });
  const tkColIndex = findTkColumnIndex(headers);
  const out = {};
  for (var i = 1; i < values.length; i++) {
    const row = values[i];
    const tk = normalizeTk(row[tkColIndex]);
    if (tk === null) continue;
    const key = String(tk);
    const obj = {};
    headers.forEach(function (h, j) {
      let val = row[j];
      if (val === 'true') val = true;
      if (val === 'false') val = false;
      obj[h] = val;
    });
    if (!out[key]) out[key] = [];
    out[key].push(obj);
  }
  return out;
}

// --------------- Режим «Аналитика» ---------------
function parseNum(val) {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val === 'number' && !isNaN(val)) return val;
  var s = String(val).replace(/\s/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function getAnalyticsByTk(ss) {
  const sheet = ss.getSheetByName(SHEET_ANALYTICS);
  if (!sheet) return {};

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return {};

  const headers = values[0].map(function (h) { return h != null ? String(h).trim() : ''; });
  var tkIdx = -1;
  var avgPeopleIdx = -1;    // средний выход сотрудников в день
  var avgShiftIdx = -1;
  var avgFotWeekIdx = -1;
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i].toLowerCase();
    if (h === 'тк' || h === 'tk') tkIdx = i;
    // столбец со средним количеством сотрудников в день
    if ((h.indexOf('средний') !== -1 || h.indexOf('среднее') !== -1) &&
        (h.indexOf('сотруд') !== -1 || h.indexOf('чел') !== -1)) {
      avgPeopleIdx = i;
    }
    // столбец со средним выходом часов в день / смену
    if ((h.indexOf('средний') !== -1 || h.indexOf('среднее') !== -1) &&
        (h.indexOf('час') !== -1 || h.indexOf('ч.') !== -1 || h.indexOf('в смену') !== -1)) {
      avgShiftIdx = i;
    }
    if (h.indexOf('фот') !== -1 && h.indexOf('недел') !== -1) avgFotWeekIdx = i;
  }
  if (tkIdx < 0) tkIdx = 0;
  // если явно не нашли, пробуем эвристики по позициям (как раньше)
  if (avgShiftIdx < 0 && headers.length > 6) avgShiftIdx = 6;
  if (avgPeopleIdx < 0 && avgShiftIdx > 0) avgPeopleIdx = avgShiftIdx - 1;
  if (avgFotWeekIdx < 0 && headers.length > 9) avgFotWeekIdx = 9;

  const out = {};
  for (var r = 1; r < values.length; r++) {
    const row = values[r];
    const tk = normalizeTk(row[tkIdx]);
    if (tk === null) continue;
    const key = String(tk);
    const avgPeopleDay = avgPeopleIdx >= 0 ? parseNum(row[avgPeopleIdx]) : null;
    const avgShift = avgShiftIdx >= 0 ? parseNum(row[avgShiftIdx]) : null;
    const avgFotWeek = avgFotWeekIdx >= 0 ? parseNum(row[avgFotWeekIdx]) : null;
    if (avgPeopleDay !== null || avgShift !== null || avgFotWeek !== null) {
      out[key] = {
        avgPeopleDay: avgPeopleDay,
        avgShift: avgShift,
        avgFotWeek: avgFotWeek
      };
    }
  }
  return out;
}
