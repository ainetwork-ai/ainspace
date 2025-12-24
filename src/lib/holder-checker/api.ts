export type Chain = "Ethereum" | "Base" | "Sepolia" | "BaseSepolia";
export type TokenStandard = "erc20" | "erc1155";
export type TokenSource = "onchain" | "opensea";

export interface HolderCheckerContractBody {
  chain: Chain;
  standard: TokenStandard;
  address: `0x${string}`;
  source: TokenSource;
}

export interface OnchainContract extends HolderCheckerContractBody {
  source: "onchain";
}

export interface OpenseaContract extends HolderCheckerContractBody {
  source: "opensea";
  collection: string;
}

export type HolderCheckerContract = OnchainContract | OpenseaContract;

// FIXME(yoojin): 응답 타입 확인
export interface CheckIsHolderResponse {
  isHolder: boolean;
  token: HolderCheckerContract;
}

export const checkIsHolder = async (walletAddress: `0x${string}`, contracts: HolderCheckerContract[]) => {
  const result = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/token/balance`, {
    method: 'POST',
    body: JSON.stringify({ walletAddress, contracts }),
  });
  return result.json();
}