# espace-uniswap-lib

Utility library for `Swappi V2` and `vSwap (WallFreeX) V3` on `Conflux eSpace`.

Chinese documentation: [README_ZH.md](./README_ZH.md)

## Upgrade Notes (0.1.x → 0.2.0)

Breaking changes:

- `client.v2.SwappiPair` (the `@uniswap/v2-sdk` `Pair` class) is removed. Use `client.v2.createSwappiPair(tokenA, tokenB, reserve0Raw, reserve1Raw)` for the factory equivalent.
- `client.v2.getPair(...)` now returns a Pair-shaped object (`token0/token1/reserve0/reserve1/liquidityToken/reserveOf/priceOf/token0Price/token1Price/involvesToken`) instead of an `@uniswap/v2-sdk` `Pair` instance. Methods like `getOutputAmount` / `getInputAmount` are not provided; reimplement them locally if you relied on them.
- `@uniswap/v2-sdk`'s `Pair.getAddress` is no longer monkey-patched. If your code depended on that global side effect, switch to `computePairAddress(...)` from this library.
- `AlphaRouter` is now constructed with a custom `v2PoolProvider`. If you call `client.v3.findRoute(...)` with `protocols: ['V2']` or `'MIXED'`, you must also inject a custom `v2SubgraphProvider` — the default one still depends on `Pair.getAddress` and will fail on Conflux.
- Testnet `client.v3.findRoute(...)` now works (previously failed inside the gas model). Testnet `client.v2.*` still fails fast because Swappi V2 is not deployed there.

Migration for most consumers is a no-op — the common paths (`findRoute`, `swapExactInputMulticall`, `getPair`) work as before, just with corrected behavior under npm / yarn / nested-dep installs.

## What It Covers

- `V2` / `V3` exact-in swaps
- `V2` path quoting and pair queries
- `V3` routing, quoting, and pool state reads
- `V3` liquidity position creation, increase, decrease, and fee collection
- ERC20 approvals, balance polling, and multicall helpers

## Modules

- `createClient`: builds the current network `provider`, addresses, tokens, and V2/V3 helpers
- `client.v2`: `Swappi V2` swaps, path search, and pair queries
- `client.v3`: `V3` routing, swaps, pool reads, and LP/NFT position helpers
- `client.utils`: approvals, balance queries, multicall helpers, and utility methods
- `ethersProvider`: helpers to create `provider` / `signer`
- `consts`: network-agnostic constants and pure helpers

## Installation

```bash
pnpm add espace-uniswap-lib
```

Or:

```bash
npm install espace-uniswap-lib
```

Requirements:

- `Node.js >= 20`
- `ESM`

## Quick Start

The example below creates a client, auto-detects mainnet or testnet from the RPC, and swaps `0.01 WCFX` to `USDT0`.

### 1. Create a client and signer

```js
import {
  createClient,
  createEthersSigner,
} from "espace-uniswap-lib";

const rpcUrl = process.env.ESPACE_RPC_URL;
const privateKey = process.env.PRIVATE_KEY;

const client = await createClient({
  ...(rpcUrl ? { rpcUrl } : {}),
  logger: console,
});

const signer = createEthersSigner(privateKey, client.provider);
```

### 2. Execute a V3 multicall swap

```js
import {
  parseEther,
} from "espace-uniswap-lib";

const amountInRaw = parseEther("0.01");
const receipt = await client.v3.swapExactInputMulticall(
  client.tokens.WCFX9,
  client.tokens.USDT0,
  amountInRaw,
  signer
);

console.log("network:", client.network);
console.log("tx:", receipt.transactionHash);
```

Notes:

- `createClient(...)` accepts `rpcUrl`, not `provider`
- if `rpcUrl` is omitted, mainnet is used by default
- when `rpcUrl` is provided, the library detects mainnet or testnet from on-chain `chainId`
- if `network` is explicitly provided and does not match the actual RPC chain, the call throws
- create the signer from `client.provider` to avoid network mismatch
- swap methods use `50 bps` slippage by default, which means `0.5%`

If you want to use `1%` slippage explicitly, pass `options` as the last argument:

```js
const receipt = await client.v3.swapExactInputMulticall(
  client.tokens.WCFX9,
  client.tokens.USDT0,
  amountInRaw,
  signer,
  { slippageBps: 100 }
);
```

## Common APIs

### Initialization

- `createClient(options)`: create a client bound to a single network
- `client.getConfig()`: read the full client config snapshot
- `client.network`: current network, `mainnet` or `testnet`
- `client.chainId`: current chain ID
- `client.provider`: the `ethers` provider used by the client
- `client.tokens`: prebuilt `Token` instances for the current network, such as `WCFX9` and `USDT0`

### V2

