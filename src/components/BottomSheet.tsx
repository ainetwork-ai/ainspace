'use client';

import React, { useEffect, useRef, useState } from 'react';

interface BottomSheetProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    title?: string;
}

export default function BottomSheet({ isOpen, onClose, children, title }: BottomSheetProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [startY, setStartY] = useState(0);
    const [currentY, setCurrentY] = useState(0);
    const sheetRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            // Prevent body scroll when bottom sheet is open
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }

        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    const handleTouchStart = (e: React.TouchEvent) => {
        setIsDragging(true);
        setStartY(e.touches[0].clientY);
        setCurrentY(0);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!isDragging) return;

        const deltaY = e.touches[0].clientY - startY;
        if (deltaY > 0) {
            // Only allow dragging down
            setCurrentY(deltaY);
        }
    };

    const handleTouchEnd = () => {
        setIsDragging(false);

        // If dragged down more than 150px, close the sheet
        if (currentY > 150) {
            onClose();
        }

        setCurrentY(0);
    };

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40 bg-black/50 transition-opacity"
                style={{ opacity: isOpen ? 1 : 0 }}
                onClick={onClose}
            />

            {/* Bottom Sheet */}
            <div
                ref={sheetRef}
                className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[85vh] flex-col rounded-t-3xl bg-white shadow-2xl transition-transform"
                style={{
                    transform: isDragging
                        ? `translateY(${currentY}px)`
                        : isOpen
                          ? 'translateY(0)'
                          : 'translateY(100%)',
                    transition: isDragging ? 'none' : 'transform 0.3s ease-out'
                }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                {/* Handle */}
                <div className="flex w-full items-center justify-center py-3">
                    <div className="h-1.5 w-12 rounded-full bg-gray-300" />
                </div>

                {/* Header */}
                {title && (
                    <div className="border-b border-gray-200 px-6 pb-3">
                        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 overflow-auto">{children}</div>
            </div>
        </>
    );
}
