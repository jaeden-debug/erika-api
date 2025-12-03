// src/server.js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { ServerClient } from 'postmark';
import { appendSubscriber, appendSubscriberToSheet } from './googleSheets.js';

// Load environment variables (local dev)
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
  STILLAWAKE_NOTIFY_TEMPLATE_ID
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
app.set('trust proxy', 1); // important when behind a proxy (Vercel, etc.)

const postmarkClient = new ServerClient(POSTMARK_SERVER_TOKEN || '');

// helper to get client IP
function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length > 0) {
    return xf.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || '';
}

// helper to pull an email from whatever the form sends
function extractEmail(body = {}) {
  if (!body) return '';

  if (typeof body.email === 'string') return body.email;
  if (typeof body.Email === 'string') return body.Email;
  if (typeof body.emailAddress === 'string') return body.emailAddress;
  if (typeof body['email_address'] === 'string') return body['email_address'];

  for (const value of Object.values(body)) {
    if (typeof value === 'string' && value.includes('@')) {
      return value;
    }
  }

  return '';
}

// security + body parsing
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// rate-limit subscribe endpoints
app.use(
  '/subscribe',
  rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false
  })
);

// === Erika landing page HTML ===
const ERIKA_LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Just Erika — Intimate Drops</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text",
        -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: radial-gradient(circle at top, #1a1016, #050509 55%, #000 100%);
      color: #f7f2f8;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .page {
      width: 100%;
      max-width: 480px;
      border-radius: 24px;
      padding: 24px 20px 20px;
      background:
        radial-gradient(circle at top left, rgba(255,255,255,0.08), transparent 55%),
        rgba(7, 7, 9, 0.96);
      box-shadow:
        0 0 0 1px rgba(255,255,255,0.06),
        0 24px 60px rgba(0,0,0,0.95),
        0 0 32px rgba(255,46,159,0.55);
      backdrop-filter: blur(18px);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 4px 14px;
      border-radius: 999px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.22em;
      color: #ffc0ea;
      border: 1px solid rgba(255,192,234,0.8);
      background:
        radial-gradient(circle at 0% 0%, rgba(255,192,234,0.45), transparent 60%),
        rgba(15,15,15,0.96);
      margin-bottom: 10px;
    }
    h1 {
      font-size: 26px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    h1 span {
      color: #ff2e9f;
    }
    .tagline {
      font-size: 14px;
      color: rgba(255,255,255,0.85);
      margin-bottom: 18px;
    }
    .copy {
      font-size: 13px;
      line-height: 1.6;
      color: rgba(255,255,255,0.84);
      margin-bottom: 18px;
    }
    form {
      margin-top: 8px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .field-wrap {
      flex: 1 1 220px;
      min-width: 0;
    }
    input[type="email"] {
      width: 100%;
      padding: 9px 12px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.22);
      background: rgba(0,0,0,0.7);
      color: #fff;
      font-size: 13px;
      outline: none;
    }
    input[type="email"]::placeholder {
      color: rgba(255,255,255,0.5);
    }
    button {
      flex: 0 0 auto;
      padding: 9px 18px;
      border-radius: 999px;
      border: none;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      cursor: pointer;
      background: linear-gradient(
        to bottom,
        #ffffff 0%,
        #f7f7f7 35%,
        #ededed 70%,
        #dcdcdc 100%
      );
      color: #111;
      box-shadow:
        0 0 0 1px rgba(255,255,255,0.9),
        0 8px 18px rgba(0,0,0,0.9),
        0 0 24px rgba(255,46,159,0.6);
      white-space: nowrap;
    }
    button[disabled] {
      opacity: 0.7;
      cursor: default;
    }
    .status {
      margin-top: 10px;
      font-size: 12px;
      min-height: 1.2em;
    }
    .status.ok {
      color: #7fffb7;
    }
    .status.err {
      color: #ffb3c6;
    }
    .footer {
      margin-top: 18px;
      font-size: 11px;
      opacity: 0.7;
      display: flex;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }
    .footer a {
      color: #ffc0ea;
      text-decoration: none;
    }
    .footer a:hover {
      text-decoration: underline;
    }
    @media (max-width: 480px) {
      .page { padding: 20px 16px 18px; }
      h1 { font-size: 22px; }
      .tagline { font-size: 13px; }
    }
  </style>
</head>
<body>
  <main class="page">
    <div class="badge">INTIMATE DROPS</div>
    <h1>JUST_<span>ERIKA</span></h1>
    <p class="tagline">
      your sweet girl next door with a mouth made for mischief
    </p>
    <p class="copy">
      Drop your email to join my private newsletter. I’ll only tap your inbox
      when I go live, drop new sets, or have something worth losing sleep over.
      No spam — just soft, filthy little alerts when a new piece of me goes live.
    </p>

    <form id="erika-form" method="post" action="/subscribe">
      <div class="field-wrap">
        <input
          type="email"
          name="email"
          placeholder="Your email for intimate alerts"
          required
        />
      </div>
      <input type="hidden" name="source" value="erika_landing" />
      <input type="hidden" name="tag" value="Intimate Drops" />
      <button type="submit" id="erika-submit">Subscribe</button>
    </form>

    <div class="status" id="erika-status"></div>

    <div class="footer">
      <span>Powered by StillAwake Media</span>
      <a href="https://stillawakemedia.com" target="_blank" rel="noopener noreferrer">
        Visit StillAwake
      </a>
    </div>
  </main>

  <script>
    (function () {
      var form = document.getElementById("erika-form");
      var submitBtn = document.getElementById("erika-submit");
      var statusEl = document.getElementById("erika-status");

      if (!form || !submitBtn || !statusEl) return;

      form.addEventListener("submit", function (e) {
        e.preventDefault();

        var formData = new FormData(form);
        var email = formData.get("email");

        if (!email) {
          statusEl.textContent = "Please add your email.";
          statusEl.className = "status err";
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "Sending...";
        statusEl.textContent = "";
        statusEl.className = "status";

        var body = new URLSearchParams();
        formData.forEach(function (value, key) {
          body.append(key, value);
        });

        fetch(form.action, {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
          },
          body: body.toString()
        })
          .then(function (res) {
            if (!res.ok) throw new Error("Bad response");
            return res.json().catch(function () { return {}; });
          })
          .then(function () {
            submitBtn.textContent = "Subscribed";
            statusEl.textContent = "You’re in. Check your inbox in a minute.";
            statusEl.className = "status ok";
          })
          .catch(function () {
            submitBtn.disabled = false;
            submitBtn.textContent = "Try again";
            statusEl.textContent = "Something went wrong. Please try again.";
            statusEl.className = "status err";
          });
      });
    })();
  </script>
</body>
</html>`;

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'ErikaAPI', time: new Date().toISOString() });
});

// Erika landing page at /erika
app.get('/erika', (req, res) => {
  res.type('html').send(ERIKA_LANDING_HTML);
});

// Root serves the same Erika landing page
app.get('/', (req, res) => {
  res.type('html').send(ERIKA_LANDING_HTML);
});

/**
 * ERIKA ENDPOINT
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
          signup_timestamp: signupTimestamp
        };

        console.log('📤 [Erika] Welcome TemplateModel:', welcomeModel);

        if (POSTMARK_WELCOME_TEMPLATE_ID) {
          await postmarkClient.sendEmailWithTemplate({
            From: ERIKA_SUBSCRIBE_FROM,
            To: email,
            TemplateId: Number(POSTMARK_WELCOME_TEMPLATE_ID),
            TemplateModel: welcomeModel,
            MessageStream: 'outbound'
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
            MessageStream: 'outbound'
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
          signup_timestamp: signupTimestamp
        };

        console.log('📤 [Erika] Notify TemplateModel:', notifyModel);

        if (POSTMARK_NOTIFY_TEMPLATE_ID) {
          await postmarkClient.sendEmailWithTemplate({
            From: ERIKA_SUBSCRIBE_FROM,
            To: ERIKA_SUBSCRIBE_TO,
            TemplateId: Number(POSTMARK_NOTIFY_TEMPLATE_ID),
            TemplateModel: notifyModel,
            MessageStream: 'outbound'
          });
          console.log('✉️ [Erika] Sent owner notification via template.');
        } else {
          await postmarkClient.sendEmail({
            From: ERIKA_SUBSCRIBE_FROM,
            To: ERIKA_SUBSCRIBE_TO,
            Subject: `New Erika subscriber: ${email}`,
            TextBody: `New subscriber.\n\nEmail: ${email}\nSource: ${source}\nTag: ${tag}\nTime: ${notifyModel.signup_timestamp}\nIP: ${notifyModel.signup_ip}`,
            MessageStream: 'outbound'
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
      sheetId: STILLAWAKE_SHEET_ID
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
          signup_timestamp: signupTimestamp
        };

        console.log('📤 [StillAwake] Welcome TemplateModel:', welcomeModel);

        if (STILLAWAKE_WELCOME_TEMPLATE_ID) {
          await postmarkClient.sendEmailWithTemplate({
            From: STILLAWAKE_SUBSCRIBE_FROM,
            To: email,
            TemplateId: Number(STILLAWAKE_WELCOME_TEMPLATE_ID),
            TemplateModel: welcomeModel,
            MessageStream: 'outbound'
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
            MessageStream: 'outbound'
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
          signup_timestamp: signupTimestamp
        };

        console.log('📤 [StillAwake] Notify TemplateModel:', notifyModel);

        if (STILLAWAKE_NOTIFY_TEMPLATE_ID) {
          await postmarkClient.sendEmailWithTemplate({
            From: STILLAWAKE_SUBSCRIBE_FROM,
            To: STILLAWAKE_SUBSCRIBE_TO,
            TemplateId: Number(STILLAWAKE_NOTIFY_TEMPLATE_ID),
            TemplateModel: notifyModel,
            MessageStream: 'outbound'
          });
          console.log('✉️ [StillAwake] Sent owner notification via template.');
        } else {
          await postmarkClient.sendEmail({
            From: STILLAWAKE_SUBSCRIBE_FROM,
            To: STILLAWAKE_SUBSCRIBE_TO,
            Subject: `New StillAwake subscriber: ${email}`,
            TextBody: `New subscriber.\n\nEmail: ${email}\nSource: ${source}\nTag: ${tag}\nTime: ${notifyModel.signup_timestamp}\nIP: ${notifyModel.signup_ip}`,
            MessageStream: 'outbound'
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
  // reuse the /subscribe route internally
  req.url = '/subscribe';
  app._router.handle(req, res, next);
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 ErikaAPI listening on http://localhost:${PORT}`);
  console.log('Env summary:', {
    hasPostmarkToken: !!POSTMARK_SERVER_TOKEN,
    erika: {
      from: !!ERIKA_SUBSCRIBE_FROM,
      to: !!ERIKA_SUBSCRIBE_TO,
      welcomeTpl: !!POSTMARK_WELCOME_TEMPLATE_ID,
      notifyTpl: !!POSTMARK_NOTIFY_TEMPLATE_ID
    },
    stillawake: {
      sheet: !!STILLAWAKE_SHEET_ID,
      from: !!STILLAWAKE_SUBSCRIBE_FROM,
      to: !!STILLAWAKE_SUBSCRIBE_TO,
      welcomeTpl: !!STILLAWAKE_WELCOME_TEMPLATE_ID,
      notifyTpl: !!STILLAWAKE_NOTIFY_TEMPLATE_ID
    }
  });
});

export default app;