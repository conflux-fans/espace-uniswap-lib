import { ethers } from "ethers";

export function createEthersProvider(url) {
  if (!url) {
    throw new Error("createEthersProvider(...) requires rpc url");
  }
  return new ethers.providers.JsonRpcProvider(url);
}

export function createEthersSigner(privateKey, provider) {
  if (!privateKey) {
    throw new Error("createEthersSigner(...) requires private key");
  }
  if (!provider) {
    throw new Error("createEthersSigner(...) requires provider");
  }
  return new ethers.Wallet(privateKey, provider);
}
