import express, { Request, Response } from "express";
import dotenv from "dotenv";
dotenv.config();

import {
  ActionPostResponse,
  createPostResponse,
  actionCorsMiddleware,
  ActionGetResponse,
  ActionPostRequest,
  createActionHeaders,
  ActionError,
  NextActionPostRequest,
  CompletedAction,
} from "@solana/actions";
import {
  Cluster,
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";

import {
  addGame,
  getGame,
  getGameById,
  getUnMatchedGames,
  updateGame,
} from "./db";
import { DEFAULT_SOL_ADDRESS, DRAW, MATE, SPL_MAP, TOKENS } from "./const";
import {
  createBlinkUrl,
  getFee,
  QueryT,
  sendPayout,
  transferSol,
  transferSPLToken,
  validatedClusterParams,
  validatedQueryParams,
  validateSignature,
  validateUsername,
} from "./helpers";
import { getGameStats } from "./proof";

const DOMAIN_URL = process.env.DOMAIN_URL!;
const PORT = process.env.PORT || 3000;
const toPubkey = DEFAULT_SOL_ADDRESS;

// Express app setup
const app = express();
app.use(express.json());

/**
 * The `actionCorsMiddleware` middleware will provide the correct CORS settings for Action APIs
 * so you do not need to use an additional `cors` middleware if you do not require it for other reasons
 */
const headers = createActionHeaders();
app.use(actionCorsMiddleware(headers));

// Routes
app.get("/actions.json", getActionsJson);
app.get("/api/actions/createGame", getCreateGame);
app.get("/api/actions/joinGame", getJoinGame);
app.get("/api/actions/publicGames", getPublicGames);
app.post("/api/actions/joinGame", postJoinGame);
app.post("/api/actions/createGame", postCreateGame);
app.post("/api/actions/createGame/verify", postVerifyCreateGame);
app.post("/api/actions/joinGame/verify", postVerifyJoinGame);
app.post("/api/actions/completeGame", postCompleteGame);
app.post("/api/actions/publicGames", postPublicGames);

// Route handlers
function getActionsJson(req: Request, res: Response) {
  const payload = {
    rules: [
      { pathPattern: "/*", apiPath: "/api/actions/*" },
      { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
    ],
  };
  res.json(payload);
}

async function getCreateGame(req: Request, res: Response) {
  try {
    const { clusterurl, cluster } = validatedClusterParams(req.query as QueryT);
    const baseHref = `${DOMAIN_URL}/api/actions/createGame?clusterurl=${clusterurl}&cluster=${cluster}`;

    const payload: ActionGetResponse = {
      type: "action",
      title: "👑Chess Clash: The Ultimate Wagering Experience!",
      icon: "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExYmZ2NTMzOXBlNW90emVzaWVrN3l4N2EybG45bmFsMjc4cTg4djVhNiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/ms3yqSf67KQjnXm6kN/giphy.gif",
      description: `Welcome to Chess Clash, where strategy meets excitement in a thrilling game of wits! Challenge your friends, rivals, or fellow chess enthusiasts to a high-stakes match that could change the course of your chess journey.
      
    ⭐**Here’s how it works:**
    ⭐ Create a friend game on [Lichess](https://lichess.org/) and copy the game ID.
    ⭐ Enter your wager, your username, the game ID, and decide whether you want to make the game public or invite specific players.
    ⭐ Share the link with Player 2 to join the battle.
    ⭐ **Join public games and ➡️ [duel](https://lichess.org/)**.
    
    ---
    
    Need to top up your wallet for the wager? Fund using UPI, your preferred crypto method or ➡️ [Add Funds Here](https://game.catoff.xyz/onramp)
    `,
      label: "Create chess duel",
      links: {
        actions: [
          {
            type: "post",
            label: "Create chess duel",
            href: `${baseHref}&amount={amount}&gameId={gameId}&username={username}&token={token}&public={public}`,
            parameters: [
              {
                name: "gameId",
                label: "Your created game ID",
                required: true,
                type: "text",
              },
              {
                name: "username",
                label: "Your Lichess username",
                required: true,
                type: "text",
              },
              {
                name: "public",
                label: "Create a public game?",
                required: false,
                type: "radio",
                options: [
                  { value: "true", label: "Yes" },
                  { value: "false", label: "No" },
                ],
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
                type: "number",
              },
            ],
          },
        ],
      },
    };

    res.json(payload);
  } catch (err) {
    console.error(err);
    let actionError: ActionError = { message: "An unknown error occurred" };
    if (typeof err == "string") actionError.message = err;
    res.status(400).json(actionError);
  }
}

async function postCreateGame(req: Request, res: Response) {
  try {
    const { amount, username, gameId, token, isPublic } =
      await validatedQueryParams(req.query as QueryT);
    const { clusterurl, cluster } = validatedClusterParams(req.query as QueryT);

    const body: ActionPostRequest = req.body;

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

    await addGame({
      game_id: gameId,
      username,
      amount,
      token,
      player_address: account.toBase58(),
      recipient_address: toPubkey.toBase58(),
      is_verified: false,
      status: "created",
      is_public: isPublic,
    });

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
        message: `Send ${amount} ${token} to ${toPubkey.toBase58()}`,
        links: {
          next: {
            type: "post",
            href: `/api/actions/createGame/verify?gameId=${gameId}&clusterurl=${clusterurl}&cluster=${cluster}`,
          },
        },
      },
    });

    res.json(payload);
  } catch (err) {
    console.error(err);
    let actionError: ActionError = { message: "An unknown error occurred" };
    if (typeof err == "string") actionError.message = err;
    res.status(400).json(actionError);
  }
}

