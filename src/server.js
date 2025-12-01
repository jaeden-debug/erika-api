// src/server.js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { ServerClient } from 'postmark';
import { appendSubscriber, appendSubscriberToSheet } from './googleSheets.js';

dotenv.config({ path: '.env' });

const {
  PORT = 8080,
  POSTMARK_SERVER_TOKEN,

  // Erika env
  ERIKA_SUBSCRIBE_TO,
  ERIKA_SUBSCRIBE_FROM,
  POSTMARK_WELCOME_TEMPLATE_ID,
  POSTMARK_NOTIFY_TEMPLATE_ID,

  // StillAwake env
  STILLAWAKE_SHEET_ID,
  STILLAWAKE_SUBSCRIBE_TO,
  STILLAWAKE_SUBSCRIBE_FROM,
  STILLAWAKE_WELCOME_TEMPLATE_ID,
  STILLAWAKE_NOTIFY_TEMPLATE_ID,
} = process.env;

if (!POSTMARK_SERVER_TOKEN) {
  console.warn('⚠ POSTMARK_SERVER_TOKEN not set. Emails will fail.');
}

/** Erika warnings **/
if (!ERIKA_SUBSCRIBE_FROM) {
  console.warn('⚠ ERIKA_SUBSCRIBE_FROM not set.');
}
if (!ERIKA_SUBSCRIBE_TO) {
  console.warn('⚠ ERIKA_SUBSCRIBE_TO not set (owner notification email).');
}
if (!POSTMARK_WELCOME_TEMPLATE_ID) {
  console.warn('⚠ POSTMARK_WELCOME_TEMPLATE_ID not set. Erika welcome email will fall back to basic text.');
}
if (!POSTMARK_NOTIFY_TEMPLATE_ID) {
  console.warn('⚠ POSTMARK_NOTIFY_TEMPLATE_ID not set. Erika owner notification will fall back to basic text.');
}

/** StillAwake warnings **/
if (!STILLAWAKE_SHEET_ID) {
  console.warn('⚠ STILLAWAKE_SHEET_ID not set. StillAwake subscriptions will fail to write to Sheets.');
}
if (!STILLAWAKE_SUBSCRIBE_FROM) {
  console.warn('⚠ STILLAWAKE_SUBSCRIBE_FROM not set.');
}
if (!STILLAWAKE_SUBSCRIBE_TO) {
  console.warn('⚠ STILLAWAKE_SUBSCRIBE_TO not set (StillAwake owner notification email).');
}
if (!STILLAWAKE_WELCOME_TEMPLATE_ID) {
  console.warn('⚠ STILLAWAKE_WELCOME_TEMPLATE_ID not set. StillAwake welcome email will fall back to basic text.');
}
if (!STILLAWAKE_NOTIFY_TEMPLATE_ID) {
  console.warn('⚠ STILLAWAKE_NOTIFY_TEMPLATE_ID not set. StillAwake owner notification will fall back to basic text.');
}

const app = express();
const postmarkClient = new ServerClient(POSTMARK_SERVER_TOKEN || '');

// 🔹 helper to get client IP (works behind proxies too)
function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length > 0) {
    return xf.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || '';
}

// 🔹 helper to pull an email from whatever the form sends
function extractEmail(body = {}) {
  if (!body) return '';

  if (typeof body.email === 'string') return body.email;
  if (typeof body.Email === 'string') return body.Email;
  if (typeof body.emailAddress === 'string') return body.emailAddress;
  if (typeof body['email_address'] === 'string') return body['email_address'];

  // last resort: first string that looks like an email
  for (const value of Object.values(body)) {
    if (typeof value === 'string' && value.includes('@')) {
      return value;
    }
  }

  return '';
}

// basic hardening
app.use(helmet());
app.use(cors());

// allow both JSON (for testing) and HTML forms (urlencoded)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// rate-limit subscribe endpoints
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

/**
 * ORIGINAL ERIKA ENDPOINT
 * POST /subscribe
 */
