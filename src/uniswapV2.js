import { CurrencyAmount, Pair } from "./uniswapDeps.js";
import { ethers } from "ethers";
import { PairABI, Router02ABI, FactoryABI } from "./abis.js";
import { isWETH, getAllPaths } from "./consts.js";
import { computePairAddress, erc20Contract, deadline, formatEther, formatUnits } from "./utils.js";
import { log, assertSignerMatchesClient, getResolvedProvider } from "./clientRuntime.js";

export function createUniswapV2Client(context) {
  function swappiFactoryAddress() {
    return context.addresses.SWAPPI_FACTORY;
  }

  function swappiRouterV2Address() {
    return context.addresses.SWAPPI_ROUTER_V2;
  }

  // 保持当前行为：Pair.getAddress 仍是全局覆写。
  Pair.getAddress = function (token0Address, token1Address) {
    return computePairAddress({
      factoryAddress: swappiFactoryAddress(),
      tokenA: token0Address,
      tokenB: token1Address,
      initCodeHash: context.addresses.INIT_CODE_HASH,
    });
  };

  function swappiFactoryContract(signerOrProvider) {
    return new ethers.Contract(swappiFactoryAddress(), FactoryABI, signerOrProvider);
  }

  function swappiRouterContract(signerOrProvider) {
    return new ethers.Contract(swappiRouterV2Address(), Router02ABI, signerOrProvider);
  }

  async function getSwappiPairs(provider = context.provider) {
    const factoryContract = swappiFactoryContract(getResolvedProvider(context, provider));
    const count = await factoryContract.allPairsLength();
    const pairs = [];
    for (let i = 0; i < count; i++) {
      const pairAddress = await factoryContract.allPairs(i);
      const pairContract = new ethers.Contract(pairAddress, PairABI, getResolvedProvider(context, provider));
      const token0Address = await pairContract.token0();
      const token1Address = await pairContract.token1();
      pairs.push({
        pairAddress,
        token0Address,
        token1Address,
      });
    }
    return pairs;
  }

  async function swapToken(token0, token1, amountInRaw, signer) {
    await assertSignerMatchesClient(context, signer);

    const amountInBigNumber = ethers.BigNumber.from(amountInRaw.toString());
    const routerContract = swappiRouterContract(signer);

    log(context, "info", `Swapping tokens via Swappi V2 Router: ${token0.address} -> ${token1.address}, amountIn: ${formatUnits(amountInRaw, token0.decimals)}`);

    if (!isWETH(token0.address, context.addresses.WCFX9_ADDRESS)) {
      const token0Contract = erc20Contract(token0.address, signer);
      const balance = await token0Contract.balanceOf(signer.address);
      if (balance.lt(amountInBigNumber)) {
        log(context, "error", `Insufficient balance: ${signer.address} have ${formatUnits(balance, token0.decimals)}, need ${formatUnits(amountInBigNumber, token0.decimals)}`);
        throw new Error("Insufficient token0 balance for swap");
      }
      await context.utils.approveIfNeeded(token0.address, swappiRouterV2Address(), amountInBigNumber, signer);
    } else {
      const ethBalance = await signer.getBalance();
      if (ethBalance.lt(amountInBigNumber)) {
        log(context, "error", `Insufficient native balance: ${signer.address} have ${formatEther(ethBalance)}, need ${formatEther(amountInBigNumber)}`);
        throw new Error("Insufficient native balance for swap");
      }
    }

    log(context, "info", "Approval check passed, proceeding to find best swap path");
    const pathRes = await getBestPath(token0.address, token1.address, amountInRaw, signer);
    if (!pathRes) {
      log(context, "error", "No valid swap path found for the given token pair");
      throw new Error("No valid swap path found");
    }
    const { bestPath, maxAmountOut } = pathRes;

    const amountOutMin = maxAmountOut.mul(995).div(1000);
    const txDeadline = deadline();

    log(
      context,
      "info",
      `Best path found: ${bestPath.join(" -> ")}, expected amount out: ${formatUnits(maxAmountOut, token1.decimals)}, amountOutMin: ${formatUnits(amountOutMin, token1.decimals)}`
    );

    if (isWETH(token0.address, context.addresses.WCFX9_ADDRESS)) {
      const swapTx = await routerContract.swapExactETHForTokens(amountOutMin, bestPath, signer.address, txDeadline, {
        value: amountInBigNumber,
      });
      return swapTx.wait();
    }

    if (isWETH(token1.address, context.addresses.WCFX9_ADDRESS)) {
      const swapTx = await routerContract.swapExactTokensForETH(amountInBigNumber, amountOutMin, bestPath, signer.address, txDeadline);
      return swapTx.wait();
    }

    const swapTx = await routerContract.swapExactTokensForTokens(amountInBigNumber, amountOutMin, bestPath, signer.address, txDeadline);
    return swapTx.wait();
  }

  async function addLiquidity(token0, token1, amount0Desired, amount1Desired, signer) {
    void token0;
    void token1;
    void amount0Desired;
    void amount1Desired;
    void signer;
    throw new Error("addLiquidity for V2 is not implemented yet");
  }

  async function removeLiquidity(token0, token1, amount0Desired, amount1Desired, signer) {
    void token0;
    void token1;
    void amount0Desired;
    void amount1Desired;
    void signer;
    throw new Error("removeLiquidity for V2 is not implemented yet");
  }

  async function getPair(token0, token1, provider = context.provider) {
    if (!token0?.address || !token1?.address || typeof token0.sortsBefore !== "function") {
      throw new Error("getPair expects token0/token1 as @uniswap/sdk-core Token instances");
    }

    const pairAddress = computePairAddress({
      factoryAddress: swappiFactoryAddress(),
      tokenA: token0,
      tokenB: token1,
      initCodeHash: context.addresses.INIT_CODE_HASH,
    });

    const pairContract = new ethers.Contract(pairAddress, PairABI, getResolvedProvider(context, provider));
    const reserves = await pairContract.getReserves();
    const [reserve0, reserve1] = reserves;
    const [token0Sorted, token1Sorted] = token0.sortsBefore(token1) ? [token0, token1] : [token1, token0];
    return new Pair(
      CurrencyAmount.fromRawAmount(token0Sorted, reserve0.toString()),
      CurrencyAmount.fromRawAmount(token1Sorted, reserve1.toString())
    );
  }

  async function getBestPath(token0, token1, amountIn, signerOrProvider = context.provider) {
    const router = swappiRouterContract(signerOrProvider);
    const allPaths = getAllPaths(token0, token1, context.bases, 2);
    const results = await Promise.all(
      allPaths.map(async (path) => {
        try {
          const amounts = await router.getAmountsOut(amountIn, path);
          return { path, amountOut: amounts[amounts.length - 1] };
        } catch {
          return null;
        }
      })
    );

    let bestPath = null;
    let maxAmountOut = ethers.BigNumber.from(0);

    for (const res of results) {
      if (res && res.amountOut.gt(maxAmountOut)) {
        maxAmountOut = res.amountOut;
        bestPath = res.path;
      }
    }

    if (!bestPath) {
      return null;
    }
    return { bestPath, maxAmountOut };
  }

  return Object.freeze({
    SwappiPair: Pair,
    swappiFactoryContract,
    swappiRouterContract,
    getSwappiPairs,
    swapToken,
    addLiquidity,
    removeLiquidity,
    getPair,
    getBestPath,
  });
}
