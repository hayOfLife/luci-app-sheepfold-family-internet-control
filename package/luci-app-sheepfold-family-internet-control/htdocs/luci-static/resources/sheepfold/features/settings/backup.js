'use strict';
'require baseclass';

var plainFormat = 'sheepfold-settings-export-v2';
var encryptedFormat = 'sheepfold-settings-encrypted-v1';
var applicationName = 'luci-app-sheepfold-family-internet-control';
var secretPlaceholder = '[secret]';
var maxSectionsPerConfig = 1024;
var maxOptionsPerSection = 256;
var maxValueLength = 131072;
var maxFileBytes = 5 * 1024 * 1024;
var pbkdf2Iterations = 250000;
var routerIdOption = 'router_install_id';
var transferDeviceOptions = {
	admin_device: true,
	admin_owner: true,
	admin_login: true,
	paired_from: true,
	paired_at: true,
	pairing_user_agent: true,
	trusted_identity_keys: true,
	trusted_identity_version: true,
	detection_fingerprint: true,
	detection_identity_keys: true,
	detection_identity_version: true,
	detection_last_analysis_at: true,
	identity_quarantine_mode: true,
	identity_quarantine_reason: true,
	identity_quarantine_at: true,
	identity_quarantine_keys: true,
	identity_quarantine_keys_version: true,
	identity_quarantine_notified_at: true,
	identity_uuid_collision_pending: true,
	identity_uuid_collision_with_id: true,
	identity_uuid_collision_reason: true,
	identity_uuid_collision_accepted_with_id: true
};

function secretOption(name) {
	// WPS PIN и списки ключей 802.11r не содержат слов password/key в имени.
	// Точные имена дополняют общий фильтр без маскирования pinning_enabled и т. п.
	return /(password|passwd|token|secret|key|cookie|session|sim_phone_history)/i.test(String(name || '')) ||
		/^(wps_pin|r0kh|r1kh)$/i.test(String(name || ''));
}

function transientOption(name) {
	return name === 'pairing_code' || name === 'pairing_code_expires';
}

function safeIdentifier(value) {
	// Не приводим массив/объект к строке: ['__proto__'] иначе обходит запрет.
	return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) &&
		value !== '__proto__' && value !== 'prototype' && value !== 'constructor';
}

function safeOptionName(value) {
	return typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value) &&
		value !== '__proto__' && value !== 'prototype' && value !== 'constructor';
}

function normalizedValue(value) {
	var values = Array.isArray(value) ? value : [value];

	if (!values.length || values.length > 1024)
		throw new Error('invalid_option_value');

	values = values.map(function (item) {
		if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean')
			throw new Error('invalid_option_value');
		item = String(item);
		if (item.length > maxValueLength)
			throw new Error('option_value_too_long');
		return item;
	});

	return Array.isArray(value) ? values : values[0];
}

function serializeSection(section, includeSecrets) {
	var name = section && section['.name'];
	var type = section && section['.type'];
	var options = Object.create(null);

	if (!safeIdentifier(name) || !safeIdentifier(type))
		throw new Error('invalid_section_identifier');

	Object.keys(section || {}).forEach(function (option) {
		var value;

		if (option.charAt(0) === '.' || transientOption(option) ||
				typeof section[option] === 'function' || section[option] == null)
			return;
		if (!safeOptionName(option))
			throw new Error('invalid_option_name');
		value = normalizedValue(section[option]);
		options[option] = !includeSecrets && secretOption(option) ? secretPlaceholder : value;
	});

	if (Object.keys(options).length > maxOptionsPerSection)
		throw new Error('too_many_options');

	return { name: String(name), type: String(type), options: options };
}

function serializeConfig(sections, includeSecrets) {
	if (!Array.isArray(sections) || sections.length > maxSectionsPerConfig)
		throw new Error('too_many_sections');
	return sections.map(function (section) { return serializeSection(section, includeSecrets); });
}

function build(sectionsByConfig, includeSecrets, exportedAt) {
	return {
		format: plainFormat,
		app: applicationName,
		exportedAt: exportedAt || new Date().toISOString(),
		containsSecrets: !!includeSecrets,
		configs: {
			sheepfold: serializeConfig(sectionsByConfig.sheepfold || [], includeSecrets),
			dhcp: serializeConfig(sectionsByConfig.dhcp || [], includeSecrets),
			wireless: serializeConfig(sectionsByConfig.wireless || [], includeSecrets)
		}
	};
}

