'use strict';
'require baseclass';

/* §frontmod §persist1 §cfgbak1 §ovaudit3
 * Импорт резервной копии подготавливается одной последовательной мутацией Sheepfold,
 * DHCP и wireless. Общий UCI-адаптер отвечает за очистку и revert при ошибке
 * save/apply.
 */
function create(deps) {
	var configs = ['sheepfold', 'dhcp', 'wireless'];

	function importedSectionByName(sections, name) {
		return (sections || []).filter(function (section) { return section.name === name; })[0] || null;
	}

	function stageConfig(config, importedSections, currentSections, managedTypes, containsSecrets) {
		var existingSections = deps.persistence.sections(config);
		var importedByName = Object.create(null);
		(importedSections || []).forEach(function (section) { importedByName[section.name] = section; });

		existingSections.forEach(function (section) {
			var managed = !managedTypes || managedTypes.indexOf(section['.type']) !== -1;
			var imported = importedByName[section['.name']];
			if (managed && (!imported || imported.type !== section['.type']))
				deps.uci.remove(config, section['.name']);
		});

		(importedSections || []).forEach(function (section) {
			var sameName = existingSections.filter(function (candidate) {
				return candidate['.name'] === section.name;
			})[0] || null;
			var existing = sameName && sameName['.type'] === section.type ? sameName : null;
			var previous = importedSectionByName(currentSections, section.name);
			var actualName = section.name;

			if (sameName && sameName['.type'] !== section.type) {
				var conflict = new Error('backup_section_type_conflict');
				conflict.errorCode = 'backup_section_type_conflict';
				conflict.config = config;
				conflict.section = section.name;
				conflict.expectedType = section.type;
				conflict.actualType = sameName['.type'];
				throw conflict;
			}
			if (!existing)
				actualName = deps.persistence.ensureSection(config, section.type, section.name);
			else
				Object.keys(existing).forEach(function (option) {
					if (option.charAt(0) !== '.') deps.uci.unset(config, actualName, option);
				});

			Object.keys(section.options || {}).forEach(function (option) {
				var value = section.options[option];
				// В полной копии [secret] — допустимое буквальное значение, а не команда.
				if (!containsSecrets && deps.model.secretOption(option) && value === deps.model.secretPlaceholder) {
					if (!previous || !Object.prototype.hasOwnProperty.call(previous.options, option))
						return;
					value = previous.options[option];
				}
				deps.uci.set(config, actualName, option, value);
			});
		});
	}

	function stagePayload(payload, previousPayload) {
		stageConfig('sheepfold', payload.configs.sheepfold, previousPayload.configs.sheepfold, null, payload.containsSecrets);
		stageConfig('dhcp', payload.configs.dhcp, previousPayload.configs.dhcp, ['host'], payload.containsSecrets);
		stageConfig('wireless', payload.configs.wireless, previousPayload.configs.wireless, ['wifi-device', 'wifi-iface'], payload.containsSecrets);
	}

	function configFingerprint(payload) {
		// Порядок UCI-секций/списков значим, порядок ключей JS-объекта — нет.
		return JSON.stringify(configs.map(function (config) {
			return payload.configs[config].map(function (section) {
				return [section.name, section.type, Object.keys(section.options).sort().map(function (option) {
					return [option, section.options[option]];
				})];
			});
		}));
	}

	function currentPayload() {
		return deps.model.validate(deps.model.build({
			sheepfold: deps.persistence.sections('sheepfold'),
			dhcp: deps.persistence.sections('dhcp').filter(function (section) { return section['.type'] === 'host'; }),
			wireless: deps.persistence.sections('wireless').filter(function (section) {
				return section['.type'] === 'wifi-device' || section['.type'] === 'wifi-iface';
			})
		}, true));
	}

	function apply(payload, previousPayload) {
		var previous = deps.model.validate(previousPayload);
		var prepared = deps.model.prepareRestore(payload, previous);
		return deps.persistence.mutate(configs, function () {
			// Controller получает previous до ожидания общей очереди. Предыдущая
			// операция могла сменить секрет/ID: старый [secret] нельзя вернуть назад.
			if (configFingerprint(currentPayload()) !== configFingerprint(previous)) {
				var conflict = new Error('backup_current_settings_changed');
				conflict.errorCode = 'backup_current_settings_changed';
				throw conflict;
			}
			stagePayload(prepared.payload, previous);
			return { routerTransfer: prepared.routerTransfer };
		}).then(function (mutation) {
			return Promise.resolve().then(function () { return deps.refreshRuntime(); }).then(function () {
				return { persisted: true, servicesRefreshed: true, routerTransfer: mutation.stageResult.routerTransfer };
			}, function () {
				return { persisted: true, servicesRefreshed: false, routerTransfer: mutation.stageResult.routerTransfer };
			});
		});
	}

	return { importedSectionByName: importedSectionByName, stageConfig: stageConfig, stagePayload: stagePayload, apply: apply };
}

return baseclass.extend({ create: create });
