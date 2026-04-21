import { MAINNET_PRESET } from "./mainnet.js";
import { TESTNET_PRESET } from "./testnet.js";

export const NETWORK_PRESETS = Object.freeze({
  mainnet: MAINNET_PRESET,
  testnet: TESTNET_PRESET,
});

export const SUPPORTED_NETWORKS = Object.freeze(Object.keys(NETWORK_PRESETS));

export function getPresetByNetwork(network) {
  const preset = NETWORK_PRESETS[network];
  if (!preset) {
    throw new Error(`Unsupported network: ${String(network)}`);
  }
  return preset;
}

export function getPresetByChainId(chainId) {
  for (const preset of Object.values(NETWORK_PRESETS)) {
    if (preset.chainId === Number(chainId)) {
      return preset;
    }
  }
  throw new Error(`Unsupported network chainId: ${String(chainId)}`);
}
