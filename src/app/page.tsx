import { ChatPanel } from '@/components/ChatPanel';
import { SuggestionsPanel } from '@/components/SuggestionsPanel';
import { TranscriptPanel } from '@/components/TranscriptPanel';

export default function Page() {
  return (
    <>
      <main className="hidden h-screen grid-cols-3 xl:grid">
        <TranscriptPanel className="h-screen overflow-y-auto border-r border-gray-200 [scrollbar-gutter:stable]" />
        <SuggestionsPanel className="h-screen overflow-y-auto border-r border-gray-200 [scrollbar-gutter:stable]" />
        <ChatPanel className="h-screen overflow-y-auto [scrollbar-gutter:stable]" />
      </main>
      <div
        className="flex h-screen items-center justify-center p-8 text-center text-gray-600 xl:hidden"
        role="status"
      >
        TwinMind is desktop-only. Please open this app in a window at least
        1280 px wide.
      </div>
    </>
  );
}
