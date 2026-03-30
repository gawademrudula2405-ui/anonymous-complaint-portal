const express = require("express");
const multer = require("multer");
const sqlite3 = require("sqlite3").verbose();
const { v4: uuidv4 } = require("uuid");
const session = require("express-session");
const nodemailer = require("nodemailer");

const app = express();
const db = new sqlite3.Database("./complaints.db");

app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: "secret123",
    resave: false,
    saveUninitialized: true
}));

// EMAIL CONFIG
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "your_email@gmail.com",
        pass: "your_app_password"
    }
});

// FILE UPLOAD
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/"),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage });

// TABLES
db.serialize(() => {

    db.run(`CREATE TABLE IF NOT EXISTS complaints(
        id TEXT PRIMARY KEY,
        title TEXT,
        category TEXT,
        description TEXT,
        file TEXT,
        status TEXT,
        action TEXT,
        action_date TEXT,
        created_at TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admins(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        category TEXT
    )`);

    db.run(`INSERT OR IGNORE INTO admins(username,password,category) VALUES
        ('hod','123','academics'),
        ('lab','123','lab')
    `);

});

// REGISTER COMPLAINT
app.post("/register", upload.single("file"), (req, res) => {
    const { title, category, description } = req.body;
    const id = "CMP-" + uuidv4().slice(0, 6).toUpperCase();
    const file = req.file ? req.file.filename : null;

    db.run(`INSERT INTO complaints VALUES(?,?,?,?,?,?,?, ?, datetime('now'))`,
        [id, title, category, description, file, "Pending", "", ""],
        () => {

            // EMAIL TO ADMIN
            let adminEmail = category === "academics"
                ? "hod@gmail.com"
                : "lab@gmail.com";

            transporter.sendMail({
                from: "your_email@gmail.com",
                to: adminEmail,
                subject: "New Complaint",
                text: `ID: ${id}\nTitle: ${title}\nCategory: ${category}`
            });

            res.send(`Complaint Registered! Your ID: ${id}`);
        }
    );
});

// TRACK
app.get("/track/:id", (req, res) => {
    db.get(`SELECT * FROM complaints WHERE id=?`, [req.params.id], (err, row) => {
        if (!row) return res.send("Not Found");
        res.json(row);
    });
});

// ADMIN LOGIN
app.post("/admin-login", (req, res) => {
    const { username, password } = req.body;

    db.get(`SELECT * FROM admins WHERE username=? AND password=?`,
        [username, password],
        (err, admin) => {
            if (!admin) return res.send("Invalid Login");

            req.session.admin = admin;
            res.redirect("/admin/panel.html");
        }
    );
});

// CHECK AUTH
app.get("/check-auth", (req, res) => {
    if (!req.session.admin) return res.status(401).send("Unauthorized");
    res.send("OK");
});

// LOGOUT
app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/admin/login.html");
    });
});

// GET COMPLAINTS
app.get("/admin-complaints", (req, res) => {
    if (!req.session.admin) return res.status(401).send("Unauthorized");

    db.all(`SELECT * FROM complaints WHERE category=?`,
        [req.session.admin.category],
        (err, rows) => res.json(rows)
    );
});

// UPDATE
app.post("/update", (req, res) => {
    const { id, status, action } = req.body;

    db.run(`UPDATE complaints 
        SET status=?, action=?, action_date=datetime('now')
        WHERE id=?`,
        [status, action, id],
        () => res.send("Updated")
    );
});

// HISTORY
app.get("/history/:type", (req, res) => {
    let query = "";

    if (req.params.type === "recent")
        query = "date(action_date)=date('now')";
    else if (req.params.type === "week")
        query = "action_date >= date('now','-7 days')";
    else
        query = "strftime('%m',action_date)=strftime('%m','now')";

    db.all(`SELECT * FROM complaints WHERE ${query}`, (err, rows) => {
        res.json(rows);
    });
});

// PROFILE
app.get("/profile", (req, res) => {
    if (!req.session.admin) return res.status(401).send("Unauthorized");
    res.json(req.session.admin);
});

// NOTIFICATIONS
app.get("/notifications", (req, res) => {
    if (!req.session.admin) return res.status(401).send("Unauthorized");

    db.get(
        `SELECT COUNT(*) as count FROM complaints 
         WHERE category=? AND status='Pending'`,
        [req.session.admin.category],
        (err, row) => res.json(row)
    );
});

app.listen(3000, () => console.log("Server running on port 3000"));