import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom doesn't implement these browser APIs that the app touches during tests
// (scrollIntoView on message updates; getUserMedia/permissions in push-to-talk).
// Stub them so component/hook tests don't crash on unimplemented natives.
Element.prototype.scrollIntoView = vi.fn();

if (!navigator.mediaDevices) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getAudioTracks: () => [],
        getTracks: () => [],
      }),
    },
  });
}

if (!navigator.permissions) {
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: vi.fn().mockResolvedValue({ state: 'granted' }) },
  });
}

afterEach(() => {
  cleanup();
});
