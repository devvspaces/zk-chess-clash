import dotenv from "dotenv";
dotenv.config();

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  ParsedTransactionWithMeta,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { getProfileDetail } from "./proof";
import {
  CAP_AMOUNT,
  CHARGE_PERCENTAGE,
  DEFAULT_SOL_ADDRESS,
  DEFAULT_SOL_AMOUNT,
  SPL_MAP,
  TOKENS,
} from "./const";
import { Game } from "./db";

const DOMAIN_URL = process.env.DOMAIN_URL!;

const toPubkey = DEFAULT_SOL_ADDRESS;

export type QueryT = Record<string, string | undefined>;

export async function validatedQueryParams(query: QueryT) {
  let gameId = "";
  let username = "";
  let amount = DEFAULT_SOL_AMOUNT;
  let isPublic = false;

  if (query.gameId) {
    gameId = query.gameId;
  } else {
    throw "Missing input query parameter: gameId";
  }

  if (query.public) {
    isPublic = Boolean(query.public);
  }

  if (query.username) {
    username = query.username;

    // Verify username is a valid Lichess username
    try {
      await getProfileDetail(username);
    } catch (e) {
      if (e instanceof Error) {
        console.log(e.message);
      } else {
        console.log(String(e));
      }
      throw "Ensure you have entered a valid Lichess username";
    }
  } else {
    throw "Missing input query parameter: username";
  }

  try {
    if (query.amount) {
      amount = parseFloat(query.amount);
    } else {
      throw "Missing input query parameter: amount";
    }
    if (amount <= 0) throw "amount is too small";
  } catch (err) {
    throw "Invalid input query parameter: amount";
  }

  let token = query.token;
  if (!token) {
    throw "Missing input query parameter: token";
  }

  if (!Object.values(TOKENS).includes(token)) {
    throw `Invalid input query parameter: token. Must be one of ${Object.values(
      TOKENS,
    ).join(", ")}`;
  }

  return {
    amount,
    username,
    gameId,
    token,
    isPublic,
  };
}

export async function validateUsername(query: QueryT) {
  let username = "";
  if (query.username) {
    username = query.username;

    // Verify username is a valid Lichess username
    try {
      await getProfileDetail(username);
    } catch (e) {
      if (e instanceof Error) {
        console.log(e.message);
      } else {
        console.log(String(e));
      }
      throw "Ensure you have entered a valid Lichess username";
    }
  } else {
    throw "Missing input query parameter: username";
  }
  return {
    username,
  };
}

export function validatedClusterParams(query: QueryT) {
  let clusterurl = query.clusterurl || "devnet";
  let cluster = query.cluster || "devnet";

  return {
    clusterurl,
    cluster,
  };
}

export async function transferSPLToken(
  connection: Connection,
  fromAccount: {
    publicKey: PublicKey;
  },
  tokenMint: PublicKey,
  amount: number,
  decimals: number,
) {
  try {
    // Get the token accounts for sender and receiver
    const fromTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      fromAccount.publicKey,
    );

    const toTokenAccount = await getAssociatedTokenAddress(tokenMint, toPubkey);

    // Check if destination token account exists
    const toAccountInfo = await connection.getAccountInfo(toTokenAccount);

    let transaction = new Transaction();

    // If destination token account doesn't exist, create it
    if (!toAccountInfo) {
      const createAccountInstruction = createAssociatedTokenAccountInstruction(
        fromAccount.publicKey, // payer
        toTokenAccount, // associated token account
        toPubkey, // owner
        tokenMint, // mint
      );
      transaction.add(createAccountInstruction);
    }

    // Create transfer instruction
    const transferInstruction = createTransferInstruction(
      fromTokenAccount, // source
      toTokenAccount, // destination
      fromAccount.publicKey, // owner
      amount * Math.pow(10, decimals), // amount to transfer (adjusted for decimals)
    );

    transaction.add(transferInstruction);

    // Get latest blockhash
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();

    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
    transaction.feePayer = fromAccount.publicKey;

    return transaction;
  } catch (error) {
    console.error("Error creating transfer transaction:", error);
    throw error;
  }
}

