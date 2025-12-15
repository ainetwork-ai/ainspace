'use client';

import React from 'react';
import Image from 'next/image';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TokenInfo {
  name: string;
  icon: string;
  url: string;
}

const tokens: TokenInfo[] = [
  {
    name: 'AIN(ETH)',
    icon: '/tokens/ethereum.svg',
    url: 'https://etherscan.io/token/0x3A810ff7211b40c4fA76205a14efe161615d0385',
  },
  {
    name: 'AIN(Base)',
    icon: '/tokens/base.svg',
    url: 'https://basescan.org/token/0xD4423795fd904D9B87554940a95FB7016f172773',
  },
  {
    name: 'sAIN',
    icon: '/tokens/base.svg',
    url: 'https://basescan.org/token/0x0000000000000000000000000000000000000000',
  },
  {
    name: 'MiniEgg NFT',
    icon: '/tokens/opensea.svg',
    url: 'https://opensea.io/collection/miniegg',
  },
];

interface HolderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}

export default function HolderModal({
  open,
  onOpenChange,
  className,
}: HolderModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'w-[328px] bg-white rounded-2xl py-6 px-4 shadow-lg',
          'flex flex-col gap-4',
          className
        )}
      >
        <DialogHeader className="flex flex-col items-center gap-2">
          <DialogTitle className="text-xl font-bold text-black text-center">
            Access for Holders Only
          </DialogTitle>
          <DialogDescription className="text-base text-gray-500 text-center">
            This feature is reserved for
            <br />
            AIN ecosystem holders.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {tokens.map((token) => (
            <a
              key={token.name}
              href={token.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between p-3 bg-[#F5F3FF] rounded-xl hover:bg-[#EDE9FE] transition-colors"
            >
              <div className="flex items-center gap-3">
                <Image
                  src={token.icon}
                  alt={token.name}
                  width={48}
                  height={48}
                  className="rounded-xl"
                />
                <span className="text-lg font-semibold text-[#7C3AED]">
                  {token.name}
                </span>
              </div>
              <ExternalLink className="w-6 h-6 text-[#7C3AED]" />
            </a>
          ))}
        </div>

        <p className="text-sm text-gray-400 text-center mt-2">
          The required assets were not
          <br />
          found in your wallet.
        </p>
      </DialogContent>
    </Dialog>
  );
}
