import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { google } from "googleapis";
import { Dropbox } from "dropbox";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(cookieParser());

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// --- MOCK DATABASE FOR SYNC (Replace with Firebase/Supabase in production) ---
const sessionStore: Record<string, any> = {};

// --- GOOGLE DRIVE OAUTH ---
const getGoogleClient = () => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google API credentials missing. Please set them in Settings.");
  }
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL || 'http://localhost:3000'}/auth/google/callback`
  );
};

app.get("/api/auth/google/url", (req, res) => {
  try {
    const oauth2Client = getGoogleClient();
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/userinfo.email"],
      prompt: 'consent'
    });
    res.json({ url });
  } catch (error: any) {
    console.error("Google Auth URL error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const oauth2Client = getGoogleClient();
    const { tokens } = await oauth2Client.getToken(code as string);
    res.cookie("google_token", JSON.stringify(tokens), { httpOnly: true, secure: true, sameSite: 'none' });
    res.send(`
      <html>
        <body style="background: #000; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif;">
          <div style="text-align: center;">
            <p>Authentication Successful!</p>
            <p>Connecting you back to NightPaper...</p>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'AUTH_SUCCESS', provider: 'google' }, '*');
              setTimeout(() => window.close(), 1000);
            }
          </script>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error("Google Callback Error:", error);
    res.status(500).send(`Auth Failed: ${error.message}`);
  }
});

// --- DROPBOX OAUTH ---
const getDropboxClient = () => {
  if (!process.env.DROPBOX_CLIENT_ID || !process.env.DROPBOX_CLIENT_SECRET) {
     throw new Error("Dropbox API credentials missing. Please set them in Settings.");
  }
  return new Dropbox({ 
    clientId: process.env.DROPBOX_CLIENT_ID, 
    clientSecret: process.env.DROPBOX_CLIENT_SECRET 
  });
}

app.get("/api/auth/dropbox/url", async (req, res) => {
  try {
    const dbx = getDropboxClient();
    const authUrl = await dbx.auth.getAuthenticationUrl(
      `${process.env.APP_URL || 'http://localhost:3000'}/auth/dropbox/callback`,
      undefined,
      'code',
      'offline',
      undefined,
      'none',
      false
    );
    res.json({ url: authUrl });
  } catch (error: any) {
    console.error("Dropbox Auth URL error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/auth/dropbox/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const dbx = getDropboxClient();
    const response = await dbx.auth.getAccessTokenFromCode(
      `${process.env.APP_URL || 'http://localhost:3000'}/auth/dropbox/callback`,
      code as string
    );
    res.cookie("dropbox_token", JSON.stringify(response.result), { httpOnly: true, secure: true, sameSite: 'none' });
    res.send(`
      <html>
        <body style="background: #000; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif;">
          <div style="text-align: center;">
            <p>Authentication Successful!</p>
            <p>Connecting you back to NightPaper...</p>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'AUTH_SUCCESS', provider: 'dropbox' }, '*');
              setTimeout(() => window.close(), 1000);
            }
          </script>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error("Dropbox Callback Error:", error);
    res.status(500).send(`Dropbox Auth Failed: ${error.message}`);
  }
});

// --- SYNC ENDPOINTS ---
app.post("/api/sync/save", (req, res) => {
  const { sessionId, data } = req.body;
  if (!sessionId) return res.status(400).send("Missing sessionId");
  sessionStore[sessionId] = { ...sessionStore[sessionId], ...data, updatedAt: new Date() };
  res.json({ success: true });
});

app.get("/api/sync/load/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  res.json(sessionStore[sessionId] || {});
});

// --- VITE MIDDLEWARE ---
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
}

setupVite().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
