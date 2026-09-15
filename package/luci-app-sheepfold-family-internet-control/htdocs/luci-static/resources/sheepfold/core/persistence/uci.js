'use strict';
'require baseclass';

/* §frontmod §persist1 §ovaudit2
 * У клиента LuCI UCI одна общая локальная staging-область. uci.save() не принимает
 * имя конфига, а ui.changes.apply() является UI-процессом, а не ожидаемой примитивой
 * сохранения. Поэтому адаптер выполняет мутации Sheepfold последовательно, проверяет
 * локальные и удалённые ожидающие изменения, вызывает ровно один uci.save() без
 * аргументов, ожидает прямые callApply/callConfirm и очищает своё staging при ошибке.
 */
function unique(values) {
	var seen = Object.create(null);

	return (values || []).map(function (value) {
		return String(value || '');
	}).filter(function (value) {
		if (!value || seen[value])
			return false;
		seen[value] = true;
		return true;
	});
}

function codedError(code, message) {
	var error = new Error(message || code);
	error.errorCode = code;
	return error;
}

function asError(value, code) {
	var error;

	if (value && typeof value === 'object')
		return value;
	error = codedError(code || 'uci_operation_failed', String(value == null ? code || 'uci_operation_failed' : value));
	error.cause = value;
	if (typeof value === 'number')
		error.status = value;
	return error;
}

function sortedObject(value) {
	var result;

	if (Array.isArray(value))
		return value.map(sortedObject);
	if (!value || typeof value !== 'object')
		return value;
	result = {};
	Object.keys(value).sort().forEach(function (key) {
		if (typeof value[key] !== 'function' && value[key] !== undefined)
			result[key] = sortedObject(value[key]);
	});
	return result;
}

