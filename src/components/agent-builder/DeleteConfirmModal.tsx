'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface DeleteConfirmModalProps {
    onConfirm?: () => void;
    onCancel?: () => void;
    children: React.ReactNode;
}

export default function DeleteConfirmModal({ onConfirm, onCancel, children }: DeleteConfirmModalProps) {
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
            <DialogContent className="max-w-md p-0 bg-white rounded-2xl" showCloseButton={false}>
                <DialogHeader className="px-6 pt-6 pb-4">
                    <DialogTitle className="text-xl font-bold text-black text-center">
                        Delete Agent
                    </DialogTitle>
                </DialogHeader>
                
                {/* Body Text */}
                <div className="px-6 pb-6">
                    <p className="text-black text-center text-base leading-relaxed">
                        Do you really want to delete your agent?
                    </p>
                </div>

                {/* Action Buttons */}
                <div className="px-6 pb-6 flex flex-row gap-3">
                    <Button
                        onClick={handleCancel}
                        type="large"
                        variant="secondary"
                        className={cn(
                            "flex-1 bg-white border border-[#7F4FE8] text-[#7F4FE8] hover:bg-[#F9F7FF]",
                            "hover:border-[#7F4FE8]"
                        )}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        type="large"
                        variant="primary"
                        className="flex-1"
                    >
                        Delete
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

