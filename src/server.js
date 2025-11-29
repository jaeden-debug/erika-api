import express from "express";
import cors from "cors";
import { ServerClient } from "postmark";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const client = new ServerClient(process.env.POSTMARK_SERVER_TOKEN);

app.post("/erikaAPI", async (req, res) => {
  try {
    const email = req.body.email;
    const source = req.body.source || "unknown_source";
    const tag = req.body.tag || "Intimate Drops";

    console.log("📨 Received signup:", { email, source, tag });

    if (!email)
      return res.status(400).json({ error: "Missing email" });

    // 🔥 Send the email to your inbox or mailing list via Postmark
    await client.sendEmail({
      From: process.env.FROM_EMAIL,
      To: process.env.TO_EMAIL,
      Subject: `New Subscriber: ${email}`,
      TextBody: `Source: ${source}\nTag: ${tag}\nEmail: ${email}`,
      MessageStream: "outbound"
    });

    return res.json({ success: true, message: "Subscriber stored" });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Erika API running on port ${PORT}`);
});