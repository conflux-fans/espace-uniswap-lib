import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { AlphaRouter } from "v-swap-smart-order-router";
import { createClient } from "../src/config.js";
import { UniswapV3RouterABI } from "../src/abis.js";
import { applySlippageBps, DEFAULT_SLIPPAGE_BPS, resolveSlippageBps } from "../src/clientRuntime.js";
import { Percent, Pool, Route, SwapRouter } from "../src/uniswapDeps.js";

const originalGetNetwork = ethers.providers.JsonRpcProvider.prototype.getNetwork;
const originalContractDescriptor = Object.getOwnPropertyDescriptor(ethers, "Contract");
const originalAlphaRoute = AlphaRouter.prototype.route;
const originalSwapCallParameters = SwapRouter.swapCallParameters;

const QUOTE_AMOUNT = ethers.BigNumber.from("2000");
const SQRT_PRICE_X96 = "79228162514264337593543950336";

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
  Object.defineProperty(ethers, "Contract", originalContractDescriptor);
  AlphaRouter.prototype.route = originalAlphaRoute;
  SwapRouter.swapCallParameters = originalSwapCallParameters;
});

test.afterEach(() => {
  Object.defineProperty(ethers, "Contract", originalContractDescriptor);
  AlphaRouter.prototype.route = originalAlphaRoute;
  SwapRouter.swapCallParameters = originalSwapCallParameters;
});