async function postVerifyCreateGame(req: Request, res: Response) {
  try {
    let gameId = req.query.gameId as string;
    if (!gameId) {
      throw "Missing input query parameter: gameId";
    }

    const { clusterurl, cluster } = validatedClusterParams(req.query as QueryT);

    const body: NextActionPostRequest = req.body;

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

    let signature: string;
    try {
      signature = body.signature!;
      if (!signature) throw "Invalid signature";
    } catch (err) {
      throw 'Invalid "signature" provided';
    }

    try {
      let status = await connection.getSignatureStatus(signature);

      console.log("signature status:", status);

      if (!status) throw "Unknown signature status";

      // only accept `confirmed` and `finalized` transactions
      if (status.value?.confirmationStatus) {
        if (
          status.value.confirmationStatus != "confirmed" &&
          status.value.confirmationStatus != "finalized"
        ) {
          throw "Unable to confirm the transaction";
        }
      }

      // todo: check for a specific confirmation status if desired
      // if (status.value?.confirmationStatus != "confirmed")
    } catch (err) {
      if (typeof err == "string") throw err;
      throw "Unable to confirm the provided signature";
    }

    let game = await getGame(gameId);
    if (!game) throw "Game not found";

    // Get the parsed transaction
    const parsedTx = await connection.getParsedTransaction(
      signature,
      "confirmed",
    );

    if (!parsedTx || !parsedTx.meta || parsedTx.meta.err) {
      throw "Invalid or failed transaction";
    }

    // Validate transaction is expected transaction
    await validateSignature(game, parsedTx);

    // Update the game status
    await updateGame(gameId, {
      signature,
      is_verified: true,
    });

    const joinUrl = createBlinkUrl("joinGame", {
      gameUid: game.id,
      clusterurl,
      cluster,
    });
    const completeUrl = createBlinkUrl("completeGame", {
      gameUid: game.id,
      clusterurl,
      cluster,
    });
    const payload: CompletedAction = {
      type: "completed",
      title: "🎉 Game Created!",
      icon: "https://images.chesscomfiles.com/uploads/v1/images_users/tiny_mce/SamCopeland/phpuTejFE.gif",
      label: "Get ready to duel!",
      description: `Your game has been successfully created and is ready for the ultimate chess duel! Share the link ${joinUrl} with Player 2 to join the battle. And if you wanted to play with the world sit back and relax, we will find a match for you. When the game is over, click [here](${completeUrl}) to complete the game. The winner takes it all! If the outcome is a draw, the wager will be refunded to both players.`,
    };
    res.json(payload);
  } catch (err) {
    console.error(err);
    let actionError: ActionError = { message: "An unknown error occurred" };
    if (typeof err == "string") actionError.message = err;
    res.status(400).json(actionError);
  }
}

