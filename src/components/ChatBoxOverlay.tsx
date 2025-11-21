import { useGameState } from '@/hooks/useGameState';
import { cn } from '@/lib/utils';
import { AgentInformation, useThreadStore } from '@/stores';
import { Triangle } from 'lucide-react';
import Image from 'next/image';
import { useMemo, useState } from 'react';
import BottomSheet from './BottomSheet';
import { ChatBoxRef } from './ChatBox';

interface ChatBoxOverlayProps {
  chatBoxRef: React.RefObject<ChatBoxRef | null>;
  className?: string;
  lastCommentary: string;
  worldAgents: AgentInformation[];
  currentThreadId?: string;
  threads: {
    id: string;
    message: string;
    timestamp: Date;
  }[];
}

export default function ChatBoxOverlay({ chatBoxRef, className, lastCommentary, currentThreadId }: ChatBoxOverlayProps) {
    const { worldAgents, playerPosition } = useGameState();
    const [isBottomSheetOpen, setIsBottomSheetOpen] = useState(false);
    const { userId } = useGameState();
    const { threads, setCurrentThreadId } = useThreadStore();
    // Calculate agents within broadcast radius (10 units)
    const agentsInRadius = useMemo(() => {
      if (!playerPosition || worldAgents.length === 0) return [];

      const broadcastRadius = 10;
      return worldAgents.filter(agent => {
          const distance = Math.sqrt(
              Math.pow(agent.x - playerPosition.x, 2) +
              Math.pow(agent.y - playerPosition.y, 2)
          );
          return distance <= broadcastRadius;
      });
    }, [worldAgents, playerPosition]);

    // Generate placeholder text
    const chatPlaceholder = useMemo(() => {
      if (agentsInRadius.length === 0) {
          return "No agents nearby";
      }
      const agentNames = agentsInRadius.map(a => a.name).join(', ');
      return `Talk to: ${agentNames}`;
    }, [agentsInRadius]);

    const openBottomSheet = () => {
      setIsBottomSheetOpen(true);
    };

    return (
        <div className={cn("relative w-full z-50", className)}>
            {!isBottomSheetOpen &&
                <div
                    className={
                        cn(
                            // "fixed left-0 right-0",
                            "flex w-full items-center justify-center gap-1.5 self-stretch rounded-tl-lg rounded-tr-lg backdrop-blur-[6px] bg-black/50 p-3",
                        )}
                    // style={{ bottom: `${FOOTER_HEIGHT}px` }}
                >
                    <div className="p-2 rounded-full bg-black/30">
                        <Image
                            src="/footer/bottomTab/tab_icon_bubble.svg"
                            className="h-4 w-4"
                            alt="Chat"
                            width={16}
                            height={16}
                        />
                    </div>
                    <button onClick={openBottomSheet} className="flex flex-1 cursor-pointer rounded-[100px] px-2.5 py-2 bg-black/30">
                        <span className="text-xs font-bold text-white">{chatPlaceholder}</span>
                    </button>
                    <button className="bg-white rounded-lg w-[30px] h-[30px] flex items-center justify-center">
                        <Triangle className="text-xs font-bold text-black" fill="black" width={12} height={9} />
                    </button>
                </div>}
            <BottomSheet 
                open={isBottomSheetOpen}
                onOpenChange={setIsBottomSheetOpen}
                chatBoxRef={chatBoxRef as React.RefObject<ChatBoxRef>}
                lastCommentary={lastCommentary}
                worldAgents={worldAgents}
                currentThreadId={currentThreadId || undefined}
                threads={[]}
                onThreadSelect={setCurrentThreadId}
                userId={userId}
            />
        </div>
    );
}