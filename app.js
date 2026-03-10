let map;
let stores = [];
let visits = [];
let tasks = [];
let plans = [];
let markers = {};
let statsChart = null;
let editorMode = false;
let editorSubMode = 'move'; // 'move' | 'highlight'
let activeMarker = null;
let highlighted = new Set(); // номера ТК с красной обводкой

// Режим «Потребность»
let demandStores = [];
let mapPotrebnost = null;
let demandMarkers = {};
let potrebnostInitialized = false;
let demandFilterJob = ''; // фильтр по должности: пусто = все, иначе значение «Должность»
let demandHideGray = false; // скрывать серые маркеры (ТК без потребности)

// Режим «Аналитика»
let analyticsStores = [];
let mapAnalytics = null;
let analyticsMarkers = {};
let analyticsInitialized = false;
let analyticsColorBy = 'avgShift'; // 'avgShift' | 'avgFotWeek'

const COLORS = { OUR: 'green', OTHER: 'blue', NONE: 'gray', EDIT: 'orange' };

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            inQuotes = !inQuotes;
        } else if (c === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += c;
        }
    }
    result.push(current.trim());
    return result;
}

function parseCSV(csvText) {
    const lines = csvText.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    
    const result = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length >= 4) {
            const officesStr = (values[4] || '').replace(/"/g, '');
            result.push({
                tk_number: parseInt(values[0]) || values[0],
                address: (values[1] || '').replace(/^"|"$/g, ''),
                lat: parseFloat(values[2]),
                lng: parseFloat(values[3]),
                offices: officesStr ? officesStr.split(',') : []
            });
        }
    }
    return result;
}

function isWithinDays(dateString, days) {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= days;
}

function hasOurOffice(store) {
    return store.offices && store.offices.some(o => o.includes('Максутов'));
}

function hasOtherOffices(store) {
    return store.offices && store.offices.length > 0 && !hasOurOffice(store);
}

function getOfficesLabel(store) {
    if (!store || !store.offices || store.offices.length === 0) return 'Нет офисов';
    return store.offices.join(', ');
}

function getMarkerColor(tkNumber) {
    const store = stores.find(s => s.tk_number == tkNumber);
    const recentVisits = visits.filter(v => v.tk == tkNumber && isWithinDays(v.date, 14));
    
    if (recentVisits.length > 0) {
        const hasOur = recentVisits.some(v => v.our_presence);
        const hasOther = recentVisits.some(v => v.other_presence);
        if (hasOur) return COLORS.OUR;
        if (hasOther) return COLORS.OTHER;
    }
    
    if (store) {
        if (hasOurOffice(store)) return COLORS.OUR;
        if (store.offices && store.offices.length > 0) return COLORS.OTHER;
    }
    return COLORS.NONE;
}

function updateMarkerColor(tkNumber) {
    const color = getMarkerColor(tkNumber);
    updateMarkerVisual(tkNumber, color);
}

async function loadData() {
    try {
        // Проверка, что мы не на file:// протоколе
        if (window.location.protocol === 'file:') {
            alert('⚠️ Файл открыт напрямую!\n\nПожалуйста, используйте локальный сервер:\n\n1. Откройте терминал\n2. Выполните: cd ' + window.location.pathname.split('/').slice(0, -1).join('/') + '\n3. Выполните: python3 -m http.server 8080\n4. Откройте: http://localhost:8080\n\nИли используйте уже запущенный сервер на http://localhost:8080');
            throw new Error('File protocol not supported');
        }
        
        const response = await fetch('stores_final.csv');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const csvText = await response.text();
        stores = parseCSV(csvText);
        
        if (stores.length === 0) {
            console.error('No stores loaded from CSV');
            return;
        }
        
        // Один запрос к API — грузим всё сразу (fallback на LocalStorage внутри)
        await loadAllFromServer();
    } catch (error) {
        console.error('Error loading data:', error);
        if (error.message !== 'File protocol not supported') {
            alert('Ошибка загрузки данных. Проверьте консоль браузера.');
        }
    }
}

function initMap() {
    const mapElement = document.getElementById('map');
    if (!mapElement) {
        console.error('Map element not found');
        return;
    }
    
    try {
        const isMobile = window.innerWidth < 768;
        
        map = L.map('map', {
            center: [55.75, 37.61],
            zoom: isMobile ? 9 : 10,
            zoomControl: true,
            touchZoom: true,
            doubleClickZoom: true,
            boxZoom: false,
            keyboard: true,
            scrollWheelZoom: true,
            tap: true,
            tapTolerance: 15
        });
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 19,
            minZoom: 5
        }).addTo(map);
        
        if (stores && stores.length > 0) {
            stores.forEach(store => {
                createMarker(store);
            });
        } else {
            console.error('No stores to display');
        }
        
        // Принудительное обновление размера карты после небольшой задержки
        setTimeout(() => {
            if (map) {
                map.invalidateSize();
            }
        }, 100);
    } catch (error) {
        console.error('Error initializing map:', error);
        alert('Ошибка инициализации карты: ' + error.message);
    }
}

