/**
 * Solana Actions Example
 */

import {
  ActionPostResponse,
  createPostResponse,
  ActionGetResponse,
  ActionPostRequest,
  createActionHeaders,
  ActionError,
} from "@solana/actions";
import {
  Authorized,
  Cluster,
  clusterApiUrl,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  StakeProgram,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import {
  DEFAULT_SOL_ADDRESS,
  DEFAULT_SOL_AMOUNT,
  TOKENS,
  SPL_MAP,
} from "./const";
import { supabase } from "./db";

const toPubkey = DEFAULT_SOL_ADDRESS;

// create the standard headers for this route (including CORS)
const headers = createActionHeaders();

export const GET = async (req: Request) => {
  try {
    const requestUrl = new URL(req.url);
    const { clusterurl, cluster } = validatedClusterParams(requestUrl);

    const baseHref = new URL(
      `/api/actions/stake?clusterurl=${clusterurl}&cluster=${cluster}`,
      requestUrl.origin,
    ).toString();

    const payload: ActionGetResponse = {
      type: "action",
      title: "👑Chess Clash: The Ultimate Wagering Experience!",
      icon: "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExYmZ2NTMzOXBlNW90emVzaWVrN3l4N2EybG45bmFsMjc4cTg4djVhNiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/ms3yqSf67KQjnXm6kN/giphy.gif",
      description: `
Welcome to Chess Clash, where strategy meets excitement in a thrilling game of wits! Challenge your friends, rivals, or fellow chess enthusiasts to a high-stakes match that could change the course of your chess journey.

**Here’s how it works:**

1. Create a friend game on [Lichess](https://lichess.org/) and copy the game ID.
2. Enter your wager, your username, the game ID, and decide whether you want to make the game public or invite specific players.
3. Share the link with Player 2 to join the battle.
4. **Join public games and ➡️ [duel](https://lichess.org/)**.

---

Need to top up your wallet for the wager? Fund using UPI, your preferred crypto method or ➡️ [Add Funds Here](https://game.catoff.xyz/onramp)
`,
      label: "Create chess duel",
      links: {
        actions: [
          {
            type: "post",
            label: "Create chess duel",
            href: `${baseHref}&amount=${"1"}`,
            parameters: [
              {
                name: "gameId",
                label: "Your created game ID",
                required: true,
              },
              {
                name: "username",
                label: "Your Lichess username",
                required: true,
              },
              {
                name: "token",
                label: "Choose token",
                required: true,
                type: "radio",
                options: Object.entries(TOKENS).map(([key, value]) => ({
                  value: key,
                  label: value,
                })),
              },
              {
                name: "amount",
                label: "Set wager amount",
                required: true,
              },
            ],
          },
        ],
      },
    };

    return Response.json(payload, {
      headers,
    });
  } catch (err) {
    console.log(err);
    let actionError: ActionError = { message: "An unknown error occurred" };
    if (typeof err == "string") actionError.message = err;
    return Response.json(actionError, {
      status: 400,
      headers,
    });
  }
};

// DO NOT FORGET TO INCLUDE THE `OPTIONS` HTTP METHOD
// THIS WILL ENSURE CORS WORKS FOR BLINKS
export const OPTIONS = async () => Response.json(null, { headers });

export const POST = async (req: Request) => {
  try {
    const requestUrl = new URL(req.url);
    const { amount, username, gameId, token } =
      validatedQueryParams(requestUrl);
    const { clusterurl } = validatedClusterParams(requestUrl);

    const body: ActionPostRequest = await req.json();

    // validate the client provided input
    let account: PublicKey;
    try {
      account = new PublicKey(body.account);
    } catch (err) {
      throw 'Invalid "account" provided';
    }

    let rpc = ["devnet", "testnet", "mainnet-beta"].includes(clusterurl)
      ? clusterApiUrl(clusterurl as Cluster)
      : clusterurl;
    const connection = new Connection(rpc);

    const { data, error } = await supabase
      .from("games")
      .insert({
        game_id: gameId,
        username,
        amount,
        token,
        player_address: account.toBase58(),
      })
      .select()
      .single();

    if (error) throw error;

    // create a new transaction
    let transaction: Transaction;
    if (token === TOKENS.SOL) {
      transaction = await transferSol(connection, amount, account);
    } else {
      const { mint, decimals } = SPL_MAP[token];
      transaction = await transferSPLToken(
        connection,
        { publicKey: account },
        mint,
        amount,
        decimals,
      );
    }

    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        type: "transaction",
        transaction,
        message: `Send ${amount} SOL to ${toPubkey.toBase58()}`,
      },
    });

    return Response.json(payload, {
      headers,
    });
  } catch (err) {
    console.log(err);
    let actionError: ActionError = { message: "An unknown error occurred" };
    if (typeof err == "string") actionError.message = err;
    return Response.json(actionError, {
      status: 400,
      headers,
    });
  }
};

function validatedQueryParams(requestUrl: URL) {
  let gameId = "";
  let username = "";
  let amount = DEFAULT_SOL_AMOUNT;

  if (requestUrl.searchParams.get("gameId")) {
    gameId = requestUrl.searchParams.get("gameId")!;
  } else {
    throw "Missing input query parameter: gameId";
  }

  if (requestUrl.searchParams.get("username")) {
    username = requestUrl.searchParams.get("username")!;
  } else {
    throw "Missing input query parameter: username";
  }

  try {
    if (requestUrl.searchParams.get("amount")) {
      amount = parseFloat(requestUrl.searchParams.get("amount")!);
    } else {
      throw "Missing input query parameter: amount";
    }
    if (amount <= 0) throw "amount is too small";
  } catch (err) {
    throw "Invalid input query parameter: amount";
  }

  let token = requestUrl.searchParams.get("token");
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
  };
}

function validatedClusterParams(requestUrl: URL) {
  let clusterurl = requestUrl.searchParams.get("clusterurl") || "devnet";
  let cluster = requestUrl.searchParams.get("cluster") || "devnet";

  return {
    clusterurl,
    cluster,
  };
}

async function transferSPLToken(
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

async function transferSol(
  connection: Connection,
  amount: number,
  account: PublicKey,
) {
  const minimumBalance = await connection.getMinimumBalanceForRentExemption(
    0, // note: simple accounts that just store native SOL have `0` bytes of data
  );
  if (amount * LAMPORTS_PER_SOL < minimumBalance) {
    throw `account may not be rent exempt: ${toPubkey.toBase58()}`;
  }

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
