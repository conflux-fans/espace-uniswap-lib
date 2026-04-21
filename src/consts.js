export const USDT_DECIMALS = 6;
export const ETH_DECIMALS = 18;

export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

export const MAX_FEE_PER_GAS = 100000000000;
export const MAX_PRIORITY_FEE_PER_GAS = 100000000000;

export function isWETH(address, wethAddress) {
  if (!wethAddress) {
    throw new Error("isWETH(...) requires wethAddress");
  }
  return String(address).toLowerCase() === String(wethAddress).toLowerCase();
}

export function getAllPaths(tokenIn, tokenOut, basesOrMaxHops = [], maxHops = 2) {
  const bases = Array.isArray(basesOrMaxHops) ? basesOrMaxHops : [];
  const hops = Array.isArray(basesOrMaxHops) ? maxHops : basesOrMaxHops;
  const paths = [];

  paths.push([tokenIn, tokenOut]);

  for (const base of bases) {
    if (base === tokenIn || base === tokenOut) continue;
    paths.push([tokenIn, base, tokenOut]);
  }

  if (hops > 2) {
    for (const base1 of bases) {
      for (const base2 of bases) {
        if (base1 === tokenIn || base1 === tokenOut) continue;
        if (base2 === tokenIn || base2 === tokenOut || base2 === base1) continue;
        paths.push([tokenIn, base1, base2, tokenOut]);
      }
    }
  }

  return paths;
}
