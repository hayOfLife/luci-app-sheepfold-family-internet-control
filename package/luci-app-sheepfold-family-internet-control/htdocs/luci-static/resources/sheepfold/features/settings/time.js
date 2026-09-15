'use strict';
'require baseclass';

/* §country1 §frontmod
 * Настройка времени сохраняет уже выбранный часовой пояс роутера. Выбор страны
 * является только рекомендацией: Sheepfold не угадывает город по публичному IP
 * и не меняет время OpenWrt до явного сохранения родителем.
 */
var COUNTRY_PROFILES = {
	ru: {
		label: 'Russia',
		timezone: 'Europe/Moscow|MSK-3',
		servers: 'ntp1.vniiftri.ru ntp2.ntp-servers.net 3.openwrt.pool.ntp.org'
	},
	by: {
		label: 'Belarus',
		timezone: 'Europe/Minsk|+03-3',
		servers: 'by.pool.ntp.org pool.ntp.org'
	},
	cn: {
		label: 'China',
		timezone: 'Asia/Shanghai|CST-8',
		servers: 'cn.pool.ntp.org ntp.aliyun.com time1.cloud.tencent.com'
	},
	other: {
		label: 'Other country',
		timezone: 'UTC|UTC0',
		servers: 'pool.ntp.org'
	}
};

function countryProfile(value) {
	return COUNTRY_PROFILES[value] || COUNTRY_PROFILES.ru;
}

function normalizeNtpServers(value) {
	return String(value || '')
		.split(/[\s,;]+/)
		.map(function (server) { return server.trim(); })
		.filter(Boolean)
		.join(' ');
}

function timezoneOptions() {
	return [
		['Europe/Moscow|MSK-3', 'Moscow time', 'Europe/Moscow, MSK-3'],
		['Europe/Kaliningrad|EET-2', 'Kaliningrad time', 'Europe/Kaliningrad, EET-2'],
		['Europe/Samara|+04-4', 'Samara time', 'Europe/Samara, +04-4'],
		['Asia/Yekaterinburg|+05-5', 'Yekaterinburg time', 'Asia/Yekaterinburg, +05-5'],
		['Asia/Omsk|+06-6', 'Omsk time', 'Asia/Omsk, +06-6'],
		['Asia/Krasnoyarsk|+07-7', 'Krasnoyarsk time', 'Asia/Krasnoyarsk, +07-7'],
		['Asia/Irkutsk|+08-8', 'Irkutsk time', 'Asia/Irkutsk, +08-8'],
		['Asia/Yakutsk|+09-9', 'Yakutsk time', 'Asia/Yakutsk, +09-9'],
		['Asia/Vladivostok|+10-10', 'Vladivostok time', 'Asia/Vladivostok, +10-10'],
		['Asia/Magadan|+11-11', 'Magadan time', 'Asia/Magadan, +11-11'],
		['Asia/Kamchatka|+12-12', 'Kamchatka time', 'Asia/Kamchatka, +12-12'],
		['Europe/Minsk|+03-3', 'Minsk time', 'Europe/Minsk, +03-3'],
		['Asia/Shanghai|CST-8', 'China Standard Time', 'Asia/Shanghai, CST-8'],
		['UTC|UTC0', 'UTC', 'UTC']
	];
}

function optionNode(item, selected) {
	return E('option', {
		'value': item[0],
		'selected': item[0] === selected ? 'selected' : null
	}, item[1] === 'UTC' ? 'UTC' : _(item[1]) + ' (' + item[2] + ')');
}

// commandActions.run отклоняет ненулевой exit до then. Только штатный
// post-commit отказ NTP подтверждает запись; timeout этого не доказывает.
function normalizeSaveError(error, parseKeyValues) {
	var result = error && error.result;
	var outcome = parseKeyValues(result && result.stdout || '');
	if (result && result.code === 5 && outcome.status === 'error' &&
		outcome.error === 'ntp_restart_failed' && outcome.persisted === '1' && outcome.runtime_applied === '0') {
		error.persisted = true;
		error.runtimeApplied = false;
		error.errorCode = 'ntp_restart_failed';
		error.message = _('Router time settings were saved, but NTP could not be restarted. Check the time service before relying on schedules.');
	}
	// Неполное файловое восстановление не подтверждает ни старые, ни новые
	// настройки. Не принимаем черновик и не предлагаем автоматический повтор.
	if (result && result.code === 6 && outcome.status === 'error' &&
		outcome.error === 'time_rollback_failed' && outcome.config_files_restored === '0' && outcome.recovery_required === '1') {
		error.errorCode = 'time_rollback_failed';
		error.message = _('Router time settings could not be restored completely. Check the router configuration and recovery snapshots before saving again.');
	}
	if (result && result.code === 4 && outcome.status === 'error' && outcome.error === 'time_clock_unavailable') {
		error.errorCode = 'time_clock_unavailable';
		error.message = _('Could not read the router clock. Time settings were not changed. Check the router before trying again.');
	}
	return error;
}

