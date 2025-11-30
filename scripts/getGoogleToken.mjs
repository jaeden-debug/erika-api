import http from 'http';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
  console.error('Missing GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI in .env');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

const scopes = ['https://www.googleapis.com/auth/spreadsheets'];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: scopes,
  prompt: 'consent',
});

const PORT = 3000;

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.statusCode = 400;
    return res.end('No URL');
  }

  if (req.url.startsWith('/oauth2callback')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const code = url.searchParams.get('code');

    if (!code) {
      res.statusCode = 400;
      res.end('No code in callback');
      return;
    }

    try {
      const { tokens } = await oauth2Client.getToken(code);
      console.log('\n✅ Tokens received from Google:');
      console.log('Access token:', tokens.access_token);
      console.log('Refresh token:', tokens.refresh_token || '(none!)');

      if (!tokens.refresh_token) {
        console.warn('\n⚠ No refresh token returned. Try again and be sure to re-consent.');
      }

      res.end('All set! You can close this tab and go back to the terminal.');
    } catch (err) {
      console.error('Error exchanging code for tokens:', err);
      res.statusCode = 500;
      res.end('Error getting tokens, check terminal.');
    } finally {
      server.close();
    }
  } else {
    res.statusCode = 404;
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n➡  Auth helper listening on http://localhost:${PORT}`);
  console.log('1) Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\n2) Allow access with the Google account that owns Erika email list.');
  console.log('3) After redirect, check this terminal for your REFRESH TOKEN.\n');
});