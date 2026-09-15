'use strict';
'require baseclass';
'require fs';

function field(deps, label, option, placeholder, hint, secret) {
	var input = E('input', {
		'class': 'cbi-input-text' + (secret ? ' sf-secret-input' : ''),
		'type': secret ? 'password' : 'text',
		'value': deps.get(option, ''),
		'placeholder': placeholder || ''
	});
	var control = input;

	input.addEventListener('keydown', function (event) {
		if (event.key === 'Enter')
			event.preventDefault();
	});

	if (secret) {
		control = E('span', { 'class': 'sf-secret-row' }, [
			input,
			E('button', {
				'class': 'sf-icon-action sf-secret-toggle',
				'type': 'button',
				'title': _('Show secret'),
				'aria-label': _('Show secret'),
				'click': function (event) {
					var visible;
					event.preventDefault();
					visible = input.type === 'password';
					input.type = visible ? 'text' : 'password';
					event.currentTarget.setAttribute('title', visible ? _('Hide secret') : _('Show secret'));
					event.currentTarget.setAttribute('aria-label', visible ? _('Hide secret') : _('Show secret'));
				}
			}, deps.icon('actionShowSecret'))
		]);
	}

	var node = E('label', { 'class': 'sf-field sf-field-wide' }, [
		E('span', {}, label), control, hint ? E('small', {}, hint) : ''
	]);

	node.sfInput = input;
	node.sfOption = option;
	return node;
}

function commandRows() {
	return [
		['/start', 'старт', _('Shows available commands.')],
		['/help', 'помощь, help', _('Shows available commands.')],
		['/status', 'статус', _('Shows Sheepfold and router status.')],
		['/devices', 'показать все устройства, устройства', _('Shows all detected devices with Sheepfold IDs.')],
		['/internet_on', 'включить интернет, интернет включён', _('Turns global blocking off.')],
		['/internet_off', 'отключить интернет, выключить интернет, интернет отключен', _('Turns on global blocking for everyone except the allowlist.')],
		['/wifi_status', 'статус Wi-Fi, статус вайфай', _('Shows whether Wi-Fi is enabled.')],
		['/wifi_on', 'включить Wi-Fi, включить вайфай', _('Turns router Wi-Fi on.')],
		['/wifi_off', 'отключить Wi-Fi, выключить вайфай', _('Turns router Wi-Fi off; use carefully.')],
		['/support', 'саппорт, поддержка', _('Shows what to prepare before asking for support.')],
		['/grant_time #3 30', 'дать #3 30 минут, +30 #3', _('Grants temporary access to the selected device.')],
		['/block_device #3', 'заблокировать #3', _('Blocks the selected device.')],
		['/unblock_device #3', 'разблокировать #3', _('Removes blocking from the selected device.')],
		['/allowlist_add #3', 'добавить #3 в белый список', _('Adds the selected device to the allowlist.')],
		['/blocklist_add #3', 'добавить #3 в чёрный список', _('Adds the selected device to the blocklist.')],
		['/logs', 'журнал, показать журнал', _('Shows recent administrative log entries.')],
		['/clear_logs', 'очистить журнал', _('Clears the administrative log after confirmation.')],
		['/update', 'обновить приложение', _('Checks and installs an update after confirmation.')],
		['/reboot', 'перезагрузить роутер', _('Reboots the router after confirmation.')],
		['/emergency_sites', 'аварийно-полезные сайты', _('Shows configured emergency-useful sites.')]
	];
}

function commandList() {
	return E('div', { 'class': 'sf-command-list sf-command-list-wide' }, commandRows().map(function (command) {
		return E('div', { 'class': 'sf-command-item' }, [
			E('code', {}, command[0]),
			E('span', { 'class': 'sf-command-aliases' }, command[1]),
			E('span', { 'class': 'sf-command-description' }, command[2])
		]);
	}));
}

