import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const sdkCore = require("@uniswap/sdk-core");
const v2Sdk = require("@uniswap/v2-sdk");
const v3Sdk = require("@uniswap/v3-sdk");

export const {
  Token,
  TradeType,
  CurrencyAmount,
  Percent,
  Price,
} = sdkCore;

export const { Pair } = v2Sdk;

export const {
  Pool,
  SwapQuoter,
  Route,
  Trade,
  SwapRouter,
  encodeRouteToPath,
  Position,
  NonfungiblePositionManager,
  nearestUsableTick,
  TickMath,
  priceToClosestTick,
  computePoolAddress,
} = v3Sdk;
