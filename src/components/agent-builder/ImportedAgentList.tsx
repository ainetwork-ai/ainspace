import { StoredAgent } from '@/lib/redis';
import ImportedAgentCard from './ImportedAgentCard';

interface ImportedAgentListProps {
  agents: StoredAgent[];
  onSpawnAgent: (agent: StoredAgent) => void;
  onRemoveAgent: (url: string) => void;
  onUploadImage: (agent: StoredAgent, spriteUrl: string) => void;
}

function NoAgentNotice() {
  return (
      <div className="inline-flex h-[150px] w-full flex-col items-center justify-center gap-3.5 rounded-lg bg-[#eff1f4] p-3.5">
          <p className="justify-start self-stretch text-center font-['SF_Pro'] text-base text-[#838d9d]">
              No agent imported yet.
              <br />
              Import from URL or create with AI above.
          </p>
      </div>
  )
}

export default function ImportedAgentList({ agents, onSpawnAgent, onRemoveAgent, onUploadImage }: ImportedAgentListProps) {
  return (
    <div className="flex flex-col gap-4 px-5 bg-white">
        <h3 className="text-xl font-semibold text-black text-center">My Agents ({agents.length})</h3>
        {agents.length === 0 ? (
          <NoAgentNotice/>
        ) : (
            agents.map((agent) => (
                <ImportedAgentCard key={agent.url} agent={agent} onSpawnAgent={onSpawnAgent} onRemoveAgent={onRemoveAgent} onUploadImage={onUploadImage} />
            ))
        )}
    </div>
  )
}
