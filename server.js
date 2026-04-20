const express = require("express");
const session = require("express-session");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { getPool, initDatabase } = require("./db");

const app = express();
const port = process.env.PORT || 3000;

const publicDir = path.join(__dirname, "public");
const uploadsDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const adminAccounts = {
  academics: { username: "academics", password: "1234", name: "Dr. Sharma", department: "Academics", role: "Academic Admin" },
  canteen: { username: "canteen", password: "1234", name: "Mr. Patil", department: "Canteen", role: "Manager" },
  lab: { username: "lab", password: "1234", name: "Ms. Joshi", department: "Lab", role: "Incharge" },
  library: { username: "library", password: "1234", name: "Mrs. Kulkarni", department: "Library", role: "Librarian" },
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "student-portal-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
    },
  })
);

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use("/uploads", express.static(uploadsDir));
app.use(express.static(publicDir));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    cb(null, `${Date.now()}-${uuidv4().slice(0, 8)}${extension}`);
  },
});

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

const uploadProof = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file || allowedMimeTypes.has(file.mimetype)) {
      return cb(null, true);
    }

    cb(new Error("Only images, PDF, DOC, DOCX, and TXT proof files are allowed."));
  },
});

function normalizeToken(token) {
  return String(token || "").trim().toUpperCase();
}

function getHistoryCutoff(range) {
  const now = new Date();

  if (range === "week") {
    now.setDate(now.getDate() - 7);
    return now;
  }

  if (range === "month") {
    now.setMonth(now.getMonth() - 1);
    return now;
  }

  return null;
}

function generateRandomValue(prefix, length) {
  return `${prefix}${uuidv4().replace(/-/g, "").slice(0, length).toUpperCase()}`;
}

function formatDate(value) {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString();
}

function mapStudent(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    password: row.password,
    token: row.token,
    createdAt: formatDate(row.created_at),
  };
}

function mapToken(row) {
  if (!row) {
    return null;
  }

  return {
    token: row.token,
    createdAt: formatDate(row.created_at),
    createdBy: row.created_by,
    usedByStudentId: row.used_by_student_id,
    usedByUsername: row.used_by_username,
    usedAt: formatDate(row.used_at),
  };
}

function mapComplaint(row) {
  if (!row) {
    return null;
  }

  const hasFeedback = row.feedback_mood || row.feedback_message || row.feedback_submitted_at;

  return {
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    file: row.file_path,
    status: row.status,
    action: row.action_text,
    action_date: formatDate(row.action_date),
    created_at: formatDate(row.created_at),
    feedback: hasFeedback
      ? {
          mood: row.feedback_mood || "unknown",
          message: row.feedback_message || "",
          submitted_at: formatDate(row.feedback_submitted_at),
        }
      : null,
    studentId: row.student_id,
    studentUsername: row.student_username,
  };
}

async function findCurrentStudent(req) {
  if (!req.session.studentId) {
    return null;
  }

  const [rows] = await getPool().query("SELECT * FROM students WHERE id = ? LIMIT 1", [req.session.studentId]);
  return mapStudent(rows[0]);
}

async function requireStudent(req, res, next) {
  try {
    const student = await findCurrentStudent(req);

    if (!student) {
      return res.status(401).json({ error: "Student login required." });
    }

    req.student = student;
    next();
  } catch (error) {
    next(error);
  }
}

function requireAdmin(req, res, next) {
  if (!req.session.adminUsername) {
    return res.status(401).json({ error: "Admin login required." });
  }

  const admin = adminAccounts[req.session.adminUsername];

  if (!admin) {
    req.session.adminUsername = null;
    return res.status(401).json({ error: "Admin session expired." });
  }

  req.admin = admin;
  next();
}

function sanitizeStudent(student) {
  return {
    id: student.id,
    username: student.username,
    token: student.token,
    createdAt: student.createdAt,
  };
}

function sanitizeAdmin(admin) {
  return {
    username: admin.username,
    name: admin.name,
    department: admin.department,
    role: admin.role,
  };
}

app.get("/api/student/session", async (req, res) => {
  const student = await findCurrentStudent(req);

  if (!student) {
    return res.json({ authenticated: false });
  }

  res.json({
    authenticated: true,
    student: sanitizeStudent(student),
  });
});

app.post("/api/student/token/validate", async (req, res) => {
  const tokenValue = normalizeToken(req.body.token);
  const [rows] = await getPool().query("SELECT * FROM tokens WHERE token = ? LIMIT 1", [tokenValue]);
  const token = mapToken(rows[0]);

  if (!token) {
    return res.status(404).json({ error: "Token not found." });
  }

  if (token.usedByStudentId) {
    return res.status(400).json({ error: "This token has already been used. Please login instead." });
  }

  res.json({
    message: "Token verified successfully.",
    token: token.token,
    createdAt: token.createdAt,
  });
});

