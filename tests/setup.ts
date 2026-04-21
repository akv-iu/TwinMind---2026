import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

if (!Element.prototype.scrollIntoView) {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
}
