/*
 * Только тестовый стенд: платформенный бюджет дочернего процесса, диагностика
 * первичной ошибки и явно последовательная модель flock при его отсутствии
 * в Windows. Не изменяет тайм-ауты или блокировки рабочего роутера.
 */
import { spawnSync } from 'node:child_process';

export function runtimeTimeout(posixMs, { platform = process.platform, env = process.env } = {}) {
  if (!Number.isSafeInteger(posixMs) || posixMs <= 0)
    throw new Error('Invalid POSIX fixture timeout');
  const override = env.SHEEPFOLD_TEST_PROCESS_TIMEOUT_MS;
  if (override !== undefined) {
    if (!/^[1-9][0-9]*$/.test(override) || Number(override) > 600000)
      throw new Error('SHEEPFOLD_TEST_PROCESS_TIMEOUT_MS must be 1..600000');
    return Number(override);
  }
  return platform === 'win32' ? Math.max(120000, posixMs * 6) : posixMs;
}

export function completedProcess(result, label = 'fixture process') {
  // Проверки отказов продукта вправе ожидать ненулевой exit. Но timeout/spawn
  // failure не является ответом продукта и должен быть виден до разбора JSON.
  if (result.error || result.status === null || result.signal) {
    const code = result.error?.code || result.signal || 'NO_EXIT_STATUS';
    throw new Error(`${label}: ${code}; status=${result.status}; signal=${result.signal || '-'}; ` +
      `stderr=${String(result.stderr || '').slice(0, 2000)}`, { cause: result.error });
  }
  return result;
}

const flockCache = new Map();
function probeFlock(platform) {
  if (!flockCache.has(platform)) {
    const result = completedProcess(spawnSync(platform === 'win32' ? 'bash' : 'sh',
      ['-c', 'command -v flock >/dev/null 2>&1'], { encoding: 'utf8', timeout: 10000 }), 'probe flock');
    flockCache.set(platform, result.status === 0);
  }
  return flockCache.get(platform);
}

export function prepareFixtureFlock(put, { platform = process.platform, probe = probeFlock } = {}) {
  if (probe(platform)) return 'native';
  if (platform !== 'win32')
    throw new Error('Missing flock: Linux/POSIX locking tests require the real utility');
  // Модель разрешена только для последовательных Windows-сценариев. Native
  // locking/permission tests сохраняют собственный Linux gate и видимые skips.
  put('flock', '#!/bin/sh\n# TEST ONLY: sequential Windows model, NOT a lock.\nexit 0\n');
  return 'sequential-model';
}
