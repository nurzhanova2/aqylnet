import { describe, test, expect } from 'vitest';
import { launchLabel } from './DiscussionPage';

describe('launchLabel (DiscussionPage launch button)', () => {
  test('a fresh project (nothing run yet) invites the user to start', () => {
    expect(launchLabel({ isGenerating: false, isRevealing: false, iterCur: 0, iterMax: 5 }))
      .toBe('Запустить симуляцию');
  });

  test('after one completed iteration, invites continuing to the next one by number', () => {
    expect(launchLabel({ isGenerating: false, isRevealing: false, iterCur: 1, iterMax: 5 }))
      .toBe('Запустить следующую итерацию (2 из 5)');
  });

  test('while the backend call is in flight', () => {
    expect(launchLabel({ isGenerating: true, isRevealing: false, iterCur: 1, iterMax: 5 }))
      .toBe('Генерация…');
  });

  test('while responses are being revealed one by one', () => {
    expect(launchLabel({ isGenerating: false, isRevealing: true, iterCur: 1, iterMax: 5 }))
      .toBe('Показ ответов…');
  });

  test('once the configured limit is reached, launching again is not offered', () => {
    expect(launchLabel({ isGenerating: false, isRevealing: false, iterCur: 5, iterMax: 5 }))
      .toBe('Симуляция завершена');
  });

  test('generating takes priority over the completed label if both could apply', () => {
    expect(launchLabel({ isGenerating: true, isRevealing: false, iterCur: 5, iterMax: 5 }))
      .toBe('Генерация…');
  });
});
