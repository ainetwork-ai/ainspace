import { StoredAgent } from '@/lib/redis';
import ImportedAgentCard from './ImportedAgentCard';

import { MAP_NAMES } from '@/constants/game';

interface ImportedAgentListProps {
  agents: StoredAgent[];
  onPlaceAgent: (agent: StoredAgent, selectedMap?: MAP_NAMES) => void;
  onUnplaceAgent: (agent: StoredAgent) => void;
  onRemoveAgent: (url: string) => void;
  onUploadImage: (agent: StoredAgent, sprite: {url:string, height:number} | File) => void;
}

function NoAgentNotice() {
  return (
      <div className="inline-flex h-[150px] w-full flex-col items-center justify-center gap-3.5 rounded-lg bg-[#eff1f4] p-3.5">
          <p className="justify-start self-stretch text-center font-['SF_Pro'] text-base text-[#838d9d]">
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
}: ImportedAgentListProps) {
    return (
        <div className="flex flex-col gap-4 px-5 bg-white">
            <h3 className="text-xl font-semibold text-black text-center">My Agents ({agents.length})</h3>
            {agents.length === 0 ? (
              <NoAgentNotice/>
            ) : (
                agents.map((agent) => (
                    <ImportedAgentCard
                        key={agent.url}
                        agent={agent}
                        onPlaceAgent={onPlaceAgent}
                        onUnplaceAgent={onUnplaceAgent}
                        onRemoveAgent={onRemoveAgent}
                        onUploadImage={onUploadImage}
                    />
                ))
            )}
        </div>
    )
}
