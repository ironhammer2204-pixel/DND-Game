import { Router } from "express";
import { createUserSupabaseClient, supabaseAuth } from "../db/supabase";
import { pool } from "../db/client";

const router = Router();
const reservedEmailDomains = new Set(["example.com", "example.org", "example.net"]);

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getEmailDomain(email: string): string | undefined {
  return email.split("@")[1]?.toLowerCase();
}

function authErrorStatus(message: string, fallback: number): number {
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("rate limit")) {
    return 429;
  }

  return fallback;
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  const email = typeof req.body.email === "string" ? normalizeEmail(req.body.email) : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";

  if (!email || !password || !username) {
    return res.status(400).json({ error: "Missing required fields: email, password, username" });
  }

  if (reservedEmailDomains.has(getEmailDomain(email) ?? "")) {
    return res.status(400).json({
      error: "invalid_email_domain",
      message: "Use a real email domain for registration; reserved example domains are rejected."
    });
  }

  try {
    const { data, error } = await supabaseAuth.auth.signUp({
      email,
      password,
      options: {
        data: { username },
      },
    });

    if (error || !data.user) {
      return res.status(authErrorStatus(error?.message || "Registration failed", 400)).json({
        error: error?.message ? "registration_failed" : "registration_failed",
        message: error?.message || "Registration failed"
      });
    }

    const userId = data.user.id;
    // The public.users row is automatically created by the Supabase auth.users database trigger.

    res.status(201).json({
      message: "User registered successfully",
      user: {
        id: userId,
        email,
        username,
      },
      session: data.session,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Internal server error during registration" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const email = typeof req.body.email === "string" ? normalizeEmail(req.body.email) : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (!email || !password) {
    return res.status(400).json({ error: "Missing required fields: email, password" });
  }

  try {
    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user || !data.session) {
      return res.status(authErrorStatus(error?.message || "Login failed", 401)).json({
        error: "login_failed",
        message: error?.message || "Login failed"
      });
    }

    // 2. Fetch user profile from public.users to retrieve username
    const profileRes = await pool.query(
      "SELECT username, avatar_url FROM public.users WHERE id = $1",
      [data.user.id]
    );

    const profile = profileRes.rows[0];

    res.json({
      message: "Login successful",
      session: data.session,
      user: {
        id: data.user.id,
        email: data.user.email,
        username: profile?.username || "Unknown",
        avatar_url: profile?.avatar_url || null,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error during login" });
  }
});

// POST /api/auth/logout
router.post("/logout", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;

    if (!token) {
      return res.status(401).json({ error: "Missing bearer token" });
    }

    const userSupabase = createUserSupabaseClient(token);
    const { error } = await userSupabase.auth.signOut({ scope: "local" });
    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: "Logout successful" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Internal server error during logout" });
  }
});

// GET /api/auth/google
router.get("/google", async (req, res) => {
  try {
    const { data, error } = await supabaseAuth.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${req.headers.origin || "http://localhost:5173"}/auth/callback`,
      },
    });

    if (error || !data.url) {
      return res.status(500).json({ error: error?.message || "Failed to initialize Google Auth" });
    }

    res.redirect(data.url);
  } catch (error) {
    console.error("Google Auth error:", error);
    res.status(500).json({ error: "Internal server error during Google Auth" });
  }
});

// GET /api/auth/me
router.get("/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;

    if (!token) {
      return res.status(401).json({ error: "Missing bearer token" });
    }

    const userSupabase = createUserSupabaseClient(token);
    const { data: { user }, error } = await userSupabase.auth.getUser();

    if (error || !user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const profileRes = await pool.query(
      "SELECT username, avatar_url FROM public.users WHERE id = $1",
      [user.id]
    );

    const profile = profileRes.rows[0];

    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: profile?.username || "Unknown",
        avatar_url: profile?.avatar_url || null,
      },
    });
  } catch (error) {
    console.error("Auth me error:", error);
    res.status(500).json({ error: "Internal server error during me fetch" });
  }
});

export default router;
