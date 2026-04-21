import { Token } from "./uniswapDeps.js";

const TOKEN_DEFINITIONS = Object.freeze({
  cUSDT: Object.freeze({
    addressKey: "cUSDT_ADDRESS",
    decimals: 18,
    symbol: "cUSDT",
    name: "Tether USDT",
  }),
  USDT0: Object.freeze({
    addressKey: "USDT0_ADDRESS",
    decimals: 6,
    symbol: "USDT0",
    name: "Tether USDT0",
  }),
  WCFX9: Object.freeze({
    addressKey: "WCFX9_ADDRESS",
    decimals: 18,
    symbol: "WCFX9",
    name: "Wrapped Conflux",
  }),
  AXCNH: Object.freeze({
    addressKey: "AXCNH_ADDRESS",
    decimals: 6,
    symbol: "AxCNH",
    name: "AnchorX CNH",
  }),
});

export function buildTokens({ chainId, addresses }) {
  const tokens = {};

  for (const [key, definition] of Object.entries(TOKEN_DEFINITIONS)) {
    const address = addresses[definition.addressKey];
    if (!address) continue;
    tokens[key] = new Token(chainId, address, definition.decimals, definition.symbol, definition.name);
  }

  return Object.freeze(tokens);
}
