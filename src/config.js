import { createEthersProvider } from "./ethersProvider.js";
import { buildTokens } from "./uniswapToken.js";
import { createUtils } from "./utils.js";
import { createWethClient } from "./weth.js";
import { createUniswapV2Client } from "./uniswapV2.js";
import { createUniswapV3Client } from "./uniswapV3.js";
import { getPresetByChainId, getPresetByNetwork, NETWORK_PRESETS, SUPPORTED_NETWORKS } from "./networks/index.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clonePreset(preset) {
  return {
    network: preset.network,
    chainId: preset.chainId,
    rpcUrl: preset.rpcUrl,
    addresses: { ...preset.addresses },
    bases: [...preset.bases],
  };
}

function freezeClientConfig(config) {
  return Object.freeze({
    ...config,
    addresses: Object.freeze({ ...config.addresses }),
    bases: Object.freeze([...config.bases]),
    hooks: Object.freeze({ ...config.hooks }),
  });
}

const BASE_ADDRESS_KEYS = Object.freeze([
  "WCFX9_ADDRESS",
  "cUSDT_ADDRESS",
  "USDT0_ADDRESS",
  "cUSDC_ADDRESS",
  "cETH_ADDRESS",
  "cBTC_ADDRESS",
  "xCFX_ADDRESS",
  "AXCNH_ADDRESS",
]);

function resolveBases(preset, addresses, bases) {
  if (Array.isArray(bases) && bases.length > 0) {
    return [...bases];
  }

  const replacements = new Map();
  for (const key of BASE_ADDRESS_KEYS) {
    const original = preset.addresses[key];
    const overridden = addresses[key];
    if (original && overridden && original.toLowerCase() !== overridden.toLowerCase()) {
      replacements.set(original.toLowerCase(), overridden);
    }
  }

  return preset.bases
    .map((address) => replacements.get(address.toLowerCase()) || address)
    .filter(Boolean);
}

function validateCreateClientOptions(options) {
  if (!isPlainObject(options)) {
    throw new Error("createClient(...) expects a plain object");
  }
  if ("provider" in options) {
    throw new Error("createClient(...) does not accept provider; use rpcUrl instead");
  }
  if (options.network !== undefined && !SUPPORTED_NETWORKS.includes(options.network)) {
    throw new Error(`Unsupported network: ${String(options.network)}`);
  }
  if (options.addresses !== undefined && !isPlainObject(options.addresses)) {
    throw new Error("createClient(...) expects addresses to be a plain object");
  }
  if (options.hooks !== undefined && !isPlainObject(options.hooks)) {
    throw new Error("createClient(...) expects hooks to be a plain object");
  }
  if (options.bases !== undefined && !Array.isArray(options.bases)) {
    throw new Error("createClient(...) expects bases to be an array");
  }
}

export async function createClient(options = {}) {
  validateCreateClientOptions(options);

  const defaultPreset = getPresetByNetwork(options.network || "mainnet");
  const rpcUrl = options.rpcUrl || defaultPreset.rpcUrl;
  const provider = createEthersProvider(rpcUrl);
  const networkInfo = await provider.getNetwork();
  const detectedPreset = clonePreset(getPresetByChainId(networkInfo.chainId));

  if (options.network && options.network !== detectedPreset.network) {
    throw new Error(
      `Configured network ${options.network} does not match RPC chainId ${networkInfo.chainId} (${detectedPreset.network})`
    );
  }

  const addresses = {
    ...detectedPreset.addresses,
    ...(options.addresses || {}),
  };
  const bases = resolveBases(detectedPreset, addresses, options.bases);

  const context = {
    network: detectedPreset.network,
    chainId: Number(networkInfo.chainId),
    rpcUrl,
    provider,
    addresses,
    bases,
    logger: options.logger ?? null,
    hooks: { ...(options.hooks || {}) },
  };

  context.tokens = buildTokens({
    chainId: context.chainId,
    addresses: context.addresses,
  });
  context.utils = createUtils(context);
  context.weth = createWethClient(context);

  const v2 = createUniswapV2Client(context);
  const v3 = createUniswapV3Client(context);
  const clientConfig = freezeClientConfig(context);

  return Object.freeze({
    network: clientConfig.network,
    chainId: clientConfig.chainId,
    rpcUrl: clientConfig.rpcUrl,
    provider: clientConfig.provider,
    addresses: clientConfig.addresses,
    bases: clientConfig.bases,
    tokens: clientConfig.tokens,
    getConfig() {
      return clientConfig;
    },
    utils: context.utils,
    v2,
    v3,
  });
}

export {
  NETWORK_PRESETS,
  SUPPORTED_NETWORKS,
  getPresetByChainId,
  getPresetByNetwork,
};
