// src/server.js
import express from 'express';
import cors from 'cors';
// import helmet from 'helmet'; // removed for now
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
  console.warn(
    '⚠ POSTMARK_WELCOME_TEMPLATE_ID not set. Erika welcome email will fall back to basic text.'
  );
}
if (!POSTMARK_NOTIFY_TEMPLATE_ID) {
  console.warn(
    '⚠ POSTMARK_NOTIFY_TEMPLATE_ID not set. Erika owner notification will fall back to basic text.'
  );
}

/** StillAwake warnings **/
if (!STILLAWAKE_SHEET_ID) {
  console.warn(
    '⚠ STILLAWAKE_SHEET_ID not set. StillAwake subscriptions will fail to write to Sheets.'
  );
}
if (!STILLAWAKE_SUBSCRIBE_FROM) {
  console.warn('⚠ STILLAWAKE_SUBSCRIBE_FROM not set.');
}
if (!STILLAWAKE_SUBSCRIBE_TO) {
  console.warn(
    '⚠ STILLAWAKE_SUBSCRIBE_TO not set (StillAwake owner notification email).'
  );
}
if (!STILLAWAKE_WELCOME_TEMPLATE_ID) {
  console.warn(
    '⚠ STILLAWAKE_WELCOME_TEMPLATE_ID not set. StillAwake welcome email will fall back to basic text.'
  );
}
if (!STILLAWAKE_NOTIFY_TEMPLATE_ID) {
  console.warn(
    '⚠ STILLAWAKE_NOTIFY_TEMPLATE_ID not set. StillAwake owner notification will fall back to basic text.'
  );
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

// ---- security + body parsing (CSP fully removed) ----
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

// === Erika landing page HTML (bg image + glass card) ===
const ERIKA_LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Just Erika — Intimate Drops</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html,
    body {
      height: 100%;
    }

    body {
      min-height: 100vh;
      font-family: system-ui, -apple-system, BlinkMacSystemFont,
        "SF Pro Text", "Segoe UI", sans-serif;
      color: #f7f2f8;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      position: relative;
      overflow: hidden;
      background-color: #000; /* fallback if image fails */
    }

    /* Background image container (non-clickable) */
    .bg {
      position: fixed;
      inset: 0;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 0;
      cursor: default;
      overflow: hidden;
    }

    .bg img {
      width: 100%;
      height: 100%;
      object-fit: cover; /* fill viewport on all devices */
      display: block;
      pointer-events: none; /* extra safety so it never catches clicks */
    }

    /* Darken the image slightly */
    .bg::after {
      content: "";
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.35);
      pointer-events: none;
    }

    .page {
      width: 100%;
      max-width: 520px;
      transition: opacity 0.22s ease, transform 0.22s ease;
      position: relative;
      z-index: 1;
    }

    .card {
      width: 100%;
      border-radius: 26px;
      padding: 24px 20px 18px;
      background: rgba(0, 0, 0, 0.55); /* glass, see-through */
      box-shadow:
        0 0 0 1px rgba(255,255,255,0.05),
        0 18px 50px rgba(0,0,0,0.9),
        0 0 30px rgba(255,46,159,0.55);
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
      border: 1px solid rgba(255,192,234,0.9);
      background:
        radial-gradient(circle at 0% 0%, rgba(255,192,234,0.45), transparent 60%),
        rgba(16,16,18,0.96);
      margin-bottom: 10px;
    }

    h1 {
      font-size: 26px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      margin-bottom: 6px;
    }

    h1 span {
      color: #ff2e9f;
    }

    .tagline {
      font-size: 14px;
      color: rgba(255,255,255,0.88);
      margin-bottom: 8px;
    }

    .copy {
      font-size: 11px;
      line-height: 1.4;
      color: rgba(255,255,255,0.84);
      margin-bottom: 18px;
    }

    form {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 10px;
    }

    .field-label {
      font-size: 10px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.7);
      margin-bottom: 4px;
    }

    .field-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    input[type="text"],
    input[type="email"] {
      width: 100%;
      padding: 9px 12px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.22);
      background: rgba(0,0,0,0.78);
      color: #fff;
      font-size: 13px;
      outline: none;
      transition: border-color 0.18s ease, box-shadow 0.18s ease,
        background 0.18s ease, transform 0.1s ease;
    }

    input[type="text"]::placeholder,
    input[type="email"]::placeholder {
      color: rgba(255,255,255,0.5);
    }

    input[type="text"]:focus,
    input[type="email"]:focus {
      border-color: rgba(255,46,159,0.8);
      box-shadow:
        0 0 0 1px rgba(255,46,159,0.7),
        0 0 22px rgba(255,46,159,0.65);
      background: rgba(0,0,0,0.9);
      transform: translateY(-0.5px);
    }

    .consent-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-top: 4px;
      font-size: 11px;
      color: rgba(255,255,255,0.78);
    }

    .consent-row input[type="checkbox"] {
      margin-top: 2px;
      accent-color: #ff2e9f;
      flex-shrink: 0;
    }

    .consent-row strong {
      font-weight: 600;
      color: #ffc0ea;
    }

    .button-row {
      display: flex;
      justify-content: flex-end;
      margin-top: 4px;
    }

    .btn {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 9px 22px;
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
        0 10px 22px rgba(0,0,0,0.9),
        0 0 26px rgba(255,46,159,0.6);
      white-space: nowrap;
      transition:
        transform 0.12s ease,
        box-shadow 0.12s ease,
        background 0.2s ease,
        color 0.2s ease;
    }

    .btn:hover:not(.is-loading):not(.is-success) {
      transform: translateY(-1px);
      box-shadow:
        0 0 0 1px rgba(255,255,255,1),
        0 16px 30px rgba(0,0,0,0.95),
        0 0 32px rgba(255,46,159,0.7);
    }

    .btn:active:not(.is-loading):not(.is-success) {
      transform: translateY(0);
      box-shadow:
        0 0 0 1px rgba(255,255,255,0.9),
        0 8px 18px rgba(0,0,0,0.9),
        0 0 22px rgba(255,46,159,0.6);
    }

    .btn[disabled] {
      cursor: default;
      opacity: 0.85;
    }

    .btn-content {
      position: relative;
      z-index: 1;
    }

    /* Loader hidden at start */
    .btn-loader {
      display: none;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.4);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      margin: 0 auto;
      pointer-events: none;
    }

    /* Loading State */
    .btn.is-loading .btn-content {
      display: none;
    }

    .btn.is-loading .btn-loader {
      display: inline-block;
    }

    /* Success State */
    .btn.is-success {
      background: radial-gradient(circle at top, #ff2e9f, #ff5ab8 45%, #fdf2ff 120%);
      color: #12030b;
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.95),
        0 20px 40px rgba(0,0,0,0.95),
        0 0 42px rgba(255,46,159,0.95);
      transition: background 0.22s ease, color 0.22s ease, box-shadow 0.22s ease;
    }

    .helper {
      font-size: 11px;
      margin-top: 4px;
      min-height: 1.4em;
      color: rgba(255,255,255,0.75);
      transition: color 0.18s ease, opacity 0.18s ease, transform 0.18s ease;
    }

    .helper.helper-ok {
      color: #9bffd0;
      transform: translateY(-1px);
    }

    .helper.helper-err {
      color: #ffb3c6;
      transform: translateY(-1px);
    }

    .footer {
      margin-top: 16px;
      font-size: 11px;
      opacity: 0.72;
      display: flex;
      justify-content: flex-start;
      gap: 8px;
      flex-wrap: wrap;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    @media (max-width: 520px) {
      body {
        padding: 16px;
      }
      .card {
        padding: 22px 16px 18px;
        border-radius: 22px;
      }
      h1 {
        font-size: 22px;
      }
      .tagline {
        font-size: 13px;
      }
      .button-row {
        justify-content: flex-start;
      }
    }
  </style>
</head>
<body>
  <!-- Background image -->
  <div class="bg" id="erika-bg">
    <img
      src="https://i.imgur.com/lqk625X.jpg"
      alt="Just Erika background"
    />
  </div>

  <main class="page">
    <section class="card" aria-label="Just Erika intimate newsletter signup">
      <div class="badge">INTIMATE DROPS</div>
      <h1>JUST_<span>ERIKA</span></h1>
      <p class="tagline">
        your sweet girl next door with a mouth made for mischief
      </p>
      <p class="copy">
        Drop your details to join my private newsletter. I only touch your inbox
        when something actually matters — live alerts, new sets, and the kind of
        drops that keep you up a little too late.
      </p>

      <form id="erika-form" method="post" action="/subscribe" novalidate>
        <div class="field-group">
          <div class="field-label">FIRST NAME*</div>
          <input
            type="text"
            name="first_name"
            autocomplete="given-name"
            required
          />
        </div>

        <div class="field-group">
          <div class="field-label">EMAIL ADDRESS*</div>
          <input
            type="email"
            name="email"
            autocomplete="email"
            required
          />
        </div>

        <div class="consent-row">
          <input
            id="erika-consent"
            type="checkbox"
            name="is_adult"
            value="true"
            required
          />
          <label for="erika-consent">
            <strong>18+ only.</strong> I confirm I'm an adult and comfortable
            receiving suggestive, sensitive content in my inbox.
          </label>
        </div>

        <!-- Hidden meta fields for your backend -->
        <input type="hidden" name="source" value="erika_landing" />
        <input type="hidden" name="tag" value="Intimate Drops" />

        <div class="button-row">
          <button type="submit" id="erika-submit" class="btn">
            <span class="btn-content">Subscribe</span>
            <span class="btn-loader" aria-hidden="true"></span>
          </button>
        </div>
      </form>

      <div id="erika-helper" class="helper">
        Slide your email in — I only tease your inbox when it’s worth opening.
      </div>

      <div class="footer">
        <span>Powered by StillAwake Media</span>
      </div>
    </section>
  </main>

  <script>
    (function () {
      var form = document.getElementById("erika-form");
      var btn = document.getElementById("erika-submit");
      var helper = document.getElementById("erika-helper");
      if (!form || !btn || !helper) return;

      var labelSpan = btn.querySelector(".btn-content");

      function setHelper(text, kind) {
        helper.textContent = text;
        helper.className = "helper" + (kind ? " helper-" + kind : "");
      }

      form.addEventListener("submit", function (e) {
        e.preventDefault();

        var data = new FormData(form);
        var first = (data.get("first_name") || "").toString().trim();
        var email = (data.get("email") || "").toString().trim();
        var isAdult = document.getElementById("erika-consent").checked;

        if (!first) {
          setHelper(
            "Tell me your name first — I like to know who I’m teasing.",
            "err"
          );
          return;
        }
        if (!email || !email.includes("@")) {
          setHelper("Drop a valid email so I know where to whisper.", "err");
          return;
        }
        if (!isAdult) {
          setHelper(
            "You’ll need to be 18+ to get these kinds of midnight messages.",
            "err"
          );
          return;
        }

        btn.disabled = true;
        btn.classList.add("is-loading");
        labelSpan.textContent = "Sending...";
        setHelper("", "");

        var body = new URLSearchParams();
        data.forEach(function (value, key) {
          body.append(key, value);
        });

        fetch(form.action, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
          },
          body: body.toString()
        })
          .then(function (res) {
            if (!res.ok) throw new Error("Bad response");
            return res.json().catch(function () {
              return {};
            });
          })
          .then(function () {
            btn.classList.remove("is-loading");
            btn.classList.add("is-success");
            labelSpan.textContent = "Subscribed!";
            setHelper(
              "You’re in. Check your inbox for a private link I don’t share anywhere else.",
              "ok"
            );
          })
          .catch(function () {
            btn.disabled = false;
            btn.classList.remove("is-loading");
            labelSpan.textContent = "Try again";
            setHelper(
              "Something glitched. Nudge it again and I’ll behave on the second try.",
              "err"
            );
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
    const {
      email,
      first_name,
      last_name,
      is_adult,
      source = 'erika_landing',
      tag = 'Intimate Drops'
    } = req.body || {};

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
          first_name,
          last_name,
          is_adult,
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
              'Thanks for subscribing to Erika. Watch your inbox for drops and invites I don’t post anywhere else. 💋',
            HtmlBody: `
              <html>
                <body style="font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; background:#050509; color:#f5f5f5;">
                  <h2>Welcome to Just Erika 💋</h2>
                  <p>Thanks for subscribing. You’ll get exclusive updates, drops, and private invites.</p>
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
      console.warn(
        '⚠ [Erika] Skipping welcome email – missing POSTMARK_SERVER_TOKEN or ERIKA_SUBSCRIBE_FROM'
      );
    }

    // 3. Notify you (Erika admin notification)
    if (POSTMARK_SERVER_TOKEN && ERIKA_SUBSCRIBE_TO && ERIKA_SUBSCRIBE_FROM) {
      try {
        const notifyModel = {
          email,
          first_name,
          last_name,
          is_adult,
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
            TextBody: `New subscriber.\n\nEmail: ${email}\nFirst name: ${
              first_name || ''
            }\nLast name: ${last_name || ''}\nAdult: ${
              is_adult ? 'yes' : 'no'
            }\nSource: ${source}\nTag: ${tag}\nTime: ${
              notifyModel.signup_timestamp
            }\nIP: ${notifyModel.signup_ip}`,
            MessageStream: 'outbound'
          });
          console.log('✉️ [Erika] Sent fallback owner notification email.');
        }
      } catch (notifyErr) {
        console.error('❌ [Erika] Error sending owner notification email:', notifyErr);
      }
    } else {
      console.warn(
        '⚠ [Erika] Skipping owner notification – missing config (token/from/to)'
      );
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

    console.log(
      '📨 [StillAwake] Incoming payload:',
      rawBody,
      'resolvedEmail=',
      email,
      'ip=',
      signupIp
    );

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
      console.warn(
        '⚠ [StillAwake] Skipping welcome email – missing POSTMARK_SERVER_TOKEN or STILLAWAKE_SUBSCRIBE_FROM'
      );
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
        console.error(
          '❌ [StillAwake] Error sending owner notification email:',
          notifyErr
        );
      }
    } else {
      console.warn(
        '⚠ [StillAwake] Skipping owner notification – missing config (token/from/to)'
      );
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