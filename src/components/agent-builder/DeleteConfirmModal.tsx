'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface DeleteConfirmModalProps {
    onConfirm?: () => void;
    onCancel?: () => void;
    children: React.ReactNode;
    isDarkMode?: boolean;
}

export default function DeleteConfirmModal({ onConfirm, onCancel, children, isDarkMode = false }: DeleteConfirmModalProps) {
    const [isOpen, setIsOpen] = useState(false);

    const handleConfirm = () => {
        if (onConfirm) {
            onConfirm();
        }
        setIsOpen(false);
    };

    const handleCancel = () => {
        if (onCancel) {
            onCancel();
        }
        setIsOpen(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className={cn("max-w-md p-0 rounded-2xl", isDarkMode ? 'bg-[#2F333B]' : 'bg-white')} showCloseButton={false}>
                <DialogHeader className="px-6 pt-6 pb-4">
                    <DialogTitle className={cn("text-xl font-bold text-center", isDarkMode ? 'text-white' : 'text-black')}>
                        Delete Agent
                    </DialogTitle>
                </DialogHeader>

                {/* Body Text */}
                <div className="px-6 pb-6">
                    <p className={cn("text-center text-base leading-relaxed", isDarkMode ? 'text-white' : 'text-black')}>
                        Do you really want to delete your agent?
                    </p>
                </div>

                {/* Action Buttons */}
                <div className="px-6 pb-6 flex flex-row gap-3">
                    <Button
                        onClick={handleCancel}
                        type="large"
                        variant="secondary"
                        isDarkMode={isDarkMode}
                        className={cn(
                            "flex-1 border border-[#7F4FE8]",
                            isDarkMode
                                ? 'bg-[#222529] text-[#C0A9F1] hover:bg-[#3A3E46]'
                                : 'bg-white text-[#7F4FE8] hover:bg-[#F9F7FF]',
                            "hover:border-[#7F4FE8]"
                        )}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        type="large"
                        variant="primary"
                        isDarkMode={isDarkMode}
                        className="flex-1"
                    >
                        Delete
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

