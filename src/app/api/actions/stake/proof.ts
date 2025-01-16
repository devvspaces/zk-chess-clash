
const client = new ReclaimClient(process.env.RECLAIM_APP_ID, process.env.RECLAIM_APP_SECRET);
async function getGameStats() {
  
  const publicOptions = {
      method: 'GET',
      headers : {'accept':'application/json'}
  }
  const privateOptions = {
    headers: {},
    responseMatches : [{}],
    responseRedactions : [{}]
  }
  const proof = await client.zkFetch('https://lichess.org/game/export/LRy93nnW',publicOptions, privateOptions)
  return proof;
}