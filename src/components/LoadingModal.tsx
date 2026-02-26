'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoadingModalProps {
  open: boolean;
  title?: string;
  message?: string;
  subMessage?: string;
  className?: string;
  isDarkMode?: boolean;
}

export default function LoadingModal({
  open,
  title = 'Updating...',
  message = 'Applying your request.',
  subMessage = 'Please wait for a moment.',
  className,
  isDarkMode = false,
}: LoadingModalProps) {
  return (
    <Dialog open={open} modal={true}>
      <DialogContent
        className={cn(
          'max-w-xs rounded-2xl py-6 px-4 shadow-lg',
          'flex flex-col items-center justify-center gap-4',
          isDarkMode ? 'bg-[#2F333B]' : 'bg-white',
          className
        )}
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="flex flex-col items-center gap-2">
          <DialogTitle className={cn("text-lg font-bold text-center", isDarkMode ? 'text-white' : 'text-black')}>
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-1">
          <DialogDescription className={cn("text-sm text-center", isDarkMode ? 'text-[#CAD0D7]' : 'text-gray-600')}>
            {message}
          </DialogDescription>
          <DialogDescription className={cn("text-sm text-center", isDarkMode ? 'text-[#CAD0D7]' : 'text-gray-600')}>
            {subMessage}
          </DialogDescription>
        </div>
      </DialogContent>
    </Dialog>
  );
}
