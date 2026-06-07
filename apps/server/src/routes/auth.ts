import { Router } from "express";
import { supabase } from "../db/supabase";
import { pool } from "../db/client";

const router = Router();

// POST /api/auth/register
router.post("/register", async (req, res) => {
  const { email, password, username } = req.body;

  if (!email || !password || !username) {
    return res.status(400).json({ error: "Missing required fields: email, password, username" });
  }

  try {
    // 1. Sign up user in Supabase Auth
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error || !data.user) {
      return res.status(400).json({ error: error?.message || "Registration failed" });
    }

    const userId = data.user.id;

    // 2. Insert user profile into public.users
    await pool.query(
      "INSERT INTO public.users (id, email, username) VALUES ($1, $2, $3)",
      [userId, email, username]
    );

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
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Missing required fields: email, password" });
  }

  try {
    // 1. Sign in with password via Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user || !data.session) {
      return res.status(400).json({ error: error?.message || "Login failed" });
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
    // Supabase stateless signout
    const { error } = await supabase.auth.signOut();
    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: "Logout successful" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Internal server error during logout" });
  }
});

export default router;
