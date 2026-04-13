"use client";

import { useState } from "react";
import { Check, Link as LinkIcon } from "lucide-react";
import { useToast } from "./Toast";

interface CopyLinkButtonProps {
  url: string;
  className?: string;
  size?: "sm" | "md";
}

export function CopyLinkButton({
  url,
  className = "",
  size = "md",
}: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const { showToast } = useToast();

  const handleCopy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    showToast("Link copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <button
      onClick={handleCopy}
      className={`p-1 text-muted-foreground transition-colors hover:text-foreground ${className}`}
      title="Copy link"
    >
      {copied ? (
        <Check className={`${iconSize} text-green-500`} />
      ) : (
        <LinkIcon className={iconSize} />
      )}
    </button>
  );
}