function validateSection(section, config, names, containsSecrets) {
	var options = Object.create(null);

	if (!section || !safeIdentifier(section.name) || !safeIdentifier(section.type) ||
		!section.options || Array.isArray(section.options) || typeof section.options !== 'object')
		throw new Error('invalid_section');
	if (names[section.name])
		throw new Error('duplicate_section');
	names[section.name] = true;
	if (config === 'dhcp' && section.type !== 'host')
		throw new Error('invalid_dhcp_section');
	if (config === 'wireless' && section.type !== 'wifi-device' && section.type !== 'wifi-iface')
		throw new Error('invalid_wireless_section');

	Object.keys(section.options).forEach(function (option) {
		var value;

		if (!safeOptionName(option))
			throw new Error('invalid_option_name');
		value = normalizedValue(section.options[option]);
		if (!containsSecrets && secretOption(option) && value !== secretPlaceholder)
			throw new Error('unencrypted_secrets_forbidden');
		options[option] = value;
	});
	if (Object.keys(options).length > maxOptionsPerSection)
		throw new Error('too_many_options');

	return { name: String(section.name), type: String(section.type), options: options };
}

function listValues(section) {
	var value = section && section.options && section.options.mac;
	return (Array.isArray(value) ? value : value == null ? [] : [value]).map(function (item) {
		return String(item).toUpperCase();
	});
}

function validateAccessLists(sections) {
	var allow = sections.filter(function (section) { return section.name === 'allowlist' && section.type === 'list'; })[0];
	var block = sections.filter(function (section) { return section.name === 'blocklist' && section.type === 'list'; })[0];
	var blocked = Object.create(null);

	if (!allow || !block)
		throw new Error('required_lists_missing');
	listValues(block).forEach(function (mac) { blocked[mac] = true; });
	if (listValues(allow).some(function (mac) { return blocked[mac]; }))
		throw new Error('conflicting_device_lists');
}

function validate(payload) {
	var normalized = { format: plainFormat, app: applicationName, exportedAt: '', containsSecrets: false, configs: {} };
	var containsSecrets;

	if (!payload || payload.format !== plainFormat || payload.app !== applicationName ||
		!payload.configs || typeof payload.configs !== 'object')
		throw new Error('invalid_format');
	containsSecrets = payload.containsSecrets === true;

	['sheepfold', 'dhcp', 'wireless'].forEach(function (config) {
		var names = Object.create(null);
		var sections = payload.configs[config];
		if (!Array.isArray(sections) || sections.length > maxSectionsPerConfig)
			throw new Error('invalid_config_sections');
		normalized.configs[config] = sections.map(function (section) {
			return validateSection(section, config, names, containsSecrets);
		});
	});

	if (!normalized.configs.sheepfold.some(function (section) {
		return section.name === 'global' && section.type === 'sheepfold';
	}))
		throw new Error('global_section_missing');
	validateAccessLists(normalized.configs.sheepfold);
	normalized.exportedAt = String(payload.exportedAt || '');
	normalized.containsSecrets = containsSecrets;
	return normalized;
}

function namedSection(payload, name, type) {
	return (payload.configs.sheepfold || []).filter(function (section) {
		return section.name === name && section.type === type;
	})[0] || null;
}

function routerId(payload) {
	var global = namedSection(payload, 'global', 'sheepfold');
	var value = String(global && global.options[routerIdOption] || '').toLowerCase();

	return /^[a-f0-9]{32,64}$/.test(value) ? value : '';
}

function removeTransientOptions(payload) {
	(payload.configs.sheepfold || []).forEach(function (section) {
		Object.keys(section.options || {}).forEach(function (option) {
			if (transientOption(option))
				delete section.options[option];
		});
	});
}

function resetTransferredDevice(section) {
	Object.keys(section.options || {}).forEach(function (option) {
		// Унаследованные ключи вроде toString не являются переносимыми правами.
		if (Object.prototype.hasOwnProperty.call(transferDeviceOptions, option))
			delete section.options[option];
	});
}

function prepareRestore(importedPayload, currentPayload) {
	var restored = validate(importedPayload);
	var current = validate(currentPayload);
	var sourceId = routerId(restored);
	var currentId = routerId(current);
	var global;
	var routerTransfer;

	if (!currentId)
		throw new Error('current_router_id_missing');

	global = namedSection(restored, 'global', 'sheepfold');
	global.options[routerIdOption] = currentId;
	removeTransientOptions(restored);
	// Согласие на вход с другой сети не переносим резервной копией, даже на тот же роутер
	restored.configs.sheepfold.forEach(function (section) {
		if (section.name === 'home_network_global' || section.type === 'home_network') {
			section.options.enabled = '0';
			delete section.options.fingerprint;
		}
	});
	routerTransfer = !sourceId || sourceId !== currentId;

	if (routerTransfer) {
		// HMAC-отпечатки зависят от локального секрета конкретного роутера. При
		// переносе сохраняем постоянные ID и семейные правила, но строим доверенную
		// базу заново и требуем новое QR-сопряжение админских телефонов. §cfgbak1
		restored.configs.sheepfold.filter(function (section) {
			return section.type === 'device';
		}).forEach(resetTransferredDevice);
	}

	return {
		payload: restored,
		routerTransfer: routerTransfer,
		legacySource: !sourceId
	};
}

