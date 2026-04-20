const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const complaintsFile = path.join(__dirname, "complaints.json");
const studentsFile = path.join(__dirname, "students.json");
const tokensFile = path.join(__dirname, "student-tokens.json");

let pool;

function readLegacyJson(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) {
    return defaultValue;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`Failed to parse legacy JSON file: ${filePath}`, error);
    return defaultValue;
  }
}

function normalizeDate(value) {
  if (!value) {
    return new Date();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function ensureDatabase() {
  const config = {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "#@mrudula@29",
  };
  const databaseName = process.env.DB_NAME || "complaint_portal";

  const connection = await mysql.createConnection(config);

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\``);
  } finally {
    await connection.end();
  }

  pool = mysql.createPool({
    ...config,
    database: databaseName,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
}

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      id VARCHAR(36) PRIMARY KEY,
      username VARCHAR(255) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      token VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tokens (
      token VARCHAR(255) PRIMARY KEY,
      created_at DATETIME NOT NULL,
      created_by VARCHAR(255) NOT NULL,
      used_by_student_id VARCHAR(36) NULL,
      used_by_username VARCHAR(255) NULL,
      used_at DATETIME NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaints (
      id VARCHAR(36) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      category VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      file_path VARCHAR(255) NULL,
      status VARCHAR(100) NOT NULL,
      action_text VARCHAR(255) NOT NULL,
      action_date DATETIME NOT NULL,
      created_at DATETIME NOT NULL,
      feedback_mood VARCHAR(100) NULL,
      feedback_message TEXT NULL,
      feedback_submitted_at DATETIME NULL,
      student_id VARCHAR(36) NULL,
      student_username VARCHAR(255) NULL
    )
  `);

  await pool.query("ALTER TABLE complaints MODIFY student_id VARCHAR(36) NULL");
  await pool.query("ALTER TABLE complaints MODIFY student_username VARCHAR(255) NULL");
}

async function migrateStudentsIfNeeded() {
  const [rows] = await pool.query("SELECT COUNT(*) AS count FROM students");

  if (rows[0].count > 0) {
    return;
  }

  const students = readLegacyJson(studentsFile, []);

  for (const student of students) {
    await pool.query(
      "INSERT INTO students (id, username, password, token, created_at) VALUES (?, ?, ?, ?, ?)",
      [student.id, student.username, student.password, student.token, normalizeDate(student.createdAt)]
    );
  }
}

async function migrateTokensIfNeeded() {
  const [rows] = await pool.query("SELECT COUNT(*) AS count FROM tokens");

  if (rows[0].count > 0) {
    return;
  }

  const tokens = readLegacyJson(tokensFile, []);

  for (const token of tokens) {
    await pool.query(
      `
        INSERT INTO tokens (token, created_at, created_by, used_by_student_id, used_by_username, used_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        token.token,
        normalizeDate(token.createdAt),
        token.createdBy || "system",
        token.usedByStudentId || null,
        token.usedByUsername || null,
        token.usedAt ? normalizeDate(token.usedAt) : null,
      ]
    );
  }
}

async function migrateComplaintsIfNeeded() {
  const [rows] = await pool.query("SELECT COUNT(*) AS count FROM complaints");

  if (rows[0].count > 0) {
    return;
  }

  const complaints = readLegacyJson(complaintsFile, []);

  for (const complaint of complaints) {
    await pool.query(
      `
        INSERT INTO complaints (
          id, title, category, description, file_path, status, action_text, action_date, created_at,
          feedback_mood, feedback_message, feedback_submitted_at, student_id, student_username
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        complaint.id,
        complaint.title,
        complaint.category,
        complaint.description,
        complaint.file || null,
        complaint.status || "Pending",
        complaint.action || "Created",
        normalizeDate(complaint.action_date),
        normalizeDate(complaint.created_at),
        complaint.feedback?.mood || null,
        complaint.feedback?.message || null,
        complaint.feedback?.submitted_at ? normalizeDate(complaint.feedback.submitted_at) : null,
        complaint.studentId,
        complaint.studentUsername || "",
      ]
    );
  }
}

async function initDatabase() {
  if (pool) {
    return pool;
  }

  await ensureDatabase();
  await createTables();
  await migrateStudentsIfNeeded();
  await migrateTokensIfNeeded();
  await migrateComplaintsIfNeeded();

  return pool;
}

function getPool() {
  if (!pool) {
    throw new Error("Database pool has not been initialized.");
  }

  return pool;
}

module.exports = {
  getPool,
  initDatabase,
};
