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
}

export default function LoadingModal({
  open,
  title = 'Updating...',
  message = 'Applying your request.',
  subMessage = 'Please wait for a moment.',
  className,
}: LoadingModalProps) {
  return (
    <Dialog open={open} modal={true}>
      <DialogContent
        className={cn(
          'max-w-xs bg-white rounded-2xl py-6 px-4 shadow-lg',
          'flex flex-col items-center justify-center gap-4',
          className
        )}
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="flex flex-col items-center gap-2">
          <DialogTitle className="text-lg font-bold text-black text-center">
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-1">
          <DialogDescription className="text-sm text-gray-600 text-center">
            {message}
          </DialogDescription>
          <DialogDescription className="text-sm text-gray-600 text-center">
            {subMessage}
          </DialogDescription>
        </div>
      </DialogContent>
    </Dialog>
  );
}
