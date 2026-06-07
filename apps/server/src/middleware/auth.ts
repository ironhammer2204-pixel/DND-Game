import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../db/supabase";

export interface AuthenticatedRequest extends Request {
  user?: {
    sub: string;       // User UUID (Supabase Auth ID)
    email?: string;
    role?: string;
    aud?: string;
    user_metadata?: Record<string, unknown>;
    [key: string]: any;
  };
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.split(" ")[1];
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.user = {
    sub: data.user.id,
    email: data.user.email,
    role: data.user.role,
    aud: data.user.aud,
    user_metadata: data.user.user_metadata,
  };

  next();
}
