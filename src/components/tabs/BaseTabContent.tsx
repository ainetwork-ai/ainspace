'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface BaseTabContentProps {
    isActive: boolean;
    children: React.ReactNode;
    className?: string;
    withPadding?: boolean;
}

export default function BaseTabContent({
    isActive,
    children,
    className = '',
    withPadding = true
}: BaseTabContentProps) {
    return (
        <div className={cn('h-full w-full flex flex-col', withPadding && 'p-4', !isActive && 'hidden', className)}>
            {children}
        </div>
    );
}