function createMarker(store) {
    const color = getMarkerColor(store.tk_number);
    const officesLabel = getOfficesLabel(store);
    const isMobile = window.innerWidth < 768;
    const markerSize = isMobile ? 40 : 36;

    const marker = L.marker([store.lat, store.lng], {
        icon: L.divIcon({
            html: `<div class="marker marker-${color}${highlighted.has(store.tk_number) ? ' marker-highlighted' : ''}" data-tk="${store.tk_number}" title="${officesLabel}">${store.tk_number}</div>`,
            className: 'custom-marker',
            iconSize: [markerSize, markerSize],
            iconAnchor: [markerSize / 2, markerSize / 2]
        }),
        draggable: editorMode,
        keyboard: true
    }).addTo(map);
    
    marker.bindTooltip(`<strong>ТК ${store.tk_number}</strong><br>${officesLabel}`, {
        permanent: false,
        direction: 'top',
        className: 'marker-tooltip',
        offset: [0, -20]
    });
    
    marker.on('click', () => {
        if (editorMode) {
            activateMarker(store.tk_number);
        } else {
            showTKPanel(store.tk_number);
        }
    });
    
    if (editorMode) {
        marker.on('dragend', () => saveMarkerPosition(store.tk_number, marker));
    }
    
    markers[store.tk_number] = marker;
}

function activateMarker(tkNumber) {
    if (!editorMode) return;

    if (editorSubMode === 'highlight') {
        toggleHighlight(tkNumber);
        return;
    }

    // Деактивируем предыдущий активный маркер
    if (activeMarker && activeMarker !== tkNumber) {
        const prevMarker = markers[activeMarker];
        if (prevMarker) {
            const color = getMarkerColor(activeMarker);
            updateMarkerVisual(activeMarker, color);
            prevMarker.draggable = false;
        }
    }
    
    // Если кликнули на уже активный маркер - деактивируем
    if (activeMarker === tkNumber) {
        const color = getMarkerColor(tkNumber);
        updateMarkerVisual(tkNumber, color);
        markers[tkNumber].draggable = false;
        activeMarker = null;
        return;
    }
    
    // Активируем новый маркер
    activeMarker = tkNumber;
    const marker = markers[tkNumber];
    if (marker) {
        marker.draggable = true;
        updateMarkerVisual(tkNumber, 'orange');
    }
}

async function toggleHighlight(tkNumber) {
    showLoadingOverlay('Сохраняем выделение...');
    if (highlighted.has(tkNumber)) {
        highlighted.delete(tkNumber);
    } else {
        highlighted.add(tkNumber);
    }
    const color = getMarkerColor(tkNumber);
    updateMarkerVisual(tkNumber, color);
    await saveDataToServer();
    hideLoadingOverlay();
}

function setEditorSubMode(mode) {
    editorSubMode = mode;
    document.getElementById('mode-move-btn').classList.toggle('active', mode === 'move');
    document.getElementById('mode-highlight-btn').classList.toggle('active', mode === 'highlight');

    // Деактивируем активный маркер (move-режим)
    if (activeMarker) {
        const color = getMarkerColor(activeMarker);
        updateMarkerVisual(activeMarker, color);
        if (markers[activeMarker]) markers[activeMarker].dragging.disable();
        activeMarker = null;
    }

    // Включаем/выключаем перетаскивание у всех маркеров
    Object.keys(markers).forEach(tk => {
        const m = markers[tk];
        if (mode === 'move') m.dragging.enable();
        else m.dragging.disable();
    });
}

function updateMarkerVisual(tkNumber, color) {
    const marker = markers[tkNumber];
    if (!marker) return;
    
    const store = stores.find(s => s.tk_number == tkNumber);
    const officesLabel = getOfficesLabel(store);
    
    const isMobile = window.innerWidth < 768;
    const markerSize = isMobile ? 40 : 36;
    
    marker.setIcon(L.divIcon({
        html: `<div class="marker marker-${color}${highlighted.has(tkNumber) ? ' marker-highlighted' : ''}" data-tk="${tkNumber}" title="${officesLabel}">${tkNumber}</div>`,
        className: 'custom-marker',
        iconSize: [markerSize, markerSize],
        iconAnchor: [markerSize / 2, markerSize / 2]
    }));
}

async function saveMarkerPosition(tkNumber, marker) {
    const store = stores.find(s => s.tk_number == tkNumber);
    if (!store) return;
    
    const latlng = marker.getLatLng();
    store.lat = latlng.lat;
    store.lng = latlng.lng;
    
    showLoadingOverlay('Сохраняем позицию маркера...');
    // Сохраняем на сервер (в файл проекта)
    await saveDataToServer();
    
    // Также сохраняем в LocalStorage как кэш
    await localforage.setItem('store_positions', stores.map(s => ({
        tk: s.tk_number,
        lat: s.lat,
        lng: s.lng
    })));
    hideLoadingOverlay();
}

