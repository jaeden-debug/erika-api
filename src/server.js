// src/server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { ServerClient } from "postmark";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// trust proxy (for when you run behind Vercel / Render / etc)
app.set("trust proxy", 1);

// 🔐 Security headers
app.use(
  helmet({
    contentSecurityPolicy: false, // safe to disable for simple API
  })
);

// 🌍 CORS — lock this down to your real domains
app.use(
  cors({
    origin: [
      "https://justerika.com",
      "https://www.justerika.com",
      "https://admin.blackwateraquatics.ca",
      // add/remove domains as needed
    ],
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// 🔒 Rate limiting for this endpoint
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,                  // 50 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
});

// Body parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Postmark client
const client = new ServerClient(process.env.POSTMARK_SERVER_TOKEN);

// Apply limiter only to this route
app.post("/erikaAPI", limiter, async (req, res) => {
  try {
    const email = (req.body.email || "").trim();
    const source = (req.body.source || "unknown_source").slice(0, 100);
    const tag = (req.body.tag || "Intimate Drops").slice(0, 100);

    console.log("📨 Received signup:", { email, source, tag });

    // basic validation
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: "Valid email is required" });
    }

    await client.sendEmail({
      From: process.env.FROM_EMAIL,
      To: process.env.TO_EMAIL,
      Subject: `New Subscriber: ${email}`,
      TextBody: `Source: ${source}\nTag: ${tag}\nEmail: ${email}`,
      MessageStream: "outbound",
    });

    return res.json({ success: true, message: "Subscriber stored" });
  } catch (err) {
    console.error("Error:", err);
    // don’t leak internals to client
    return res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Erika API running on port ${PORT}`);
});