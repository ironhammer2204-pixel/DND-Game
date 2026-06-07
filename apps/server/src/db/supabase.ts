import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
  console.warn("WARNING: SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_KEY is not set in environment variables.");
}

const authOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
};

export const supabaseAuth = createClient(supabaseUrl || "", supabaseAnonKey || "", authOptions);

export const supabaseAdmin = createClient(supabaseUrl || "", supabaseServiceKey || "", authOptions);

export function createUserSupabaseClient(accessToken: string) {
  return createClient(supabaseUrl || "", supabaseAnonKey || "", {
    ...authOptions,
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}
