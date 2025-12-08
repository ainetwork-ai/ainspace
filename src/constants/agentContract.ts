export const AGENT_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_AGENT_CONTRACT_ADDRESS as `0x${string}`;
export const ADD_AGENT_ABI = [
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "_agentUrl",
        "type": "string"
      },
      {
        "internalType": "int256",
        "name": "_x",
        "type": "int256"
      },
      {
        "internalType": "int256",
        "name": "_y",
        "type": "int256"
      }
    ],
    "name": "addAgent",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
]

export const A2A_BUILDER_URL = process.env.NEXT_PUBLIC_A2A_BUILDER_URL || 'https://a2a-builder-dev.ainetwork.ai';
