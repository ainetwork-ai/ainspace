import { AuthDefinition } from '@/types/auth';

export const DEFAULT_AUTH_DEFINITIONS: AuthDefinition[] = [
  {
    name: 'ain_eth_holder',
    permissions: {
      importAgent: true,
      placeAgent: 3,
      placeAllowedMaps: ['Happy Village'],
    },
    tokenRequirements: [
      {
        type: 'erc20',
        chain: 'Ethereum',
        address: '0x3A810ff7211b40c4fA76205a14efe161615d0385',
        minAmount: 1,
      },
    ],
  },
  {
    name: 'ain_base_holder',
    permissions: {
      importAgent: true,
      placeAgent: 3,
      placeAllowedMaps: ['Happy Village'],
    },
    tokenRequirements: [
      {
        type: 'erc20',
        chain: 'Base',
        address: '0xD4423795fd904D9B87554940a95FB7016f172773',
        minAmount: 1,
      },
    ],
  },
  {
    name: 'sain_base_holder',
    permissions: {
      importAgent: true,
      placeAgent: 10,
      placeAllowedMaps: ['Uncommon Village', 'Happy Village'],
    },
    tokenRequirements: [
      {
        type: 'erc20',
        chain: 'Base',
        address: '0x70e68AF68933D976565B1882D80708244E0C4fe9',
        minAmount: 1,
      },
    ],
  },
  {
    name: 'mini_egg_nft_holder',
    permissions: {
      importAgent: true,
      placeAgent: 10,
      placeAllowedMaps: [
        'Uncommon Village',
        'Hahoe Village',
        'Happy Village',
      ],
      mapBuild: true,
      buildAllowedMaps: ['Happy Village'],
    },
    tokenRequirements: [
      {
        type: 'erc1155',
        chain: 'Ethereum',
        address: '0x495f947276749Ce646f68AC8c248420045cb7b5e',
        minAmount: 1,
      },
    ],
  },
  {
    name: 'admin',
    permissions: {
      importAgent: true,
      placeAgent: true, // 무제한
      placeAllowedMaps: ['*'], // 모든 마을
      mapBuild: true,
      buildAllowedMaps: ['*'], // 모든 마을
      adminAccess: true,
    },
    tokenRequirements: [],
  },
];

export const initializeDefaultAuths = async (): Promise<void> => {
  const { saveAuthDefinition } = await import('./redis');

  for (const auth of DEFAULT_AUTH_DEFINITIONS) {
    await saveAuthDefinition(auth);
  }
};