function settingsBox(deps) {
	var activeValue = deps.get('active_messenger', 'none');
	var vkToken = field(deps, _('VK community access token'), 'vk_access_token', '', _('Stored on the router.'), true);
	var vkCommunity = field(deps, _('VK community ID'), 'vk_community_id', 'club123456789', '', false);
	var vkAdmin = field(deps, _('VK admin user ID'), 'vk_admin_user_id', '123456789', _('Sheepfold accepts messenger commands only from the administrator ID entered here. Other users are ignored.'), false);
	var telegramToken = field(deps, _('Telegram bot token'), 'telegram_bot_token', '123456:ABC...', _('Stored on the router.'), true);
	var telegramAdmin = field(deps, _('Telegram admin chat ID'), 'telegram_admin_chat_id', '123456789', _('Sheepfold accepts messenger commands only from the administrator ID entered here. Other users are ignored.'), false);
	var fields = [vkToken, vkCommunity, vkAdmin, telegramToken, telegramAdmin];
	var select;
	var initialOptions;
	var confirmedOptions = null;
	var saving = false;
	var testing = false;
	var statusText = E('span', {}, activeValue === 'none' ? _('Messenger disabled.') : _('Messenger status will be checked after saving settings or sending a test message.'));
	var statusPlaque = E('div', {
		'class': 'sf-messenger-status ' + (activeValue === 'none' ? 'sf-messenger-status-muted' : 'sf-messenger-status-idle')
	}, [E('span', { 'class': 'sf-messenger-status-label' }, _('Messenger connection status')), statusText]);

	function collectOptions() {
		var options = { active_messenger: select.value };
		fields.forEach(function (item) { options[item.sfOption] = item.sfInput.value.trim(); });
		return options;
	}

	function setStatus(kind, message) {
		statusPlaque.className = 'sf-messenger-status sf-messenger-status-' + kind;
		statusText.textContent = message || _('Connection check failed.');
	}

	function fallbackStatus(value) {
		if (value === 'telegram') return _('No response from Telegram server.');
		if (value === 'vk') return _('No response from VK server.');
		return _('Messenger disabled.');
	}

	function hasEdits() {
		return !deps.sameValues(initialOptions, collectOptions());
	}

	function submittedOptions(options) {
		var saved = { active_messenger: options.active_messenger };
		var keys = options.active_messenger === 'telegram' ? ['telegram_bot_token', 'telegram_admin_chat_id'] :
			(options.active_messenger === 'vk' ? ['vk_access_token', 'vk_community_id', 'vk_admin_user_id'] : []);
		keys.forEach(function (key) { saved[key] = options[key]; });
		return saved;
	}

	function acceptSaved() {
		// Ответ подтверждает отправленные поля, а не поздний ввод или скрытые
		// настройки другого мессенджера, которых эта команда не сохраняла.
		Object.keys(confirmedOptions || {}).forEach(function (key) {
			initialOptions[key] = confirmedOptions[key];
		});
	}

	function edited() {
		setStatus('idle', hasEdits() ? _('Messenger settings have unsaved changes. Press Save before testing the connection.') :
			_('Messenger status will be checked after saving settings or sending a test message.'));
		deps.changed();
	}

	function showResult(options, kind, message) {
		// Поздний сетевой ответ относится к снимку запроса, не к новым полям.
		if (deps.sameValues(options, collectOptions()))
			setStatus(kind, message);
	}

	function checkedExec(result, message) {
		if (!result || typeof result.code !== 'number')
			throw new Error(message);
		return deps.ensureOk(result, message);
	}

	function readStatus() {
		return deps.routerControl(['messenger-status']).then(function (result) {
			var status = deps.parseOutput(result.stdout || '');
			if (!/^(none|vk|telegram)$/.test(status.active || ''))
				throw new Error(_('Could not read saved messenger settings. Refresh the page before trying again.'));
			return status;
		});
	}

	function checkConnection(options) {
		if (options.active_messenger === 'none') {
			showResult(options, 'muted', _('Messenger disabled.'));
			return Promise.resolve(null);
		}

		showResult(options, 'checking', _('Checking messenger connection...'));
		return deps.routerControl(['messenger-check']).then(function (result) {
			var status = deps.parseOutput(result.stdout || '');
			showResult(options, status.status === 'connected' ? 'ok' : 'warning', status.message || fallbackStatus(options.active_messenger));
			return status;
		}, function () {
			// Не извлекаем «connected» из частичного вывода неуспешной команды.
			showResult(options, 'warning', fallbackStatus(options.active_messenger));
			return null;
		});
	}

	function saveOptions() {
		if (testing)
			return Promise.reject(new Error(_('Wait for the test message to finish, then save messenger settings.')));
		var options = collectOptions();
		var args = options.active_messenger === 'telegram' ?
			['messenger-save-telegram', options.telegram_bot_token || '', options.telegram_admin_chat_id || ''] :
			(options.active_messenger === 'vk' ?
				['messenger-save-vk', options.vk_access_token || '', options.vk_community_id || '', options.vk_admin_user_id || ''] :
				['messenger-disable']);
		confirmedOptions = null;
		saving = true;

		return Promise.resolve().then(function () {
			return deps.routerControl(args);
		}).then(function () {
			confirmedOptions = submittedOptions(options);
			acceptSaved();
			return fs.exec('/etc/init.d/sheepfold', ['restart']);
		}).then(function (result) {
			checkedExec(result, _('Could not restart Sheepfold after saving messenger settings.'));
			return readStatus();
		}).then(function (status) {
			if (status.active !== options.active_messenger)
				throw new Error(_('Messenger settings were sent to the router, but the router still reports another active messenger. Reinstall the latest Sheepfold package and check UCI config.') + ' ' + _('Router reports active messenger:') + ' ' + status.active);
			return checkConnection(options).then(function () { return status; });
		}).catch(function (value) {
			var error = value && typeof value === 'object' ? value : new Error(String(value));
			// Успешный backend-save уже выполнен. Отказ restart/readback не должен
			// объявлять всю запись несделанной или повторно принимать поздний ввод.
			if (confirmedOptions) {
				error.persisted = true;
				error.runtimeApplied = false;
			}
			throw error;
		}).finally(function () {
			saving = false;
		});
	}

	var vkFields = E('div', { 'class': 'sf-messenger-fields' }, [
		E('div', { 'class': 'sf-note' }, _('Create a VK community, enable messages, create an access token for community messages, then enter the community ID and the VK user ID of the parent whose commands are allowed.')),
		vkToken, vkCommunity, vkAdmin
	]);
	var telegramFields = E('div', { 'class': 'sf-messenger-fields' }, [
		E('div', { 'class': 'sf-note' }, _('Telegram setup short note')),
		E('details', { 'class': 'sf-note' }, [
			E('summary', {}, _('Step-by-step Telegram setup')),
			E('ol', {}, [
				_('Open Telegram and find the official @BotFather account. Check the username carefully: @BotFather.'),
				_('Press Start or send /start.'), _('Send /newbot and follow BotFather questions.'),
				_('Enter a visible bot name, for example Sheepfold Home. This name is shown in Telegram.'),
				_('Enter a unique bot username. It must end with bot, for example my_sheepfold_home_bot.'),
				_('BotFather will send a token that looks like 123456:ABC-DEF... Copy it into the Telegram bot token field. Treat this token like a password.'),
				_('Select Telegram as the active messenger and save settings in Sheepfold.'),
				_('Open the created bot from the parent Telegram account and send any message to it. If the chat ID field is empty, Sheepfold will reply with your chat ID.'),
				_('Copy that chat ID into the Telegram admin chat ID field and save settings again.'),
				_('Press the test message button. If everything is correct, the bot will send a message from the router.')
			].map(function (text) { return E('li', {}, text); })),
			E('p', {}, _('Keep the bot private. Do not publish its token, do not add it to public groups, and do not give the token to children.')),
			E('p', {}, E('a', { 'href': 'https://core.telegram.org/bots/tutorial', 'target': '_blank', 'rel': 'noopener noreferrer' }, _('Official Telegram guide')))
		]),
		telegramToken, telegramAdmin,
		E('div', { 'class': 'sf-note' }, _('Russian phrases like "help", "status", "show all devices", "turn internet off", and "support" also work. Dangerous commands require confirmation. Commands are accepted only from the allowed user ID configured on the router.')),
		E('button', {
			'class': 'sf-action sf-action-positive sf-action-nowrap',
			'click': function (event) {
				event.preventDefault();
				// Тест — не альтернативная кнопка Save: реквизиты и выбранный
				// мессенджер меняются только явным сохранением родителя.
				if (saving || hasEdits() || initialOptions.active_messenger !== 'telegram') {
					deps.notify(_('Save messenger settings and select Telegram before sending a test message.'), 'warning');
					return Promise.resolve(false);
				}
				if (testing)
					return Promise.resolve(false);
				var options = collectOptions();
				// После завершения обработчика браузер очищает event.currentTarget
				var button = event.currentTarget;
				testing = true;
				return Promise.resolve().then(function () {
					showResult(options, 'checking', _('Checking messenger connection...'));
					return deps.command({
						key: 'messenger-telegram-test',
						button: button,
						task: function () {
							return fs.exec('/usr/libexec/sheepfold/sheepfold-telegram-bot', ['send-test']).then(function (result) {
								return checkedExec(result, _('Could not send test Telegram message. Check bot token, chat ID, internet access on the router, and that Telegram is selected as the active messenger.'));
							});
						},
						successMessage: _('Test Telegram message sent.'),
						errorMessage: _('Could not send test Telegram message. Check bot token, chat ID, internet access on the router, and that Telegram is selected as the active messenger.'),
						onSuccess: function () { showResult(options, 'ok', _('Telegram connected.')); },
						onError: function () { showResult(options, 'warning', _('No response from Telegram server.')); }
					});
				}).catch(function () { return null; }).finally(function () { testing = false; });
			}
		}, _('Send test Telegram message')),
		E('div', { 'class': 'sf-messenger-command-box' }, [E('h4', {}, _('Commands')), commandList()])
	]);

	select = E('select', {
		'class': 'cbi-input-select',
		'change': function (event) {
			activeValue = event.currentTarget.value;
			setVisibility(activeValue);
			setStatus(activeValue === 'none' ? 'muted' : 'idle', activeValue === 'none' ? _('Messenger disabled.') : _('Messenger status will be checked after saving settings or sending a test message.'));
			deps.changed();
		}
	}, [['none', _('Disabled')], ['vk', 'VK'], ['telegram', 'Telegram']].map(function (item) {
		return E('option', { 'value': item[0], 'selected': item[0] === activeValue ? 'selected' : null }, item[1]);
	}));

	function setVisibility(value) {
		vkFields.hidden = value === 'vk' ? null : 'hidden';
		telegramFields.hidden = value === 'telegram' ? null : 'hidden';
	}

	setVisibility(activeValue);
	initialOptions = collectOptions();
	fields.forEach(function (item) {
		item.sfInput.addEventListener('input', edited);
		item.sfInput.addEventListener('change', edited);
	});
	deps.registerSaver({
		isChanged: hasEdits,
		save: saveOptions,
		accept: acceptSaved
	});

	return E('div', { 'class': 'sf-box' }, [
		E('label', { 'class': 'sf-field sf-field-wide' }, [E('span', {}, _('Active messenger')), select]),
		statusPlaque, vkFields, telegramFields
	]);
}

return baseclass.extend({
	commandRows: commandRows,
	commandList: commandList,
	settingsBox: settingsBox
});
