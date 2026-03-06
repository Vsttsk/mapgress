const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const url = require('url');

const PORT = 8080;
const DATA_FILE = path.join(__dirname, 'data.json');

// Инициализация файла данных, если его нет
async function initDataFile() {
    try {
        await fs.access(DATA_FILE);
    } catch {
        await fs.writeFile(DATA_FILE, JSON.stringify({
            visits: [],
            tasks: [],
            plans: [],
            store_positions: [],
            highlighted: []
        }, null, 2));
    }
}

async function readData() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading data:', error);
        return { visits: [], tasks: [], plans: [], store_positions: [], highlighted: [] };
    }
}

async function writeData(data) {
    try {
        await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error writing data:', error);
        return false;
    }
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    // API: Получить все данные
    if (pathname === '/api/data' && req.method === 'GET') {
        const data = await readData();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
    }
    
    // API: Сохранить данные
    if (pathname === '/api/data' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
            try {
                const newData = JSON.parse(body);
                const currentData = await readData();
                
                // Объединяем данные
                const updatedData = {
                    visits: newData.visits ?? currentData.visits,
                    tasks: newData.tasks ?? currentData.tasks,
                    plans: newData.plans ?? currentData.plans,
                    store_positions: newData.store_positions ?? currentData.store_positions,
                    highlighted: newData.highlighted ?? currentData.highlighted
                };
                
                const success = await writeData(updatedData);
                
                if (success) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Failed to write data' }));
                }
            } catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
        return;
    }
    
    // Статические файлы
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(__dirname, filePath);
    
    // Безопасность: проверяем, что файл внутри директории проекта
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    
    try {
        const data = await fs.readFile(filePath);
        const ext = path.extname(filePath);
        const contentType = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.csv': 'text/csv',
            '.json': 'application/json'
        }[ext] || 'application/octet-stream';
        
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    } catch (error) {
        res.writeHead(404);
        res.end('File not found');
    }
});

async function start() {
    await initDataFile();
    server.listen(PORT, () => {
        console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
        console.log(`📁 Данные сохраняются в: ${DATA_FILE}`);
    });
}

start();
