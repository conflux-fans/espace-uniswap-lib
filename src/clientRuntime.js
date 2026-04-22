export function log(context, level, message, ...args) {
  const logger = context?.logger;
  if (!logger || typeof logger[level] !== "function") return;
  logger[level](message, ...args);
}

export const BPS_BASE = 10_000;
export const DEFAULT_SLIPPAGE_BPS = 50;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function emitHook(context, name, payload) {
  const hook = context?.hooks?.[name];
  if (typeof hook !== "function") return;
  await hook(payload);
}

export function getResolvedProvider(context, provider) {
  return provider || context.provider;
}

export async function assertSignerMatchesClient(context, signer) {
  if (!signer || typeof signer !== "object") {
    throw new Error("Signer is required");
  }
  if (!signer.provider || typeof signer.provider.getNetwork !== "function") {
    throw new Error("Signer must be connected to a provider");
  }

  const network = await signer.provider.getNetwork();
  const signerChainId = Number(network?.chainId);
  if (signerChainId !== Number(context.chainId)) {
    throw new Error(`Signer network mismatch: signer=${signerChainId} client=${context.chainId}`);
  }
}

export function resolveSlippageBps(options) {
  if (options === undefined) {
    return DEFAULT_SLIPPAGE_BPS;
  }
  if (!isPlainObject(options)) {
    throw new Error("swap options must be a plain object");
  }

  const { slippageBps } = options;
  if (slippageBps === undefined) {
    return DEFAULT_SLIPPAGE_BPS;
  }
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= BPS_BASE) {
    throw new Error("slippageBps must be an integer between 0 and 9999");
  }

  return slippageBps;
}

export function applySlippageBps(amount, slippageBps) {
  return amount.mul(BPS_BASE - slippageBps).div(BPS_BASE);
}
