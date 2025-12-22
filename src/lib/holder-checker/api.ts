export type Chain = "Ethereum" | "Base" | "Sepolia" | "BaseSepolia";
export type TokenStandard = "erc20" | "erc1155";
export type TokenSource = "onchain" | "opensea";

export interface HolderCheckerContract {
  chain: Chain;
  standard: TokenStandard;
  address: `0x${string}`;
  source: TokenSource;
}

// FIXME(yoojin): 응답 타입 확인
export interface CheckIsHolderResponse {
  isHolder: boolean;
  token: HolderCheckerContract;
}

export const checkIsHolder = async (contracts: HolderCheckerContract[]) => {
  const result = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/token/balance`, {
    method: 'POST',
    body: JSON.stringify(contracts),
  });
  return result.json();
}