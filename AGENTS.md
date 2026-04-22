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
  提供 `client.v2.*` 能力。
- `src/uniswapV3.js`
  提供 `client.v3.*` 能力。
- `src/utils.js`
  提供 `client.utils.*` 与纯工具函数。
- `src/uniswapToken.js`
  基于当前 client 动态生成 `client.tokens.*`。

## 重要约束

### 1. 禁止修改 `Pair.getAddress` 全局覆写

当前 [src/uniswapV2.js](./src/uniswapV2.js) 中仍保留 `Pair.getAddress` 的全局覆写。  
这条逻辑当前 **禁止重构、禁止删除、禁止替换**，前提是“不能影响现有功能”。

原因：

- `@uniswap/v2-sdk` 的 `Pair` 构造函数内部会调用静态方法 `Pair.getAddress(...)`。
- 第三方依赖中也存在对 `Pair.getAddress(...)` 的直接依赖。
- 如果仅在本库内部改成显式地址计算，而去掉全局覆写，可能导致：
  - `Pair` 内部 `liquidityToken` 地址错误
  - 第三方 V2 路径或调试输出行为错误

结论：

- 在没有完整替换所有相关调用路径之前，任何涉及 `Pair.getAddress` 的改动都视为高风险改动。
- 若任务要求“不能影响现有功能”，则这部分必须保持现状。

### 2. 变更网络相关逻辑时的要求

- 任何网络相关能力都应绑定在 `client` 上，不应重新引入全局运行时配置。
- 若修改 `createClient(...)`、网络预设、地址覆盖逻辑，必须同步检查：
  - `README.md`
  - `example/`
  - `tests/`

### 3. 修改测试网地址时的要求

- 测试网目前只明确切换了 `RPC`、`WCFX9`、`USDT0` 和 `Multicall3`。
- 当前测试网不提供完整的 `Swappi V2` 配置，因此 `Pair.getAddress` 和 `client.v2.*` 在测试网应直接报错。
- 若要补齐测试网 DEX 协议地址，必须先确认来源可靠，再写入预设。
- 在未确认前，应继续通过 `createClient({ addresses: ... })` 让调用方显式覆盖。

## 修改原则

- 优先保持现有功能不变。
- 若某项重构存在功能风险，先在本文件补充约束，再实施。
- 任何 breaking change 都必须同步更新 `README.md`、示例和测试。