app.post('/subscribe', async (req, res) => {
  try {
    const { email, source = 'myfreecams', tag = '' } = req.body || {};
    const signupIp = getClientIp(req);

    console.log('📨 [Erika] Incoming payload:', req.body, 'ip=', signupIp);

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      console.warn('⚠ [Erika] Invalid or missing email, returning 400');
      return res.status(400).json({ error: 'Valid email is required.' });
    }

    // 1. Log to Erika Google Sheet
    const row = await appendSubscriber({ email, source, tag });
    console.log('📗 [Erika] Logged to Google Sheet:', row);

    const signupTimestamp = row.timestamp;

    // 2. Welcome email to subscriber (Erika)
    if (POSTMARK_SERVER_TOKEN && ERIKA_SUBSCRIBE_FROM) {
      try {
        const welcomeModel = {
          email,
          source,
          tag,
          timestamp: signupTimestamp,
          subscriber_email: email,
          signup_ip: signupIp,
          signup_source: source,
          signup_timestamp: signupTimestamp,
        };

        console.log('📤 [Erika] Welcome TemplateModel:', welcomeModel);

        if (POSTMARK_WELCOME_TEMPLATE_ID) {
          await postmarkClient.sendEmailWithTemplate({
            From: ERIKA_SUBSCRIBE_FROM,
            To: email,
            TemplateId: Number(POSTMARK_WELCOME_TEMPLATE_ID),
            TemplateModel: welcomeModel,
            MessageStream: 'outbound',
          });
          console.log('✉️ [Erika] Sent welcome email via template to subscriber.');
        } else {
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
          console.log('✉️ [Erika] Sent fallback welcome email to subscriber.');
        }
      } catch (emailErr) {
        console.error('❌ [Erika] Error sending welcome email:', emailErr);
      }
    } else {
      console.warn('⚠ [Erika] Skipping welcome email – missing POSTMARK_SERVER_TOKEN or ERIKA_SUBSCRIBE_FROM');
    }

    // 3. Notify you (Erika admin notification)
    if (POSTMARK_SERVER_TOKEN && ERIKA_SUBSCRIBE_TO && ERIKA_SUBSCRIBE_FROM) {
      try {
        const notifyModel = {
          email,
          source,
          tag,
          timestamp: signupTimestamp,
          subscriber_email: email,
          signup_ip: signupIp,
          signup_source: source,
          signup_timestamp: signupTimestamp,
        };

        console.log('📤 [Erika] Notify TemplateModel:', notifyModel);

        if (POSTMARK_NOTIFY_TEMPLATE_ID) {
          await postmarkClient.sendEmailWithTemplate({
            From: ERIKA_SUBSCRIBE_FROM,
            To: ERIKA_SUBSCRIBE_TO,
            TemplateId: Number(POSTMARK_NOTIFY_TEMPLATE_ID),
            TemplateModel: notifyModel,
            MessageStream: 'outbound',
          });
          console.log('✉️ [Erika] Sent owner notification via template.');
        } else {
          await postmarkClient.sendEmail({
            From: ERIKA_SUBSCRIBE_FROM,
            To: ERIKA_SUBSCRIBE_TO,
            Subject: `New Erika subscriber: ${email}`,
            TextBody: `New subscriber.\n\nEmail: ${email}\nSource: ${source}\nTag: ${tag}\nTime: ${notifyModel.signup_timestamp}\nIP: ${notifyModel.signup_ip}`,
            MessageStream: 'outbound',
          });
          console.log('✉️ [Erika] Sent fallback owner notification email.');
        }
      } catch (notifyErr) {
        console.error('❌ [Erika] Error sending owner notification email:', notifyErr);
      }
    } else {
      console.warn('⚠ [Erika] Skipping owner notification – missing config (token/from/to)');
    }

    return res.status(200).json({ ok: true, email });
  } catch (err) {
    console.error('❌ Error in /subscribe (Erika):', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * STILLAWAKE MEDIA ENDPOINT
 * POST /subscribe/stillawake
 */
app.post('/subscribe/stillawake', async (req, res) => {
  try {
    const rawBody = req.body || {};
    const email = extractEmail(rawBody);
    const source = rawBody.source || 'stillawake_footer';
    const tag = rawBody.tag || 'newsletter';

    const signupIp = getClientIp(req);

    console.log('📨 [StillAwake] Incoming payload:', rawBody, 'resolvedEmail=', email, 'ip=', signupIp);

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      console.warn('⚠ [StillAwake] Invalid or missing email, returning 400');
      return res.status(400).json({ error: 'Valid email is required.' });
    }

    if (!STILLAWAKE_SHEET_ID) {
      console.error('❌ [StillAwake] STILLAWAKE_SHEET_ID not configured.');
      return res
        .status(500)
        .json({ error: 'Server not configured for StillAwake sheet.' });
    }

    // 1. Log to StillAwake Google Sheet
    const row = await appendSubscriberToSheet({
      email,
      source,
      tag,
      sheetId: STILLAWAKE_SHEET_ID,
    });
    console.log('📘 [StillAwake] Logged to Google Sheet:', row);

    const signupTimestamp = row.timestamp;

    // 2. Welcome email to subscriber (StillAwake)
    if (POSTMARK_SERVER_TOKEN && STILLAWAKE_SUBSCRIBE_FROM) {
      try {
        const welcomeModel = {
          email,
          source,
          tag,
          timestamp: signupTimestamp,
          subscriber_email: email,
          signup_ip: signupIp,
          signup_source: source,
          signup_timestamp: signupTimestamp,
        };

        console.log('📤 [StillAwake] Welcome TemplateModel:', welcomeModel);

        if (STILLAWAKE_WELCOME_TEMPLATE_ID) {
          await postmarkClient.sendEmailWithTemplate({
            From: STILLAWAKE_SUBSCRIBE_FROM,
            To: email,
            TemplateId: Number(STILLAWAKE_WELCOME_TEMPLATE_ID),
            TemplateModel: welcomeModel,
            MessageStream: 'outbound',
          });
          console.log('✉️ [StillAwake] Sent welcome email via template to subscriber.');
        } else {
          await postmarkClient.sendEmail({
            From: STILLAWAKE_SUBSCRIBE_FROM,
            To: email,
            Subject: 'Welcome to StillAwake Media',
            TextBody:
              'Thanks for subscribing to StillAwake Media. Ambition never sleeps.',
            HtmlBody: `
              <html>
                <body style="font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; background:#050509; color:#f5f5f5;">
                  <h2>Welcome to StillAwake Media</h2>
                  <p>Thanks for subscribing. You’ll get tools, ideas, and updates to fuel your next moves.</p>
                  <p>
                    More:<br />
                    <a href="https://stillawakemedia.com" style="color:#E09A43" target="_blank">https://stillawakemedia.com</a>
                  </p>
                </body>
              </html>
            `,
            MessageStream: 'outbound',
          });
          console.log('✉️ [StillAwake] Sent fallback welcome email to subscriber.');
        }
      } catch (emailErr) {
        console.error('❌ [StillAwake] Error sending welcome email:', emailErr);
      }
    } else {
      console.warn('⚠ [StillAwake] Skipping welcome email – missing POSTMARK_SERVER_TOKEN or STILLAWAKE_SUBSCRIBE_FROM');
    }

    // 3. Notify you (StillAwake admin notification)
    if (POSTMARK_SERVER_TOKEN && STILLAWAKE_SUBSCRIBE_TO && STILLAWAKE_SUBSCRIBE_FROM) {
      try {
        const notifyModel = {
          email,
          source,
          tag,
          timestamp: signupTimestamp,
          subscriber_email: email,
          signup_ip: signupIp,
          signup_source: source,
          signup_timestamp: signupTimestamp,
        };

        console.log('📤 [StillAwake] Notify TemplateModel:', notifyModel);

        if (STILLAWAKE_NOTIFY_TEMPLATE_ID) {
          await postmarkClient.sendEmailWithTemplate({
            From: STILLAWAKE_SUBSCRIBE_FROM,
            To: STILLAWAKE_SUBSCRIBE_TO,
            TemplateId: Number(STILLAWAKE_NOTIFY_TEMPLATE_ID),
            TemplateModel: notifyModel,
            MessageStream: 'outbound',
          });
          console.log('✉️ [StillAwake] Sent owner notification via template.');
        } else {
          await postmarkClient.sendEmail({
            From: STILLAWAKE_SUBSCRIBE_FROM,
            To: STILLAWAKE_SUBSCRIBE_TO,
            Subject: `New StillAwake subscriber: ${email}`,
            TextBody: `New subscriber.\n\nEmail: ${email}\nSource: ${source}\nTag: ${tag}\nTime: ${notifyModel.signup_timestamp}\nIP: ${notifyModel.signup_ip}`,
            MessageStream: 'outbound',
          });
          console.log('✉️ [StillAwake] Sent fallback owner notification email.');
        }
      } catch (notifyErr) {
        console.error('❌ [StillAwake] Error sending owner notification email:', notifyErr);
      }
    } else {
      console.warn('⚠ [StillAwake] Skipping owner notification – missing config (token/from/to)');
    }

    return res.status(200).json({ ok: true, email });
  } catch (err) {
    console.error('❌ Error in /subscribe/stillawake:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Optional alias: /api/erikaAPI -> /subscribe (Erika only)
app.post('/api/erikaAPI', (req, res, next) => {
  req.url = '/subscribe';
  app._router.handle(req, res, next);
});

app.listen(PORT, () => {
  console.log(`🚀 ErikaAPI listening on http://localhost:${PORT}`);
  console.log('Env summary:', {
    hasPostmarkToken: !!POSTMARK_SERVER_TOKEN,
    erika: {
      from: !!ERIKA_SUBSCRIBE_FROM,
      to: !!ERIKA_SUBSCRIBE_TO,
      welcomeTpl: !!POSTMARK_WELCOME_TEMPLATE_ID,
      notifyTpl: !!POSTMARK_NOTIFY_TEMPLATE_ID,
    },
    stillawake: {
      sheet: !!STILLAWAKE_SHEET_ID,
      from: !!STILLAWAKE_SUBSCRIBE_FROM,
      to: !!STILLAWAKE_SUBSCRIBE_TO,
      welcomeTpl: !!STILLAWAKE_WELCOME_TEMPLATE_ID,
      notifyTpl: !!STILLAWAKE_NOTIFY_TEMPLATE_ID,
    },
  });
});

export default app;