// Единый запрос к API — загружает visits/tasks/plans и позиции маркеров
async function loadAllFromServer() {
    const apiUrl = CONFIG.SHEETS_API_URL || '/api/data';
    try {
        const response = await fetch(apiUrl);
        if (response.ok) {
            const data = await response.json();

            // Если Apps Script вернул ошибку — падаем в fallback на LocalStorage
            if (data.error) throw new Error(data.error);

            visits    = data.visits    || [];
            tasks     = data.tasks     || [];
            plans     = data.plans     || [];
            highlighted = new Set(data.highlighted || []);

            if (data.store_positions && data.store_positions.length > 0) {
                data.store_positions.forEach(pos => {
                    const store = stores.find(s => s.tk_number == pos.tk);
                    if (store) {
                        store.lat = parseFloat(pos.lat) || store.lat;
                        store.lng = parseFloat(pos.lng) || store.lng;
                    }
                });
                await localforage.setItem('store_positions', data.store_positions);
            }

            await localforage.setItem('visits', visits);
            await localforage.setItem('tasks',  tasks);
            await localforage.setItem('plans',  plans);

            console.log('✅ Данные загружены с', CONFIG.SHEETS_API_URL ? 'Google Sheets' : 'сервера');
            return true;
        }
    } catch (error) {
        console.log('⚠️ API недоступен или вернул ошибку:', error.message);
    }

    // Fallback на LocalStorage
    const savedPositions = await localforage.getItem('store_positions');
    if (savedPositions) {
        savedPositions.forEach(pos => {
            const store = stores.find(s => s.tk_number == pos.tk);
            if (store) { store.lat = pos.lat; store.lng = pos.lng; }
        });
    }
    visits = await localforage.getItem('visits') || [];
    tasks  = await localforage.getItem('tasks')  || [];
    plans  = await localforage.getItem('plans')  || [];
    const savedHighlighted = await localforage.getItem('highlighted');
    if (savedHighlighted && Array.isArray(savedHighlighted)) highlighted = new Set(savedHighlighted);
    return false;
}

// Алиас для 30-секундного поллинга (обновляет только данные, не позиции)
async function loadDataFromServer() {
    const apiUrl = CONFIG.SHEETS_API_URL || '/api/data';
    try {
        const response = await fetch(apiUrl);
        if (response.ok) {
            const data = await response.json();
            visits = data.visits || [];
            tasks  = data.tasks  || [];
            plans  = data.plans  || [];
            await localforage.setItem('visits', visits);
            await localforage.setItem('tasks',  tasks);
            await localforage.setItem('plans',  plans);
            return true;
        }
    } catch { return false; }
}

async function saveDataToServer() {
    const apiUrl = CONFIG.SHEETS_API_URL || '/api/data';
    const payload = JSON.stringify({
        visits: visits,
        tasks: tasks,
        plans: plans,
        store_positions: stores.map(s => ({
            tk: s.tk_number,
            lat: s.lat,
            lng: s.lng
        })),
        highlighted: [...highlighted]
    });

    try {
        // Для Google Apps Script используем Content-Type: text/plain,
        // чтобы избежать CORS preflight (OPTIONS), который Apps Script не поддерживает.
        const contentType = CONFIG.SHEETS_API_URL ? 'text/plain' : 'application/json';

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': contentType },
            body: payload
        });
        
        if (response.ok) {
            console.log('✅ Данные сохранены в', CONFIG.SHEETS_API_URL ? 'Google Sheets' : 'data.json');
            await localforage.setItem('highlighted', [...highlighted]);
            showSaveIndicator(true);
            return true;
        } else {
            console.error('Ошибка сохранения:', await response.text());
            showSaveIndicator(false);
            return false;
        }
    } catch (error) {
        console.error('Ошибка сохранения:', error);
        showSaveIndicator(false);
        await localforage.setItem('visits', visits);
        await localforage.setItem('tasks', tasks);
        await localforage.setItem('plans', plans);
        await localforage.setItem('highlighted', [...highlighted]);
        return false;
    }
}

function showSaveIndicator(success) {
    let indicator = document.getElementById('save-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'save-indicator';
        document.body.appendChild(indicator);
    } else {
        indicator.style.animation = 'none';
        indicator.offsetHeight;
        indicator.style.animation = '';
    }
    indicator.textContent = success ? '✅ Сохранено' : '⚠️ Ошибка';
    indicator.style.background = success ? '#10B981' : '#EF4444';
    indicator.style.animation = 'slideIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';

    clearTimeout(indicator._t);
    indicator._t = setTimeout(() => {
        indicator.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => indicator.remove(), 300);
    }, 2500);
}

function showLoadingOverlay(text = 'Сохранение...') {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        document.getElementById('loading-text').textContent = text;
        overlay.classList.remove('hidden');
    }
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.add('hidden');
}

async function logVisitToSheets(visit) {
    if (!CONFIG.SHEETS_API_URL) return;
    try {
        fetch(CONFIG.SHEETS_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'append_visit', visit })
        });
    } catch {}
}

function hideTKPanel() {
    document.getElementById('tk-panel').classList.add('hidden');
}

