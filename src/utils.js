import JSBI from "jsbi";
import { ethers } from "ethers";
import { getCreate2Address } from "@ethersproject/address";
import { keccak256, pack } from "@ethersproject/solidity";
import { computePoolAddress } from "./uniswapDeps.js";
import { ERC20ABI, Multicall3ABI } from "./abis.js";
import { log, emitHook, getResolvedProvider, assertSignerMatchesClient } from "./clientRuntime.js";

export function fromReadableAmount(amount, decimals) {
  const extraDigits = Math.pow(10, countDecimals(amount));
  const adjustedAmount = amount * extraDigits;
  return JSBI.divide(
    JSBI.multiply(
      JSBI.BigInt(adjustedAmount),
      JSBI.exponentiate(JSBI.BigInt(10), JSBI.BigInt(decimals))
    ),
    JSBI.BigInt(extraDigits)
  );
}

export function toReadableAmount(rawAmount, decimals) {
  return JSBI.divide(
    JSBI.BigInt(rawAmount),
    JSBI.exponentiate(JSBI.BigInt(10), JSBI.BigInt(decimals))
  ).toString();
}

function countDecimals(x) {
  if (Math.floor(x) === x) {
    return 0;
  }
  return x.toString().split(".")[1].length || 0;
}

export function computeWfxPoolAddress(tokenA, tokenB, fee, config) {
  return computePoolAddress({
    factoryAddress: config.addresses.WFX_FACTORY,
    tokenA,
    tokenB,
    fee,
    initCodeHashManualOverride: config.addresses.WFX_INIT_CODE_HASH,
    chainId: config.chainId,
  });
}

export function computePairAddress({ factoryAddress, tokenA, tokenB, initCodeHash }) {
  const isTokenObject =
    tokenA &&
    tokenB &&
    typeof tokenA === "object" &&
    typeof tokenB === "object" &&
    typeof tokenA.sortsBefore === "function";

  const [token0Address, token1Address] = isTokenObject
    ? tokenA.sortsBefore(tokenB)
      ? [tokenA.address, tokenB.address]
      : [tokenB.address, tokenA.address]
    : [String(tokenA), String(tokenB)].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  return getCreate2Address(
    factoryAddress,
    keccak256(["bytes"], [pack(["address", "address"], [token0Address, token1Address])]),
    initCodeHash
  );
}

export function erc20Contract(address, signerOrProvider) {
  return new ethers.Contract(address, ERC20ABI, signerOrProvider);
}

function parseApproveIfNeededArgs(arg1, arg2, arg3) {
  if (typeof arg1 === "string") {
    return { spender: arg1, amount: arg2, signer: arg3 };
  }
  return { signer: arg1, spender: arg2, amount: arg3 };
}

export function deadline(min = 30) {
  return Math.floor(Date.now() / 1000 + min * 60);
}

