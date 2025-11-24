import { useGameState } from '@/hooks/useGameState';
import { cn } from '@/lib/utils';
import { AgentInformation, useThreadStore } from '@/stores';
import { Triangle } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import ChatBottomDrawer from './ChatBottomDrawer';
import { ChatBoxRef } from './ChatBox';
import ThreadListLeftDrawer from './ThreadListLeftDrawer';

interface ChatBoxOverlayProps {
    chatBoxRef: React.RefObject<ChatBoxRef | null>;
    setJoystickVisible: (isJoystickVisible: boolean) => void;
    className?: string;
    lastCommentary?: string;
    worldAgents?: AgentInformation[];
    currentThreadId?: string;
    threads?: {
        id: string;
        message: string;
        timestamp: Date;
    }[];
}

export default function ChatBoxOverlay({
  chatBoxRef, className, lastCommentary, currentThreadId, setJoystickVisible,
}: ChatBoxOverlayProps) {
    const { worldAgents, playerPosition } = useGameState();
    const [isChatSheetOpen, setIsChatSheetOpen] = useState(false);
    const [isThreadListSheetOpen, setIsThreadListSheetOpen] = useState(false);
    const { userId } = useGameState();
    const { threads, userThreads, setCurrentThreadId, setUserThreads } = useThreadStore();

    useEffect(() => {
      if (!userId) return;

      const loadThreadMappings = async () => {
          try {
              const response = await fetch(`/api/threads?userId=${userId}`);
              if (!response.ok) {
                  console.error('Failed to load thread mappings');
                  return;
              }

              const data = await response.json();
              if (data.success && data.threads) {
                  // Convert thread mappings to our format
                  const mappings: { [threadName: string]: string } = {};
                  const fullData: { [threadName: string]: { backendThreadId: string; agentNames: string[] } } = {};

                  for (const [threadName, threadData] of Object.entries(data.threads)) {
                      const td = threadData as { backendThreadId: string; agentNames: string[] };
                      mappings[threadName] = td.backendThreadId;
                      fullData[threadName] = {
                          backendThreadId: td.backendThreadId,
                          agentNames: td.agentNames || []
                      };
                  }

                  setUserThreads(data.threads);
                  console.log('Loaded thread mappings:', mappings);
              }
          } catch (error) {
              console.error('Error loading thread mappings:', error);
          }
      };

      loadThreadMappings();
  }, [userId, setUserThreads]);

    const handleChatSheetOpen = (open: boolean) => {
      setIsChatSheetOpen(open);
      setJoystickVisible(!open);
    }

    const handleThreadListSheetOpen = (open: boolean) => {
      setIsThreadListSheetOpen(open);
      setJoystickVisible(!open);
    }

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

    const openChatSheet = () => {
      setIsChatSheetOpen(true);
    };

    const openThreadListSheet = () => {
      console.log('openThreadListSheet');
      setIsThreadListSheetOpen(true);
    };

    return (
        <div className={cn("relative w-full z-50", className)}>
            {!isChatSheetOpen &&
                <div
                    className={
                        cn(
                            // "fixed left-0 right-0",
                            "flex w-full items-center justify-center gap-1.5 self-stretch rounded-tl-lg rounded-tr-lg backdrop-blur-[6px] bg-black/50 p-3",
                        )}
                    // style={{ bottom: `${FOOTER_HEIGHT}px` }}
                >
                    <div 
                        className="p-2 rounded-full bg-black/30"
                        onClick={openThreadListSheet}
                    >
                        <Image
                            src="/footer/bottomTab/tab_icon_bubble.svg"
                            className="h-4 w-4"
                            alt="Chat"
                            width={16}
                            height={16}
                        />
                    </div>
                    <button onClick={openChatSheet} className="flex flex-1 cursor-pointer rounded-[100px] px-2.5 py-2 bg-black/30">
                        <span className="text-xs font-bold text-white">{chatPlaceholder}</span>
                    </button>
                    <button className="bg-white rounded-lg w-[30px] h-[30px] flex items-center justify-center">
                        <Triangle className="text-xs font-bold text-black" fill="black" width={12} height={9} />
                    </button>
                </div>}
            <ChatBottomDrawer 
                open={isChatSheetOpen}
                onOpenChange={handleChatSheetOpen}
                chatBoxRef={chatBoxRef as React.RefObject<ChatBoxRef>}
                lastCommentary={lastCommentary}
                worldAgents={worldAgents}
                currentThreadId={currentThreadId || undefined}
                threads={[]}
                onThreadSelect={setCurrentThreadId}
                userId={userId}
            />
            <ThreadListLeftDrawer
                open={isThreadListSheetOpen}
                onOpenChange={handleThreadListSheetOpen}
                threads={userThreads}
                onThreadSelect={setCurrentThreadId}
            />
        </div>
    );
}