app.post("/api/student/register", async (req, res) => {
  const tokenValue = normalizeToken(req.body.token);
  const mode = req.body.mode === "system" ? "system" : "custom";
  const pool = getPool();
  const [tokenRows] = await pool.query("SELECT * FROM tokens WHERE token = ? LIMIT 1", [tokenValue]);
  const token = mapToken(tokenRows[0]);

  if (!token) {
    return res.status(404).json({ error: "Token not found." });
  }

  if (token.usedByStudentId) {
    return res.status(400).json({ error: "This token has already been used. Please login instead." });
  }

  let username = String(req.body.username || "").trim();
  let password = String(req.body.password || "").trim();

  if (mode === "system") {
    let matchingRows = [];

    do {
      username = `student${Math.floor(1000 + Math.random() * 9000)}`;
      [matchingRows] = await pool.query("SELECT id FROM students WHERE LOWER(username) = LOWER(?) LIMIT 1", [username]);
    } while (matchingRows.length > 0);

    password = generateRandomValue("PW", 8);
  } else {
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    const [matchingRows] = await pool.query("SELECT id FROM students WHERE LOWER(username) = LOWER(?) LIMIT 1", [username]);

    if (matchingRows.length > 0) {
      return res.status(400).json({ error: "Username already exists. Please choose another one." });
    }
  }

  const student = {
    id: uuidv4(),
    username,
    password,
    token: token.token,
    createdAt: new Date().toISOString(),
  };

  const studentCreatedAt = new Date(student.createdAt);
  const usedAt = new Date();

  await pool.query(
    "INSERT INTO students (id, username, password, token, created_at) VALUES (?, ?, ?, ?, ?)",
    [student.id, student.username, student.password, student.token, studentCreatedAt]
  );
  await pool.query(
    "UPDATE tokens SET used_by_student_id = ?, used_by_username = ?, used_at = ? WHERE token = ?",
    [student.id, student.username, usedAt, token.token]
  );

  req.session.studentId = student.id;

  res.json({
    message: "Student account created successfully.",
    student: sanitizeStudent(student),
    generatedCredentials: mode === "system",
    credentials: {
      username: student.username,
      password: student.password,
    },
  });
});

app.post("/api/student/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "").trim();
  const [rows] = await getPool().query(
    "SELECT * FROM students WHERE LOWER(username) = LOWER(?) AND password = ? LIMIT 1",
    [username, password]
  );
  const student = mapStudent(rows[0]);

  if (!student) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  req.session.studentId = student.id;

  res.json({
    message: "Login successful.",
    student: sanitizeStudent(student),
  });
});

app.post("/api/student/logout", (req, res) => {
  req.session.studentId = null;
  res.json({ message: "Logged out successfully." });
});

app.post("/api/admin/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "").trim();
  const admin = adminAccounts[username];

  if (!admin || admin.password !== password) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  req.session.adminUsername = admin.username;

  res.json({
    message: "Login successful.",
    admin: sanitizeAdmin(admin),
  });
});

app.get("/api/admin/session", (req, res) => {
  const admin = adminAccounts[req.session.adminUsername];

  if (!admin) {
    return res.json({ authenticated: false });
  }

  res.json({
    authenticated: true,
    admin: sanitizeAdmin(admin),
  });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.adminUsername = null;
  res.json({ message: "Logged out successfully." });
});

app.post("/api/admin/tokens/generate", requireAdmin, async (req, res) => {
  const count = Math.min(Math.max(Number(req.body.count) || 0, 1), 500);
  const prefix = String(req.body.prefix || "STU").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "") || "STU";
  const pool = getPool();
  const createdAt = new Date();
  const generated = [];

  while (generated.length < count) {
    const tokenValue = `${prefix}-${uuidv4().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const [existingRows] = await pool.query("SELECT token FROM tokens WHERE token = ? LIMIT 1", [tokenValue]);

    if (existingRows.length > 0 || generated.some((item) => item.token === tokenValue)) {
      continue;
    }

    generated.push({
      token: tokenValue,
      createdAt,
      createdBy: req.admin.username,
      usedByStudentId: null,
      usedByUsername: null,
      usedAt: null,
    });
  }

  for (const token of generated) {
    await pool.query(
      `
        INSERT INTO tokens (token, created_at, created_by, used_by_student_id, used_by_username, used_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [token.token, token.createdAt, token.createdBy, null, null, null]
    );
  }

  res.json({
    message: `${generated.length} token(s) created successfully.`,
    tokens: generated,
  });
});

app.get("/api/admin/tokens", requireAdmin, async (req, res) => {
  const [rows] = await getPool().query("SELECT * FROM tokens ORDER BY created_at DESC");
  res.json(rows.map(mapToken));
});

