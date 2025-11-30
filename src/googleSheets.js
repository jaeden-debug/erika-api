// src/googleSheets.js
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_REFRESH_TOKEN,
  GOOGLE_SHEET_ID,
} = process.env;

if (!GOOGLE_SHEET_ID) {
  throw new Error('GOOGLE_SHEET_ID is not set in .env');
}

if (!GOOGLE_REFRESH_TOKEN) {
  console.warn('⚠ GOOGLE_REFRESH_TOKEN is not set. Sheets writes will fail.');
}

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: GOOGLE_REFRESH_TOKEN,
});

const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

export async function appendSubscriber({ email, source = 'myfreecams', tag = '' }) {
  const now = new Date();
  const timestamp = now.toISOString();

  const values = [[email, source, tag, timestamp]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: 'Sheet1!A:D', // Email, Source, Tag, Timestamp
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });

  return { email, source, tag, timestamp };
}