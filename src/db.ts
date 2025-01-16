import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

// Define types for your game
export type Game = {
  id: string;
  game_id: string;
  username: string;
  amount: number;
  token: string;
  player_address: string;
  recipient_address: string;
  signature?: string;
  is_verified: boolean;
  is_public: boolean;
  status: "created" | "matched" | "completed";
  opponent_username?: string;
  opponent_address?: string;
  opponent_signature?: string;
  created_at?: Date;
};

export async function getGame(gameId: string): Promise<Game | null> {
  const { data, error } = await supabase
    .from("games")
    .select()
    .eq("game_id", gameId)
    .single();

  if (error) {
    console.error(error);
    return null;
  }

  return data;
}

export async function getGameById(id: string): Promise<Game | null> {
  const { data, error } = await supabase
    .from("games")
    .select()
    .eq("id", id)
    .single();

  if (error) {
    console.error(error);
    return null;
  }

  return data;
}

export async function addGame(game: Omit<Game, "id">) {
  const { data, error } = await supabase
    .from("games")
    .insert({
      ...game,
    })
    .select()
    .single();

  if (error) throw "Error creating game, please try again";
  return data;
}

export async function updateGame(gameId: string, game: Partial<Game>) {
  const { data, error } = await supabase
    .from("games")
    .update({
      ...game,
    })
    .eq("game_id", gameId)
    .single();

  if (error) throw "Error updating game, please try again";
  return data;
}

export async function getUnMatchedGames(): Promise<Game[]> {
  const { data, error } = await supabase
    .from("games")
    .select()
    .eq("status", "created")
    .eq("is_public", true)
    .eq("is_verified", true)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    return [];
  }

  return data;
}