async function getJoinGame(req: Request, res: Response) {
  try {
    const { clusterurl, cluster } = validatedClusterParams(req.query as QueryT);
    const gameUid = req.query.gameUid as string;
    if (!gameUid) {
      throw "Missing input query parameter: gameUid";
    }

    const game = await getGameById(gameUid);
    if (!game) throw "Game not found";

    const baseHref = `${DOMAIN_URL}/api/actions/joinGame?clusterurl=${clusterurl}&cluster=${cluster}&gameUid=${gameUid}`;

    const payload: ActionGetResponse = {
      type: "action",
      title: "♟️ Join Chess Clash Game",
      icon: "https://i.pinimg.com/originals/a6/df/ae/a6dfae596fffbf8657844a8ca90ed5f0.gif",
      description: `Step into the arena and prepare for the ultimate chess duel! Enter our Lichess username to join the battle.
    ---
    Game Wager: ${game.amount} ${game.token}
    Created: ${game.created_at}
    Status: ${game.status}
    ---
    Need to top up your wallet for the wager? Fund using UPI, your preferred crypto method or ➡️ [Add Funds Here](https://game.catoff.xyz/onramp)
    `,
      label: "Join chess duel",
      links: {
        actions: [
          {
            type: "post",
            label: "Join chess duel",
            href: `${baseHref}&username={username}`,
            parameters: [
              {
                name: "username",
                label: "Your Lichess username",
                required: true,
                type: "text",
              },
            ],
          },
        ],
      },
    };

    res.json(payload);
  } catch (err) {
    console.error(err);
    let actionError: ActionError = { message: "An unknown error occurred" };
    if (typeof err == "string") actionError.message = err;
    res.status(400).json(actionError);
  }
}

async function postJoinGame(req: Request, res: Response) {
  try {
    const { username } = await validateUsername(req.query as QueryT);
    let gameUid = req.query.gameUid as string;
    if (!gameUid) {
      throw "Missing input query parameter: gameUid";
    }
    const game = await getGameById(gameUid);
    if (!game) throw "Game not found";
    if (!game.is_verified) throw "Game is not verified";
    if (game.status !== "created") throw "Game is not available to join";
    if (game.username === username) throw "You cannot join your own game";

    const { clusterurl, cluster } = validatedClusterParams(req.query as QueryT);

    const body: ActionPostRequest = req.body;

    // validate the client provided input
    let account: PublicKey;
    try {
      account = new PublicKey(body.account);
    } catch (err) {
      throw 'Invalid "account" provided';
    }

    // Check if the address is the same as the game creator
    if (game.player_address === account.toBase58()) {
      throw "You cannot join your own game";
    }

    let rpc = ["devnet", "testnet", "mainnet-beta"].includes(clusterurl)
      ? clusterApiUrl(clusterurl as Cluster)
      : clusterurl;
    const connection = new Connection(rpc);

    // create a new transaction
    let transaction: Transaction;
    if (game.token === TOKENS.SOL) {
      transaction = await transferSol(connection, game.amount, account);
    } else {
      const { mint, decimals } = SPL_MAP[game.token];
      transaction = await transferSPLToken(
        connection,
        { publicKey: account },
        mint,
        game.amount,
        decimals,
      );
    }

    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        type: "transaction",
        transaction,
        message: `Send ${game.amount} ${game.token} to ${toPubkey.toBase58()}`,
        links: {
          next: {
            type: "post",
            href: `/api/actions/joinGame/verify?gameUid=${gameUid}&clusterurl=${clusterurl}&cluster=${cluster}&username=${username}`,
          },
        },
      },
    });

    res.json(payload);
  } catch (err) {
    console.error(err);
    let actionError: ActionError = { message: "An unknown error occurred" };
    if (typeof err == "string") actionError.message = err;
    res.status(400).json(actionError);
  }
}

