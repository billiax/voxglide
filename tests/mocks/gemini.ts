import { vi } from 'vitest';

export function createMockGeminiSession() {
  return {
    sendRealtimeInput: vi.fn(),
    sendToolResponse: vi.fn(),
    close: vi.fn(),
  };
}

export function createMockGoogleGenAI(mockSession?: any) {
  const session = mockSession || createMockGeminiSession();
  return {
    live: {
      connect: vi.fn().mockResolvedValue(session),
    },
  };
}

/**
 * Create a mock @google/genai module for vi.mock().
 */
export function createGeminiModuleMock(mockSession?: any) {
  const genai = createMockGoogleGenAI(mockSession);
  return {
    GoogleGenAI: vi.fn().mockReturnValue(genai),
    Modality: { AUDIO: 'AUDIO' },
    __mockGenAI: genai,
    __mockSession: mockSession || genai.live.connect.mock.results[0]?.value,
  };
}
