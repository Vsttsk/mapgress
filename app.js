let map;
let stores = [];
let visits = [];
let tasks = [];
let plans = [];
let markers = {};
let statsChart = null;
let editorMode = false;
let activeMarker = null;

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
            html: `<div class="marker marker-${color}" data-tk="${store.tk_number}" title="${officesLabel}">${store.tk_number}</div>`,
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

function updateMarkerVisual(tkNumber, color) {
    const marker = markers[tkNumber];
    if (!marker) return;
    
    const store = stores.find(s => s.tk_number == tkNumber);
    const officesLabel = getOfficesLabel(store);
    
    const isMobile = window.innerWidth < 768;
    const markerSize = isMobile ? 40 : 36;
    
    marker.setIcon(L.divIcon({
        html: `<div class="marker marker-${color}" data-tk="${tkNumber}" title="${officesLabel}">${tkNumber}</div>`,
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
    
    // Сохраняем на сервер (в файл проекта)
    await saveDataToServer();
    
    // Также сохраняем в LocalStorage как кэш
    await localforage.setItem('store_positions', stores.map(s => ({
        tk: s.tk_number,
        lat: s.lat,
        lng: s.lng
    })));
}

// Единый запрос к API — загружает visits/tasks/plans и позиции маркеров
async function loadAllFromServer() {
    const apiUrl = CONFIG.SHEETS_API_URL || '/api/data';
    try {
        const response = await fetch(apiUrl);
        if (response.ok) {
            const data = await response.json();

            visits = data.visits || [];
            tasks  = data.tasks  || [];
            plans  = data.plans  || [];

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
        console.log('⚠️ API недоступен, используем LocalStorage');
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
        }))
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
        return false;
    }
}

function showSaveIndicator(success) {
    const indicator = document.getElementById('save-indicator') || document.createElement('div');
    indicator.id = 'save-indicator';
    indicator.textContent = success ? '✅ Сохранено' : '⚠️ Ошибка сохранения';
    indicator.style.cssText = `
        position: fixed;
        top: 70px;
        right: 16px;
        padding: 8px 16px;
        background: ${success ? '#10B981' : '#EF4444'};
        color: white;
        border-radius: 8px;
        font-size: 13px;
        z-index: 2000;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        animation: slideIn 0.3s ease;
    `;
    
    if (!document.getElementById('save-indicator')) {
        document.body.appendChild(indicator);
    }
    
    setTimeout(() => {
        indicator.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => indicator.remove(), 300);
    }, 2000);
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
    
    const visitsHtml = storeVisits.length ? storeVisits.map((v, i) => `
        <div class="visit-item">
            <strong>${v.date}</strong> <span class="visit-user">${v.user || CONFIG.USER_NAME}</span>: ${v.comment ? `"${v.comment}"` : '—'}
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
    
    // Сохраняем на сервер (в файл проекта)
    await saveDataToServer();
    
    // Также сохраняем в LocalStorage как кэш
    await localforage.setItem('visits', visits);
    
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
    const plan = {
        tk: tkNumber,
        date: document.getElementById('plan-date').value,
        note: document.getElementById('plan-note').value || '',
        timestamp: new Date().toISOString()
    };
    plans.push(plan);
    
    // Сохраняем на сервер (в файл проекта)
    await saveDataToServer();
    
    // Также сохраняем в LocalStorage как кэш
    await localforage.setItem('plans', plans);
    closeModal();
}

async function completeTask(tkNumber) {
    const task = tasks.find(t => t.tk == tkNumber && !t.done);
    if (task) {
        task.done = true;
        
        // Сохраняем на сервер (в файл проекта)
        await saveDataToServer();
        
        // Также сохраняем в LocalStorage как кэш
        await localforage.setItem('tasks', tasks);
        showTKPanel(tkNumber);
    }
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
    activeMarker = null;
    document.getElementById('editor-btn').classList.remove('active');
    document.getElementById('editor-bar').classList.add('hidden');
    document.getElementById('stats-bar').classList.remove('editor-active');
    document.getElementById('app').classList.remove('editor-mode');
    
    // Пересоздаём маркеры в обычном режиме
    Object.keys(markers).forEach(tk => {
        map.removeLayer(markers[tk]);
    });
    markers = {};
    stores.forEach(store => {
        createMarker(store);
    });
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
        app.style.display = 'flex';
        
        await loadData();
        
        if (stores.length === 0) {
            alert('Не удалось загрузить данные о ТК. Проверьте файл stores_final.csv');
            return;
        }
        
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
    
    // Обработка изменения размера экрана
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (map) {
                map.invalidateSize();
            }
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
