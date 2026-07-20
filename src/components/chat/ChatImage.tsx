'use client';

import { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import { ChatMessageFile } from '@/stores';
import { Z_INDEX_OFFSETS } from '@/constants/common';

const LIGHTBOX_Z = Z_INDEX_OFFSETS.UI + 100;

/**
 * EPIC22: a single agent-sent image in a chat bubble.
 *
 * - Thumbnail: CSS-responsive so it stays small on mobile and a bit larger on
 *   desktop (no JS viewport check -> no SSR/hydration flicker). `object-contain`
 *   never crops. Desktop hover gives a subtle zoom-in cue.
 * - Click / tap opens a fullscreen dark lightbox showing the image fit to the
 *   viewport. Clicking the lightbox image toggles fit <-> 1:1 natural size
 *   (panning via overflow-auto) so fine detail is inspectable. Close via the
 *   X button, backdrop click, or ESC (Radix).
 */
export default function ChatImage({ file }: { file: ChatMessageFile }) {
    const [open, setOpen] = useState(false);
    const [zoomed, setZoomed] = useState(false);
    const alt = file.fileName ?? '';

    return (
        <DialogPrimitive.Root
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (!next) setZoomed(false); // reset zoom when closing
            }}
        >
            <DialogPrimitive.Trigger asChild>
                <button
                    type="button"
                    className="mt-2 block cursor-zoom-in overflow-hidden rounded-lg transition-transform duration-150 hover:scale-[1.02] hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                    aria-label={alt ? `이미지 확대: ${alt}` : '이미지 확대'}
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={file.fileUrl}
                        alt={alt}
                        loading="lazy"
                        decoding="async"
                        className="max-h-[140px] max-w-[200px] rounded-lg object-contain lg:max-h-[220px] lg:max-w-[320px]"
                        onError={(e) => {
                            // Hide the whole trigger button if the image is broken.
                            const btn = e.currentTarget.closest('button');
                            if (btn) btn.style.display = 'none';
                        }}
                    />
                </button>
            </DialogPrimitive.Trigger>

            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay
                    className="fixed inset-0 bg-black/80 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
                    style={{ zIndex: LIGHTBOX_Z }}
                />
                <DialogPrimitive.Content
                    // Bare, fullscreen content — no card chrome. The backdrop area
                    // closes on click; the image stops propagation so its own
                    // clicks toggle zoom instead of closing.
                    className="fixed inset-0 flex items-center justify-center p-4 focus:outline-none"
                    style={{ zIndex: LIGHTBOX_Z }}
                    onClick={() => setOpen(false)}
                >
                    <DialogPrimitive.Title className="sr-only">
                        {alt || '이미지 미리보기'}
                    </DialogPrimitive.Title>

                    <div
                        className={
                            zoomed
                                ? 'h-full w-full overflow-auto'
                                : 'flex h-full w-full items-center justify-center'
                        }
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={file.fileUrl}
                            alt={alt}
                            onClick={() => setZoomed((z) => !z)}
                            className={
                                zoomed
                                    ? 'max-w-none cursor-zoom-out'
                                    : 'mx-auto max-h-[95vh] max-w-[95vw] cursor-zoom-in object-contain'
                            }
                        />
                    </div>

                    <DialogPrimitive.Close
                        className="absolute top-4 right-4 rounded-full bg-black/50 p-2 text-white opacity-80 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                        aria-label="닫기"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <XIcon className="size-5" />
                    </DialogPrimitive.Close>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