function showTKPanel(tkNumber) {
    const store = stores.find(s => s.tk_number == tkNumber);
    if (!store) return;
    
    const storeVisits = visits.filter(v => v.tk == tkNumber)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    const storeTask = tasks.find(t => t.tk == tkNumber && !t.done);
    const lastVisit = storeVisits[0];
    const officesLabel = getOfficesLabel(store);
    
    const visitsHtml = storeVisits.length ? storeVisits.map(v => `
        <div class="visit-item">
            <div class="visit-item-header">
                <span class="visit-date">${v.date}</span>
                <span class="visit-user">${v.user || CONFIG.USER_NAME}</span>
            </div>
            ${v.comment ? `<div class="visit-comment">"${v.comment}"</div>` : ''}
        </div>
    `).join('') : '<p class="no-data">Нет посещений</p>';
    
    let html = `
        <h3>ТК ${store.tk_number}</h3>
        <p class="tk-address">${store.address}</p>
        <div class="tk-offices">
            <strong>Офисы:</strong> ${officesLabel}
        </div>
        <div class="current-status">
            <span class="status-badge ${lastVisit?.our_presence ? 'active' : ''}">Наш офис</span>
            <span class="status-badge ${lastVisit?.other_presence ? 'active' : ''}">Другие офисы</span>
        </div>
        <div class="history-block">
            <div class="history-header" onclick="toggleHistory(${tkNumber})">
                <span>История посещений</span>
                <span class="history-count">(${storeVisits.length})</span>
                <span class="history-chevron">▼</span>
            </div>
            <div class="history-content" id="history-${tkNumber}">
                ${visitsHtml}
            </div>
        </div>
    `;
    
    if (storeTask) {
        html += `
            <div class="task-block">
                <h4>Задача от руководителя:</h4>
                <label class="task-label">
                    <input type="checkbox" onchange="completeTask(${tkNumber})">
                    ${storeTask.text}
                </label>
            </div>
        `;
    }
    
    html += `
        <div class="panel-actions">
            <button class="btn btn-primary" onclick="openVisitForm(${tkNumber})">📝 Отметить посещение</button>
            <button class="btn btn-secondary" onclick="openPlanForm(${tkNumber})">📅 Запланировать визит</button>
        </div>
    `;
    
    document.getElementById('tk-info').innerHTML = html;
    const panel = document.getElementById('tk-panel');
    panel.classList.remove('hidden');
    panel.querySelector('.history-content').classList.add('collapsed');
    panel.querySelector('.history-chevron').textContent = '▶';
}

function toggleHistory(tkNumber) {
    const content = document.getElementById(`history-${tkNumber}`);
    const chevron = content?.closest('.history-block')?.querySelector('.history-chevron');
    if (content && chevron) {
        content.classList.toggle('collapsed');
        chevron.textContent = content.classList.contains('collapsed') ? '▶' : '▼';
    }
}

function showModal(html) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modal-overlay';
    overlay.innerHTML = `<div class="modal">${html}</div>`;
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
    document.body.appendChild(overlay);
}

function closeModal() {
    const el = document.getElementById('modal-overlay');
    if (el) el.remove();
}

function openVisitForm(tkNumber) {
    const formHtml = `
        <h3>Отметить посещение ТК ${tkNumber}</h3>
        <input type="date" id="visit-date" value="${new Date().toISOString().split('T')[0]}">
        <label><input type="checkbox" id="our-presence"> Наш офис присутствует</label>
        <label><input type="checkbox" id="other-presence"> Другие офисы присутствуют</label>
        <textarea id="visit-comment" placeholder="Комментарий (до 3 строк)" rows="3"></textarea>
        <div class="modal-actions">
            <button class="btn btn-primary" onclick="saveVisit(${tkNumber})">Сохранить</button>
            <button class="btn btn-ghost" onclick="closeModal()">Отмена</button>
        </div>
    `;
    showModal(formHtml);
}

async function saveVisit(tkNumber) {
    showLoadingOverlay('Сохраняем посещение...');

    const visit = {
        tk: tkNumber,
        date: document.getElementById('visit-date').value,
        user: CONFIG.USER_NAME,
        comment: document.getElementById('visit-comment').value || '',
        our_presence: document.getElementById('our-presence').checked,
        other_presence: document.getElementById('other-presence').checked,
        timestamp: new Date().toISOString()
    };

    visits.unshift(visit);
    await saveDataToServer();
    logVisitToSheets(visit);
    await localforage.setItem('visits', visits);

    hideLoadingOverlay();
    updateMarkerColor(tkNumber);
    updateStats();
    closeModal();
    showTKPanel(tkNumber);
}

function openPlanForm(tkNumber) {
    const formHtml = `
        <h3>Запланировать визит ТК ${tkNumber}</h3>
        <input type="date" id="plan-date">
        <textarea id="plan-note" placeholder="Примечание" rows="2"></textarea>
        <div class="modal-actions">
            <button class="btn btn-primary" onclick="savePlan(${tkNumber})">Сохранить</button>
            <button class="btn btn-ghost" onclick="closeModal()">Отмена</button>
        </div>
    `;
    showModal(formHtml);
}

async function savePlan(tkNumber) {
    showLoadingOverlay('Сохраняем план...');

    const plan = {
        tk: tkNumber,
        date: document.getElementById('plan-date').value,
        note: document.getElementById('plan-note').value || '',
        timestamp: new Date().toISOString()
    };
    plans.push(plan);
    await saveDataToServer();
    await localforage.setItem('plans', plans);

    hideLoadingOverlay();
    closeModal();
}

async function completeTask(tkNumber) {
    const task = tasks.find(t => t.tk == tkNumber && !t.done);
    if (task) {
        task.done = true;
        showLoadingOverlay('Обновляем задачу...');
        await saveDataToServer();
        await localforage.setItem('tasks', tasks);
        hideLoadingOverlay();
        showTKPanel(tkNumber);
    }
}

function searchTK() {
    const input = document.getElementById('tk-search-input');
    if (!input) return;
    
    const raw = input.value.trim();
    if (!raw) {
        alert('Введите номер ТК');
        return;
    }
    
    const tkNumber = parseInt(raw, 10);
    if (Number.isNaN(tkNumber)) {
        alert('Некорректный номер ТК');
        return;
    }
    
    const store = stores.find(s => s.tk_number == tkNumber);
    if (!store) {
        alert('ТК с таким номером не найден');
        return;
    }
    
    if (map) {
        map.flyTo([store.lat, store.lng], 15, { duration: 0.7 });
    }
    
    showTKPanel(store.tk_number);
}

