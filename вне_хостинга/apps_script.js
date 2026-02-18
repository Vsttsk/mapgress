// ============================================================
// Google Apps Script — REST API для "Монитор Лента"
// Вставить в Google Apps Script (script.google.com)
// ============================================================

// Вставь сюда ID своей Google-таблицы.
// Его видно в URL таблицы:
// https://docs.google.com/spreadsheets/d/СЮДА_ID/edit
const SPREADSHEET_ID = 'СЮДА_ВСТАВЬ_ID_ТАБЛИЦЫ';

// ------------------------------------------------------------
// GET — вернуть все данные в формате JSON
// ------------------------------------------------------------
function doGet(e) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const data = {
      visits:          getSheetData(ss, 'visits'),
      tasks:           getSheetData(ss, 'tasks'),
      plans:           getSheetData(ss, 'plans'),
      store_positions: getSheetData(ss, 'store_positions')
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
