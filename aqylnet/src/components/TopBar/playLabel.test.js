import { describe, test, expect } from 'vitest';
import { playLabel } from './TopBar';

describe('playLabel (TopBar play/continue button)', () => {
  test('fresh project, nothing run yet', () => {
    expect(playLabel({ isGenerating: false, isRevealing: false, iterCur: 0, iterMax: 5 })).toBe('Запустить');
  });

  test('after progress has been made, offers to continue', () => {
    expect(playLabel({ isGenerating: false, isRevealing: false, iterCur: 2, iterMax: 5 })).toBe('Продолжить');
  });

  test('in flight to the backend', () => {
    expect(playLabel({ isGenerating: true, isRevealing: false, iterCur: 0, iterMax: 5 })).toBe('Генерация…');
  });

  test('revealing responses', () => {
    expect(playLabel({ isGenerating: false, isRevealing: true, iterCur: 0, iterMax: 5 })).toBe('Показ ответов…');
  });

  test('limit reached', () => {
    expect(playLabel({ isGenerating: false, isRevealing: false, iterCur: 5, iterMax: 5 })).toBe('Завершено');
  });
});
