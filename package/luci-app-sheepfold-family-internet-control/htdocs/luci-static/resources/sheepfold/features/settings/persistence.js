'use strict';
'require baseclass';

/* §frontmod §persist1 §ovfinal1
 * Сохранение общего черновика Settings. Модуль проверяет и разделяет значения,
 * подготавливает именованные UCI-секции и выполняет один явный save/apply Sheepfold.
 * Он не отвечает за DOM, уведомления, перезагрузку страницы или runtime роутера.
 */
function hasOwn(object, key) {
	return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeAccessOrder(value, accessKeys) {
	var known = Object.create(null);
	var order = [];

	(accessKeys || []).forEach(function (key) { known[key] = true; });
	String(value || '').split(/\s+/).filter(Boolean).forEach(function (key) {
		if (known[key] && order.indexOf(key) === -1)
			order.push(key);
	});
	(accessKeys || []).forEach(function (key) {
		if (order.indexOf(key) === -1)
			order.push(key);
	});
	return order;
}

function create(deps) {
	var sectionTypes = {
		usb: 'usb',
		cloud: 'yandex_disk',
		gdrive: 'google_drive',
		adguard: 'integration'
	};

	function currentSectionValue(section, option, fallback, options) {
		var key = section + '.' + option;
		if (hasOwn(options, key))
			return options[key];
		return deps.sectionValue(section, option, fallback);
	}

	function validateInteger(options, option, minimum, maximum, label) {
		var text;
		var number;

		if (!hasOwn(options, option))
			return;
		text = String(options[option] || '');
		number = parseInt(text, 10);
		if (!text || String(number) !== text || number < minimum || number > maximum)
			throw new Error(label + ': ' + minimum + '–' + maximum);
	}

	function validate(options) {
		var address;
		var match;
		var username;
		var password;
		var automationMode;

		if (hasOwn(options, 'beta_testing') && options.beta_testing !== '0' && options.beta_testing !== '1')
			throw new Error(_('Invalid beta testing setting.'));

		if (hasOwn(options, 'automation_mode')) {
			automationMode = String(options.automation_mode || '');
			if (automationMode !== 'maximum' && automationMode !== 'selective')
				throw new Error(_('Unknown automation mode.'));
		}

		if (hasOwn(options, 'log_cache_path') &&
			(!/^\/tmp\/[A-Za-z0-9_./-]+$/.test(options.log_cache_path || '') ||
			 String(options.log_cache_path).indexOf('..') !== -1 ||
			 String(options.log_cache_path).slice(-1) === '/')) {
			throw new Error(_('Cache file path must start with /tmp/ and contain only letters, numbers, dot, slash, underscore, and hyphen.'));
		}

		validateInteger(options, 'app_port', 1, 65535, _('Application HTTPS port'));
		/* SHEEPFOLD_AI_BEGIN */
		validateInteger(options, 'ai_rate_limit_requests', 1, 1000, _('Requests per device'));
		validateInteger(options, 'ai_rate_limit_window_seconds', 60, 86400, _('Rate limit window, seconds'));
		/* SHEEPFOLD_AI_END */

		if (hasOwn(options, 'usb.device') && options['usb.device'] &&
			!/^\/dev\/[A-Za-z0-9._-]+$/.test(options['usb.device'])) {
			throw new Error(_('USB partition device path') + ': /dev/...');
		}

		if (hasOwn(options, 'access_priority') &&
			normalizeAccessOrder(options.access_priority, deps.accessKeys).join(' ') !== String(options.access_priority).trim()) {
			throw new Error(_('Access priority contains an unknown or duplicate rule.'));
		}

		if (hasOwn(options, 'adguard.url')) {
			address = String(options['adguard.url'] || '').trim();
			match = address.match(/^(https?):\/\/([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(?::([0-9]{1,5}))?\/?$/i);
			if (!match)
				throw new Error(_('AdGuard Home address must contain only the protocol, host, and optional port.'));
			if (match[3] && (parseInt(match[3], 10) < 1 || parseInt(match[3], 10) > 65535))
				throw new Error(_('AdGuard Home address must contain only the protocol, host, and optional port.'));
			// Существующий адрес локальной установки повторно проверяет backend перед передачей пароля
			if (match[1].toLowerCase() === 'http' && !/^(?:127\.0\.0\.1|localhost|\[::1\])$/i.test(match[2]) &&
				address !== deps.sectionValue('adguard', 'url', ''))
				throw new Error(_('Use HTTPS for AdGuard Home on another device. Unencrypted HTTP is allowed only on this router.'));
		}

		if (hasOwn(options, 'adguard.username') || hasOwn(options, 'adguard.password')) {
			username = String(currentSectionValue('adguard', 'username', '', options) || '').trim();
			password = String(currentSectionValue('adguard', 'password', '', options) || '');
			if (Boolean(username) !== Boolean(password))
				throw new Error(_('Enter both the AdGuard Home username and password, or leave both fields empty.'));
		}
	}

	function partition(options) {
		var result = { global: {}, sections: {} };

		Object.keys(options || {}).forEach(function (key) {
			var match = key.match(/^(usb|cloud|gdrive|adguard)\.(.+)$/);
			if (!match) {
				result.global[key] = options[key];
				return;
			}
			if (!result.sections[match[1]])
				result.sections[match[1]] = {};
			result.sections[match[1]][match[2]] = options[key];
		});
		return result;
	}

	function ensureNamedSection(section) {
		return deps.persistence.ensureSection('sheepfold', sectionTypes[section], section);
	}

	function stage(options) {
		var values = partition(options);

		if (values.global.automation_mode === 'maximum') {
			/* Максимальный профиль записывается здесь повторно, чтобы один изменённый
			 * DOM-контрол не смог сохранить противоречащие скрытые значения. §autoact1 */
			Object.assign(values.global, {
				new_device_policy: 'allow',
				auto_configure: '1',
				detection_mode: 'full',
				no_restrictions_auto_assign: '1',
				personal_devices_auto_assign: '1',
				device_monitoring_mode: 'automatic'
			});
		}
		if (hasOwn(values.global, 'language'))
			values.global.language = deps.normalizeLanguage(values.global.language);
		Object.keys(values.global).forEach(function (option) {
			deps.uci.set('sheepfold', 'global', option, values.global[option]);
		});

		/* SHEEPFOLD_AI_BEGIN */
		if ((hasOwn(values.global, 'deepseek_api_key') && String(values.global.deepseek_api_key || '').trim()) ||
			(hasOwn(values.global, 'gemini_api_key') && String(values.global.gemini_api_key || '').trim()) ||
			(hasOwn(values.global, 'grok_api_key') && String(values.global.grok_api_key || '').trim())) {
			deps.uci.set('sheepfold', 'global', 'ai_enabled', '1');
		}
		if (hasOwn(values.global, 'child_ai_parental_consent'))
			deps.uci.set('sheepfold', 'global', 'child_ai_consent_version', 'child-ai-v1');
		/* SHEEPFOLD_AI_END */

		Object.keys(values.sections).forEach(function (section) {
			ensureNamedSection(section);
			if (section === 'cloud' &&
				(hasOwn(values.sections[section], 'login') || hasOwn(values.sections[section], 'password'))) {
				deps.uci.set('sheepfold', section, 'authorized', '0');
			}
			if (section === 'gdrive' &&
				(hasOwn(values.sections[section], 'client_id') ||
				 hasOwn(values.sections[section], 'client_secret') ||
				 hasOwn(values.sections[section], 'refresh_token'))) {
				deps.uci.set('sheepfold', section, 'authorized', '0');
			}
			Object.keys(values.sections[section]).forEach(function (option) {
				deps.uci.set('sheepfold', section, option, values.sections[section][option]);
			});
		});
		return values;
	}

	function save(options) {
		return deps.persistence.mutate(['sheepfold'], function () {
			return stage(options);
		}).then(function (result) {
			return result.stageResult;
		});
	}

	return {
		validate: validate,
		partition: partition,
		stage: stage,
		save: save,
		normalizeAccessOrder: function (value) {
			return normalizeAccessOrder(value, deps.accessKeys);
		}
	};
}

return baseclass.extend({
	hasOwn: hasOwn,
	normalizeAccessOrder: normalizeAccessOrder,
	create: create
});