export function createUtils(context) {
  async function approveIfNeeded(tokenAddress, arg1, arg2, arg3) {
    const { signer, spender, amount } = parseApproveIfNeededArgs(arg1, arg2, arg3);
    if (!signer || !spender || amount === undefined || amount === null) {
      throw new Error("approveIfNeeded parameters are invalid");
    }

    await assertSignerMatchesClient(context, signer);

    const contract = new ethers.Contract(tokenAddress, ERC20ABI, signer);
    const currentApproval = await contract.allowance(signer.address, spender);
    if (currentApproval.gte(amount)) return null;

    log(context, "info", `Current allowance for spender ${spender} is ${currentApproval.toString()}, approving...`);
    const approveTx = await contract.approve(spender, MaxUint256);
    const receipt = await approveTx.wait();
    await emitHook(context, "onTxMined", {
      kind: "approve",
      tokenAddress,
      spender,
      signerAddress: signer.address,
      tx: approveTx,
      receipt,
    });
    return receipt;
  }

  async function waitForErc20Balance(token, address, amount, provider, intervalMs = 5000, timeoutMs = 900000) {
    const startTime = Date.now();
    while (true) {
      const balance = await erc20Balance(token, address, provider);
      if (balance.gte(amount)) {
        return;
      }
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Timeout waiting for ERC20 balance of ${token} at address ${address}`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  async function waitForNativeBalance(address, amount, provider, intervalMs = 5000, timeoutMs = 900000) {
    const resolvedProvider = getResolvedProvider(context, provider);
    const startTime = Date.now();
    while (true) {
      const balance = await resolvedProvider.getBalance(address);
      if (balance.gte(amount)) {
        return;
      }
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Timeout waiting for native balance at address ${address}`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  async function erc20Balance(token, address, provider) {
    const contract = erc20Contract(token, getResolvedProvider(context, provider));
    return contract.balanceOf(address);
  }

  async function erc20Allowance(token, owner, spender, provider) {
    const contract = erc20Contract(token, getResolvedProvider(context, provider));
    return contract.allowance(owner, spender);
  }

  async function batchErc20BalancesOfOneToken(token, addresses, provider) {
    const tokens = addresses.map(() => token);
    return batchErc20Balances(tokens, addresses, provider);
  }

  async function batchErc20Balances(tokens, addresses, provider) {
    if (!Array.isArray(tokens) || !Array.isArray(addresses)) {
      throw new Error("Either tokens or addresses must be an array");
    }
    if (tokens.length !== addresses.length) {
      throw new Error("If both tokens and addresses are arrays, they must have the same length");
    }

    const resolvedProvider = getResolvedProvider(context, provider);
    const multicallAddress = context.addresses.MULTICALL3_ADDRESS;
    const erc20Interface = new ethers.utils.Interface(ERC20ABI);
    const multicall = new ethers.Contract(multicallAddress, Multicall3ABI, resolvedProvider);
    const calls = [];

    for (let i = 0; i < tokens.length; i++) {
      calls.push({
        target: tokens[i],
        allowFailure: true,
        callData: erc20Interface.encodeFunctionData("balanceOf", [addresses[i]]),
      });
    }

    const batchSize = 200;
    const results = [];
    for (let i = 0; i < calls.length; i += batchSize) {
      const batchCalls = calls.slice(i, i + batchSize);
      const batchResults = await multicall.callStatic.aggregate3(batchCalls);
      results.push(...batchResults);
    }

    return results.map((result) => {
      if (!result.success) {
        return ethers.BigNumber.from(0);
      }
      return erc20Interface.decodeFunctionResult("balanceOf", result.returnData)[0];
    });
  }

  async function batchNativeBalances(addresses, provider) {
    const resolvedProvider = getResolvedProvider(context, provider);
    const multicallAddress = context.addresses.MULTICALL3_ADDRESS;
    const multicall = new ethers.Contract(multicallAddress, Multicall3ABI, resolvedProvider);
    const calls = addresses.map((address) => ({
      target: multicallAddress,
      allowFailure: true,
      callData: multicall.interface.encodeFunctionData("getEthBalance", [address]),
    }));

    const batchSize = 200;
    const results = [];
    for (let i = 0; i < calls.length; i += batchSize) {
      const batchCalls = calls.slice(i, i + batchSize);
      const batchResults = await multicall.callStatic.aggregate3(batchCalls);
      results.push(...batchResults);
    }

    return results.map((result) => {
      if (!result.success) {
        return ethers.BigNumber.from(0);
      }
      return ethers.BigNumber.from(result.returnData);
    });
  }

  return Object.freeze({
    computeWfxPoolAddress(tokenA, tokenB, fee) {
      return computeWfxPoolAddress(tokenA, tokenB, fee, context);
    },
    approveIfNeeded,
    waitForErc20Balance,
    waitForNativeBalance,
    erc20Balance,
    erc20Allowance,
    batchErc20BalancesOfOneToken,
    batchErc20Balances,
    batchNativeBalances,
  });
}

export const formatEther = ethers.utils.formatEther;
export const parseEther = ethers.utils.parseEther;
export const formatUnits = ethers.utils.formatUnits;
export const parseUnits = ethers.utils.parseUnits;

export const MaxUint256 = ethers.constants.MaxUint256;
