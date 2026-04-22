import {
  createClient,
  createEthersSigner,
  parseEther,
} from "../src/index.js";

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

async function main() {
  const rpcUrl = process.env.ESPACE_RPC_URL;
  const privateKey = getRequiredEnv("PRIVATE_KEY");

  const client = await createClient({
    ...(rpcUrl ? { rpcUrl } : {}),
    logger: console,
  });
  const signer = createEthersSigner(privateKey, client.provider);

  const amountInRaw = parseEther("0.01");
  const receipt = await client.v3.swapExactInputMulticall(
    client.tokens.WCFX9,
    client.tokens.USDT0,
    amountInRaw,
    signer,
    { slippageBps: 100 }
  );

  console.log("network:", client.network);
  console.log("V3 swap tx hash:", receipt.transactionHash);
  console.log("V3 swap block:", receipt.blockNumber);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
