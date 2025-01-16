import { ReclaimClient } from "@reclaimprotocol/zk-fetch";

const client = new ReclaimClient(
  process.env.RECLAIM_APP_ID!,
  process.env.RECLAIM_APP_SECRET!,
);

export function getJson(proof: any) {
  return JSON.parse(proof.extractedParameterValues.data.split("\r\n\r\n")[1]);
}

export async function getGameStats(gameId: string) {
  const publicOptions = {
    method: "GET",
    headers: { accept: "application/json" },
  };
  const proof = await client.zkFetch(
    `https://lichess.org/game/export/${gameId}`,
    publicOptions,
  );
  return getJson(proof);
}

export async function getProfileDetail(username: string) {
  const publicOptions = {
    method: "GET",
    headers: { accept: "application/json" },
  };
  const proof = await client.zkFetch(
    `https://lichess.org/api/user/${username}`,
    publicOptions,
  );
  // const isVerified = await Reclaim.verifySignedProof(proof)
  return getJson(proof);
}
