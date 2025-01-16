import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

// Define types for your game
export type Game = {
  id?: string;
  game_id: string;
  username: string;
  amount: number;
  token: string;
  player_address: string;
  status: "created" | "matched" | "completed";
  created_at?: Date;
};
