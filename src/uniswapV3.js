import { ethers } from "ethers";
import { AlphaRouter, SwapType } from "v-swap-smart-order-router";
import {
  TradeType,
  CurrencyAmount,
  Percent,
  Price,
  Pool,
  SwapQuoter,
  Route,
  Trade,
  SwapRouter,
  encodeRouteToPath,
  Position,
  NonfungiblePositionManager,
  nearestUsableTick,
  priceToClosestTick,
} from "./uniswapDeps.js";
import { isWETH } from "./consts.js";
import {
  UniswapV3RouterABI,
  ERC20ABI,
  IUniswapV3PoolABI,
  QuoterV2ABI,
  UniswapV3PositionManagerABI,
} from "./abis.js";
import { deadline, erc20Contract, formatUnits } from "./utils.js";
import { parseUnits } from "viem";
import { log, assertSignerMatchesClient, getResolvedProvider } from "./clientRuntime.js";

function shortAddress(address) {
  if (!address || typeof address !== "string") return "unknown";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function tokenLabel(token) {
  return token?.symbol || shortAddress(token?.address);
}

function safeErrorMessage(error) {
  if (!error) return "unknown error";
  if (error?.reason) return error.reason;
  if (error?.message) return error.message;
  return String(error);
}

export function createUniswapV3Client(context) {
  function createPoolContract(tokenA, tokenB, fee, signerOrProvider) {
    const currentPoolAddress = context.utils.computeWfxPoolAddress(tokenA, tokenB, fee);
    return new ethers.Contract(
      currentPoolAddress,
      IUniswapV3PoolABI,
      signerOrProvider
    );
  }

  function getQuoterV2Contract(signerOrProvider) {
    return new ethers.Contract(
      context.addresses.WFX_QUOTER_V2,
      QuoterV2ABI,
      signerOrProvider
    );
  }

  async function getPoolInfo(poolContract) {
    const [token0, token1, fee, liquidity, slot0] =
      await Promise.all([
        poolContract.token0(),
        poolContract.token1(),
        poolContract.fee(),
        poolContract.liquidity(),
        poolContract.slot0(),
      ]);

    return {
      token0,
      token1,
      fee,
      liquidity,
      sqrtPriceX96: slot0[0],
      tick: slot0[1],
    };
  }

  async function getQuoteOutput(swapRoute, tokenIn, amountInRaw, provider = context.provider) {
    const { calldata } = await SwapQuoter.quoteCallParameters(
      swapRoute,
      CurrencyAmount.fromRawAmount(
        tokenIn,
        amountInRaw
      ),
      TradeType.EXACT_INPUT,
      {
        useQuoterV2: true,
      }
    );

    const quoteCallReturnData = await getResolvedProvider(context, provider).call({
      to: context.addresses.WFX_QUOTER_V2,
      data: calldata,
    });

    const singleHop = swapRoute.pools.length === 1;
    const decodeTypes = singleHop
      ? ["uint256", "uint160", "uint32", "uint256"]
      : ["uint256", "uint160[]", "uint32[]", "uint256"];

    return ethers.utils.defaultAbiCoder.decode(decodeTypes, quoteCallReturnData);
  }

  async function wrapETHIfNeeded(tokenIn, amountInRaw, signer) {
    await assertSignerMatchesClient(context, signer);

    const token0Contract = new ethers.Contract(
      tokenIn.address,
      ERC20ABI,
      signer
    );

    const balance = await token0Contract.balanceOf(signer.address);
    const amountInBigNumber = ethers.BigNumber.from(amountInRaw.toString());
    if (balance.gte(amountInBigNumber)) return;

    if (isWETH(tokenIn.address, context.addresses.WCFX9_ADDRESS)) {
      const needWrap = amountInBigNumber.sub(balance);
      const nativeBalance = await context.provider.getBalance(signer.address);
      if (nativeBalance.gte(needWrap)) {
        await context.weth.wrapETH(needWrap, signer);
      } else {
        throw new Error("原生 CFX 余额不足，无法包装为 WCFX");
      }
    }
  }

  async function unwrapETHIfNeeded(tokenOut, signer) {
    await assertSignerMatchesClient(context, signer);

    if (!isWETH(tokenOut.address, context.addresses.WCFX9_ADDRESS)) return;
    const token0Contract = new ethers.Contract(
      tokenOut.address,
      ERC20ABI,
      signer
    );

    const balance = await token0Contract.balanceOf(signer.address);
    if (balance.gt(0)) {
      await context.weth.unwrapETH(balance, signer);
    }
  }

  async function checkBalanceAndApprove(tokenIn, amountInRaw, signer) {
    await assertSignerMatchesClient(context, signer);

    const amountInBigNumber = ethers.BigNumber.from(amountInRaw.toString());
    const token0Contract = new ethers.Contract(
      tokenIn.address,
      ERC20ABI,
      signer
    );

    const balance = await token0Contract.balanceOf(signer.address);
    if (balance.lt(amountInBigNumber)) {
      throw new Error("余额不足");
    }

    await context.utils.approveIfNeeded(tokenIn.address, context.addresses.WFX_ROUTER, amountInBigNumber, signer);
  }

  async function swapExactInputSingle(tokenIn, tokenOut, fee, amountInRaw, signer) {
    await assertSignerMatchesClient(context, signer);

    const amountInBigNumber = ethers.BigNumber.from(amountInRaw.toString());
    if (!isWETH(tokenIn.address, context.addresses.WCFX9_ADDRESS)) {
      await checkBalanceAndApprove(tokenIn, amountInRaw, signer);
    } else {
      const nativeBalance = await context.provider.getBalance(signer.address);
      if (nativeBalance.lte(amountInBigNumber)) {
        throw new Error("原生 CFX 余额不足，无法包装为 WCFX");
      }
    }

    const poolContract = createPoolContract(tokenIn, tokenOut, fee, signer);
    const poolInfo = await getPoolInfo(poolContract);
    const pool = new Pool(
      tokenIn,
      tokenOut,
      fee,
      poolInfo.sqrtPriceX96.toString(),
      poolInfo.liquidity.toString(),
      poolInfo.tick
    );

    const swapRoute = new Route(
      [pool],
      tokenIn,
      tokenOut
    );

    const quoteAmountRes = await getQuoteOutput(swapRoute, tokenIn, amountInRaw);
    const quoteAmount = quoteAmountRes[0];

    const uncheckedTrade = Trade.createUncheckedTrade({
      route: swapRoute,
      inputAmount: CurrencyAmount.fromRawAmount(
        tokenIn,
        amountInRaw
      ),
      outputAmount: CurrencyAmount.fromRawAmount(
        tokenOut,
        quoteAmount.toString()
      ),
      tradeType: TradeType.EXACT_INPUT,
    });

    const options = {
      slippageTolerance: new Percent(50, 10_000),
      deadline: deadline(),
      recipient: signer.address,
    };

    const methodParameters = SwapRouter.swapCallParameters([uncheckedTrade], options);
    const value = isWETH(tokenIn.address, context.addresses.WCFX9_ADDRESS) ? amountInBigNumber : ethers.BigNumber.from(0);
    const tx = {
      data: methodParameters.calldata,
      to: context.addresses.WFX_ROUTER,
      value,
      from: signer.address,
    };

    const txRes = await signer.sendTransaction(tx);
    const receipt = await txRes.wait();

    await unwrapETHIfNeeded(tokenOut, signer);
    return receipt;
  }

  async function swapExactInput(tokenIn, tokenOut, fee, amountInRaw, signer) {
    void fee;
    await assertSignerMatchesClient(context, signer);

    const amountInBigNumber = ethers.BigNumber.from(amountInRaw.toString());

    const route = await findRoute(tokenIn, tokenOut, amountInRaw, signer.address);
    if (!route || !route.route?.[0]?.route) {
      log(
        context,
        "error",
        `[V3][swap] no route ${tokenLabel(tokenIn)}->${tokenLabel(tokenOut)} amount=${amountInRaw.toString()}`
      );
      throw new Error("No route found");
    }
    const rawRoute = route.route[0].route;

    let quoteAmount;
    if (route.quoteAmount) {
      quoteAmount = ethers.BigNumber.from(route.quoteAmount.toString());
    } else {
      const quoteAmountRes = await getQuoteOutput(rawRoute, tokenIn, amountInRaw);
      quoteAmount = quoteAmountRes[0];
    }

    if (!isWETH(tokenIn.address, context.addresses.WCFX9_ADDRESS)) {
      await checkBalanceAndApprove(tokenIn, amountInRaw, signer);
    } else {
      const nativeBalance = await context.provider.getBalance(signer.address);
      if (nativeBalance.lte(amountInBigNumber)) {
        throw new Error("原生 CFX 余额不足，无法包装为 WCFX");
      }
    }

    const path = encodeRouteToPath(rawRoute);
    const routerContract = new ethers.Contract(
      context.addresses.WFX_ROUTER,
      UniswapV3RouterABI,
      signer
    );

    const amountOutMinimum = quoteAmount.mul(995).div(1000);
    const value = isWETH(tokenIn.address, context.addresses.WCFX9_ADDRESS) ? amountInBigNumber : ethers.BigNumber.from(0);
    const txRes = await routerContract.exactInput({
      path,
      recipient: signer.address,
      deadline: deadline(),
      amountIn: amountInBigNumber,
      amountOutMinimum,
    }, {
      value,
    });

    const receipt = await txRes.wait();
    await unwrapETHIfNeeded(tokenOut, signer);
    return receipt;
  }

  async function findRoute(tokenIn, tokenOut, amountInRaw, recipient) {
    log(context, "debug", `[V3][route] search ${tokenLabel(tokenIn)}->${tokenLabel(tokenOut)} amount=${amountInRaw.toString()}`);

    const router = new AlphaRouter({
      chainId: context.chainId,
      provider: context.provider,
    });

    const options = {
      recipient,
      slippageTolerance: new Percent(50, 10_000),
      deadline: deadline(),
      type: SwapType.SWAP_ROUTER_02,
    };

    try {
      const route = await router.route(
        CurrencyAmount.fromRawAmount(
          tokenIn,
          amountInRaw
        ),
        tokenOut,
        TradeType.EXACT_INPUT,
        options,
        {
          protocols: ["V3"],
        }
      );

      if (!route?.route?.[0]?.route) {
        log(context, "warn", `[V3][route] empty result ${tokenLabel(tokenIn)}->${tokenLabel(tokenOut)}`);
      }

      return route;
    } catch (error) {
      log(context, "error", `[V3][route] failed ${tokenLabel(tokenIn)}->${tokenLabel(tokenOut)} reason=${safeErrorMessage(error)}`);
      throw error;
    }
  }

  async function swapExactInputMulticall(tokenIn, tokenOut, amountInRaw, signer) {
    await assertSignerMatchesClient(context, signer);

    log(
      context,
      "debug",
      `[V3][multicall] start ${tokenLabel(tokenIn)}->${tokenLabel(tokenOut)} amount=${amountInRaw.toString()}`
    );

    const route = await findRoute(tokenIn, tokenOut, amountInRaw, signer.address);
    if (!route || !route.route?.[0]?.route) {
      log(
        context,
        "error",
        `[V3][multicall] no route ${tokenLabel(tokenIn)}->${tokenLabel(tokenOut)} amount=${amountInRaw.toString()}`
      );
      throw new Error("No route found");
    }
    const rawRoute = route.route[0].route;

    let quoteAmount;
    if (route.quoteAmount) {
      quoteAmount = ethers.BigNumber.from(route.quoteAmount.toString());
    } else {
      const quoteAmountRes = await getQuoteOutput(rawRoute, tokenIn, amountInRaw);
      quoteAmount = quoteAmountRes[0];
    }

    const path = encodeRouteToPath(rawRoute);
    const routerContract = new ethers.Contract(
      context.addresses.WFX_ROUTER,
      UniswapV3RouterABI,
      signer
    );

    const amountOutMinimum = quoteAmount.mul(995).div(1000);
    const datas = [];
    const tokenOutIsWETH = isWETH(tokenOut.address, context.addresses.WCFX9_ADDRESS);
    const tokenInIsWETH = isWETH(tokenIn.address, context.addresses.WCFX9_ADDRESS);
    const amountInBigNumber = ethers.BigNumber.from(amountInRaw.toString());
    const iface = new ethers.utils.Interface(UniswapV3RouterABI);
    const recipient = tokenOutIsWETH ? context.addresses.WFX_ROUTER : signer.address;

    const calldata = iface.encodeFunctionData("exactInput", [{
      path,
      recipient,
      deadline: deadline(),
      amountIn: amountInBigNumber,
      amountOutMinimum,
    }]);
    datas.push(calldata);

    if (tokenInIsWETH) {
      const refundCalldata = iface.encodeFunctionData("refundETH", []);
      datas.push(refundCalldata);
    }

    if (tokenOutIsWETH) {
      const unwrapCalldata = iface.encodeFunctionData("unwrapWETH9", [
        amountOutMinimum,
        signer.address,
      ]);
      datas.push(unwrapCalldata);
    }

    const txValue = tokenInIsWETH ? amountInBigNumber : 0;
    log(
      context,
      "info",
      `[V3][multicall] route ok source=${route.source || "alpha-router"} hops=${rawRoute.pools?.length || 0} quote=${quoteAmount.toString()} minOut=${amountOutMinimum.toString()}`
    );
    log(context, "info", `[V3][multicall] send calls=${datas.length} value=${txValue.toString()}`);

    const txRes = await routerContract.multicall(datas, {
      value: txValue,
    });
    log(context, "info", `[V3][multicall] submitted hash=${txRes.hash}`);

    const receipt = await txRes.wait();
    log(
      context,
      "info",
      `[V3][multicall] mined hash=${receipt.transactionHash} status=${receipt.status} block=${receipt.blockNumber} gas=${receipt.gasUsed?.toString?.() || "unknown"}`
    );

    return receipt;
  }

  async function getPoolReserveAmounts(pool, provider = context.provider) {
    const resolvedProvider = getResolvedProvider(context, provider);
    const token0 = erc20Contract(pool.token0.address, resolvedProvider);
    const token1 = erc20Contract(pool.token1.address, resolvedProvider);
    const poolAddress = context.utils.computeWfxPoolAddress(pool.token0, pool.token1, pool.fee);

    const [balance0, balance1] = await Promise.all([
      token0.balanceOf(poolAddress),
      token1.balanceOf(poolAddress),
    ]);

    return [formatUnits(balance0, pool.token0.decimals), formatUnits(balance1, pool.token1.decimals)];
  }

  function priceToTick(tokenA, tokenB, price, tickSpacing) {
    const baseAmount = parseUnits("1", tokenA.decimals).toString();
    const priceObj = new Price(tokenA, tokenB, baseAmount, parseUnits(price.toString(), tokenB.decimals).toString());
    const tick = priceToClosestTick(priceObj);
    return Math.floor(tick / tickSpacing) * tickSpacing;
  }

  function calculateAnotherAmount(pool, tokenA, amountA, tickLower, tickUpper) {
    const tickL = Math.floor(tickLower / pool.tickSpacing) * pool.tickSpacing;
    const tickU = Math.ceil(tickUpper / pool.tickSpacing) * pool.tickSpacing;
    const amount0Input = CurrencyAmount.fromRawAmount(tokenA, amountA);
    const position = Position.fromAmount0({
      pool,
      tickLower: tickL < tickU ? tickL : tickU,
      tickUpper: tickU > tickL ? tickU : tickL,
      amount0: amount0Input.quotient,
      useFullPrecision: true,
    });

    return [position.mintAmounts.amount0.toString(), position.mintAmounts.amount1.toString()];
  }

  function getTickerLowerAndUpper(configuredPool) {
    const usableTick = nearestUsableTick(configuredPool.tickCurrent, configuredPool.tickSpacing);
    return {
      tickLower: usableTick - configuredPool.tickSpacing * 2,
      tickUpper: usableTick + configuredPool.tickSpacing * 2,
    };
  }

  async function getPoolInstance(tokenA, tokenB, fee, signerOrProvider = context.provider) {
    const currentPoolAddress = context.utils.computeWfxPoolAddress(tokenA, tokenB, fee);
    const poolContract = new ethers.Contract(
      currentPoolAddress,
      IUniswapV3PoolABI,
      signerOrProvider
    );

    const [liquidity, slot0] = await Promise.all([
      poolContract.liquidity(),
      poolContract.slot0(),
    ]);

    return new Pool(
      tokenA,
      tokenB,
      fee,
      slot0.sqrtPriceX96.toString(),
      liquidity.toString(),
      slot0.tick
    );
  }

  async function mintPosition(tokenA, tokenB, fee, amount0, amount1, tickL, tickU, signer) {
    await assertSignerMatchesClient(context, signer);

    await context.utils.approveIfNeeded(tokenA.address, context.addresses.WFX_NFT_MANAGER, ethers.BigNumber.from(amount0.toString()), signer);
    await context.utils.approveIfNeeded(tokenB.address, context.addresses.WFX_NFT_MANAGER, ethers.BigNumber.from(amount1.toString()), signer);

    const pool = await getPoolInstance(tokenA, tokenB, fee, signer);
    const tickLower = tickL < tickU ? tickL : tickU;
    const tickUpper = tickU > tickL ? tickU : tickL;
    const position = Position.fromAmounts({
      pool,
      tickLower,
      tickUpper,
      amount0,
      amount1,
      useFullPrecision: true,
    });

    const mintOptions = {
      recipient: signer.address,
      deadline: Math.floor(Date.now() / 1000) + 60 * 20,
      slippageTolerance: new Percent(50, 10_000),
    };

    const { calldata, value } = NonfungiblePositionManager.addCallParameters(
      position,
      mintOptions
    );

    let wValue = value;
    if (isWETH(tokenA.address, context.addresses.WCFX9_ADDRESS)) {
      wValue = ethers.BigNumber.from(amount0.toString()).toHexString();
    }
    if (isWETH(tokenB.address, context.addresses.WCFX9_ADDRESS)) {
      wValue = ethers.BigNumber.from(amount1.toString()).toHexString();
    }

    const transaction = {
      data: calldata,
      to: context.addresses.WFX_NFT_MANAGER,
      value: wValue,
      from: signer.address,
    };

    return signer.sendTransaction(transaction);
  }

  async function getPositions(address, provider = context.provider) {
    const resolvedProvider = getResolvedProvider(context, provider);
    const nfpmContract = new ethers.Contract(
      context.addresses.WFX_NFT_MANAGER,
      UniswapV3PositionManagerABI,
      resolvedProvider
    );

    const numPositions = await nfpmContract.balanceOf(address);
    const calls = [];

    for (let i = 0; i < numPositions; i++) {
      calls.push(nfpmContract.tokenOfOwnerByIndex(address, i));
    }

    const positionIds = await Promise.all(calls);
    const positionCalls = [];

    for (const id of positionIds) {
      positionCalls.push(nfpmContract.positions(id));
    }

    const callResponses = await Promise.all(positionCalls);
    return callResponses.map((position, index) => ({
      nftTokenId: positionIds[index],
      token0: position.token0,
      token1: position.token1,
      fee: position.fee,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      liquidity: position.liquidity,
      feeGrowthInside0LastX128: position.feeGrowthInside0LastX128,
      feeGrowthInside1LastX128: position.feeGrowthInside1LastX128,
      tokensOwed0: position.tokensOwed0,
      tokensOwed1: position.tokensOwed1,
    }));
  }

  async function findPosition(tokenA, tokenB, fee, signer) {
    const currentPositions = await getPositions(signer.address, signer);
    if (currentPositions.length === 0) {
      throw new Error("No existing positions found for the user.");
    }

    const position = currentPositions.find((pos) => {
      const feeMatch = pos.fee === fee;
      const token0Match = pos.token0.toLowerCase() === tokenA.address.toLowerCase() && pos.token1.toLowerCase() === tokenB.address.toLowerCase();
      const token1Match = pos.token0.toLowerCase() === tokenB.address.toLowerCase() && pos.token1.toLowerCase() === tokenA.address.toLowerCase();
      return feeMatch && (token0Match || token1Match);
    });

    if (!position) {
      throw new Error("No matching position found for the specified token pair and fee.");
    }

    return position;
  }

  async function addLiquidity(tokenA, tokenB, fee, amount0, amount1, signer) {
    await assertSignerMatchesClient(context, signer);

    const position = await findPosition(tokenA, tokenB, fee, signer);
    const tokenId = position.nftTokenId;
    const addLiquidityOptions = {
      deadline: Math.floor(Date.now() / 1000) + 60 * 20,
      slippageTolerance: new Percent(50, 10_000),
      tokenId,
    };

    const pool = await getPoolInstance(tokenA, tokenB, fee, signer);
    const positionToIncreaseBy = Position.fromAmounts({
      pool,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      amount0,
      amount1,
      useFullPrecision: true,
    });

    const { calldata, value } = NonfungiblePositionManager.addCallParameters(
      positionToIncreaseBy,
      addLiquidityOptions
    );

    let wValue = value;
    if (isWETH(tokenA.address, context.addresses.WCFX9_ADDRESS)) {
      wValue = ethers.BigNumber.from(amount0.toString()).toHexString();
    }
    if (isWETH(tokenB.address, context.addresses.WCFX9_ADDRESS)) {
      wValue = ethers.BigNumber.from(amount1.toString()).toHexString();
    }

    const transaction = {
      data: calldata,
      to: context.addresses.WFX_NFT_MANAGER,
      value: wValue,
      from: signer.address,
    };

    return signer.sendTransaction(transaction);
  }

  async function removeLiquidity(tokenA, tokenB, fee, signer) {
    await assertSignerMatchesClient(context, signer);

    const position = await findPosition(tokenA, tokenB, fee, signer);
    const pool = await getPoolInstance(tokenA, tokenB, fee, signer);
    const currentPosition = new Position({
      pool,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      liquidity: position.liquidity,
    });

    const collectOptions = {
      expectedCurrencyOwed0: CurrencyAmount.fromRawAmount(
        tokenA,
        0
      ),
      expectedCurrencyOwed1: CurrencyAmount.fromRawAmount(
        tokenB,
        0
      ),
      recipient: signer.address,
    };

    const removeLiquidityOptions = {
      deadline: Math.floor(Date.now() / 1000) + 60 * 20,
      slippageTolerance: new Percent(50, 10_000),
      tokenId: position.nftTokenId,
      liquidityPercentage: new Percent(50, 100),
      collectOptions,
    };

    const { calldata, value } = NonfungiblePositionManager.removeCallParameters(
      currentPosition,
      removeLiquidityOptions
    );

    const transaction = {
      data: calldata,
      to: context.addresses.WFX_NFT_MANAGER,
      value,
      from: signer.address,
    };

    return signer.sendTransaction(transaction);
  }

  async function collectFees(tokenA, tokenB, fee, signer) {
    await assertSignerMatchesClient(context, signer);

    const position = await findPosition(tokenA, tokenB, fee, signer);

    if (position.tokensOwed0.toString() === "0" && position.tokensOwed1.toString() === "0") {
      throw new Error("No fees to collect for this position.");
    }

    const collectOptions = {
      tokenId: position.nftTokenId,
      expectedCurrencyOwed0: CurrencyAmount.fromRawAmount(
        tokenA,
        position.tokensOwed0
      ),
      expectedCurrencyOwed1: CurrencyAmount.fromRawAmount(
        tokenB,
        position.tokensOwed1
      ),
      recipient: signer.address,
    };

    const { calldata, value } = NonfungiblePositionManager.collectCallParameters(collectOptions);
    const transaction = {
      data: calldata,
      to: context.addresses.WFX_NFT_MANAGER,
      value,
      from: signer.address,
    };

    return signer.sendTransaction(transaction);
  }

  return Object.freeze({
    createPoolContract,
    getQuoterV2Contract,
    getPoolInfo,
    getQuoteOutput,
    wrapETHIfNeeded,
    unwrapETHIfNeeded,
    checkBalanceAndApprove,
    swapExactInputSingle,
    swapExactInput,
    findRoute,
    swapExactInputMulticall,
    getPoolReserveAmounts,
    priceToTick,
    calculateAnotherAmount,
    getTickerLowerAndUpper,
    getPoolInstance,
    mintPosition,
    getPositions,
    findPosition,
    addLiquidity,
    removeLiquidity,
    collectFees,
  });
}
