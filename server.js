const express = require("express");
const fs = require("fs");
const session = require("express-session");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

const publicDir = path.join(__dirname, "public");
const complaintsFile = path.join(__dirname, "complaints.json");
const studentsFile = path.join(__dirname, "students.json");
const tokensFile = path.join(__dirname, "student-tokens.json");

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

app.use(express.static(publicDir));

function ensureJsonFile(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), "utf8");
  }
}

function readJson(filePath, defaultValue) {
  ensureJsonFile(filePath, defaultValue);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function readComplaints() {
  return readJson(complaintsFile, []);
}

function writeComplaints(complaints) {
  writeJson(complaintsFile, complaints);
}

function readStudents() {
  return readJson(studentsFile, []);
}

function writeStudents(students) {
  writeJson(studentsFile, students);
}

function readTokens() {
  return readJson(tokensFile, []);
}

function writeTokens(tokens) {
  writeJson(tokensFile, tokens);
}

function normalizeToken(token) {
  return String(token || "").trim().toUpperCase();
}

function getHistoryCutoff(range) {
  const now = new Date();

  if (range === "week") {
    now.setDate(now.getDate() - 7);
    return now.toISOString();
  }

  if (range === "month") {
    now.setMonth(now.getMonth() - 1);
    return now.toISOString();
  }

  return null;
}

function generateRandomValue(prefix, length) {
  return `${prefix}${uuidv4().replace(/-/g, "").slice(0, length).toUpperCase()}`;
}

function findCurrentStudent(req) {
  if (!req.session.studentId) {
    return null;
  }

  return readStudents().find((student) => student.id === req.session.studentId) || null;
}

function requireStudent(req, res, next) {
  const student = findCurrentStudent(req);

  if (!student) {
    return res.status(401).json({ error: "Student login required." });
  }

  req.student = student;
  next();
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

app.get("/api/student/session", (req, res) => {
  const student = findCurrentStudent(req);

  if (!student) {
    return res.json({ authenticated: false });
  }

  res.json({
    authenticated: true,
    student: sanitizeStudent(student),
  });
});

app.post("/api/student/token/validate", (req, res) => {
  const tokenValue = normalizeToken(req.body.token);
  const token = readTokens().find((item) => item.token === tokenValue);

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

app.post("/api/student/register", (req, res) => {
  const tokenValue = normalizeToken(req.body.token);
  const mode = req.body.mode === "system" ? "system" : "custom";
  const students = readStudents();
  const tokens = readTokens();
  const token = tokens.find((item) => item.token === tokenValue);

  if (!token) {
    return res.status(404).json({ error: "Token not found." });
  }

  if (token.usedByStudentId) {
    return res.status(400).json({ error: "This token has already been used. Please login instead." });
  }

  let username = String(req.body.username || "").trim();
  let password = String(req.body.password || "").trim();

  if (mode === "system") {
    do {
      username = `student${Math.floor(1000 + Math.random() * 9000)}`;
    } while (students.some((student) => student.username.toLowerCase() === username.toLowerCase()));

    password = generateRandomValue("PW", 8);
  } else {
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    if (students.some((student) => student.username.toLowerCase() === username.toLowerCase())) {
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

  students.push(student);
  token.usedByStudentId = student.id;
  token.usedByUsername = student.username;
  token.usedAt = new Date().toISOString();

  writeStudents(students);
  writeTokens(tokens);

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

app.post("/api/student/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "").trim();
  const student = readStudents().find(
    (item) => item.username.toLowerCase() === username.toLowerCase() && item.password === password
  );

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

app.post("/api/admin/tokens/generate", requireAdmin, (req, res) => {
  const count = Math.min(Math.max(Number(req.body.count) || 0, 1), 500);
  const prefix = String(req.body.prefix || "STU").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "") || "STU";
  const tokens = readTokens();
  const createdAt = new Date().toISOString();
  const generated = [];

  while (generated.length < count) {
    const tokenValue = `${prefix}-${uuidv4().replace(/-/g, "").slice(0, 8).toUpperCase()}`;

    if (tokens.some((item) => item.token === tokenValue) || generated.some((item) => item.token === tokenValue)) {
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

  tokens.unshift(...generated);
  writeTokens(tokens);

  res.json({
    message: `${generated.length} token(s) created successfully.`,
    tokens: generated,
  });
});

app.get("/api/admin/tokens", requireAdmin, (req, res) => {
  const tokens = readTokens().sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  res.json(tokens);
});

app.post("/register-complaint", requireStudent, (req, res) => {
  const id = "CMP-" + uuidv4().slice(0, 6).toUpperCase();
  const title = String(req.body.title || "").trim();
  const description = String(req.body.description || "").trim();
  const category = String(req.body.category || "").trim();
  const createdAt = new Date().toISOString();

  if (!title || !description || !category) {
    return res.status(400).json({ error: "Title, department, and description are required." });
  }

  try {
    const complaints = readComplaints();
    complaints.push({
      id,
      title,
      category,
      description,
      file: null,
      status: "Pending",
      action: "Created",
      action_date: createdAt,
      created_at: createdAt,
      feedback: null,
      studentId: req.student.id,
      studentUsername: req.student.username,
    });
    writeComplaints(complaints);

    res.json({
      id,
      message: "Complaint submitted successfully.",
    });
  } catch (err) {
    console.error("Failed to save complaint", err);
    res.status(500).json({ error: "Failed to register complaint." });
  }
});

app.get("/track", (req, res) => {
  const id = req.query.id;

  try {
    const row = readComplaints().find((complaint) => complaint.id === id);

    if (!row) {
      return res.send("<h3>Complaint not found</h3><a href='/track.html'>Back</a>");
    }

    res.send(`
      <h2>Complaint Status</h2>
      <p><b>ID:</b> ${row.id}</p>
      <p><b>Title:</b> ${row.title}</p>
      <p><b>Department:</b> ${row.category}</p>
      <p><b>Student Username:</b> ${row.studentUsername || "-"}</p>
      <p><b>Description:</b> ${row.description || "-"}</p>
      <p><b>Status:</b> ${row.status}</p>
      <p><b>Created At:</b> ${row.created_at || "-"}</p>
      <a href="/track.html">Back</a>
    `);
  } catch (err) {
    console.error("Failed to track complaint", err);
    res.status(500).send("<h3>Something went wrong.</h3>");
  }
});

app.get("/api/complaints", requireAdmin, (req, res) => {
  const { history, department } = req.query;
  const cutoff = getHistoryCutoff(history);

  try {
    const rows = readComplaints()
      .filter((complaint) => {
        const requestedDepartment =
          req.admin.department && req.admin.department !== "All Departments" ? req.admin.department : department;

        if (!requestedDepartment || requestedDepartment === "All Departments") {
          return true;
        }

        return complaint.category === requestedDepartment;
      })
      .filter((complaint) => !cutoff || complaint.created_at >= cutoff)
      .sort((left, right) => new Date(right.created_at) - new Date(left.created_at));

    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch complaints", err);
    res.status(500).json({ error: "Failed to load complaints." });
  }
});

app.get("/api/complaints/:id", requireAdmin, (req, res) => {
  try {
    const row = readComplaints().find((complaint) => complaint.id === req.params.id);

    if (!row) {
      return res.status(404).json({ error: "Complaint not found." });
    }

    res.json(row);
  } catch (err) {
    console.error("Failed to fetch complaint", err);
    res.status(500).json({ error: "Failed to load complaint." });
  }
});

app.post("/resolve/:id", requireAdmin, (req, res) => {
  const actionDate = new Date().toISOString();
  const actionText = String(req.body.action || "").trim();

  try {
    const complaints = readComplaints();
    const complaint = complaints.find((item) => item.id === req.params.id);

    if (!complaint) {
      return res.status(404).json({ error: "Complaint not found." });
    }

    complaint.status = "Resolved";
    complaint.action = actionText || "Resolved";
    complaint.action_date = actionDate;
    writeComplaints(complaints);

    res.json({ message: "Complaint updated successfully." });
  } catch (err) {
    console.error("Failed to resolve complaint", err);
    res.status(500).json({ error: "Failed to update complaint." });
  }
});

app.post("/feedback/:id", (req, res) => {
  const { mood, message } = req.body;

  try {
    const complaints = readComplaints();
    const complaint = complaints.find((item) => item.id === req.params.id);

    if (!complaint) {
      return res.status(404).json({ error: "Complaint not found." });
    }

    complaint.feedback = {
      mood: mood || "unknown",
      message: message || "",
      submitted_at: new Date().toISOString(),
    };

    writeComplaints(complaints);
    res.json({ message: "Feedback saved successfully." });
  } catch (err) {
    console.error("Failed to save feedback", err);
    res.status(500).json({ error: "Failed to save feedback." });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
