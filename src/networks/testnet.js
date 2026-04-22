import { MAINNET_PRESET } from "./mainnet.js";

export const TESTNET_PRESET = Object.freeze({
  network: "testnet",
  chainId: 71,
  rpcUrl: "https://evmtestnet.confluxrpc.com",
  addresses: Object.freeze({
    ...MAINNET_PRESET.addresses,
    SWAPPI_FACTORY: undefined,
    SWAPPI_ROUTER: undefined,
    SWAPPI_ROUTER_V2: undefined,
    INIT_CODE_HASH: undefined,
    MULTICALL3_ADDRESS: "0xEFf0078910f638cd81996cc117bccD3eDf2B072F",
    CFX_MULTICALL_ADDRESS: "0xEFf0078910f638cd81996cc117bccD3eDf2B072F",
    USDT0_ADDRESS: "0x7d682e65efc5c13bf4e394b8f376c48e6bae0355",
    WCFX9_ADDRESS: "0x2ed3dddae5b2f321af0806181fbfa6d049be47d8",
    AXCNH_ADDRESS: undefined,
    cUSDT_ADDRESS: undefined,
    cUSDC_ADDRESS: undefined,
    cETH_ADDRESS: undefined,
    cBTC_ADDRESS: undefined,
    xCFX_ADDRESS: undefined,
  }),
  bases: Object.freeze([
    "0x2ed3dddae5b2f321af0806181fbfa6d049be47d8",
    "0x7d682e65efc5c13bf4e394b8f376c48e6bae0355",
  ]),
});
