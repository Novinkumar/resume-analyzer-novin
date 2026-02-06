console.log("🔥🔥🔥 RUNNING THIS SERVER.JS FILE 🔥🔥🔥");

require("dotenv").config();

const express = require("express");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const fs = require("fs");
const cors = require("cors");
const path = require("path");
const Tesseract = require("tesseract.js");
const OpenAI = require("openai");

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();

// ===============================
// MIDDLEWARE
// ===============================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===============================
// ROOT TEST
// ===============================
app.get("/", (req, res) => {
  res.send("Resume Analyzer Backend Running ✅");
});

// ===============================
// MONGODB
// ===============================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) =>
    console.error("❌ MongoDB connection error:", err)
  );

// ===============================
// OPENROUTER CLIENT
// ===============================
const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "AI Resume Analyzer",
  },
});

// ===============================
// UPLOAD CONFIG
// ===============================
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ===============================
// USER MODEL
// ===============================
const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String,
});

const User = mongoose.model("User", UserSchema);

// ===============================
// AUTH ROUTES
// ===============================

// REGISTER
app.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    const exists = await User.findOne({ email });
    if (exists)
      return res.status(400).json({ error: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);

    await User.create({
      email,
      password: hashed,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Register failed" });
  }
});

// LOGIN  ✅ RETURNS TOKEN
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user)
      return res.status(401).json({ error: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);

    if (!match)
      return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      token,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ===============================
// ANALYZE
// ===============================
app.post("/analyze", upload.single("resume"), async (req, res) => {
  try {
    const jobDescription = req.body.jobDescription || "";

    if (!req.file)
      return res.status(400).json({ error: "No file uploaded" });

    const buffer = fs.readFileSync(req.file.path);

    let text = "";

    const ext = path.extname(req.file.originalname).toLowerCase();
    const mime = req.file.mimetype;

    const isPdf =
      mime === "application/pdf" || ext === ".pdf";

    const isImage =
      mime.startsWith("image/") ||
      [".png", ".jpg", ".jpeg"].includes(ext);

    if (isPdf) {
      const data = await pdfParse(buffer);
      text = data.text.toLowerCase();
    } else if (isImage) {
      const result = await Tesseract.recognize(req.file.path, "eng");
      text = result.data.text.toLowerCase();
    } else {
      return res.status(400).json({
        error: "Upload PDF or image",
      });
    }

    const skillsList = [
      "java",
      "python",
      "flutter",
      "react",
      "node",
      "javascript",
      "sql",
      "aws",
      "docker",
      "mongodb",
      "kubernetes",
      "azure",
    ];

    const skillStrength = {};
    const foundSkills = [];

    skillsList.forEach((skill) => {
      const regex = new RegExp(`\\b${skill}\\b`, "g");
      const count = (text.match(regex) || []).length;

      if (count > 0) foundSkills.push(skill);
      skillStrength[skill] = count;
    });

    const jdText = jobDescription.toLowerCase();

    const jdSkills = skillsList.filter((s) =>
      jdText.includes(s)
    );

    const matchingSkills = foundSkills.filter((s) =>
      jdSkills.includes(s)
    );

    const missingSkills = jdSkills.filter(
      (s) => !foundSkills.includes(s)
    );

    const fitScore =
      jdSkills.length === 0
        ? 0
        : Math.round(
            (matchingSkills.length / jdSkills.length) * 100
          );

    res.json({
      success: true,
      skills: foundSkills,
      skillStrength,
      fitScore,
      matchingSkills,
      missingSkills,
    });
  } catch (err) {
    console.error("Analyze error:", err);
    res.status(500).json({ error: "Failed to analyze resume" });
  }
});

// ===============================
// INTERVIEW
// ===============================
app.post("/interview", upload.single("resume"), async (req, res) => {
  try {
    const jobDescription = req.body.jobDescription || "";

    if (!req.file)
      return res.status(400).json({ error: "No file uploaded" });

    const buffer = fs.readFileSync(req.file.path);

    let text = "";

    if (req.file.mimetype.includes("pdf")) {
      const data = await pdfParse(buffer);
      text = data.text;
    } else {
      const result = await Tesseract.recognize(req.file.path, "eng");
      text = result.data.text;
    }

    const prompt = `
You are an interview coach.

Resume:
${text.substring(0, 2500)}

Job description:
${jobDescription}

Generate:

TECHNICAL QUESTIONS (5)
BEHAVIORAL QUESTIONS (5)
SYSTEM DESIGN PROMPTS (3)
CODING TOPICS (5)

Return JSON.
`;

    const completion = await client.chat.completions.create({
      model: "openai/gpt-4o-mini",
      messages: [
        { role: "system", content: "Interview coach" },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    });

    res.json({
      success: true,
      interviewPrep: completion.choices[0].message.content,
    });
  } catch (err) {
    console.error("Interview error:", err);
    res.status(500).json({
      error: "Failed to generate interview prep",
    });
  }
});
// ===============================
// HISTORY STORE (TEMP IN MEMORY)
// ===============================

let historyStore = [];

// Save analysis
app.post("/save-history", (req, res) => {
  const record = {
    score: req.body.score,
    skills: req.body.skills || [],
    createdAt: new Date(),
  };

  historyStore.unshift(record);

  res.json({ success: true });
});

// Get history
app.get("/history", (req, res) => {
  res.json(historyStore);
});

// ===============================
// START SERVER
// ===============================
app.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});
