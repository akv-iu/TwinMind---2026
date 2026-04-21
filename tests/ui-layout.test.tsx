import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/font/local', () => ({
  default: vi.fn(() => ({ variable: '--mock-font' })),
}));

import RootLayout from '@/app/layout';
import Page from '@/app/page';

afterEach(() => {
  cleanup();
});

describe('ui layout shell', () => {
  it('renders transcript, suggestions, and chat panels', () => {
    render(React.createElement(Page));

    expect(screen.getByLabelText('Transcript')).toBeInTheDocument();
    expect(screen.getByLabelText('Suggestions')).toBeInTheDocument();
    expect(screen.getByLabelText('Chat')).toBeInTheDocument();
  });

  it('uses a three-column grid with borders on the first two columns', () => {
    render(React.createElement(Page));

    const main = document.querySelector('main');
    expect(main).toBeInTheDocument();
    expect(main).toHaveClass('grid-cols-3');
    expect(main).toHaveClass('xl:grid');

    const transcript = screen.getByLabelText('Transcript');
    const suggestions = screen.getByLabelText('Suggestions');
    const chat = screen.getByLabelText('Chat');

    expect(transcript).toHaveClass('border-r');
    expect(suggestions).toHaveClass('border-r');
    expect(chat).not.toHaveClass('border-r');
  });

  it('keeps panel scroll positions isolated', () => {
    render(React.createElement(Page));

    const transcript = screen.getByLabelText('Transcript');
    const suggestions = screen.getByLabelText('Suggestions');
    const chat = screen.getByLabelText('Chat');

    transcript.scrollTop = 500;

    expect(transcript.scrollTop).toBe(500);
    expect(suggestions.scrollTop).toBe(0);
    expect(chat.scrollTop).toBe(0);
  });

  it('applies overflow-hidden on the root layout body', () => {
    const root = RootLayout({
      children: React.createElement('div'),
    }) as React.ReactElement;

    expect(root.type).toBe('html');
    const rootChildren = React.Children.toArray(root.props.children);
    const body = rootChildren[0] as React.ReactElement;

    expect(body.type).toBe('body');
    expect(body.props.className).toContain('overflow-hidden');
    expect(body.props.className).toContain('h-screen');
  });
});
