import { ethers } from "ethers";
import { PairABI } from "./abis.js";
import { computePairAddress } from "./utils.js";
import { createSwappiPair } from "./uniswapV2.js";

function emptyAccessor() {
  return {
    getPool: () => undefined,
    getPoolByAddress: () => undefined,
    getAllPools: () => [],
  };
}

export function createSwappiV2PoolProvider(context) {
  const chainId = context.chainId;
  const factoryAddress = context.addresses.SWAPPI_FACTORY;
  const initCodeHash = context.addresses.INIT_CODE_HASH;
  const provider = context.provider;

  if (!factoryAddress || !initCodeHash) {
    return {
      chainId,
      async getPools() {
        return emptyAccessor();
      },
      getPoolAddress() {
        throw new Error(`Swappi V2 not configured for ${context.network}`);
      },
    };
  }

  const addressCache = new Map();

  function getPoolAddress(tokenA, tokenB) {
    const [token0, token1] = tokenA.sortsBefore(tokenB) ? [tokenA, tokenB] : [tokenB, tokenA];
    const key = `${token0.address}/${token1.address}`;
    let poolAddress = addressCache.get(key);
    if (!poolAddress) {
      poolAddress = computePairAddress({
        factoryAddress,
        tokenA: token0,
        tokenB: token1,
        initCodeHash,
      });
      addressCache.set(key, poolAddress);
    }
    return { poolAddress, token0, token1 };
  }

  async function getPools(tokenPairs) {
    const entries = await Promise.all(
      tokenPairs.map(async ([a, b]) => {
        const { poolAddress, token0, token1 } = getPoolAddress(a, b);
        try {
          const pairContract = new ethers.Contract(poolAddress, PairABI, provider);
          const [reserve0, reserve1] = await pairContract.getReserves();
          const pair = createSwappiPair(
            context,
            token0,
            token1,
            reserve0.toString(),
            reserve1.toString()
          );
          return [poolAddress, pair];
        } catch {
          return null;
        }
      })
    );
    const map = Object.fromEntries(entries.filter(Boolean));
    return {
      getPool: (a, b) => map[getPoolAddress(a, b).poolAddress],
      getPoolByAddress: (addr) => map[addr],
      getAllPools: () => Object.values(map),
    };
  }

  return { chainId, getPools, getPoolAddress };
}
