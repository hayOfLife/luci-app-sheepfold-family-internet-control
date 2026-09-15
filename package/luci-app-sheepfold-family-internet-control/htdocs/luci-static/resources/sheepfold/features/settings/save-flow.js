'use strict';
'require baseclass';

/* §frontmod §ovfinal1 §ovaudit3
 * Владеет общим жизненным циклом сохранения Settings. Успешно записанные параметры
 * и специальные savers принимаются немедленно, поэтому более поздняя ошибка
 * не заставит UI выдавать уже применённые изменения за несохранённый черновик.
 */
function create(deps) {
	var currentSave = null;

	function asError(value) {
		var error;
		if (value && typeof value === 'object')
			return value;
		error = new Error(String(value == null ? 'settings_save_failed' : value));
		error.cause = value;
		return error;
	}

	function persistedError(error, persisted) {
		error = asError(error);
		if (!persisted)
			return error;
		error.persisted = true;
		if (error.runtimeApplied == null)
			error.runtimeApplied = false;
		return error;
	}

	function executeSave(options, savers) {
		var hasOptions = Object.keys(options).length > 0;
		var persisted = false;
		var optionsAccepted = false;
		var completedSavers = [];

		if (!hasOptions && !savers.length) {
			deps.notify(_('No settings changes to save.'), 'info');
			return Promise.resolve({ changed: false, persisted: false });
		}
		try {
			deps.persistence.validate(options);
		} catch (error) {
			var validationError = asError(error);
			deps.notify(validationError.message, 'warning');
			return Promise.reject(validationError);
		}

		// Подключаем catch/finally до первого изменяющего callback: синхронный
		// отказ persistence/UI не должен оставлять обе кнопки Save заблокированными.
		return Promise.resolve().then(function () {
			deps.draft.setSaving(true);
			deps.updateButtons();
			return hasOptions ? deps.persistence.save(options) : null;
		}).then(function () {
			if (hasOptions) {
				persisted = true;
				optionsAccepted = true;
				deps.draft.acceptOptions(options);
			}
			return hasOptions ? deps.applyRuntime(options) : null;
		}).then(function () {
			return savers.reduce(function (chain, saver) {
				return chain.then(function () {
					var result;
					try { result = saver.save(); } catch (error) { result = Promise.reject(error); }
					return Promise.resolve(result).then(function () {
						persisted = true;
						completedSavers.push(saver);
						if (saver.accept)
							saver.accept();
					}, function (error) {
						error = asError(error);
						// Некоторые специальные savers сначала коммитят UCI и могут
						// упасть лишь при обновлении runtime. Принимаем их записанный
						// черновик, чтобы повтор не выполнил ту же мутацию ещё раз.
						if (error.persisted) {
							persisted = true;
							completedSavers.push(saver);
							if (saver.accept)
								saver.accept();
						}
						throw error;
					});
				});
			}, Promise.resolve());
		}).then(function () {
			return deps.applyPostSave(options);
		}).then(function () {
			deps.notifyCentered(_('Settings saved successfully.'));
			return {
				changed: true,
				persisted: persisted,
				runtimeApplied: true,
				completedSpecialSavers: completedSavers.length
			};
		}).catch(function (error) {
			error = persistedError(error, persisted || !!(error && error.persisted));
			error.completedSpecialSavers = completedSavers.length;
			error.totalSpecialSavers = savers.length;
			if (error.persisted) {
				// Post-save ошибка не владеет вводом, сделанным во время runtime.
				// Частично успешный общий saver принимает только свой снимок и один раз.
				if (hasOptions && !optionsAccepted) {
					optionsAccepted = true;
					deps.draft.acceptOptions(options);
				}
				deps.notify(
					_('Settings were saved, but some router services could not be refreshed.') + ' ' +
						deps.errorText(error, ''),
					'warning'
				);
			} else {
				deps.notify(_('Could not save settings.') + ' ' + deps.errorText(error, ''), 'warning');
			}
			throw error;
		}).finally(function () {
			deps.draft.setSaving(false);
			deps.updateButtons();
		});
	}

	function save() {
		if (currentSave)
			return currentSave;

		currentSave = Promise.resolve().then(function () {
			var options = deps.draft.snapshot();
			var savers = deps.draft.dirtySavers();
			var has = function (key) { return Object.prototype.hasOwnProperty.call(options, key); };
			var mode = has('wifi_auto_disable_mode') ? options.wifi_auto_disable_mode : deps.value('wifi_auto_disable_mode', 'never');
			var time = has('wifi_auto_disable_time') ? options.wifi_auto_disable_time : deps.value('wifi_auto_disable_time', '23:00');

			// Подтверждение времени относится к этому снимку, не к изменившемуся
			// во время диалога черновику. Поздние опции остаются для следующего Save.
			if ((has('wifi_auto_disable_mode') || has('wifi_auto_disable_time')) && mode === 'time')
				return Promise.resolve(deps.confirmWifiAutoDisable(time)).then(function (confirmed) {
					return confirmed ? executeSave(options, savers) : { changed: false, cancelled: true, persisted: false };
				});
			return executeSave(options, savers);
		}).finally(function () { currentSave = null; });
		return currentSave;
	}

	function bar(top) {
		return E('div', { 'class': 'sf-settings-save-bar' + (top ? ' sf-settings-save-bar-top' : '') }, [
			E('span', {
				'class': 'sf-settings-dirty-note',
				'data-settings-dirty-note': '1',
				'hidden': 'hidden'
			}, _('Settings have unsaved changes. Press Save to apply them.')),
			E('button', {
				'class': 'sf-action sf-action-positive sf-action-nowrap',
				'data-settings-save': '1',
				'click': function (event) {
					event.preventDefault();
					save().catch(function () { return null; });
				}
			}, _('Save settings'))
		]);
	}

	return { save: save, bar: bar, isSaving: function () { return !!currentSave; } };
}

return baseclass.extend({ create: create });
