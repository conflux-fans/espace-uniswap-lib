# espace-uniswap-lib

`Conflux eSpace` 上的 `Swappi V2` / `vSwap(WallFreeX) V3` 辅助库。  
核心变化是去掉全局 `configure(...)`，改成 `await createClient(...)` 创建实例；每个 `client` 绑定一条确定的网络配置。

## 适用场景

- `V2` / `V3` exact-in 兑换
- `V2` 路径试算与 Pair 查询
- `V3` 路由搜索、报价、池子读取
- `V3` 流动性头寸创建、加减仓、手续费提取
- ERC20 授权、余额轮询、multicall 批量查询

## 模块说明

- `createClient`: 初始化当前网络的 `provider`、地址、Token 和 V2/V3 能力。
- `client.v2`: `Swappi V2` 兑换、路径搜索、Pair 查询。
- `client.v3`: `V3` 路由搜索、兑换、池子读取、LP/NFT 头寸操作。
- `client.utils`: 授权、余额查询、multicall 等辅助方法。
- `ethersProvider`: `provider` / `signer` 创建工具。
- `consts`: 与网络无关的常量和纯函数。

## 安装

```bash
pnpm add /absolute/path/to/espace-uniswap-lib
```

要求：

- `Node.js >= 20`
- `ESM` 环境

## 快速开始

下面示例演示一件最常见的事：创建一个 `client`，自动识别当前是主网还是测试网，然后把 `0.01 WCFX` 兑换成 `USDT0`。

### 1. 初始化 client 和 signer

这一段负责连接 RPC、识别网络，并生成当前网络对应的 `provider`、地址配置和 `Token` 实例。

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

### 2. 发起一次 V3 multicall 兑换

这一段把 `0.01 WCFX` 作为输入资产，通过当前 `client` 的 `V3 Router.multicall` 执行兑换。

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

说明：

- `createClient(...)` 只接受 `rpcUrl`，不接受 `provider`。
- 不传 `rpcUrl` 时默认使用主网配置。
- 传入 `rpcUrl` 后会通过链上 `chainId` 自动识别主网或测试网。
- 如果显式传 `network`，且它与 `rpcUrl` 实际链不一致，会直接报错。
- `signer` 推荐始终基于 `client.provider` 创建，避免网络不一致。

## 常用入口

### 初始化

- `createClient(options)`: 创建一个绑定单一网络的 `client`。
- `client.getConfig()`: 读取当前 `client` 的完整配置快照。
- `client.network`: 当前网络，值为 `mainnet` 或 `testnet`。
- `client.chainId`: 当前网络的 `chainId`。
- `client.provider`: 当前 `client` 使用的 `ethers` provider。
- `client.tokens`: 当前网络的预置 `Token` 实例，如 `WCFX9`、`USDT0`。

### V2

- `client.v2.swapToken(tokenIn, tokenOut, amountInRaw, signer)`: 走 `Swappi V2` 做 exact-in 兑换，内部会搜索最佳路径并发送交易。
- `client.v2.getBestPath(tokenInAddress, tokenOutAddress, amountInRaw, providerOrSigner)`: 评估候选 V2 路径，返回预估输出最高的那一条。
- `client.v2.getPair(tokenA, tokenB, provider)`: 读取某个 V2 Pair 的储备，并构造成 SDK `Pair` 对象。
- `client.v2.getSwappiPairs(provider)`: 扫描 Factory 下全部 Pair。

### V3

- `client.v3.findRoute(tokenIn, tokenOut, amountInRaw, recipient)`: 用 `AlphaRouter` 搜索可用的 `V3` 路由。
- `client.v3.swapExactInputSingle(tokenIn, tokenOut, fee, amountInRaw, signer)`: 单跳兑换，适合已知 fee tier 的场景。
- `client.v3.swapExactInput(tokenIn, tokenOut, fee, amountInRaw, signer)`: 先找路由，再直接调用 `router.exactInput`。
- `client.v3.swapExactInputMulticall(tokenIn, tokenOut, amountInRaw, signer)`: 先找路由，再通过 `router.multicall` 执行兑换。
- `client.v3.getPoolInfo(poolContract)`: 读取池子的核心状态。
- `client.v3.getPoolReserveAmounts(pool, provider)`: 查询池子当前两侧 token 余额。

### V3 流动性

- `client.v3.mintPosition(tokenA, tokenB, fee, amount0, amount1, tickLower, tickUpper, signer)`: 创建新的 V3 流动性头寸。
- `client.v3.getPositions(address, provider)`: 读取某个地址当前持有的全部 V3 NFT 头寸。
- `client.v3.findPosition(tokenA, tokenB, fee, signer)`: 按 token 对和 fee 查找当前账户中的头寸。
- `client.v3.addLiquidity(tokenA, tokenB, fee, amount0, amount1, signer)`: 给已存在头寸追加流动性。
- `client.v3.removeLiquidity(tokenA, tokenB, fee, signer)`: 从已存在头寸中移除部分流动性。
- `client.v3.collectFees(tokenA, tokenB, fee, signer)`: 提取某个头寸当前可领取的手续费。

### 工具

- `client.utils.approveIfNeeded(token, spender, amount, signer)`: allowance 不足时自动授权。
- `client.utils.batchErc20Balances(tokens, addresses, provider)`: 通过 multicall 批量查询 ERC20 余额。
- `client.utils.batchNativeBalances(addresses, provider)`: 通过 multicall 批量查询原生币余额。
- `fromReadableAmount(amount, decimals)`: 把人类可读金额转成链上最小单位。
- `parseEther` / `formatEther` / `parseUnits` / `formatUnits`: `ethers` 常用金额转换函数。

## createClient 参数

`createClient(...)` 支持以下字段：

- `network`: 可选，`mainnet` 或 `testnet`
- `rpcUrl`: 可选，自定义 RPC URL
- `addresses`: 可选，覆盖当前网络地址配置
- `bases`: 可选，覆盖 V2 路由候选中间币
- `logger`: 可选，注入 `info` / `error` / `debug` 方法
- `hooks.onTxMined`: 可选，交易确认后的异步回调

## 当前限制

- `swapExactInputMulticall` 当前不会自动为 ERC20 输入执行 `approve`，调用前需自行授权 `WFX_ROUTER`。
- `uniswapV2.addLiquidity` 和 `uniswapV2.removeLiquidity` 仅保留导出，尚未实现。
- 当前版本仍保留 `Pair.getAddress` 的全局覆写行为；如果同一进程同时创建多个不同网络的 `client`，请避免依赖 V2 的全局 Pair 地址行为。
- 测试网当前不提供完整的 `Swappi V2` 配置；`Pair.getAddress` 和 `client.v2.*` 在测试网会直接报错。
- 测试网默认只明确切换了 `RPC`、`WCFX9`、`USDT0` 和 `Multicall3`；如测试网协议地址与你的环境一致且你需要启用，请通过 `addresses` 显式覆盖并自行承担兼容性校验。
