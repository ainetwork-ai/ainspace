export type Chain = "Ethereum" | "Base" | "Sepolia" | "BaseSepolia";
export type TokenStandard = "erc20" | "erc1155";
export type TokenSource = "onchain" | "opensea";

export interface HolderCheckerContractBody {
  chain: Chain;
  standard: TokenStandard;
  address: `0x${string}`;
  source: TokenSource;
  tokenId?: string;
}

export interface OnchainERC20Contract extends HolderCheckerContractBody {
  source: "onchain";
  standard: "erc20";
}

export interface OnchainERC1155Contract extends HolderCheckerContractBody {
  source: "onchain";
  standard: "erc1155";
  tokenId: string;
}

export interface OpenseaContract extends HolderCheckerContractBody {
  source: "opensea";
  collection: string;
}

export type HolderCheckerContract = OnchainERC20Contract | OnchainERC1155Contract | OpenseaContract;

// FIXME(yoojin): 응답 타입 확인
export interface CheckIsHolderResponse {
  isHolder: boolean;
  chain: Chain;
  standard: TokenStandard;
  contractAddress: `0x${string}`;
  source: TokenSource;
  tokenId?: string;
  collection?: string;
  error: string | null;
  decimals: number | null;
  balance: string;
  success: boolean;
}

export const checkIsHolder = async (walletAddress: `0x${string}`, contracts: HolderCheckerContract[]) => {
  const result = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/token/balance`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ walletAddress, contracts }),
  });
  return result.json();
}