async function postVerifyJoinGame(req: Request, res: Response) {
  try {
    let gameUid = req.query.gameUid as string;
    if (!gameUid) throw "Game UID is required";
    const game = await getGameById(gameUid);
    if (!game) throw "Game not found";
    if (!game.is_verified) throw "Game is not verified";
    if (game.status !== "created") throw "Game is not available to join";
    const { username } = await validateUsername(req.query as QueryT);
    if (game.username === username) throw "You cannot join your own game";

    const { clusterurl, cluster } = validatedClusterParams(req.query as QueryT);

    const body: NextActionPostRequest = req.body;

    // validate the client provided input
    let account: PublicKey;
    try {
      account = new PublicKey(body.account);
    } catch (err) {
      throw 'Invalid "account" provided';
    }

    // Check if the address is the same as the game creator
    if (game.player_address === account.toBase58()) {
      throw "You cannot join your own game";
    }

    let rpc = ["devnet", "testnet", "mainnet-beta"].includes(clusterurl)
      ? clusterApiUrl(clusterurl as Cluster)
      : clusterurl;
    const connection = new Connection(rpc);

    let signature: string;
    try {
      signature = body.signature!;
      if (!signature) throw "Invalid signature";
    } catch (err) {
      throw 'Invalid "signature" provided';
    }

    try {
      let status = await connection.getSignatureStatus(signature);

      console.log("signature status:", status);

      if (!status) throw "Unknown signature status";

      // only accept `confirmed` and `finalized` transactions
      if (status.value?.confirmationStatus) {
        if (
          status.value.confirmationStatus != "confirmed" &&
          status.value.confirmationStatus != "finalized"
        ) {
          throw "Unable to confirm the transaction";
        }
      }

      // todo: check for a specific confirmation status if desired
      // if (status.value?.confirmationStatus != "confirmed")
    } catch (err) {
      if (typeof err == "string") throw err;
      throw "Unable to confirm the provided signature";
    }

    // Get the parsed transaction
    const parsedTx = await connection.getParsedTransaction(
      signature,
      "confirmed",
    );

    if (!parsedTx || !parsedTx.meta || parsedTx.meta.err) {
      throw "Invalid or failed transaction";
    }

    // Validate transaction is expected transaction
    await validateSignature(game, parsedTx);

    // Update the game status
    await updateGame(game.game_id, {
      opponent_address: account.toBase58(),
      opponent_signature: signature,
      opponent_username: username,
    });

    const joinGameUrl = `https://lichess.org/${game.game_id}`;
    const completeUrl = createBlinkUrl("completeGame", {
      gameUid: game.id,
      clusterurl,
      cluster,
    });
    const payload: CompletedAction = {
      type: "completed",
      title: "💪 Only the strongest shall prevail",
      icon: "https://media3.giphy.com/media/9POMmQiLkvhRzKFXyT/giphy.gif?cid=6c09b952gl1epu23baqmuud8yz22n1meyzovvjc8x7u130wm&ep=v1_gifs_search&rid=giphy.gif&ct=g",
      label: "Start the duel!",
      description: `Player 1 is waiting for you to join the battle. Click this [link](${joinGameUrl}) to start the game. When the game is over, click [here](${completeUrl}) to complete the game. The winner takes it all! If the outcome is a draw, the wager will be refunded to both players.`,
    };
    res.json(payload);
  } catch (err) {
    console.error(err);
    let actionError: ActionError = { message: "An unknown error occurred" };
    if (typeof err == "string") actionError.message = err;
    res.status(400).json(actionError);
  }
}

async function postCompleteGame(req: Request, res: Response) {
  try {
    let gameUid = req.query.gameUid as string;
    if (!gameUid) throw "Game UID is required";
    const game = await getGameById(gameUid);
    if (!game) throw "Game not found";
    if (!game.is_verified) throw "Game is not verified";
    if (game.status === "completed") throw "Game is already completed";

    const { clusterurl, cluster } = validatedClusterParams(req.query as QueryT);

    const body: ActionPostRequest = req.body;

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

    // Get game status
    let stat = null;
    try {
      stat = await getGameStats(game.game_id);
    } catch (err) {
      throw "Unable to get game stats";
    }

    let status = stat.status;
    if (status !== DRAW && status !== MATE) {
      throw "Game is not over";
    }

    const payerKeypair = Keypair.fromSecretKey(
      Buffer.from(JSON.parse(process.env.PAYER_PRIVATE_KEY!)),
    );
    const fee = getFee(game.amount);
    let message = "";
    if (status === DRAW) {
      // Refund the players
      await sendPayout(payerKeypair, {
        connection,
        amount: game.amount - fee,
        token: game.token,
        recipientAddress: game.player_address,
      });
      if (game.opponent_address) {
        await sendPayout(payerKeypair, {
          connection,
          amount: game.amount - fee,
          token: game.token,
          recipientAddress: game.opponent_address,
        });
      }
      message = `The game ended in a draw. The wager has been refunded to both players. Both players will receive ${
        game.amount - fee
      } ${game.token}.`;
    } else {
      const players = {
        white: stat.players.white.user.id,
        black: stat.players.black.user.id,
      };
      const winner = players[stat.winner as "white" | "black"];
      const addresses = {
        [game.username]: game.player_address,
        [game.opponent_username!]: game.opponent_address,
      };
      const winnerAddress = addresses[winner];
      if (!winnerAddress) throw `Address not found for winner: ${winner}`;
      await sendPayout(payerKeypair, {
        connection,
        amount: game.amount * 2 - fee,
        token: game.token,
        recipientAddress: winnerAddress,
      });
      message = `The game ended in a checkmate. The winner is ${winner}. The wager has been sent to the winner. The winner will receive ${
        game.amount * 2 - fee
      } ${game.token}.`;
    }

    // Update the game status
    await updateGame(game.game_id, {
      status: "completed",
    });

    const payload: CompletedAction = {
      type: "completed",
      title: "🏆 Game Over!",
      icon: "https://media2.giphy.com/media/g9582DNuQppxC/giphy.gif",
      label: "Game completed",
      description: message,
    };
    res.json(payload);
  } catch (err) {
    console.error(err);
    let actionError: ActionError = { message: "An unknown error occurred" };
    if (typeof err == "string") actionError.message = err;
    res.status(400).json(actionError);
  }
}