function create(deps) {
	var selectedCountry = deps.countryProfile();
	var recommendationText = null;

	function recommendedProfile() {
		return countryProfile(selectedCountry);
	}

	function updateRecommendationText() {
		var profile = recommendedProfile();

		if (recommendationText)
			recommendationText.textContent = _('Recommended for the selected country:') + ' ' + _(profile.label) + '. ';
	}

	function render() {
		var profile = recommendedProfile();
		var systemZoneName = deps.systemValue('@system[0]', 'zonename', '');
		var systemTimezone = deps.systemValue('@system[0]', 'timezone', '');
		var systemConfigured = !!(systemZoneName && systemTimezone);
		var storedConfigured = deps.globalValue('router_time_configured', '0') === '1';
		var storedZoneName = deps.globalValue('router_timezone_name', '');
		var storedTimezone = deps.globalValue('router_timezone', '');
		var selectedTimezone = systemConfigured ? systemZoneName + '|' + systemTimezone :
			(storedConfigured && storedZoneName && storedTimezone ? storedZoneName + '|' + storedTimezone : profile.timezone);
		var currentOptions = timezoneOptions();
		var knownSelected = currentOptions.some(function (item) { return item[0] === selectedTimezone; });
		var ntpEnabled = deps.systemValue('ntp', 'enabled', deps.globalValue('router_ntp_client_auto_configure', '1')) !== '0';
		var ntpServerEnabled = deps.systemValue('ntp', 'enable_server', deps.globalValue('router_ntp_server_enabled', '1')) === '1';
		var currentServers = deps.listValues(deps.systemValue('ntp', 'server', '')).join(' ');
		var storedServers = deps.globalValue('router_ntp_servers', '');
		var ntpServers = currentServers || (storedConfigured ? storedServers : '') || profile.servers;
		var serverField = deps.checkbox(_('Make router an NTP server for LAN'), ntpServerEnabled,
			_('Home devices can use the router as their local time server.'));
		var clientField = deps.checkbox(_('Automatically configure router NTP client'), ntpEnabled,
			_('Sheepfold writes the selected NTP servers only after the parent saves this section.'));
		var timezoneSelect;
		var ntpServersTextarea;
		var stateNote = E('div', { 'class': systemConfigured ? 'sf-note sf-note-ok' : 'sf-note sf-note-warning' });
		var clockNote = E('div', { 'class': 'sf-note sf-note-warning', 'hidden': 'hidden' });
		var initialOptions;
		var savedOptions = null;

		if (!knownSelected && selectedTimezone.indexOf('|') > 0)
			currentOptions.unshift([selectedTimezone, 'Current router timezone', selectedTimezone.replace('|', ', ')]);

		timezoneSelect = E('select', { 'class': 'cbi-input-select' }, currentOptions.map(function (item) {
			return optionNode(item, selectedTimezone);
		}));
		ntpServersTextarea = E('textarea', {
			'class': 'cbi-input-textarea',
			'rows': 3
		}, normalizeNtpServers(ntpServers).replace(/ /g, '\n'));

		function updateStateNote() {
			stateNote.textContent = systemConfigured ?
				_('The current OpenWrt timezone is preserved. The country profile below is only a recommendation.') :
				_('Router timezone is not configured. Select a region or apply the country recommendation, then save settings.');
		}

		function collectOptions() {
			var timezoneParts = String(timezoneSelect.value || '').split('|');
			return {
				server_enabled: serverField.input.checked ? '1' : '0',
				client_enabled: clientField.input.checked ? '1' : '0',
				timezone_name: timezoneParts[0] || '',
				timezone: timezoneParts[1] || '',
				servers: normalizeNtpServers(ntpServersTextarea.value),
				country_profile: selectedCountry
			};
		}

		function timeValues(options) {
			return {
				server_enabled: options.server_enabled,
				client_enabled: options.client_enabled,
				timezone_name: options.timezone_name,
				timezone: options.timezone,
				servers: options.servers
			};
		}

		function changed() {
			deps.changed();
		}

		function applyRecommendation(event) {
			var currentProfile = recommendedProfile();

			if (event)
				event.preventDefault();
			timezoneSelect.value = currentProfile.timezone;
			ntpServersTextarea.value = currentProfile.servers.replace(/ /g, '\n');
			clientField.input.checked = true;
			changed();
		}

		initialOptions = collectOptions();
		updateStateNote();
		[serverField.input, clientField.input, timezoneSelect, ntpServersTextarea].forEach(function (input) {
			input.addEventListener('change', changed);
			input.addEventListener('input', changed);
		});

		deps.registerSaver({
			isChanged: function () {
				return !deps.sameValues(timeValues(initialOptions), timeValues(collectOptions()));
			},
			save: function () {
				var options = collectOptions();
				savedOptions = null;
				if (!options.timezone_name || !options.timezone || !options.servers)
					return Promise.reject(new Error(_('Choose a timezone and at least one valid NTP server.')));
				return Promise.resolve().then(function () {
					return deps.save(options);
				}).then(function (result) {
					savedOptions = options;
					return result;
				}, function (error) {
					// Отказ перезапуска не отменяет подтверждённую запись. Но до её
					// подтверждения ни один текущий ввод нельзя считать сохранённым.
					if (error && error.persisted === true)
						savedOptions = options;
					throw error;
				});
			},
			accept: function () {
				if (!savedOptions)
					return;
				// Ответ относится к отправленному снимку, не к полям, которые
				// родитель успел изменить, пока ожидал сохранения времени.
				initialOptions = savedOptions;
				savedOptions = null;
				systemConfigured = true;
				updateStateNote();
			}
		});

		if (deps.status) {
			deps.status().then(function (status) {
				if (status && status.clock_sane === '0') {
					clockNote.hidden = false;
					clockNote.textContent = _('Router clock is not synchronized. Schedules and TLS checks may be inaccurate until NTP succeeds.');
				}
			}, function () {
				// Поля UCI остаются доступными, даже если необязательная проверка статуса не удалась.
			});
		}

		recommendationText = E('span', {}, '');
		updateRecommendationText();

		return E('div', { 'class': 'sf-flat-form' }, [
			stateNote,
			clockNote,
			E('div', { 'class': 'sf-note' }, [
				recommendationText,
				E('button', {
					'class': 'sf-action sf-action-neutral',
					'type': 'button',
					'click': applyRecommendation
				}, _('Use country recommendation')),
				E('small', { 'class': 'sf-field-wide' }, _('No public-IP geolocation is used. Choose another region when the router is located in a different timezone.'))
			]),
			serverField.node,
			clientField.node,
			E('label', { 'class': 'sf-field sf-field-wide' }, [
				E('span', {}, _('Router timezone')),
				timezoneSelect
			]),
			E('label', { 'class': 'sf-field sf-field-wide' }, [
				E('span', {}, _('NTP servers')),
				ntpServersTextarea,
				E('small', {}, _('One hostname per line. Invalid values are rejected instead of silently resetting the router to Moscow time.'))
			])
		]);
	}

	function notice() {
		var node = E('div', { 'class': 'sf-note sf-note-warning', 'hidden': 'hidden' });
		if (!deps.status)
			return node;
		deps.status().then(function (status) {
			if (!status || (status.system_configured === '1' && status.clock_sane === '1'))
				return;
			node.hidden = false;
			node.textContent = status.system_configured !== '1' ?
				_('Finish router time setup in Settings → Misc → Router time and NTP before relying on schedules.') :
				_('Router clock is not synchronized. Check timezone and NTP settings before relying on schedules.');
		}, function () {
			// Ошибка проверки не должна блокировать остальные настройки вкладки «Общее».
		});
		return node;
	}

	return {
		render: render,
		notice: notice,
		setCountry: function (value) {
			selectedCountry = COUNTRY_PROFILES[value] ? value : 'other';
			updateRecommendationText();
		}
	};
}

return baseclass.extend({
	normalizeSaveError: normalizeSaveError,
	countryProfile: countryProfile,
	normalizeNtpServers: normalizeNtpServers,
	timezoneOptions: timezoneOptions,
	create: create
});
