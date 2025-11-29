// api/intimate-drops.js
import postmark from "postmark";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const email = req.body?.email;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // Initialize Postmark client using environment variable
    const client = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);

    // Send newsletter alert email to yourself (or store)
    await client.sendEmail({
      From: process.env.FROM_EMAIL,
      To: process.env.TO_EMAIL,
      Subject: "New Newsletter Signup (Intimate Drops)",
      TextBody: `New subscriber: ${email}`
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}