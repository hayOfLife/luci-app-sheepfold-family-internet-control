/*
 * Защищает публичную половину двустороннего контракта с закрытым support server
 * Тест не читает private repo и не доказывает готовность сети; он не даёт случайно
 * потерять ссылку, владельца protocol или fail-closed границу Codex bridge §rsuppeer §testwhy
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (filePath) => readFileSync(resolve(repoRoot, filePath), 'utf8');

const decision = read('docs/architecture/decisions/0023-private-support-server-boundary.ru.md');
const integration = read('docs/remote-support-server-integration.ru.md');
const manifest = JSON.parse(read('tools/remoteSupport/peer-project.json'));

describe('private support server peer boundary §rsuppeer', () => {
  it('keeps the public client as canonical owner of router protocol v1', () => {
    assert.equal(manifest.contractId, 'sheepfold.remote-support.peer.v1');
    assert.equal(manifest.protocol.major, 1);
    assert.equal(manifest.protocol.canonicalRepository, manifest.thisProject.repository);
    assert.equal(manifest.thisProject.visibility, 'public');
    assert.equal(manifest.peerProject.visibility, 'private');
  });

  it('documents a local typed Codex bridge without public arbitrary shell', () => {
    assert.match(integration, /локальный `supportctl`/);
    assert.match(integration, /Универсального `runShell` в MCP v1 нет/);
    assert.match(integration, /exact plan hash/);
    assert.match(integration, /rollback/);
    assert.match(decision, /private repository `kva4991\/sheepfold-support-server`/);
    assert.equal(manifest.peerProject.repository, 'https://github.com/hayOfLife/sheepfold-support-server');
    assert.match(integration, /https:\/\/github\.com\/hayOfLife\/sheepfold-support-server/);
  });

  it('keeps report upload separate from remote access', () => {
    assert.match(integration, /Получение отчёта не даёт удалённый доступ/);
    assert.match(integration, /шифрует payload для operator key до отправки/);
    assert.match(integration, /12-значного claim/);
  });
});
