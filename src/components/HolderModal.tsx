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
  {
    name: 'Uncommon Membership',
    icon: '/tokens/uncommon_membership.svg',
    url: 'https://comcom.notion.site/AINSpace-2cdd86552212806eab88fa68aefa1ae9?source=copy_link',
  },
];

interface HolderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDarkMode?: boolean;
  className?: string;
}

export default function HolderModal({
  open,
  onOpenChange,
  isDarkMode = false,
}: HolderModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'w-[328px] rounded-2xl py-6 px-4 shadow-lg border-none',
          'flex flex-col gap-4',
          isDarkMode ? 'dark bg-[#2F333B] [&_[data-slot=dialog-close]]:text-white' : 'bg-white',
        )}
      >
        <DialogHeader className="flex flex-col items-center gap-1 pt-6">
          <DialogTitle className={cn("text-xl font-bold text-center", isDarkMode ? 'text-white' : 'text-black')}>
            Access for Holders Only
          </DialogTitle>
          <DialogDescription className={cn("text-base text-center", isDarkMode ? 'text-[#CAD0D7]' : 'text-[#2F333B]')}>
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
              className={cn(
                "flex items-center justify-between p-2 rounded-lg transition-colors w-full",
                isDarkMode ? 'bg-[#3A3050] hover:bg-[#4A3E60]' : 'bg-[#f7f0ff] hover:bg-[#EDE9FE]',
              )}
            >
              <div className="flex items-center gap-2">
                <Image
                  src={token.icon}
                  alt={token.name}
                  width={32}
                  height={32}
                  className="rounded-xs"
                />
                <span className={cn("text-[16px] font-bold font-manrope", isDarkMode ? 'text-[#C0A9F1]' : 'text-[#7C3AED]')}>
                  {token.name}
                </span>
              </div>
              <ExternalLink className={cn("w-6 h-6", isDarkMode ? 'text-[#C0A9F1]' : 'text-[#7C3AED]')} />
            </a>
          ))}
        </div>

        <p className={cn("text-sm text-center mt-2", isDarkMode ? 'text-[#838D9D]' : 'text-[#969EAA]')}>
          The required assets were not
          <br />
          found in your wallet.
        </p>
      </DialogContent>
    </Dialog>
  );
}
