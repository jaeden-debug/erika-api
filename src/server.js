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
  POSTMARK_WELCOME_TEMPLATE_ID,
  POSTMARK_NOTIFY_TEMPLATE_ID,
} = process.env;

if (!POSTMARK_SERVER_TOKEN) {
  console.warn('⚠ POSTMARK_SERVER_TOKEN not set. Emails will fail.');
}
if (!ERIKA_SUBSCRIBE_FROM) {
  console.warn('⚠ ERIKA_SUBSCRIBE_FROM not set.');
}
if (!ERIKA_SUBSCRIBE_TO) {
  console.warn('⚠ ERIKA_SUBSCRIBE_TO not set (owner notification email).');
}
if (!POSTMARK_WELCOME_TEMPLATE_ID) {
  console.warn('⚠ POSTMARK_WELCOME_TEMPLATE_ID not set. Welcome email will fall back to basic text.');
}
if (!POSTMARK_NOTIFY_TEMPLATE_ID) {
  console.warn('⚠ POSTMARK_NOTIFY_TEMPLATE_ID not set. Owner notification will fall back to basic text.');
}

const app = express();
const postmarkClient = new ServerClient(POSTMARK_SERVER_TOKEN || '');

// basic hardening
app.use(helmet());
app.use(cors());

// allow both JSON (for testing) and HTML forms (urlencoded)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// rate-limit just the subscribe endpoint
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

    console.log('📨 Incoming subscribe payload:', req.body);

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required.' });
    }

    // 1. Log to Google Sheet
    const row = await appendSubscriber({ email, source, tag });
    console.log('📗 Logged to Google Sheet:', row);

    // 2. Welcome email to subscriber
    if (POSTMARK_SERVER_TOKEN && ERIKA_SUBSCRIBE_FROM) {
      try {
        if (POSTMARK_WELCOME_TEMPLATE_ID) {
          await postmarkClient.sendEmailWithTemplate({
            From: ERIKA_SUBSCRIBE_FROM,
            To: email,
            TemplateId: Number(POSTMARK_WELCOME_TEMPLATE_ID),
            TemplateModel: {
              email,
              source,
              tag,
              timestamp: row.timestamp,
            },
            MessageStream: 'outbound',
          });
          console.log('✉️ Sent welcome email via template to subscriber.');
        } else {
          // Fallback: simple text/HTML email
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
                    Links &amp; more:<br />
                    <a href="https://justerika.com" style="color:#f38ecb" target="_blank">https://justerika.com</a>
                  </p>
                </body>
              </html>
            `,
            MessageStream: 'outbound',
          });
          console.log('✉️ Sent fallback welcome email to subscriber.');
        }
      } catch (emailErr) {
        console.error('❌ Error sending welcome email:', emailErr);
      }
    }

    // 3. Notify you
    if (POSTMARK_SERVER_TOKEN && ERIKA_SUBSCRIBE_TO && ERIKA_SUBSCRIBE_FROM) {
      try {
        if (POSTMARK_NOTIFY_TEMPLATE_ID) {
          await postmarkClient.sendEmailWithTemplate({
            From: ERIKA_SUBSCRIBE_FROM,
            To: ERIKA_SUBSCRIBE_TO,
            TemplateId: Number(POSTMARK_NOTIFY_TEMPLATE_ID),
            TemplateModel: {
              email,
              source,
              tag,
              timestamp: row.timestamp,
            },
            MessageStream: 'outbound',
          });
          console.log('✉️ Sent owner notification via template.');
        } else {
          await postmarkClient.sendEmail({
            From: ERIKA_SUBSCRIBE_FROM,
            To: ERIKA_SUBSCRIBE_TO,
            Subject: `New Erika subscriber: ${email}`,
            TextBody: `New subscriber.\n\nEmail: ${email}\nSource: ${source}\nTag: ${tag}\nTime: ${row.timestamp}`,
            MessageStream: 'outbound',
          });
          console.log('✉️ Sent fallback owner notification email.');
        }
      } catch (notifyErr) {
        console.error('❌ Error sending owner notification email:', notifyErr);
      }
    }

    return res.status(200).json({ ok: true, email });
  } catch (err) {
    console.error('❌ Error in /subscribe:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Optional alias: /api/erikaAPI -> /subscribe
app.post('/api/erikaAPI', (req, res, next) => {
  req.url = '/subscribe';
  app._router.handle(req, res, next);
});

app.listen(PORT, () => {
  console.log(`🚀 ErikaAPI listening on http://localhost:${PORT}`);
});

export default app;