export async function transferSol(
  connection: Connection,
  amount: number,
  account: PublicKey,
) {
  // create an instruction to transfer native SOL from one wallet to another
  const transferSolInstruction = SystemProgram.transfer({
    fromPubkey: account,
    toPubkey: toPubkey,
    lamports: amount * LAMPORTS_PER_SOL,
  });

  // get the latest blockhash amd block height
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  // create a legacy transaction
  const transaction = new Transaction({
    feePayer: account,
    blockhash,
    lastValidBlockHeight,
  }).add(transferSolInstruction);

  // versioned transactions are also supported
  // const transaction = new VersionedTransaction(
  //   new TransactionMessage({
  //     payerKey: account,
  //     recentBlockhash: blockhash,
  //     instructions: [transferSolInstruction],
  //   }).compileToV0Message(),
  //   // note: you can also use `compileToLegacyMessage`
  // );
  return transaction;
}

export async function validateSignature(
  game: Game,
  parsedTx: ParsedTransactionWithMeta,
) {
  if (game.token === TOKENS.SOL) {
    const instruction = parsedTx.transaction.message.instructions[0];
    if (
      "program" in instruction &&
      instruction.program === "system" &&
      "parsed" in instruction &&
      instruction.parsed.type === "transfer"
    ) {
      const { info } = instruction.parsed;

      // Verify amount and recipient
      const amountInSol = info.lamports / LAMPORTS_PER_SOL;
      const isValid =
        info.destination === game.recipient_address &&
        amountInSol === game.amount;

      if (!isValid) {
        throw "Transaction details do not match expected values";
      }
    }
  } else {
    // For SPL token transfers
    const instruction = parsedTx.transaction.message.instructions[0];
    if (
      "parsed" in instruction &&
      instruction.parsed.type === "transferChecked"
    ) {
      const { info } = instruction.parsed;

      // Get token decimals from SPL_MAP
      const tokenInfo = Object.values(SPL_MAP).find(
        (t) => t.mint.toBase58() === info.mint,
      );

      if (!tokenInfo) throw "Invalid token";

      const amount = info.tokenAmount.amount / Math.pow(10, tokenInfo.decimals);
      const isValid =
        info.destination === game.recipient_address && amount === game.amount;

      if (!isValid) {
        throw "Transaction details do not match expected values";
      }
    }
  }
}

export function createBlinkUrl(endpoint: string, params: Record<string, string>) {
  const queryString = new URLSearchParams(params).toString();
  const scheme = `solana-action:${DOMAIN_URL}/api/actions/${endpoint}?${queryString}`;
  return `https://dial.to/?action=${encodeURIComponent(scheme)}`;
}

interface PayoutConfig {
  connection: Connection;
  amount: number;
  token: string;
  recipientAddress: string;
}

// House pays transaction fee
export async function sendPayout(
  payer: Keypair,
  config: PayoutConfig
) {
  const { connection, amount, token, recipientAddress } = config;
  const recipient = new PublicKey(recipientAddress);

  try {
    if (token === 'SOL') {
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: recipient,
          lamports: amount * LAMPORTS_PER_SOL,
        })
      );

      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [payer] // House keypair signs and pays fee
      );

      return { success: true, signature };
    } else {

      const tokenInfo = SPL_MAP[token];
      const { mint: tokenMint, decimals } = tokenInfo;

      // SPL Token transfer
      if (!tokenMint || !decimals) throw new Error("Token mint and decimals required for SPL transfers");

      const fromATA = await getAssociatedTokenAddress(tokenMint, payer.publicKey);
      const toATA = await getAssociatedTokenAddress(tokenMint, recipient);

      const transferInstruction = createTransferInstruction(
        fromATA,
        toATA,
        payer.publicKey,
        amount * Math.pow(10, decimals)
      );

      const transaction = new Transaction().add(transferInstruction);

      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [payer]
      );

      return { success: true, signature };
    }
  } catch (error) {
    console.error("Payout failed:", error);
    return { success: false, error };
  }
}

export function getFee(amount: number) {
  // Take note of the charge percentage and cap amount
  const charge = amount * (CHARGE_PERCENTAGE / 100);
  return Math.min(charge, CAP_AMOUNT);
}