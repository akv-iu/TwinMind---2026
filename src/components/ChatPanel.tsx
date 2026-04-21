interface ChatPanelProps {
  className?: string;
}

export function ChatPanel({ className }: ChatPanelProps) {
  return <section aria-label="Chat" className={className} />;
}
