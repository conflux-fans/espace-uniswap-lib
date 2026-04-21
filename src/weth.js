import { ethers } from "ethers";
import { WETH9ABI } from "./abis.js";
import { assertSignerMatchesClient } from "./clientRuntime.js";

export function createWethClient(context) {
  async function wrapETH(amount, signer) {
    await assertSignerMatchesClient(context, signer);

    const wethContract = new ethers.Contract(
      context.addresses.WCFX9_ADDRESS,
      WETH9ABI,
      signer
    );
    const balance = await context.provider.getBalance(signer.address);
    if (balance.lt(amount)) {
      throw new Error("原生 CFX 余额不足，无法包装为 WCFX");
    }

    const wrapTx = await wethContract.deposit({ value: amount });
    const receipt = await wrapTx.wait();
    if (receipt.status !== 1) {
      throw new Error("包装 WCFX 失败");
    }
    return receipt;
  }

  async function unwrapETH(amount, signer) {
    await assertSignerMatchesClient(context, signer);

    const wethContract = new ethers.Contract(
      context.addresses.WCFX9_ADDRESS,
      WETH9ABI,
      signer
    );

    const wethBalance = await wethContract.balanceOf(signer.address);
    if (wethBalance.lt(amount)) {
      throw new Error("WCFX 余额不足，无法解包为原生 CFX");
    }

    const unwrapTx = await wethContract.withdraw(amount);
    const receipt = await unwrapTx.wait();
    if (receipt.status !== 1) {
      throw new Error("解包 WCFX 失败");
    }
    return receipt;
  }

  return Object.freeze({
    wrapETH,
    unwrapETH,
  });
}
