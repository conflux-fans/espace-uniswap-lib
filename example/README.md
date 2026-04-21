# Example

运行前准备：

- 设置 `PRIVATE_KEY`
- 可选设置 `ESPACE_RPC_URL`
  - 不传时，示例默认使用主网 RPC
  - 传入后，`createClient(...)` 会根据链上 `chainId` 自动识别主网或测试网

安装依赖：

```bash
pnpm install
```

运行 `V2` 示例：

```bash
node example/uniswapv2-swap.js
```

运行 `V3` 示例：

```bash
node example/uniswapv3-swap.js
```