function updateStats() {
    const last14Days = visits.filter(v => isWithinDays(v.date, 14));
    const ourTKs = [...new Set(last14Days.filter(v => v.our_presence).map(v => v.tk))];
    const otherTKs = [...new Set(last14Days.filter(v => v.other_presence).map(v => v.tk))];
    const totalUnique = new Set([...ourTKs, ...otherTKs]).size;
    
    document.getElementById('stats-summary').innerHTML = 
        `📊 За 14 дней: Посещено: ${totalUnique} ТК | Наших: ${ourTKs.length} | Других: ${otherTKs.length}`;
}

function toggleDashboard() {
    const dash = document.getElementById('dashboard');
    dash.classList.toggle('hidden');
    if (!dash.classList.contains('hidden')) {
        renderDashboard();
    }
}

function renderDashboard() {
    const ctx = document.getElementById('stats-chart');
    if (!ctx) return;
    
    const last14 = visits.filter(v => isWithinDays(v.date, 14));
    const byDate = {};
    for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        byDate[key] = { our: 0, other: 0 };
    }
    
    last14.forEach(v => {
        if (byDate[v.date]) {
            if (v.our_presence) byDate[v.date].our++;
            if (v.other_presence) byDate[v.date].other++;
        }
    });
    
    const labels = Object.keys(byDate).map(d => d.slice(5));
    const ourData = Object.values(byDate).map(d => d.our);
    const otherData = Object.values(byDate).map(d => d.other);
    
    if (statsChart) statsChart.destroy();
    statsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Наш офис', data: ourData, backgroundColor: '#10B981' },
                { label: 'Другие офисы', data: otherData, backgroundColor: '#3B82F6' }
            ]
        },
        options: {
            responsive: true,
            scales: { y: { beginAtZero: true } }
        }
    });
}

function showCalendar() {
    alert('Календарь визитов — в разработке');
}

function toggleEditorMode() {
    if (editorMode) {
        finishEditing();
        return;
    }
    
    const password = prompt('Введите пароль для режима редактора:');
    if (password !== CONFIG.PASSWORD) {
        alert('Неверный пароль');
        return;
    }
    
    editorMode = true;
    document.getElementById('editor-btn').classList.add('active');
    document.getElementById('editor-bar').classList.remove('hidden');
    document.getElementById('stats-bar').classList.add('editor-active');
    document.getElementById('app').classList.add('editor-mode');
    
    // Пересоздаём маркеры с возможностью перетаскивания
    Object.keys(markers).forEach(tk => {
        map.removeLayer(markers[tk]);
    });
    markers = {};
    stores.forEach(store => {
        createMarker(store);
    });
}

function finishEditing() {
    editorMode = false;
    editorSubMode = 'move';
    activeMarker = null;
    document.getElementById('editor-btn').classList.remove('active');
    document.getElementById('editor-bar').classList.add('hidden');
    document.getElementById('stats-bar').classList.remove('editor-active');
    document.getElementById('app').classList.remove('editor-mode');
    // Сбрасываем кнопки тумблера на дефолт
    document.getElementById('mode-move-btn').classList.add('active');
    document.getElementById('mode-highlight-btn').classList.remove('active');
    
    // Пересоздаём маркеры в обычном режиме
    Object.keys(markers).forEach(tk => {
        map.removeLayer(markers[tk]);
    });
    markers = {};
    stores.forEach(store => {
        createMarker(store);
    });
}

function chooseMode(mode) {
    const modeChoice = document.getElementById('mode-choice');
    const appLoader = document.getElementById('app-loader');
    if (modeChoice) modeChoice.classList.add('hidden');
    if (appLoader) appLoader.classList.remove('hidden');

    if (mode === 'obezdy') {
        initApp();
        return;
    }
    if (mode === 'potrebnost') {
        initPotrebnost();
        return;
    }
    if (mode === 'analytics') {
        initAnalytics();
        return;
    }
}

async function loadDemandData() {
    const base = CONFIG.SHEETS_API_URL || '';
    if (!base) throw new Error('SHEETS_API_URL не настроен');
    const apiUrl = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'mode=demand';
    const response = await fetch(apiUrl);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error('Ошибка загрузки потребности: ' + response.status);
    if (data.error) throw new Error(data.error);
    return data.stores || [];
}

function getDemandForFilter(store) {
    const list = store.demand || [];
    if (!demandFilterJob) return list;
    return list.filter(row => (row['Должность'] || '').toString().trim() === demandFilterJob);
}

