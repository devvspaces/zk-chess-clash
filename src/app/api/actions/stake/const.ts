import { PublicKey } from "@solana/web3.js";

export const DEFAULT_SOL_ADDRESS: PublicKey = new PublicKey(
  process.env.APP_WALLET,
);

export const DEFAULT_SOL_AMOUNT: number = 0;

export const TOKENS = {
  SOL: "SOL",
  USDC: "USDC",
  BONK: "BONK",
};

export const SPL_MAP = {
  [TOKENS.USDC]: {
    mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    decimals: 6,
  },
  [TOKENS.BONK]: {
    mint: new PublicKey("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"),
    decimals: 5,
  },
};
