export function log(context, level, message, ...args) {
  const logger = context?.logger;
  if (!logger || typeof logger[level] !== "function") return;
  logger[level](message, ...args);
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
