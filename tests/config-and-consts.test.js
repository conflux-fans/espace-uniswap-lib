import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { createClient } from "../src/config.js";
import { getAllPaths, isWETH } from "../src/consts.js";
import { createSwappiPair } from "../src/uniswapV2.js";
import { computePairAddress } from "../src/utils.js";

const originalGetNetwork = ethers.providers.JsonRpcProvider.prototype.getNetwork;

test.before(() => {
  ethers.providers.JsonRpcProvider.prototype.getNetwork = async function () {
    const url = String(this.connection?.url || "");
    if (url.includes("testnet")) {
      return { chainId: 71, name: "conflux-espace-testnet" };
    }
    return { chainId: 1030, name: "conflux-espace-mainnet" };
  };
});

test.after(() => {
  ethers.providers.JsonRpcProvider.prototype.getNetwork = originalGetNetwork;
});

test("getAllPaths includes direct path", () => {
  const tokenIn = "0x1111111111111111111111111111111111111111";
  const tokenOut = "0x2222222222222222222222222222222222222222";
  const paths = getAllPaths(tokenIn, tokenOut, [], 2);
  assert.deepEqual(paths[0], [tokenIn, tokenOut]);
});

test("isWETH requires explicit weth address", () => {
  const weth = "0x3333333333333333333333333333333333333333";
  assert.equal(isWETH(weth, weth), true);
  assert.equal(isWETH("0x4444444444444444444444444444444444444444", weth), false);
});

test("createClient defaults to mainnet preset", async () => {
  const client = await createClient();
  assert.equal(client.network, "mainnet");
  assert.equal(client.chainId, 1030);
  assert.equal(client.tokens.WCFX9.address.toLowerCase(), "0x14b2d3bc65e74dae1030eafd8ac30c533c976a9b");
});

test("createClient detects testnet from rpcUrl", async () => {
  const client = await createClient({
    rpcUrl: "https://evmtestnet.confluxrpc.com",
  });
  assert.equal(client.network, "testnet");
  assert.equal(client.chainId, 71);
  assert.equal(client.tokens.WCFX9.address.toLowerCase(), "0x2ed3dddae5b2f321af0806181fbfa6d049be47d8");
  assert.equal(client.tokens.USDT0.address.toLowerCase(), "0x7d682e65efc5c13bf4e394b8f376c48e6bae0355");
});

test("createClient rejects network mismatch", async () => {
  await assert.rejects(
    () => createClient({
      network: "testnet",
      rpcUrl: "https://evm.confluxrpc.com",
    }),
    /does not match RPC chainId/
  );
});

test("createClient rejects provider option", async () => {
  await assert.rejects(
    () => createClient({
      provider: {},
    }),
    /does not accept provider/
  );
});

test("mainnet and testnet clients keep different token values", async () => {
  const mainnetClient = await createClient();
  const testnetClient = await createClient({
    rpcUrl: "https://evmtestnet.confluxrpc.com",
  });

  assert.notEqual(
    mainnetClient.tokens.WCFX9.address.toLowerCase(),
    testnetClient.tokens.WCFX9.address.toLowerCase()
  );
  assert.equal("cUSDT" in testnetClient.tokens, false);
});

test("mainnet computePairAddress uses Swappi factory + initCodeHash", async () => {
  const client = await createClient();
  const pairAddress = computePairAddress({
    factoryAddress: client.addresses.SWAPPI_FACTORY,
    tokenA: client.tokens.WCFX9,
    tokenB: client.tokens.USDT0,
    initCodeHash: client.addresses.INIT_CODE_HASH,
  });
  assert.equal(typeof pairAddress, "string");
  assert.equal(pairAddress.startsWith("0x"), true);
  assert.equal(pairAddress.length, 42);

  const pair = createSwappiPair(client.getConfig(), client.tokens.WCFX9, client.tokens.USDT0, "0", "0");
  assert.equal(pair.liquidityToken.address, pairAddress);
});

test("testnet createSwappiPair throws because Swappi is not configured", async () => {
  const client = await createClient({
    rpcUrl: "https://evmtestnet.confluxrpc.com",
  });

  assert.throws(
    () =>
      computePairAddress({
        factoryAddress: client.addresses.SWAPPI_FACTORY,
        tokenA: client.tokens.WCFX9,
        tokenB: client.tokens.USDT0,
        initCodeHash: client.addresses.INIT_CODE_HASH,
      }),
    /invalid|undefined/i
  );
});

test("addresses override also refreshes default bases when bases are omitted", async () => {
  const overriddenWeth = "0x5555555555555555555555555555555555555555";
  const client = await createClient({
    addresses: {
      WCFX9_ADDRESS: overriddenWeth,
    },
  });

  assert.equal(client.tokens.WCFX9.address.toLowerCase(), overriddenWeth);
  assert.equal(client.bases.includes(overriddenWeth), true);
});

test("write methods reject signer on different network", async () => {
  const client = await createClient();
  const fakeSigner = {
    provider: {
      async getNetwork() {
        return { chainId: 71, name: "conflux-espace-testnet" };
      },
    },
  };

  await assert.rejects(
    () => client.v2.swapToken(client.tokens.WCFX9, client.tokens.USDT0, "1", fakeSigner),
    /Signer network mismatch/
  );
});

test("testnet V2 methods fail fast because config is incomplete", async () => {
  const client = await createClient({
    rpcUrl: "https://evmtestnet.confluxrpc.com",
  });

  await assert.rejects(
    () => client.v2.getBestPath(client.tokens.WCFX9.address, client.tokens.USDT0.address, "1"),
    /Swappi V2 is not configured for testnet/
  );
});