function setContractMock(mock) {
  Object.defineProperty(ethers, "Contract", {
    value: mock,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

function createSigner(chainId) {
  return {
    address: "0x0000000000000000000000000000000000000abc",
    provider: {
      async getNetwork() {
        return { chainId, name: "test-network" };
      },
    },
    async getBalance() {
      return ethers.BigNumber.from("1000000000000000000");
    },
    async sendTransaction(tx) {
      return {
        hash: "0xsingle",
        async wait() {
          return {
            transactionHash: tx.hash || "0xsingle",
            status: 1,
            blockNumber: 1,
            gasUsed: ethers.BigNumber.from(1),
          };
        },
      };
    },
  };
}

function buildV3Route(client, tokenIn = client.tokens.USDT0, tokenOut = client.tokens.cUSDT, fee = 3000) {
  const pool = new Pool(
    tokenIn,
    tokenOut,
    fee,
    SQRT_PRICE_X96,
    "1000000",
    0
  );

  return new Route([pool], tokenIn, tokenOut);
}

function mockErc20AndV2Router(client, tokenAddress, quoteAmount) {
  let swapArgs = null;

  setContractMock(function MockContract(address) {
    const normalized = address.toLowerCase();
    if (normalized === tokenAddress.toLowerCase()) {
      return {
        async balanceOf() {
          return ethers.BigNumber.from("5000000");
        },
        async allowance() {
          return ethers.constants.MaxUint256;
        },
      };
    }

    if (normalized === client.addresses.SWAPPI_ROUTER_V2.toLowerCase()) {
      return {
        async getAmountsOut(amountIn, path) {
          if (path.length === 2) {
            return [amountIn, quoteAmount];
          }
          return [amountIn, ethers.BigNumber.from("1500"), ethers.BigNumber.from("1500")];
        },
        async swapExactTokensForTokens(amountIn, amountOutMin, path, recipient, txDeadline) {
          swapArgs = { amountIn, amountOutMin, path, recipient, txDeadline };
          return {
            async wait() {
              return { transactionHash: "0xv2", status: 1, blockNumber: 1 };
            },
          };
        },
      };
    }

    throw new Error(`Unexpected contract address: ${address}`);
  });

  return () => swapArgs;
}

function mockErc20AndV3Contracts(client, tokenIn, tokenOut, fee, handlers = {}) {
  setContractMock(function MockContract(address) {
    const normalized = address.toLowerCase();
    if (normalized === tokenIn.address.toLowerCase()) {
      return {
        async balanceOf() {
          return ethers.BigNumber.from("5000000");
        },
        async allowance() {
          return ethers.constants.MaxUint256;
        },
      };
    }

    if (normalized === client.addresses.WFX_ROUTER.toLowerCase()) {
      return handlers.routerContract || {};
    }

    return handlers.poolContract || {
      async token0() {
        return tokenIn.address;
      },
      async token1() {
        return tokenOut.address;
      },
      async fee() {
        return fee;
      },
      async liquidity() {
        return ethers.BigNumber.from("1000000");
      },
      async slot0() {
        return [ethers.BigNumber.from(SQRT_PRICE_X96), 0];
      },
    };
  });
}

test("resolveSlippageBps defaults to 50 bps", () => {
  assert.equal(resolveSlippageBps(), DEFAULT_SLIPPAGE_BPS);
  assert.equal(resolveSlippageBps({}), DEFAULT_SLIPPAGE_BPS);
});

test("resolveSlippageBps accepts valid integer bps", () => {
  assert.equal(resolveSlippageBps({ slippageBps: 0 }), 0);
  assert.equal(resolveSlippageBps({ slippageBps: 50 }), 50);
  assert.equal(resolveSlippageBps({ slippageBps: 9999 }), 9999);
});

test("resolveSlippageBps rejects invalid values", () => {
  assert.throws(() => resolveSlippageBps(null), /swap options must be a plain object/);
  assert.throws(() => resolveSlippageBps([]), /swap options must be a plain object/);
  assert.throws(() => resolveSlippageBps({ slippageBps: -1 }), /slippageBps must be an integer between 0 and 9999/);
  assert.throws(() => resolveSlippageBps({ slippageBps: 0.5 }), /slippageBps must be an integer between 0 and 9999/);
  assert.throws(() => resolveSlippageBps({ slippageBps: "50" }), /slippageBps must be an integer between 0 and 9999/);
  assert.throws(() => resolveSlippageBps({ slippageBps: 10_000 }), /slippageBps must be an integer between 0 and 9999/);
});

test("applySlippageBps computes minimum output amount", () => {
  const minOut = applySlippageBps(ethers.BigNumber.from("2000"), 50);
  assert.equal(minOut.toString(), "1990");
});

test("v2.swapToken keeps default 50 bps when options are omitted", async () => {
  const client = await createClient();
  const signer = createSigner(client.chainId);
  const getSwapArgs = mockErc20AndV2Router(client, client.tokens.USDT0.address, QUOTE_AMOUNT);

  await client.v2.swapToken(
    client.tokens.USDT0,
    client.tokens.cUSDT,
    "1000",
    signer
  );

  const swapArgs = getSwapArgs();
  assert.ok(swapArgs);
  assert.equal(swapArgs.amountOutMin.toString(), "1990");
});

test("v2.swapToken applies custom slippage bps", async () => {
  const client = await createClient();
  const signer = createSigner(client.chainId);
  const getSwapArgs = mockErc20AndV2Router(client, client.tokens.USDT0.address, QUOTE_AMOUNT);

  await client.v2.swapToken(
    client.tokens.USDT0,
    client.tokens.cUSDT,
    "1000",
    signer,
    { slippageBps: 100 }
  );

  const swapArgs = getSwapArgs();
  assert.ok(swapArgs);
  assert.equal(swapArgs.amountOutMin.toString(), "1980");
});

test("v3.findRoute passes slippage tolerance from options", async () => {
  const client = await createClient();
  const rawRoute = buildV3Route(client);
  let capturedOptions = null;

  AlphaRouter.prototype.route = async function route(_amountIn, _tokenOut, _tradeType, options) {
    capturedOptions = options;
    return {
      route: [{ route: rawRoute }],
      quoteAmount: QUOTE_AMOUNT,
      source: "mock-router",
    };
  };

  await client.v3.findRoute(
    client.tokens.USDT0,
    client.tokens.cUSDT,
    "1000",
    "0x0000000000000000000000000000000000000def",
    { slippageBps: 125 }
  );

  assert.ok(capturedOptions);
  assert.equal(capturedOptions.slippageTolerance.equalTo(new Percent(125, 10_000)), true);
});

test("v3.swapExactInputSingle passes custom slippage tolerance to SwapRouter", async () => {
  const client = await createClient();
  const signer = createSigner(client.chainId);
  let capturedOptions = null;

  client.provider.call = async function call() {
    return ethers.utils.defaultAbiCoder.encode(
      ["uint256", "uint160", "uint32", "uint256"],
      [QUOTE_AMOUNT, 0, 0, 0]
    );
  };

  mockErc20AndV3Contracts(client, client.tokens.USDT0, client.tokens.cUSDT, 3000);
  SwapRouter.swapCallParameters = function swapCallParameters(_trades, options) {
    capturedOptions = options;
    return { calldata: "0x1234" };
  };

  await client.v3.swapExactInputSingle(
    client.tokens.USDT0,
    client.tokens.cUSDT,
    3000,
    "1000",
    signer,
    { slippageBps: 250 }
  );

  assert.ok(capturedOptions);
  assert.equal(capturedOptions.slippageTolerance.equalTo(new Percent(250, 10_000)), true);
});

test("v3.swapExactInput keeps default 50 bps when options are omitted", async () => {
  const client = await createClient();
  const signer = createSigner(client.chainId);
  const rawRoute = buildV3Route(client);
  let capturedParams = null;

  AlphaRouter.prototype.route = async function route() {
    return {
      route: [{ route: rawRoute }],
      quoteAmount: QUOTE_AMOUNT,
      source: "mock-router",
    };
  };

  mockErc20AndV3Contracts(client, client.tokens.USDT0, client.tokens.cUSDT, 3000, {
    routerContract: {
      async exactInput(params) {
        capturedParams = params;
        return {
          async wait() {
            return { transactionHash: "0xv3", status: 1, blockNumber: 1 };
          },
        };
      },
    },
  });

  await client.v3.swapExactInput(
    client.tokens.USDT0,
    client.tokens.cUSDT,
    3000,
    "1000",
    signer
  );

  assert.ok(capturedParams);
  assert.equal(capturedParams.amountOutMinimum.toString(), "1990");
});

test("v3.swapExactInputMulticall encodes custom minimum output", async () => {
  const client = await createClient();
  const signer = createSigner(client.chainId);
  const rawRoute = buildV3Route(client);
  let capturedDatas = null;

  AlphaRouter.prototype.route = async function route() {
    return {
      route: [{ route: rawRoute }],
      quoteAmount: QUOTE_AMOUNT,
      source: "mock-router",
    };
  };

  mockErc20AndV3Contracts(client, client.tokens.USDT0, client.tokens.cUSDT, 3000, {
    routerContract: {
      async multicall(datas) {
        capturedDatas = datas;
        return {
          hash: "0xmulti",
          async wait() {
            return {
              transactionHash: "0xmulti",
              status: 1,
              blockNumber: 1,
              gasUsed: ethers.BigNumber.from(1),
            };
          },
        };
      },
    },
  });

  await client.v3.swapExactInputMulticall(
    client.tokens.USDT0,
    client.tokens.cUSDT,
    "1000",
    signer,
    { slippageBps: 200 }
  );

  assert.ok(capturedDatas);
  const iface = new ethers.utils.Interface(UniswapV3RouterABI);
  const decoded = iface.decodeFunctionData("exactInput", capturedDatas[0]);
  assert.equal(decoded[0].amountOutMinimum.toString(), "1960");
});
