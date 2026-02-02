let map;
let stores = [];
let visits = [];
let tasks = [];
let plans = [];
let markers = {};
let statsChart = null;

const COLORS = { OUR: 'green', OTHER: 'blue', NONE: 'gray' };

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
    return diffDays <= days;
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
    const el = document.querySelector(`.marker[data-tk="${tkNumber}"]`);
    if (el) {
        el.className = `marker marker-${color}`;
        el.setAttribute('data-tk', tkNumber);
    }
}

async function loadData() {
    const response = await fetch('stores_final.csv');
    const csvText = await response.text();
    stores = parseCSV(csvText);
    
    visits = await localforage.getItem('visits') || [];
    tasks = await localforage.getItem('tasks') || [];
    plans = await localforage.getItem('plans') || [];
}

function initMap() {
    map = L.map('map').setView([55.75, 37.61], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);
    
    stores.forEach(store => {
        const color = getMarkerColor(store.tk_number);
        const officesLabel = getOfficesLabel(store);
        
        const marker = L.marker([store.lat, store.lng], {
            icon: L.divIcon({
                html: `<div class="marker marker-${color}" data-tk="${store.tk_number}" title="${officesLabel}">${store.tk_number}</div>`,
                className: 'custom-marker',
                iconSize: [36, 36]
            })
        }).addTo(map);
        
        marker.bindTooltip(`<strong>ТК ${store.tk_number}</strong><br>${officesLabel}`, {
            permanent: false,
            direction: 'top',
            className: 'marker-tooltip',
            offset: [0, -20]
        });
        
        marker.on('click', () => showTKPanel(store.tk_number));
        markers[store.tk_number] = marker;
    });
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
            <strong>${v.date}</strong> ${v.user || 'Саша'}: ${v.comment ? `"${v.comment}"` : '—'}
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
        user: 'Саша',
        comment: document.getElementById('visit-comment').value || '',
        our_presence: document.getElementById('our-presence').checked,
        other_presence: document.getElementById('other-presence').checked
    };
    
    visits.unshift(visit);
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
        note: document.getElementById('plan-note').value || ''
    };
    plans.push(plan);
    await localforage.setItem('plans', plans);
    closeModal();
}

async function completeTask(tkNumber) {
    const task = tasks.find(t => t.tk == tkNumber && !t.done);
    if (task) {
        task.done = true;
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

async function initApp() {
    document.getElementById('password-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    
    await loadData();
    initMap();
    updateStats();
}

document.getElementById('password-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') checkPassword();
});
