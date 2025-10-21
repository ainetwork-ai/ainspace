import React, { useState } from 'react';
import { AgentCard } from '@a2a-js/sdk';
import BaseTabContent from './BaseTabContent';

interface ImportedAgent {
  url: string;
  card: AgentCard;
  characterImage?: string; // Character image URL for layer2
}

interface AgentTabProps {
  isActive: boolean;
  onSpawnAgent: (agent: ImportedAgent) => void;
  onRemoveAgentFromMap: (agentUrl: string) => void;
  spawnedAgents: string[]; // URLs of spawned agents
  onUploadCharacterImage: (agentUrl: string, imageUrl: string) => void;
}

export default function AgentTab({
  isActive,
  onSpawnAgent,
  onRemoveAgentFromMap,
  spawnedAgents,
  onUploadCharacterImage
}: AgentTabProps) {
  const [agentUrl, setAgentUrl] = useState('');
  const [agents, setAgents] = useState<ImportedAgent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState<string | null>(null);

  const handleImportAgent = async () => {
    if (!agentUrl.trim()) {
      setError('Please enter a valid agent URL');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Use proxy to fetch agent card to avoid CORS issues
      const proxyResponse = await fetch('/api/agent-proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ agentUrl }),
      });

      if (!proxyResponse.ok) {
        const errorData = await proxyResponse.json();
        throw new Error(errorData.error || 'Failed to fetch agent card');
      }

      const { agentCard } = await proxyResponse.json();
      
      // Check if agent already exists
      if (agents.some(agent => agent.url === agentUrl)) {
        setError('This agent has already been imported');
        setIsLoading(false);
        return;
      }

      // Add the agent to the list
      setAgents([...agents, {
        url: agentUrl,
        card: agentCard
      }]);

      // Clear the input
      setAgentUrl('');
      
    } catch (err) {
      setError(`Failed to import agent: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveAgent = (url: string) => {
    setAgents(agents.filter(agent => agent.url !== url));
  };

  const handleImageUpload = async (agentUrl: string, file: File) => {
    setUploadingImage(agentUrl);
    try {
      // Upload to Vercel Blob
      const formData = new FormData();
      const imageId = `character_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      formData.append('file', file, `${imageId}.png`);
      formData.append('tileId', imageId);

      const uploadResponse = await fetch('/api/upload-tile', {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload image');
      }

      const { url } = await uploadResponse.json();

      // Update agent with character image
      setAgents(agents.map(agent =>
        agent.url === agentUrl
          ? { ...agent, characterImage: url }
          : agent
      ));

      // Notify parent component
      onUploadCharacterImage(agentUrl, url);

    } catch (err) {
      setError(`Failed to upload image: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setUploadingImage(null);
    }
  };

  return (
    <BaseTabContent isActive={isActive}>
      <div className="flex flex-col h-full w-full max-w-full overflow-hidden">
        {/* Import Agent Section */}
        <div className="bg-purple-50 p-4 rounded-lg mb-4">
          <h3 className="text-lg font-semibold text-purple-800 mb-3">Import Agent</h3>
          
          <div className="flex space-x-2 mb-2">
            <input
              type="url"
              value={agentUrl}
              onChange={(e) => setAgentUrl(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleImportAgent()}
              placeholder="Enter agent card JSON URL"
              className="flex-1 px-3 py-2 border border-purple-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              disabled={isLoading}
            />
            <button
              onClick={handleImportAgent}
              disabled={isLoading || !agentUrl.trim()}
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? 'Importing...' : 'Import'}
            </button>
          </div>

          {error && (
            <div className="text-red-600 text-sm mt-2">
              ⚠️ {error}
            </div>
          )}

          <div className="mt-3 text-xs text-gray-600">
            <div className="font-medium mb-1">Example agent card JSON URLs:</div>
            <div className="space-y-1">
              <div className="break-all">• https://socratic-web3-ai-tutor.vercel.app/api/a2a/.well-known/agent.json</div>
              <div className="break-all">• http://localhost:4000/.well-known/agent-card.json</div>
            </div>
          </div>
        </div>

        {/* Imported Agents List */}
        <div className="flex-1 overflow-auto">
          <h3 className="text-lg font-semibold text-gray-800 mb-3">Imported Agents ({agents.length})</h3>
          
          {agents.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No agents imported yet. Enter an agent URL above to get started.
            </div>
          ) : (
            <div className="space-y-3">
              {agents.map((agent, index) => (
                <div key={agent.url} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm overflow-hidden">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900">{agent.card.name || `Agent ${index + 1}`}</h4>
                      {agent.card.description && (
                        <p className="text-sm text-gray-600 mt-1 break-words">{agent.card.description}</p>
                      )}
                      <div className="mt-2 space-y-1 text-xs text-gray-500">
                        <div>Version: {agent.card.version || 'N/A'}</div>
                        <div>Protocol: {agent.card.protocolVersion || 'N/A'}</div>
                        <div>URL: <span className="text-blue-600 break-all">{agent.url}</span></div>
                        {agent.card.capabilities?.streaming && (
                          <div className="text-green-600">✓ Streaming supported</div>
                        )}
                      </div>
                      
                      {/* Skills */}
                      {agent.card.skills && agent.card.skills.length > 0 && (
                        <div className="mt-3">
                          <div className="text-xs font-medium text-gray-700 mb-1">Skills:</div>
                          <div className="flex flex-wrap gap-1">
                            {agent.card.skills.map((skill, skillIndex) => (
                              <span 
                                key={skillIndex}
                                className="inline-block px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded-full"
                              >
                                {skill.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    
                    <div className="ml-4 flex flex-col space-y-2">
                      <div className="flex space-x-2">
                        {spawnedAgents.includes(agent.url) ? (
                          <button
                            onClick={() => onRemoveAgentFromMap(agent.url)}
                            className="px-3 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600 transition-colors"
                            title="Remove from map"
                          >
                            Remove from Map
                          </button>
                        ) : (
                          <button
                            onClick={() => onSpawnAgent(agent)}
                            className="px-3 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600 transition-colors"
                            title="Spawn on map"
                          >
                            Spawn on Map
                          </button>
                        )}

                        <button
                          onClick={() => handleRemoveAgent(agent.url)}
                          className="text-red-500 hover:text-red-700 transition-colors"
                          title="Remove agent completely"
                        >
                          ✕
                        </button>
                      </div>

                      {/* Character Image Upload */}
                      <div className="flex flex-col space-y-1">
                        <label className="text-xs text-gray-600">Character Image:</label>
                        {agent.characterImage ? (
                          <div className="flex items-center space-x-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={agent.characterImage}
                              alt="Character"
                              className="w-8 h-8 border rounded object-cover"
                            />
                            <label className="cursor-pointer px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors">
                              Change
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleImageUpload(agent.url, file);
                                }}
                                disabled={uploadingImage === agent.url}
                              />
                            </label>
                          </div>
                        ) : (
                          <label className="cursor-pointer px-2 py-1 bg-purple-500 text-white text-xs rounded hover:bg-purple-600 transition-colors text-center">
                            {uploadingImage === agent.url ? 'Uploading...' : 'Upload Image'}
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleImageUpload(agent.url, file);
                              }}
                              disabled={uploadingImage === agent.url}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </BaseTabContent>
  );
}