console.log("🔥🔥🔥 RUNNING THIS SERVER.JS FILE 🔥🔥🔥");

require("dotenv").config();
const safeParse = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;

  try {
    return JSON.parse(val);
  } catch {
    return [];
  }
};
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
    "HTTP-Referer": "https://resume-analyzer-novin.onrender.com",
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

    const isPdf = ext === ".pdf";
    const isImage = [".png", ".jpg", ".jpeg"].includes(ext);

    if (isPdf) {
      const data = await pdfParse(buffer);
      text = data.text;
    } else if (isImage) {
      const result = await Tesseract.recognize(req.file.path, "eng");
      text = result.data.text;
    } else {
      return res.status(400).json({ error: "Upload PDF or image" });
    }

    // ========= AI ANALYSIS =========
    const prompt = `
You are an ATS resume analyzer.

Resume:
${text.substring(0, 4000)}

Job Description:
${jobDescription}

Return STRICT JSON:

{
  "atsScore": number,
  "fitScore": number,
  "skillStrength": { "skill": number },
  "matchingSkills": [],
  "missingSkills": []
}
`;

    const completion = await client.chat.completions.create({
      model: "openai/gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: "ATS engine" },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices[0].message.content;

    // Clean JSON if model wraps markdown
    const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];

    const parsed = JSON.parse(jsonText);

    res.json({
      success: true,
      ...parsed,
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
    ${text.substring(0, 3000)}

    Job Description:
    ${jobDescription}

    Generate interview preparation in CLEAN TEXT FORMAT.

    Include:

    TECHNICAL QUESTIONS:
    - 5 items

    BEHAVIORAL QUESTIONS:
    - 5 items

    SYSTEM DESIGN PROMPTS:
    - 3 items

    CODING TOPICS:
    - 5 items

    Rules:
    - NO JSON
    - NO curly brackets {}
    - NO code blocks
    - Use headings and bullet points only
    - Human readable
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


const PDFDocument = require("pdfkit");

app.post(
  "/generate-report",
  upload.none(),
  async (req, res) => {
    try {
      const {
        score,
        fitScore,
        skills,
        matchingSkills,
        missingSkills,
        interviewPrep,
      } = req.body;

      const skillsArr = safeParse(skills);
      const matchingArr = safeParse(matchingSkills);
      const missingArr = safeParse(missingSkills);

      const doc = new PDFDocument({ margin: 40 });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=resume_report.pdf"
      );

      doc.pipe(res);

      // ===== TITLE =====
      doc.fontSize(24).text("AI Resume Analysis Report", {
        align: "center",
      });

      doc.moveDown();

      doc.fontSize(14).text(`Generated on: ${new Date().toLocaleString()}`);

      doc.moveDown(2);

      // ===== SCORES =====
      doc.fontSize(18).text("Summary Scores");
      doc.moveDown();
      doc.text(`ATS Score: ${score}%`);
      doc.text(`Fit Score: ${fitScore}%`);

      doc.moveDown(2);

      // ===== SKILLS =====
      doc.fontSize(18).text("Skills Found");

      skillsArr.forEach((s) => {
        doc.text(`• ${s}`);
      });

      doc.moveDown();

      // ===== MATCHING =====
      doc.fontSize(18).text("Matching Skills");

      matchingArr.forEach((s) => {
        doc.fillColor("green").text(`✔ ${s}`);
      });

      doc.fillColor("black");
      doc.moveDown();

      // ===== MISSING =====
      doc.fontSize(18).text("Missing Skills");

      missingArr.forEach((s) => {
        doc.fillColor("red").text(`✖ ${s}`);
      });

      doc.fillColor("black");
      doc.moveDown();

      // ===== INTERVIEW =====
      if (interviewPrep) {
        doc.addPage();
        doc.fontSize(20).text("Interview Preparation");
        doc.moveDown();
        doc.fontSize(11).text(interviewPrep);
      }

      doc.end();
    } catch (err) {
      console.error("PDF ERROR:", err);

      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate PDF" });
      }
    }
  }
);

// ===============================
// START SERVER
// ===============================
app.listen(3000, () => {
  console.log("🚀 Server running on https://resume-analyzer-novin.onrender.com");
});