- `client.v2.swapToken(tokenIn, tokenOut, amountInRaw, signer, options?)`: execute an exact-in swap through `Swappi V2`
- `client.v2.getBestPath(tokenInAddress, tokenOutAddress, amountInRaw, providerOrSigner)`: evaluate candidate V2 paths and return the one with the highest quoted output
- `client.v2.getPair(tokenA, tokenB, provider)`: read reserves for a V2 pair and return a Pair-shaped object (`token0/token1/reserve0/reserve1/liquidityToken/reserveOf/priceOf/token0Price/token1Price/involvesToken`)
- `client.v2.createSwappiPair(tokenA, tokenB, reserve0Raw, reserve1Raw)`: build the same Pair-shaped object from known reserves without any RPC call
- `client.v2.getSwappiPairs(provider)`: scan all pairs from the factory

### V3

- `client.v3.findRoute(tokenIn, tokenOut, amountInRaw, recipient, options?)`: search a `V3` route with `AlphaRouter`
- `client.v3.swapExactInputSingle(tokenIn, tokenOut, fee, amountInRaw, signer, options?)`: single-hop swap when the fee tier is already known
- `client.v3.swapExactInput(tokenIn, tokenOut, fee, amountInRaw, signer, options?)`: search a route and call `router.exactInput`
- `client.v3.swapExactInputMulticall(tokenIn, tokenOut, amountInRaw, signer, options?)`: search a route and execute with `router.multicall`
- `client.v3.getPoolInfo(poolContract)`: read core pool state
- `client.v3.getPoolReserveAmounts(pool, provider)`: query current token balances for a pool

### V3 Liquidity

- `client.v3.mintPosition(tokenA, tokenB, fee, amount0, amount1, tickLower, tickUpper, signer)`: create a new V3 liquidity position
- `client.v3.getPositions(address, provider)`: read all V3 NFT positions owned by an address
- `client.v3.findPosition(tokenA, tokenB, fee, signer)`: find an existing position by token pair and fee tier
- `client.v3.addLiquidity(tokenA, tokenB, fee, amount0, amount1, signer)`: add liquidity to an existing position
- `client.v3.removeLiquidity(tokenA, tokenB, fee, signer)`: remove liquidity from an existing position
- `client.v3.collectFees(tokenA, tokenB, fee, signer)`: collect fees for a position

### Utilities

- `client.utils.approveIfNeeded(token, spender, amount, signer)`: approve automatically when allowance is insufficient
- `client.utils.batchErc20Balances(tokens, addresses, provider)`: query ERC20 balances in batch through multicall
- `client.utils.batchNativeBalances(addresses, provider)`: query native balances in batch through multicall
- `fromReadableAmount(amount, decimals)`: convert a human-readable amount into the on-chain smallest unit
- `parseEther` / `formatEther` / `parseUnits` / `formatUnits`: common `ethers` amount helpers

## createClient Options

`createClient(...)` supports:

- `network`: optional, `mainnet` or `testnet`
- `rpcUrl`: optional, custom RPC URL
- `addresses`: optional, override the current network address preset
- `bases`: optional, override V2 routing base tokens
- `logger`: optional, inject `info` / `error` / `debug`
- `hooks.onTxMined`: optional, async callback after a transaction is mined

## Swap Options

Swap-related methods and `client.v3.findRoute(...)` accept an extra trailing `options` argument:

- `slippageBps`: optional integer in `bps`; `50` means `0.5%`, `100` means `1%`

Notes:

- the default is `50`
- the accepted range is `0` to `9999`
- if you want route preview and the actual swap to use the same slippage boundary, pass the same `slippageBps` value to both

## Current Limitations

- `swapExactInputMulticall` does not auto-approve ERC20 input tokens; approve `WFX_ROUTER` before calling it
- `uniswapV2.addLiquidity` and `uniswapV2.removeLiquidity` are exported but not implemented yet
- the library no longer monkey-patches `@uniswap/v2-sdk`'s `Pair.getAddress`; all V2 pair addresses go through `computePairAddress(...)` and `createSwappiPair(...)`, so the library is safe under nested / duplicated `@uniswap/v2-sdk` installs (npm / yarn / pnpm)
- `getPair()` and the injected V2 pool provider return duck-typed Pair-shaped objects instead of `@uniswap/v2-sdk` `Pair` instances; methods that the SDK `Pair` class provides but this object does not (`getOutputAmount` / `getInputAmount`) are intentionally out of scope
- testnet does not currently provide a complete `Swappi V2` preset; `client.v2.*` fails fast on testnet. `client.v3.findRoute(...)` on testnet works (the custom V2 pool provider returns an empty accessor, and the gas model falls back to V3 pools)
- if you ever need `protocols: ['V2']` or `'MIXED'` for AlphaRouter, you must also inject a custom `v2SubgraphProvider`; the default one still calls `Pair.getAddress` and will fail on Conflux
- by default, testnet only switches `RPC`, `WCFX9`, `USDT0`, and `Multicall3`; if your environment has matching protocol addresses and you want to enable them, override through `addresses` and validate compatibility yourself
