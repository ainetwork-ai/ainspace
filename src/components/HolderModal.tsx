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
    url: 'https://www.coingecko.com/en/coins/ai-network',
  },
  {
    name: 'AIN(Base)',
    icon: '/tokens/base.svg',
    url: 'https://www.coingecko.com/en/coins/ai-network',
  },
  {
    name: 'sAIN',
    icon: '/tokens/base.svg',
    url: 'https://stake.ainetwork.ai/stake',
  },
  {
    name: 'MiniEgg NFT',
    icon: '/tokens/opensea.svg',
    url: 'https://opensea.io/collection/mysterious-minieggs',
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
}: HolderModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'w-auto bg-white rounded-2xl py-6 px-4 shadow-lg',
          'flex flex-col gap-4',
        )}
      >
        <DialogHeader className="flex flex-col items-center gap-1 pt-6">
          <DialogTitle className="text-xl font-bold text-black text-center">
            Access for Holders Only
          </DialogTitle>
          <DialogDescription className="text-base text-[#2F333B] text-center">
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
              className="flex items-center justify-between p-2 bg-[#f7f0ff] rounded-lg hover:bg-[#EDE9FE] transition-colors w-[264px]"
            >
              <div className="flex items-center gap-2">
                <Image
                  src={token.icon}
                  alt={token.name}
                  width={32}
                  height={32}
                  className="rounded-xs"
                />
                <span className="text-[16px] font-bold text-[#7C3AED] font-manrope">
                  {token.name}
                </span>
              </div>
              <ExternalLink className="w-6 h-6 text-[#7C3AED]" />
            </a>
          ))}
        </div>

        <p className="text-sm text-[#969EAA] text-center mt-2">
          The required assets were not
          <br />
          found in your wallet.
        </p>
      </DialogContent>
    </Dialog>
  );
}