function create(deps) {
	var queue = Promise.resolve();
	var active = 0;

	function sections(config, type) {
		// Для незагруженного или пустого конфига LuCI возвращает пустой массив.
		// Настоящую ошибку сохранения нельзя маскировать состоянием «нет данных».
		return (type ? deps.uci.sections(config, type) : deps.uci.sections(config)) || [];
	}

	function existingNamedSection(config, name) {
		return sections(config).filter(function (section) {
			return section['.name'] === name;
		})[0] || null;
	}

	function ensureSection(config, type, preferredName) {
		var existing;
		var created;

		if (!preferredName)
			return deps.uci.add(config, type);
		existing = existingNamedSection(config, preferredName);
		if (existing) {
			if (existing['.type'] !== type) {
				var conflict = codedError('uci_section_type_conflict', 'uci_section_type_conflict');
				conflict.config = config;
				conflict.section = preferredName;
				conflict.expectedType = type;
				conflict.actualType = existing['.type'];
				throw conflict;
			}
			return existing['.name'];
		}
		created = deps.uci.add(config, type, preferredName);
		if (created !== preferredName)
			throw codedError('named_section_not_supported', 'named_section_not_supported');
		return created;
	}

	function replaceList(config, section, option, values) {
		var normalized = unique(values);

		deps.uci.unset(config, section, option);
		if (normalized.length)
			deps.uci.set(config, section, option, normalized);
		return normalized;
	}

	function stateSnapshot() {
		var state = deps.uci.state || {};
		return JSON.stringify(sortedObject({
			creates: state.creates || {},
			changes: state.changes || {},
			deletes: state.deletes || {},
			reorder: state.reorder || {}
		}));
	}

	function localConfigNames() {
		var state = deps.uci.state || {};
		var names = Object.create(null);

		['creates', 'changes', 'deletes', 'reorder'].forEach(function (bucket) {
			Object.keys(state[bucket] || {}).forEach(function (config) {
				var value = state[bucket][config];
				if (value === true || value && Object.keys(value).length)
					names[config] = true;
			});
		});
		return Object.keys(names).sort();
	}

	function hasRemoteChanges(changes) {
		return Object.keys(changes || {}).some(function (config) {
			return Array.isArray(changes[config]) ? changes[config].length > 0 : !!changes[config];
		});
	}

	function ensureOnlySelected(selected) {
		var allowed = Object.create(null);
		var foreign;

		selected.forEach(function (config) { allowed[config] = true; });
		foreign = localConfigNames().filter(function (config) { return !allowed[config]; });
		if (foreign.length) {
			var error = codedError('uci_foreign_local_changes', 'uci_foreign_local_changes');
			error.configs = foreign;
			throw error;
		}
	}

	function invoke(callback) {
		try {
			return Promise.resolve(callback());
		} catch (error) {
			return Promise.reject(error);
		}
	}

	function remoteChanges() {
		if (!deps.uci || typeof deps.uci.changes !== 'function')
			return Promise.reject(codedError('uci_changes_unavailable', 'uci_changes_unavailable'));
		return invoke(function () { return deps.uci.changes(); }).then(function (changes) {
			if (hasRemoteChanges(changes)) {
				var error = codedError('uci_unapplied_changes', 'uci_unapplied_changes');
				error.changes = changes;
				throw error;
			}
			return changes || {};
		});
	}

	function reload(configs) {
		var selected = unique(configs);

		selected.forEach(function (config) { deps.uci.unload(config); });
		return Promise.all(selected.map(function (config) { return deps.uci.load(config); }));
	}

	function preserveOriginal(error, cleanup) {
		return Promise.resolve().then(cleanup).catch(function (cleanupError) {
			error.cleanupError = cleanupError;
		}).then(function () {
			throw error;
		});
	}

	function discard(configs) {
		return reload(configs);
	}

	function revertRemote(configs) {
		if (!deps.revert)
			return Promise.resolve();
		return invoke(function () { return deps.revert(unique(configs)); });
	}

	function cleanupOwned(configs, error, remoteMayExist) {
		error = asError(error, 'uci_operation_failed');
		error.uciCleanupAttempted = true;
		return preserveOriginal(error, function () {
			var chain = remoteMayExist ? revertRemote(configs) : Promise.resolve();
			return chain.then(function () { return discard(configs); });
		});
	}

	function delay(callback, milliseconds) {
		if (!deps.setTimeout)
			throw codedError('uci_timer_unavailable', 'uci_timer_unavailable');
		return deps.setTimeout(callback, milliseconds);
	}

	function isZeroStatus(value) {
		return value === 0 || value === '0';
	}

	function applyAndConfirm() {
		var timeout = Number(deps.applyTimeout || 10);

		if (!(timeout >= 1))
			timeout = 10;
		if (!deps.uci.callApply || !deps.uci.callConfirm)
			return Promise.reject(codedError('uci_apply_api_unavailable', 'uci_apply_api_unavailable'));
		return invoke(function () { return deps.uci.callApply(timeout, true); }).then(function (status) {
			var deadline;

			if (!isZeroStatus(status))
				throw asError(status, 'uci_apply_failed');
			deadline = Date.now() + timeout * 1000;
			return new Promise(function (resolve, reject) {
				function confirm() {
					invoke(function () { return deps.uci.callConfirm(); }).then(function (confirmStatus) {
						if (isZeroStatus(confirmStatus)) {
							resolve(0);
							return;
						}
						if (Date.now() >= deadline) {
							reject(asError(confirmStatus, 'uci_confirm_failed'));
							return;
						}
						delay(confirm, 250);
					}, function (error) {
						if (Date.now() >= deadline) {
							reject(asError(error, 'uci_confirm_failed'));
							return;
						}
						delay(confirm, 250);
					});
				}
				delay(confirm, 1000);
			});
		});
	}

	function applyOwned(selected, expectedFingerprint) {
		var savePromise;
		var saveStarted = false;

		ensureOnlySelected(selected);
		if (stateSnapshot() !== expectedFingerprint)
			return Promise.reject(codedError('uci_concurrent_local_changes', 'uci_concurrent_local_changes'));

		// uci.save() вызывается в том же turn: перенос в Promise.then() снова открыл бы
		// глобальную staging-область LuCI для другого синхронного вызывающего кода.
		try {
			saveStarted = true;
			savePromise = deps.uci.save();
		} catch (error) {
			return cleanupOwned(selected, error, saveStarted);
		}
		return Promise.resolve(savePromise).then(function () {
			return applyAndConfirm();
		}).then(function () {
			return { configs: selected.slice(), persisted: true };
		}).catch(function (error) {
			return cleanupOwned(selected, error, saveStarted);
		});
	}

	function enqueue(task) {
		var operation = queue.catch(function () { return null; }).then(function () {
			active += 1;
			return task();
		});

		queue = operation.catch(function () { return null; }).finally(function () {
			active -= 1;
		});
		return operation;
	}

	function mutate(configs, stage) {
		var selected = unique(configs);

		return enqueue(function () {
			var cleanFingerprint;
			var stageStarted = false;
			var stagingConflict = false;
			var stageResult;
			var ownedFingerprint;

			if (localConfigNames().length)
				return Promise.reject(codedError('uci_foreign_local_changes', 'uci_foreign_local_changes'));
			cleanFingerprint = stateSnapshot();
			return remoteChanges().then(function () {
				var value;

				if (stateSnapshot() !== cleanFingerprint)
					throw codedError('uci_concurrent_local_changes', 'uci_concurrent_local_changes');
				stageStarted = true;
				value = typeof stage === 'function' ? stage() : null;
				// У LuCI одна глобальная staging-область в памяти. Yield из stage callback
				// позволил бы другому callback страницы смешать изменения до фиксации
				// отпечатка владельца, поэтому staging всегда синхронный.
				if (value && typeof value.then === 'function')
					throw codedError('uci_async_stage_forbidden', 'uci_async_stage_forbidden');
				stageResult = value;
				ensureOnlySelected(selected);
				ownedFingerprint = stateSnapshot();
				// Снимок владельца фиксируется до yield, иначе поздний callback
				// будет ошибочно принят за часть явно подтверждённой операции.
			}).then(function () {
				if (stateSnapshot() !== ownedFingerprint) {
					stagingConflict = true;
					throw codedError('uci_concurrent_local_changes', 'uci_concurrent_local_changes');
				}
				return applyOwned(selected, ownedFingerprint);
			}).then(function (result) {
				result.stageResult = stageResult;
				return result;
			}).catch(function (error) {
				// До начала своих записей нечего откатывать: unload стирает и чужой
				// черновик, который появился во время ожидания remoteChanges().
				// После замечанного смешения unload уже не принадлежит только нам:
				// оставляем весь черновик для проверки, не сохраняем и не стираем его.
				if (!stageStarted || stagingConflict || error && error.uciCleanupAttempted)
					throw error;
				return cleanupOwned(selected, error, false);
			});
		});
	}


	return {
		sections: sections,
		ensureSection: ensureSection,
		replaceList: replaceList,
		mutate: mutate,
		reload: reload,
		discard: discard,
		stateFingerprint: stateSnapshot,
		localConfigNames: localConfigNames,
		isBusy: function () { return active > 0; },
		applyAndConfirm: applyAndConfirm,
		isZeroStatus: isZeroStatus
	};
}

return baseclass.extend({
	unique: unique,
	asError: asError,
	create: create
});
