const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./complaints.db');

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS complaints (
            complaint_id TEXT PRIMARY KEY,
            title TEXT,
            category TEXT,
            description TEXT,
            file_path TEXT,
            status TEXT DEFAULT 'Pending'
        )
    `);
});

module.exports = db;