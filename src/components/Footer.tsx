import React from "react";

interface FooterProps {
  activeTab: "map" | "thread" | "build" | "agent";
  onTabChange: (tab: "map" | "thread" | "build" | "agent") => void;
}

export default function Footer({ activeTab, onTabChange }: FooterProps) {
  return (
    <div className="bg-black border-t border-black">
      <div className="flex w-full h-[72px]">
        <button
          onClick={() => onTabChange("map")}
          className={`flex-1 py-3 text-sm rounded font-medium transition-colors ${
            activeTab === "map"
              ? "bg-[#424049] text-white"
              : "text-gray-100 hover:text-gray-200 hover:bg-gray-800"
          }`}>
          🗺️ Map
        </button>
        <button
          onClick={() => onTabChange("thread")}
          className={`flex-1 py-3 text-sm rounded font-medium transition-colors ${
            activeTab === "thread"
              ? "bg-[#424049] text-white"
              : "text-gray-100 hover:text-gray-200 hover:bg-gray-800"
          }`}>
          💬 Thread
        </button>
        <button
          onClick={() => onTabChange("build")}
          className={`flex-1 py-3 text-sm rounded font-medium transition-colors ${
            activeTab === "build"
              ? "bg-[#424049] text-white"
              : "text-gray-100 hover:text-gray-200 hover:bg-gray-800"
          }`}>
          🔨 Build
        </button>
        <button
          onClick={() => onTabChange("agent")}
          className={`flex-1 py-3 text-sm rounded font-medium transition-colors ${
            activeTab === "agent"
              ? "bg-[#424049] text-white"
              : "text-gray-100 hover:text-gray-200 hover:bg-gray-800"
          }`}>
          🤖 Agent
        </button>
      </div>
    </div>
  );
}