function renderDemandMarkers() {
    if (!mapPotrebnost || !demandStores.length) return;
    Object.values(demandMarkers).forEach(m => { if (mapPotrebnost && m) mapPotrebnost.removeLayer(m); });
    demandMarkers = {};

    demandStores.forEach(store => {
        const filtered = getDemandForFilter(store);
        if (demandFilterJob && filtered.length === 0) return;

        const count = filtered.length;
        const hasDemand = count > 0;
        if (demandHideGray && !hasDemand) return;

        const lat = parseFloat(store.lat);
        const lng = parseFloat(store.lng);
        if (isNaN(lat) || isNaN(lng)) return;

        const color = hasDemand ? 'green' : 'gray';
        const isMobile = window.innerWidth < 768;
        const markerSize = isMobile ? 40 : 36;
        const countHtml = hasDemand && count > 0
            ? `<span class="marker-demand-count">${count}</span>`
            : '';
        const html = `<div class="marker-wrap"><div class="marker marker-${color}" data-tk="${store.tk}">${store.tk}</div>${countHtml}</div>`;

        const m = L.marker([lat, lng], {
            icon: L.divIcon({
                html: html,
                className: 'custom-marker',
                iconSize: [markerSize, markerSize],
                iconAnchor: [markerSize / 2, markerSize / 2]
            })
        }).addTo(mapPotrebnost);
        m.bindTooltip(`ТК ${store.tk}${hasDemand ? ' · потребность: ' + count : ''}`, {
            permanent: false,
            direction: 'top',
            className: 'marker-tooltip',
            offset: [0, -20]
        });
        m.on('click', () => showDemandPanel(store.tk, store));
        demandMarkers[store.tk] = m;
    });
}

function fillDemandJobFilter() {
    const sel = document.getElementById('demand-job-filter');
    if (!sel) return;
    const jobs = new Set();
    demandStores.forEach(store => {
        (store.demand || []).forEach(row => {
            const j = row['Должность'];
            if (j != null && String(j).trim() !== '') jobs.add(String(j).trim());
        });
    });
    const jobList = [...jobs].sort();
    const current = sel.value;
    sel.innerHTML = '<option value="">Все вакансии</option>' + jobList.map(j => `<option value="${escapeHtml(j)}">${escapeHtml(j)}</option>`).join('');
    if (jobList.includes(current)) sel.value = current;
}

function onDemandFilterChange() {
    const sel = document.getElementById('demand-job-filter');
    demandFilterJob = sel ? sel.value : '';
    renderDemandMarkers();
}

function resetDemandFilter() {
    demandFilterJob = '';
    const sel = document.getElementById('demand-job-filter');
    if (sel) sel.value = '';
    renderDemandMarkers();
}

function toggleDemandHideGray() {
    demandHideGray = !demandHideGray;
    const btn = document.getElementById('demand-hide-gray-btn');
    if (btn) btn.classList.toggle('active', demandHideGray);
    renderDemandMarkers();
}

function hideDemandPanel() {
    document.getElementById('demand-panel').classList.add('hidden');
}

function showDemandPanel(tk, store) {
    const storeData = demandStores.find(s => String(s.tk) === String(tk)) || store;
    if (!storeData) return;
    const demand = getDemandForFilter(storeData);
    const first = demand[0] || {};
    const addr = first['Адрес'] || first['адрес'] || '';
    const mainFields = ['Должность', 'Приоритет', 'Сколько нужно людей', 'Уровень ЧТС', 'описание графика', 'Комментарий', 'РОП'];
    const otherKeys = Object.keys(first).filter(k => !['ТК', 'тк', 'tk', 'Адрес', 'адрес'].includes(k) && !mainFields.includes(k));
    let html = `<h3>ТК ${storeData.tk}</h3>`;
    if (addr) html += `<p class="tk-address">${escapeHtml(addr)}</p>`;
    if (demand.length === 0) {
        html += '<p class="no-data">Нет данных о потребности</p>';
    } else {
        demand.forEach((row, idx) => {
            html += '<div class="demand-card">';
            html += '<div class="demand-card-main">';
            if (row['Должность']) html += `<strong>${escapeHtml(String(row['Должность']))}</strong>`;
            if (row['Сколько нужно людей'] != null && row['Сколько нужно людей'] !== '') html += `<span class="demand-count">${escapeHtml(String(row['Сколько нужно людей']))} чел.</span>`;
            html += '</div>';
            html += '<div class="demand-card-details">';
            mainFields.forEach(f => {
                if (row[f] != null && row[f] !== '') html += `<div class="demand-row"><span class="demand-label">${escapeHtml(f)}:</span> <span>${escapeHtml(String(row[f]))}</span></div>`;
            });
            otherKeys.forEach(k => {
                if (row[k] != null && row[k] !== '') html += `<div class="demand-row demand-row-muted"><span class="demand-label">${escapeHtml(k)}:</span> <span>${escapeHtml(String(row[k]))}</span></div>`;
            });
            html += '</div></div>';
        });
    }
    document.getElementById('demand-info').innerHTML = html;
    document.getElementById('demand-panel').classList.remove('hidden');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function searchTKPotrebnost() {
    const input = document.getElementById('tk-search-potrebnost');
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) {
        alert('Введите номер ТК');
        return;
    }
    const tk = isNaN(Number(raw)) ? raw : Number(raw);
    const store = demandStores.find(s => s.tk == tk);
    if (!store) {
        alert('ТК с таким номером не найден');
        return;
    }
    const lat = parseFloat(store.lat);
    const lng = parseFloat(store.lng);
    if (!isNaN(lat) && !isNaN(lng) && mapPotrebnost) {
        mapPotrebnost.flyTo([lat, lng], 15, { duration: 0.7 });
    }
    showDemandPanel(store.tk, store);
}

