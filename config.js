const CONFIG = {
    PASSWORD: "445566",
    APP_NAME: "Монитор Лента",
    MAP_CENTER: [55.75, 37.61],
    MAP_ZOOM: 10,
    OUR_OFFICE: "Максутов",
    USER_NAME: "Менеджер", // Можно изменить на имя конкретного менеджера
    COLORS: {
        OUR: '#10B981',
        OTHER: '#3B82F6',
        NONE: '#9CA3AF'
    },
    // URL задеплоенного Google Apps Script (вставь после деплоя).
    // Пока пустая строка — данные хранятся локально через node server.js.
    SHEETS_API_URL: "https://script.google.com/macros/s/AKfycbyW1PNsjxqW_GgHWEa2li9MkcsSQvKcYqr5PdSNKuAg3i3ZNjUqr1CgHwpHuVUaLTCh/exec"
};

function checkPassword() {
    const input = document.getElementById('password-input').value;
    if (input === CONFIG.PASSWORD) {
        initApp();
    } else {
        alert('Неверный пароль');
    }
}