function summary(payload) {
	var sections = payload.configs.sheepfold;
	return {
		devices: sections.filter(function (section) { return section.type === 'device'; }).length,
		groups: sections.filter(function (section) { return section.type === 'group'; }).length,
		schedules: sections.filter(function (section) { return section.type === 'schedule'; }).length,
		administrators: sections.filter(function (section) { return section.type === 'administrator'; }).length,
		dhcpHosts: payload.configs.dhcp.length,
		wifiSections: payload.configs.wireless.length,
		containsSecrets: payload.containsSecrets
	};
}

// Проверяем именно скачиваемый UTF-8 JSON: шифрованная оболочка с Base64
// может превышать лимит, даже когда исходная конфигурация в него помещается.
function fileText(payload) {
	var text = JSON.stringify(payload, null, 2) + '\n';
	if (new TextEncoder().encode(text).length > maxFileBytes)
		throw new Error('backup_file_too_large');
	return text;
}

function bytesToBase64(bytes) {
	var binary = '';
	var chunkSize = 32768;
	var offset;
	for (offset = 0; offset < bytes.length; offset += chunkSize)
		binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
	return btoa(binary);
}

function base64ToBytes(value) {
	var binary = atob(String(value || ''));
	var bytes = new Uint8Array(binary.length);
	var index;
	for (index = 0; index < binary.length; index++)
		bytes[index] = binary.charCodeAt(index);
	return bytes;
}

function encryptionAvailable() {
	return typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined' &&
		typeof TextDecoder !== 'undefined' && typeof btoa === 'function' && typeof atob === 'function';
}

function deriveKey(password, salt, usages) {
	var encoded = new TextEncoder().encode(password);
	return crypto.subtle.importKey('raw', encoded, 'PBKDF2', false, ['deriveKey']).then(function (keyMaterial) {
		return crypto.subtle.deriveKey({
			name: 'PBKDF2',
			salt: salt,
			iterations: pbkdf2Iterations,
			hash: 'SHA-256'
		}, keyMaterial, { name: 'AES-GCM', length: 256 }, false, usages);
	});
}

function encrypt(payload, password) {
	var salt;
	var iv;
	var plaintext;

	if (!encryptionAvailable())
		return Promise.reject(new Error('encryption_unavailable'));
	if (String(password || '').length < 12)
		return Promise.reject(new Error('password_too_short'));
	payload = validate(payload);
	salt = crypto.getRandomValues(new Uint8Array(16));
	iv = crypto.getRandomValues(new Uint8Array(12));
	plaintext = new TextEncoder().encode(JSON.stringify(payload));

	return deriveKey(password, salt, ['encrypt']).then(function (key) {
		return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plaintext);
	}).then(function (ciphertext) {
		return {
			format: encryptedFormat,
			app: applicationName,
			kdf: 'PBKDF2-SHA256',
			iterations: pbkdf2Iterations,
			cipher: 'AES-256-GCM',
			salt: bytesToBase64(salt),
			iv: bytesToBase64(iv),
			ciphertext: bytesToBase64(new Uint8Array(ciphertext))
		};
	});
}

function decrypt(envelope, password) {
	var salt;
	var iv;
	var ciphertext;

	if (!encryptionAvailable())
		return Promise.reject(new Error('encryption_unavailable'));
	if (!envelope || envelope.format !== encryptedFormat || envelope.app !== applicationName ||
		envelope.kdf !== 'PBKDF2-SHA256' || envelope.cipher !== 'AES-256-GCM' ||
		envelope.iterations !== pbkdf2Iterations)
		return Promise.reject(new Error('invalid_encrypted_format'));
	try {
		salt = base64ToBytes(envelope.salt);
		iv = base64ToBytes(envelope.iv);
		ciphertext = base64ToBytes(envelope.ciphertext);
	} catch (error) {
		return Promise.reject(new Error('invalid_encrypted_format'));
	}
	if (salt.length !== 16 || iv.length !== 12 || !ciphertext.length)
		return Promise.reject(new Error('invalid_encrypted_format'));

	return deriveKey(password, salt, ['decrypt']).then(function (key) {
		return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ciphertext);
	}).then(function (plaintext) {
		return validate(JSON.parse(new TextDecoder().decode(plaintext)));
	});
}

return baseclass.extend({
	plainFormat: plainFormat,
	encryptedFormat: encryptedFormat,
	secretPlaceholder: secretPlaceholder,
	maxFileBytes: maxFileBytes,
	fileText: fileText,
	secretOption: secretOption,
	transientOption: transientOption,
	build: build,
	validate: validate,
	prepareRestore: prepareRestore,
	summary: summary,
	encryptionAvailable: encryptionAvailable,
	encrypt: encrypt,
	decrypt: decrypt
});