// --------------- Аналитика ---------------
function loadAnalyticsData() {
    return fetch(CONFIG.SHEETS_API_URL + '?mode=analytics')
        .then(r => r.json())
        .then(data => {
            analyticsStores = (data && data.stores) ? data.stores : [];
            return analyticsStores;
        })
        .catch(() => { analyticsStores = []; return []; });
}

function initAnalytics() {
    const appLoader = document.getElementById('app-loader');
    if (appLoader) appLoader.classList.remove('hidden');
    loadAnalyticsData().then(() => {
        document.getElementById('app-analytics').classList.remove('hidden');
        document.getElementById('app-analytics').style.display = 'flex';
        setServiceNavActive('analytics');
        const mapEl = document.getElementById('map-analytics');
        if (!mapAnalytics && mapEl) {
            mapAnalytics = L.map('map-analytics').setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapAnalytics);
        }
        renderAnalyticsMarkers();
        analyticsInitialized = true;
        setTimeout(() => { if (mapAnalytics) mapAnalytics.invalidateSize(); }, 100);
        if (appLoader) appLoader.classList.add('hidden');
    }).catch(() => {
        if (appLoader) appLoader.classList.add('hidden');
    });
}

function interpolateRedGreen(t) {
    if (t <= 0) return '#ef4444';
    if (t >= 1) return '#22c55e';
    const r = Math.round(239 - (239 - 34) * t);
    const g = Math.round(68 + (187 - 68) * t);
    const b = Math.round(68 + (34 - 68) * t);
    return '#' + [r, g, b].map(x => ('0' + Math.max(0, Math.min(255, x)).toString(16)).slice(-2)).join('');
}

function renderAnalyticsMarkers() {
    if (!mapAnalytics) return;
    Object.keys(analyticsMarkers).forEach(tk => {
        if (analyticsMarkers[tk]) mapAnalytics.removeLayer(analyticsMarkers[tk]);
    });
    analyticsMarkers = {};
    const key = analyticsColorBy;
    const values = analyticsStores.map(s => s[key] != null ? Number(s[key]) : null).filter(v => v != null);
    const minV = values.length ? Math.min(...values) : 0;
    const maxV = values.length ? Math.max(...values) : 1;
    const range = maxV - minV || 1;
    analyticsStores.forEach(store => {
        const lat = parseFloat(store.lat);
        const lng = parseFloat(store.lng);
        if (isNaN(lat) || isNaN(lng)) return;
        const val = store[key] != null ? Number(store[key]) : null;
        const t = (val != null && values.length) ? (val - minV) / range : 0.5;
        const color = val != null ? interpolateRedGreen(t) : '#9CA3AF';
        const marker = L.circleMarker([lat, lng], { radius: 10, fillColor: color, color: '#333', weight: 1, fillOpacity: 0.9 })
            .addTo(mapAnalytics)
            .on('click', () => showAnalyticsPanel(store));
        analyticsMarkers[String(store.tk)] = marker;
    });
}

function onAnalyticsColorByChange() {
    const sel = document.getElementById('analytics-color-by');
    if (sel) analyticsColorBy = sel.value || 'avgShift';
    renderAnalyticsMarkers();
}

function hideAnalyticsPanel() {
    document.getElementById('analytics-panel').classList.add('hidden');
}

function showAnalyticsPanel(store) {
    const avgShift = store.avgShift != null ? Number(store.avgShift) : null;
    const avgPeople = store.avgPeopleDay != null ? Number(store.avgPeopleDay) : null;
    const avgFot = store.avgFotWeek != null ? Number(store.avgFotWeek) : null;
    let html = `<h3>ТК ${store.tk}</h3>`;
    html += '<div class="demand-row"><span class="demand-label">Средний выход сотрудников в день:</span> <span>' + (avgPeople != null ? avgPeople : '—') + '</span></div>';
    html += '<div class="demand-row"><span class="demand-label">Средний выход в смену, ч.:</span> <span>' + (avgShift != null ? avgShift : '—') + '</span></div>';
    html += '<div class="demand-row"><span class="demand-label">Средний ФОТ в неделю:</span> <span>' + (avgFot != null ? avgFot : '—') + '</span></div>';
    document.getElementById('analytics-info').innerHTML = html;
    document.getElementById('analytics-panel').classList.remove('hidden');
}

