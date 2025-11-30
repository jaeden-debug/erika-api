// src/server.js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { ServerClient } from 'postmark';
import { appendSubscriber } from './googleSheets.js';

dotenv.config({ path: '.env' });

const {
  PORT = 8080,
  POSTMARK_SERVER_TOKEN,
  ERIKA_SUBSCRIBE_TO,
  ERIKA_SUBSCRIBE_FROM,
} = process.env;

if (!POSTMARK_SERVER_TOKEN) {
  console.warn('⚠ POSTMARK_SERVER_TOKEN not set. Emails will fail.');
}
if (!ERIKA_SUBSCRIBE_FROM) {
  console.warn('⚠ ERIKA_SUBSCRIBE_FROM not set.');
}

const app = express();
const postmarkClient = new ServerClient(POSTMARK_SERVER_TOKEN || '');

// basic hardening
app.use(helmet());
app.use(cors());
app.use(express.json());

app.use(
  '/subscribe',
  rateLimit({
    windowMs: 60 * 1000,
    max: 20,
  })
);

// Health check
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'ErikaAPI', time: new Date().toISOString() });
});

// Main endpoint: called by MyFreeCams form
app.post('/subscribe', async (req, res) => {
  try {
    const { email, source = 'myfreecams', tag = '' } = req.body || {};

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required.' });
    }

    // 1. Log to Google Sheet
    const row = await appendSubscriber({ email, source, tag });

    // 2. Welcome email to subscriber
    if (POSTMARK_SERVER_TOKEN && ERIKA_SUBSCRIBE_FROM) {
      await postmarkClient.sendEmail({
        From: ERIKA_SUBSCRIBE_FROM,
        To: email,
        Subject: 'Welcome to Just Erika 💋',
        TextBody:
          'Thanks for subscribing to Erika. Watch your inbox for drops and offers. 💋',
        HtmlBody: `
          <html>
            <body style="font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; background:#050509; color:#f5f5f5;">
              <h2>Welcome to Just Erika 💋</h2>
              <p>Thanks for subscribing. You’ll get exclusive updates, drops, and offers.</p>
              <p>
                Shop + links:<br />
                <a href="https://justerika.com" style="color:#f38ecb" target="_blank">https://justerika.com</a>
              </p>
            </body>
          </html>
        `,
        MessageStream: 'outbound',
      });
    }

    // 3. Notify you
    if (POSTMARK_SERVER_TOKEN && ERIKA_SUBSCRIBE_TO && ERIKA_SUBSCRIBE_FROM) {
      await postmarkClient.sendEmail({
        From: ERIKA_SUBSCRIBE_FROM,
        To: ERIKA_SUBSCRIBE_TO,
        Subject: `New Erika subscriber: ${email}`,
        TextBody: `New subscriber.\n\nEmail: ${email}\nSource: ${source}\nTag: ${tag}\nTime: ${row.timestamp}`,
      });
    }

    return res.status(200).json({ ok: true, email });
  } catch (err) {
    console.error('Error in /subscribe:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 ErikaAPI listening on http://localhost:${PORT}`);
});