app.post("/register-complaint", requireStudent, uploadProof.single("proof"), async (req, res) => {
  const id = "CMP-" + uuidv4().slice(0, 6).toUpperCase();
  const title = String(req.body.title || "").trim();
  const description = String(req.body.description || "").trim();
  const category = String(req.body.category || "").trim();
  const filePath = req.file ? `/uploads/${req.file.filename}` : null;
  const createdAt = new Date();

  if (!title || !description || !category) {
    return res.status(400).json({ error: "Title, department, and description are required." });
  }

  try {
    await getPool().query(
      `
        INSERT INTO complaints (
          id, title, category, description, file_path, status, action_text, action_date, created_at,
          feedback_mood, feedback_message, feedback_submitted_at, student_id, student_username
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        title,
        category,
        description,
        filePath,
        "Pending",
        "Created",
        createdAt,
        createdAt,
        null,
        null,
        null,
        req.student.id,
        req.student.username,
      ]
    );

    res.json({
      id,
      file: filePath,
      message: "Complaint submitted successfully.",
    });
  } catch (err) {
    console.error("Failed to save complaint", err);
    res.status(500).json({ error: "Failed to register complaint." });
  }
});

app.get("/track", async (req, res) => {
  const id = String(req.query.id || "").trim();

  if (!id) {
    return res.redirect("/track.html");
  }

  res.redirect(`/track.html?id=${encodeURIComponent(id)}`);
});

app.get("/api/track/:id", async (req, res) => {
  try {
    const [rows] = await getPool().query("SELECT * FROM complaints WHERE id = ? LIMIT 1", [req.params.id]);
    const row = mapComplaint(rows[0]);

    if (!row) {
      return res.status(404).json({ error: "Complaint not found." });
    }

    res.json({
      id: row.id,
      title: row.title,
      category: row.category,
      description: row.description,
      file: row.file,
      status: row.status,
      action: row.action,
      action_date: row.action_date,
      created_at: row.created_at,
      feedback: row.feedback,
    });
  } catch (err) {
    console.error("Failed to track complaint", err);
    res.status(500).json({ error: "Failed to load complaint status." });
  }
});

app.get("/api/complaints", requireAdmin, async (req, res) => {
  const { history, department } = req.query;
  const cutoff = getHistoryCutoff(history);

  try {
    const requestedDepartment =
      req.admin.department && req.admin.department !== "All Departments" ? req.admin.department : department;
    const filters = [];
    const values = [];

    if (requestedDepartment && requestedDepartment !== "All Departments") {
      filters.push("category = ?");
      values.push(requestedDepartment);
    }

    if (cutoff) {
      filters.push("created_at >= ?");
      values.push(cutoff);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    const [rows] = await getPool().query(`SELECT * FROM complaints ${whereClause} ORDER BY created_at DESC`, values);

    res.json(rows.map(mapComplaint));
  } catch (err) {
    console.error("Failed to fetch complaints", err);
    res.status(500).json({ error: "Failed to load complaints." });
  }
});

app.get("/api/complaints/:id", requireAdmin, async (req, res) => {
  try {
    const [rows] = await getPool().query("SELECT * FROM complaints WHERE id = ? LIMIT 1", [req.params.id]);
    const row = mapComplaint(rows[0]);

    if (!row) {
      return res.status(404).json({ error: "Complaint not found." });
    }

    res.json(row);
  } catch (err) {
    console.error("Failed to fetch complaint", err);
    res.status(500).json({ error: "Failed to load complaint." });
  }
});

app.post("/resolve/:id", requireAdmin, async (req, res) => {
  const actionDate = new Date();
  const actionText = String(req.body.action || "").trim();

  try {
    const [rows] = await getPool().query("SELECT id FROM complaints WHERE id = ? LIMIT 1", [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Complaint not found." });
    }

    await getPool().query(
      "UPDATE complaints SET status = ?, action_text = ?, action_date = ? WHERE id = ?",
      ["Resolved", actionText || "Resolved", actionDate, req.params.id]
    );

    res.json({ message: "Complaint updated successfully." });
  } catch (err) {
    console.error("Failed to resolve complaint", err);
    res.status(500).json({ error: "Failed to update complaint." });
  }
});

app.post("/feedback/:id", async (req, res) => {
  const { mood, message } = req.body;

  try {
    const [rows] = await getPool().query("SELECT id, status, feedback_submitted_at FROM complaints WHERE id = ? LIMIT 1", [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Complaint not found." });
    }

    if (rows[0].status !== "Resolved") {
      return res.status(400).json({ error: "Feedback can be shared after the complaint is resolved." });
    }

    if (rows[0].feedback_submitted_at) {
      return res.status(400).json({ error: "Feedback has already been submitted for this complaint." });
    }

    await getPool().query(
      `
        UPDATE complaints
        SET feedback_mood = ?, feedback_message = ?, feedback_submitted_at = ?
        WHERE id = ?
      `,
      [mood || "unknown", message || "", new Date(), req.params.id]
    );

    res.json({ message: "Feedback saved successfully." });
  } catch (err) {
    console.error("Failed to save feedback", err);
    res.status(500).json({ error: "Failed to save feedback." });
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Proof file is too large. Maximum size is 5 MB." });
    }

    return res.status(400).json({ error: error.message || "Failed to upload proof file." });
  }

  if (error && error.message && error.message.includes("proof files")) {
    return res.status(400).json({ error: error.message });
  }

  console.error("Unexpected server error", error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({ error: "Internal server error." });
});

initDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize MySQL database.", error);
    process.exit(1);
  });
