# AGENTS.md

本文件记录本仓库的实现边界与后续修改约束，供人和 agent 统一遵循。

## 项目概况

- 本项目是 `Conflux eSpace` 上的 `Swappi V2` / `vSwap(WallFreeX) V3` 辅助库。
- 当前初始化方式为 `await createClient(...)`。
- `createClient(...)` 默认使用主网配置；若传入 `rpcUrl`，会通过链上 `chainId` 自动识别主网或测试网。
- `createClient(...)` 禁止传 `provider`，只允许传 `rpcUrl`。
- 主网与测试网配置已拆分到独立网络预设文件中。

## 当前架构

- `src/config.js`
  负责 `createClient(...)`、网络识别、client 组装。
- `src/networks/`
  存放主网/测试网预设。
- `src/uniswapV2.js`
  提供 `client.v2.*` 能力，以及 `createSwappiPair(...)` 工厂（不触发 `@uniswap/v2-sdk` 的 `Pair` 构造器）。
- `src/uniswapV3.js`
  提供 `client.v3.*` 能力。
- `src/swappiV2PoolProvider.js`
  注入给 `AlphaRouter` 的自定义 V2 pool provider，走 Swappi factory + initCodeHash，不依赖 `Pair.getAddress`。
- `src/utils.js`
  提供 `client.utils.*` 与纯工具函数。
- `src/uniswapToken.js`
  基于当前 client 动态生成 `client.tokens.*`。

## 重要约束

### 1. 不得依赖 `@uniswap/v2-sdk` 的 `Pair.getAddress` / `Pair` 构造器

本库**不再**通过全局覆写 `Pair.getAddress` 来适配 Swappi。所有 V2 pair 地址一律通过 [src/utils.js](./src/utils.js) 的 `computePairAddress(...)` 显式计算；需要 "Pair 形状" 的对象时，使用 [src/uniswapV2.js](./src/uniswapV2.js) 里的 `createSwappiPair(...)` 工厂（它不会触发 `@uniswap/v2-sdk` 的 `Pair` 构造器）。

原因：

- 全局覆写隐式假设整个进程只有一份 `@uniswap/v2-sdk`。当下游消费者用 npm / yarn 安装，或者 `v-swap-smart-order-router` 嵌套了另一份 `@uniswap/v2-sdk@3.x` 时，覆写就错过那份副本，表现为 `Failed to get gas models: invalid address, value=undefined`。
- 覆写靠 `pnpm.overrides` 兜底，只在库自身为根项目时生效；作为依赖被安装时会失效。

约束：

- 任何新增 V2 能力：地址用 `computePairAddress(...)`，对象用 `createSwappiPair(...)`，**不要** `new Pair(...)`、**不要** `Pair.getAddress(...)`。
- 调用 `AlphaRouter` 时必须注入自定义 `v2PoolProvider` —— 见 [src/swappiV2PoolProvider.js](./src/swappiV2PoolProvider.js) 与 [src/uniswapV3.js](./src/uniswapV3.js) 里 `findRoute` 的构造器参数。默认 `V2PoolProvider` 依赖 `Pair.getAddress`，不可使用。
- 若未来要支持 `protocols: ['V2']` 或 `'MIXED'`，需同时注入自定义 `v2SubgraphProvider`，并核查 `v-swap-smart-order-router` mixed-route gas model 里的 `instanceof Pair` 判断是否会命中（`createSwappiPair` 返回的对象不是 `Pair` 实例）。

### 2. 变更网络相关逻辑时的要求

- 任何网络相关能力都应绑定在 `client` 上，不应重新引入全局运行时配置。
- 若修改 `createClient(...)`、网络预设、地址覆盖逻辑，必须同步检查：
  - `README.md`
  - `example/`
  - `tests/`

### 3. 修改测试网地址时的要求

- 测试网目前只明确切换了 `RPC`、`WCFX9`、`USDT0` 和 `Multicall3`。
- 当前测试网不提供完整的 `Swappi V2` 配置，因此 `client.v2.*` 方法在测试网应通过 `assertV2Configured()` 直接报错；`createSwappiV2PoolProvider(context)` 在测试网返回空 accessor，让 V3 路由的 gas 模型自动跳过 V2 fallback。
- 若要补齐测试网 DEX 协议地址，必须先确认来源可靠，再写入预设。
- 在未确认前，应继续通过 `createClient({ addresses: ... })` 让调用方显式覆盖。

## 修改原则

- 优先保持现有功能不变。
- 若某项重构存在功能风险，先在本文件补充约束，再实施。
- 任何 breaking change 都必须同步更新 `README.md`、示例和测试。
