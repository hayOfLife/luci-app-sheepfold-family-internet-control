/*
 * Защищает ADR как навигационный контракт: последовательные номера, обязательный
 * контекст решения, статус замены, индекс и живые относительные ссылки без записи файлов
 * Синтетические строки проверяют ошибки метаданных, но не истинность решения или
 * соответствие документа коду и намерению владельца §adrproc §testwhy
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const decisionDir = resolve(repoRoot, 'docs/architecture/decisions');
const decisionFiles = readdirSync(decisionDir)
  .filter((name) => /^\d{4}-.+\.ru\.md$/.test(name))
  .sort();
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8');

function assertDecisionStatus(source, file) {
  const entries = [...source.matchAll(/^- Статус: ([^\r\n]+)\r?$/gm)];
  assert.equal(entries.length, 1, `${file} needs exactly one status`);
  const status = entries[0][1];
  if (['Предложено', 'Принято', 'Отклонено'].includes(status)) return;

  const replacement = /^(?:Частично заменено|Заменено) (?:ADR-(\d{4})|\[ADR-(\d{4})\]\((\d{4}-[a-z0-9-]+\.ru\.md)\))$/.exec(status);
  assert.ok(replacement, `${file} has an unsupported status: ${status}`);
  const number = replacement[1] ?? replacement[2];
  const target = decisionFiles.find((name) => name.startsWith(`${number}-`));
  assert.ok(target, `${file} names a missing replacement ADR-${number}`);
  assert.notEqual(target, file, `${file} cannot replace itself`);
  if (replacement[3]) {
    assert.equal(replacement[3], target, `${file} replacement label and filename disagree`);
  }
}

describe('architecture decision records §adrproc', () => {
  it('keeps a numbered accepted decision set with required reasoning', () => {
    assert.ok(decisionFiles.length >= 10);
    const numbers = [];
    for (const file of decisionFiles) {
      const source = readFileSync(resolve(decisionDir, file), 'utf8');
      const number = file.slice(0, 4);
      numbers.push(Number(number));
      assert.match(source, new RegExp(`^# ADR-${number}: `));
      assertDecisionStatus(source, file);
      assert.match(source, /^- Дата: \d{4}-\d{2}-\d{2}$/m);
      assert.match(source, /^- Теги: .*§[a-z0-9]{7}/m);
      for (const heading of ['Контекст', 'Рассмотренные варианты', 'Решение', 'Последствия', 'Проверка', 'Когда пересматривать']) {
        assert.match(source, new RegExp(`^## ${heading}$`, 'm'), `${file} lost ${heading}`);
      }
    }
    assert.deepEqual(numbers, Array.from({ length: numbers.length }, (_, index) => index + 1));
  });

  it('accepts documented statuses and plain or linked replacement references', () => {
    const file = '0022-temporary-remote-support-access.ru.md';
    const target = '0031-typed-https-remote-support.ru.md';
    for (const status of ['Предложено', 'Принято', 'Отклонено', ...['Заменено', 'Частично заменено']
      .flatMap((prefix) => [`${prefix} ADR-0031`, `${prefix} [ADR-0031](${target})`])]) {
      assertDecisionStatus(`- Статус: ${status}\n`, file);
    }
  });

  it('rejects unknown, duplicated, missing and misleading replacement statuses', () => {
    const file = '0022-temporary-remote-support-access.ru.md';
    for (const source of [
      '', '- Статус: Принято\n- Статус: Отклонено\n', '- Статус: Неизвестно\n',
      '- Статус: Частично заменено\n', '- Статус: Заменено ADR-9999\n',
      `- Статус: Частично заменено [ADR-0022](${file})\n`,
      `- Статус: Заменено [ADR-0031](${file})\n`,
      '- Статус: Заменено [ADR-0031](0031-missing.ru.md)\n',
      '- Статус: Заменено [ADR-0031](../0031-typed-https-remote-support.ru.md)\n',
    ]) {
      assert.throws(() => assertDecisionStatus(source, file), { code: 'ERR_ASSERTION' });
    }
  });

  it('indexes every ADR and keeps its local links alive', () => {
    const index = read('docs/architecture/decisions/README.ru.md');
    for (const file of decisionFiles) {
      const number = file.slice(0, 4);
      assert.match(index, new RegExp(`\\[${number}\\]\\(${file.replaceAll('.', '\\.')}\\)`));

      const source = readFileSync(resolve(decisionDir, file), 'utf8');
      for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1];
        if (/^(?:https?:|#)/.test(target)) continue;
        assert.ok(existsSync(resolve(decisionDir, target)), `${file} links missing ${target}`);
      }
    }
  });

  it('connects ADR process to architecture entry points and the tag map', () => {
    const architecture = read('docs/architecture/README.ru.md');
    const tagMap = read('docs/dev/tag-map.md');
    const fastStart = read('docs/agent-fast-start.ru.md');
    assert.match(architecture, /decisions\/README\.ru\.md/);
    assert.match(tagMap, /§adrproc[^\n]*ARCHITECTURE_DECISION_RECORDS/);
    assert.match(fastStart, /architecture\/decisions/);
    assert.equal(basename(decisionDir), 'decisions');
  });
});
