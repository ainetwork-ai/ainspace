'use client';

import { cn } from '@/lib/utils';
import { useThreadStore } from '@/stores';
import { AgentState } from '@/lib/agent';
import { Triangle } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import ChatBottomDrawer from './ChatBottomDrawer';
import { ChatBoxRef } from './ChatBox';
import ThreadListLeftDrawer from './ThreadListLeftDrawer';
import { useAccount } from 'wagmi';
import { Thread } from '@/stores';
import { generateAgentComboId } from '@/lib/hash';

interface ChatBoxOverlayProps {
    chatBoxRef: React.RefObject<ChatBoxRef | null>;
    setJoystickVisible: (isJoystickVisible: boolean) => void;
    className?: string;
    lastCommentary?: string;
    currentAgentsInRadius: AgentState[];
}

export default function ChatBoxOverlay({
  chatBoxRef,
  className,
  lastCommentary,
  setJoystickVisible,
  currentAgentsInRadius,
}: ChatBoxOverlayProps) {
    const [isChatSheetOpen, setIsChatSheetOpen] = useState(false);
    const [isThreadListSheetOpen, setIsThreadListSheetOpen] = useState(false);
    const {
        setThreads,
        setCurrentThreadId,
    } = useThreadStore();

    const { address } = useAccount();

    useEffect(() => {
      if (!address) return;

      const loadThreadMappings = async () => {
          try {
              const response = await fetch(`/api/threads?userId=${address}`);
              if (!response.ok) {
                  console.error('Failed to load threads');
                  return;
              }

              const data = await response.json();
              if (data.success && data.threads) {
                  const _threads = data.threads as { [id: string]: Thread };
                  const fetchedThreads: Thread[] = [];
                  for (const [id, threadData] of Object.entries(_threads)) {
                      const agentComboId = threadData.agentComboId || await generateAgentComboId(threadData.agentNames);
                      fetchedThreads.push({
                        id: threadData.id,
                        threadName: threadData.threadName,
                        agentNames: threadData.agentNames,
                        agentComboId,
                        createdAt: threadData.createdAt,
                        lastMessageAt: threadData.lastMessageAt
                      });
                  }
                  fetchedThreads.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
                  setThreads(fetchedThreads);
                  console.log('fetchedThreads', fetchedThreads);
              }
          } catch (error) {
              console.error('Error loading threads:', error);
          }
      };

      loadThreadMappings();
  }, [address, setThreads]);

    const handleChatSheetOpen = (open: boolean) => {
      setIsChatSheetOpen(open);
      setJoystickVisible(!open);

      if (!open) {
        setCurrentThreadId('0');
      }
    }

    const handleThreadListSheetOpen = (open: boolean) => {
      setIsThreadListSheetOpen(open);
      setJoystickVisible(!open);
    }

    // Generate placeholder text
    const chatPlaceholder = useMemo(() => {
        if (currentAgentsInRadius.length === 0) {
            return "No agents nearby";
        }
        const agentNames = currentAgentsInRadius.map(a => a.name).join(', ');
        return `Talk to: ${agentNames}`;
    }, [currentAgentsInRadius]);

    const openChatSheet = () => {
        handleChatSheetOpen(true);
    };

    const openThreadListSheet = () => {
        handleThreadListSheetOpen(true);
    };

    const handleThreadSelect = (threadId: string) => {
        setCurrentThreadId(threadId);
        openChatSheet();
        handleThreadListSheetOpen(false);
    }

    return (
        <div className={cn("relative w-full z-50", className)}>
            {!isChatSheetOpen &&
                <div
                    className={
                        cn(
                            "flex w-full items-center justify-center gap-1.5 self-stretch rounded-tl-lg rounded-tr-lg backdrop-blur-[6px] bg-black/50 p-3",
                        )}
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
                </div>
            }
            <ChatBottomDrawer 
                open={isChatSheetOpen}
                onOpenChange={handleChatSheetOpen}
                openThreadList={() => handleThreadListSheetOpen(true)}
                chatBoxRef={chatBoxRef as React.RefObject<ChatBoxRef>}
                onThreadSelect={setCurrentThreadId}
                currentAgentsInRadius={currentAgentsInRadius}
            />
            <ThreadListLeftDrawer
                open={isThreadListSheetOpen}
                onOpenChange={handleThreadListSheetOpen}
                onThreadSelect={handleThreadSelect}
            />
        </div>
    );
}