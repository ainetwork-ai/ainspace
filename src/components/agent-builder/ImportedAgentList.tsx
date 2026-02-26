import { StoredAgent } from '@/lib/redis';
import { cn } from '@/lib/utils';
import ImportedAgentCard from './ImportedAgentCard';

interface ImportedAgentListProps {
  agents: StoredAgent[];
  onPlaceAgent: (agent: StoredAgent) => void;
  onUnplaceAgent: (agent: StoredAgent) => void;
  onRemoveAgent: (url: string) => void;
  onUploadImage: (agent: StoredAgent, sprite: {url:string, height:number} | File) => void;
  isDarkMode?: boolean;
}

function NoAgentNotice({ isDarkMode = false }: { isDarkMode?: boolean }) {
  return (
      <div className={cn(
          "inline-flex h-[150px] w-full flex-col items-center justify-center gap-3.5 rounded-lg p-3.5",
          isDarkMode ? 'bg-[#3A3E46]' : 'bg-[#eff1f4]'
      )}>
          <p className={cn(
              "justify-start self-stretch text-center font-['SF_Pro'] text-base",
              isDarkMode ? 'text-[#CAD0D7]' : 'text-[#838d9d]'
          )}>
              No agents imported yet.
              <br />
              Directly Import an deployed agent, or use the A2A Builder button to create one and then import it.
          </p>
      </div>
  )
}

export default function ImportedAgentList({
    agents,
    onPlaceAgent,
    onUnplaceAgent,
    onRemoveAgent,
    onUploadImage,
    isDarkMode = false,
}: ImportedAgentListProps) {
    return (
        <div className={cn("flex flex-col gap-4 px-5", isDarkMode ? 'bg-[#2F333B]' : 'bg-white')}>
            <h3 className={cn("text-xl font-semibold text-center", isDarkMode ? 'text-white' : 'text-black')}>My Agents ({agents.length})</h3>
            {agents.length === 0 ? (
              <NoAgentNotice isDarkMode={isDarkMode} />
            ) : (
                agents.map((agent) => (
                    <ImportedAgentCard
                        key={agent.url}
                        agent={agent}
                        onPlaceAgent={onPlaceAgent}
                        onUnplaceAgent={onUnplaceAgent}
                        onRemoveAgent={onRemoveAgent}
                        onUploadImage={onUploadImage}
                        isDarkMode={isDarkMode}
                    />
                ))
            )}
        </div>
    )
}