async function getPublicGames(req: Request, res: Response) {
  try {
    const { clusterurl, cluster } = validatedClusterParams(req.query as QueryT);
    const baseHref = `${DOMAIN_URL}/api/actions/publicGames?clusterurl=${clusterurl}&cluster=${cluster}`;

    const games = await getUnMatchedGames();

    const payload: ActionGetResponse = {
      type: "action",
      title: "👑Chess Clash: The Ultimate Wagering Experience!",
      icon: "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExYmZ2NTMzOXBlNW90emVzaWVrN3l4N2EybG45bmFsMjc4cTg4djVhNiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/ms3yqSf67KQjnXm6kN/giphy.gif",
      description: `Welcome to Chess Clash, where strategy meets excitement in a thrilling game of wits! Challenge your friends, rivals, or fellow chess enthusiasts to a high-stakes match that could change the course of your chess journey.

      Join a public game and get ready to duel with a random player. The winner takes it all! If the outcome is a draw, the wager will be refunded to both players.
    
    ---
    
    Need to top up your wallet for the wager? Fund using UPI, your preferred crypto method or ➡️ [Add Funds Here](https://game.catoff.xyz/onramp)
    `,
      label: "Join a chess duel",
      links: {
        actions: [
          {
            type: "post",
            label: "Join a chess duel",
            href: `${baseHref}&username={username}&gameId={gameUid}`,
            parameters: [
              {
                name: "username",
                label: "Your Lichess username",
                required: true,
                type: "text",
              },
              {
                name: "gameUid",
                label: "Select a game to join",
                required: true,
                type: "select",
                options: games.map((game) => ({
                  value: game.id,
                  label: `${game.amount} ${game.token} - ${game.username} - ${game.created_at}`,
                })),
              },
            ],
          },
        ],
      },
    };

    res.json(payload);
  } catch (err) {
    console.error(err);
    let actionError: ActionError = { message: "An unknown error occurred" };
    if (typeof err == "string") actionError.message = err;
    res.status(400).json(actionError);
  }
}

async function postPublicGames(req: Request, res: Response) {
  try {
    const { username } = await validateUsername(req.query as QueryT);
    let gameUid = req.query.gameUid as string;
    if (!gameUid) {
      throw "Missing input query parameter: gameUid";
    }
    const game = await getGameById(gameUid);
    if (!game) throw "Game not found";
    if (!game.is_verified) throw "Game is not verified";
    if (game.status !== "created") throw "Game is not available to join";
    if (game.username === username) throw "You cannot join your own game";

    const { clusterurl, cluster } = validatedClusterParams(req.query as QueryT);

    const body: ActionPostRequest = req.body;

    // validate the client provided input
    let account: PublicKey;
    try {
      account = new PublicKey(body.account);
    } catch (err) {
      throw 'Invalid "account" provided';
    }

    // Check if the address is the same as the game creator
    if (game.player_address === account.toBase58()) {
      throw "You cannot join your own game";
    }

    let rpc = ["devnet", "testnet", "mainnet-beta"].includes(clusterurl)
      ? clusterApiUrl(clusterurl as Cluster)
      : clusterurl;
    const connection = new Connection(rpc);

    // create a new transaction
    let transaction: Transaction;
    if (game.token === TOKENS.SOL) {
      transaction = await transferSol(connection, game.amount, account);
    } else {
      const { mint, decimals } = SPL_MAP[game.token];
      transaction = await transferSPLToken(
        connection,
        { publicKey: account },
        mint,
        game.amount,
        decimals,
      );
    }

    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        type: "transaction",
        transaction,
        message: `Send ${game.amount} ${game.token} to ${toPubkey.toBase58()}`,
        links: {
          next: {
            type: "post",
            href: `/api/actions/joinGame/verify?gameUid=${gameUid}&clusterurl=${clusterurl}&cluster=${cluster}&username=${username}`,
          },
        },
      },
    });

    res.json(payload);
  } catch (err) {
    console.error(err);
    let actionError: ActionError = { message: "An unknown error occurred" };
    if (typeof err == "string") actionError.message = err;
    res.status(400).json(actionError);
  }
}

app.listen(PORT, () => {
  console.log(`Server is running at ${DOMAIN_URL}`);
});