function setServiceNavActive(mode) {
    document.querySelectorAll('.service-nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
}

function ensureObezdyInited() {
    if (map) return Promise.resolve();
    return loadData().then(() => {
        if (stores.length === 0) return;
        initMap();
        updateStats();
    });
}

function switchToObezdy() {
    const appLoader = document.getElementById('app-loader');
    if (appLoader) appLoader.classList.remove('hidden');
    document.getElementById('app-potrebnost').classList.add('hidden');
    document.getElementById('app-potrebnost').style.display = 'none';
    document.getElementById('app-analytics').classList.add('hidden');
    document.getElementById('app-analytics').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    setServiceNavActive('obezdy');
    if (!map) {
        ensureObezdyInited().then(() => {
            if (map) map.invalidateSize();
            if (appLoader) appLoader.classList.add('hidden');
        }).catch(() => {
            if (appLoader) appLoader.classList.add('hidden');
        });
        return;
    }
    setTimeout(() => {
        if (map) map.invalidateSize();
        if (appLoader) appLoader.classList.add('hidden');
    }, 200);
}

function switchToPotrebnost() {
    setServiceNavActive('potrebnost');
    const appLoader = document.getElementById('app-loader');
    if (appLoader) appLoader.classList.remove('hidden');
    document.getElementById('app').style.display = 'none';
    document.getElementById('app-analytics').classList.add('hidden');
    document.getElementById('app-analytics').style.display = 'none';
    document.getElementById('app-potrebnost').classList.remove('hidden');
    document.getElementById('app-potrebnost').style.display = 'flex';
    if (!potrebnostInitialized) {
        initPotrebnost();
        return;
    }
    if (mapPotrebnost) mapPotrebnost.invalidateSize();
    setTimeout(() => { if (appLoader) appLoader.classList.add('hidden'); }, 180);
}

function switchToAnalytics() {
    setServiceNavActive('analytics');
    const appLoader = document.getElementById('app-loader');
    if (appLoader) appLoader.classList.remove('hidden');
    document.getElementById('app').style.display = 'none';
    document.getElementById('app-potrebnost').classList.add('hidden');
    document.getElementById('app-potrebnost').style.display = 'none';
    document.getElementById('app-analytics').classList.remove('hidden');
    document.getElementById('app-analytics').style.display = 'flex';
    if (!analyticsInitialized) {
        initAnalytics();
        return;
    }
    if (mapAnalytics) mapAnalytics.invalidateSize();
    setTimeout(() => { if (appLoader) appLoader.classList.add('hidden'); }, 180);
}

async function initPotrebnost() {
    const appLoader = document.getElementById('app-loader');
    const appPotrebnost = document.getElementById('app-potrebnost');
    const mapEl = document.getElementById('map-potrebnost');
    if (!mapEl || !appPotrebnost) return;
    try {
        if (appLoader) appLoader.classList.remove('hidden');
        try {
            demandStores = await loadDemandData();
        } catch (demandErr) {
            demandStores = [];
            console.warn('Потребность: данные с сервера недоступны, показываем пустую карту', demandErr);
        }
        if (appLoader) appLoader.classList.add('hidden');
        appPotrebnost.classList.remove('hidden');
        appPotrebnost.style.display = 'flex';
        setServiceNavActive('potrebnost');

        if (!mapPotrebnost) {
            const center = CONFIG.MAP_CENTER || [55.75, 37.61];
            const zoom = CONFIG.MAP_ZOOM != null ? CONFIG.MAP_ZOOM : 10;
            mapPotrebnost = L.map('map-potrebnost', {
                center: center,
                zoom: zoom,
                zoomControl: true,
                touchZoom: true,
                doubleClickZoom: true,
                scrollWheelZoom: true
            });
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap',
                maxZoom: 19,
                minZoom: 5
            }).addTo(mapPotrebnost);
        }
        fillDemandJobFilter();
        renderDemandMarkers();
        potrebnostInitialized = true;
        setTimeout(() => { if (mapPotrebnost) mapPotrebnost.invalidateSize(); }, 100);
    } catch (err) {
        console.error('Ошибка инициализации Потребности:', err);
        if (appLoader) appLoader.classList.add('hidden');
        alert('Ошибка загрузки данных потребности. Проверьте консоль и URL API.');
    }
}

async function initApp() {
    try {
        const passwordScreen = document.getElementById('password-screen');
        const app = document.getElementById('app');
        
        if (!passwordScreen || !app) {
            console.error('Required DOM elements not found');
            return;
        }
        
        passwordScreen.style.display = 'none';
        const appLoader = document.getElementById('app-loader');
        if (appLoader) appLoader.classList.remove('hidden');

        await loadData();

        if (stores.length === 0) {
            if (appLoader) appLoader.classList.add('hidden');
            alert('Не удалось загрузить данные о ТК. Проверьте файл stores_final.csv');
            return;
        }

        if (appLoader) appLoader.classList.add('hidden');
        app.style.display = 'flex';
        setServiceNavActive('obezdy');

        initMap();
        updateStats();
        
        // Периодическая синхронизация — только если настроен Google Sheets
        if (CONFIG.SHEETS_API_URL) {
            setInterval(async () => {
                await loadDataFromServer();
                Object.keys(markers).forEach(tk => updateMarkerColor(tk));
            }, 30000);
        }
    } catch (error) {
        console.error('Error initializing app:', error);
        alert('Ошибка инициализации приложения: ' + error.message);
    }
}

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    const passwordInput = document.getElementById('password-input');
    if (passwordInput) {
        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') checkPassword();
        });
    }
    
    const tkSearchInput = document.getElementById('tk-search-input');
    if (tkSearchInput) {
        tkSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchTK();
        });
    }
    const tkSearchPotrebnost = document.getElementById('tk-search-potrebnost');
    if (tkSearchPotrebnost) {
        tkSearchPotrebnost.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchTKPotrebnost();
        });
    }
    
    // Обработка изменения размера экрана
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (map) map.invalidateSize();
            if (mapPotrebnost) mapPotrebnost.invalidateSize();
        }, 250);
    });
    
    // Предотвращение масштабирования при двойном тапе (только для карты)
    let lastTap = 0;
    document.addEventListener('touchend', (e) => {
        // Проверяем, что тап не на интерактивном элементе
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') {
            return;
        }
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTap;
        if (tapLength < 300 && tapLength > 0 && e.target.closest('#map')) {
            e.preventDefault();
        }
        lastTap = currentTime;
    }, false);
});
