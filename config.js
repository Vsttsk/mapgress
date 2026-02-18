const CONFIG = {
    PASSWORD: "445566",
    APP_NAME: "Монитор Лента",
    MAP_CENTER: [55.75, 37.61],
    MAP_ZOOM: 10,
    OUR_OFFICE: "Максутов",
    COLORS: {
        OUR: '#10B981',
        OTHER: '#3B82F6',
        NONE: '#9CA3AF'
    }
};

function checkPassword() {
    const input = document.getElementById('password-input').value;
    if (input === CONFIG.PASSWORD) {
        initApp();
    } else {
        alert('Неверный пароль');
    }
}
