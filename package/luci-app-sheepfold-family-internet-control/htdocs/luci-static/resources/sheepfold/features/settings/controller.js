'use strict';
'require baseclass';
'require sheepfold.features.settings.fields as settingsFieldsModel';
'require sheepfold.features.settings.misc as settingsMiscModel';
'require sheepfold.features.settings.storage as settingsStorageModel';
'require sheepfold.features.settings.home-network as homeNetworkModel';
/* SHEEPFOLD_AI_BEGIN */
'require sheepfold.features.settings.ai as settingsAiModel';
/* SHEEPFOLD_AI_END */
'require sheepfold.features.settings.save-flow as settingsSaveFlowModel';

/* §frontmod §ovfinal1
 * Контроллер Settings отвечает за представление вкладок и общий жизненный цикл
 * сохранения. Адаптеры persistence, runtime-эффекты и профильные панели передаются
 * ему явно.
 */
function create(deps) {
	var fields = settingsFieldsModel.create({
		value: deps.value,
		sectionValue: deps.sectionValue,
		setOption: deps.setOption,
		setSectionOption: deps.setSectionOption,
		checkbox: deps.forms.checkboxControl,
		icon: deps.icon,
		defaultLogCachePath: deps.defaultLogCachePath
	});
	var integrationUi = {
		run: deps.run,
		icon: deps.icon,
		isDirty: deps.draft.isDirty,
		value: deps.value,
		setOption: deps.setOption,
		setOptions: deps.setOptions,
		checkbox: deps.forms.checkboxControl,
		sectionInput: fields.sectionInputField,
		divider: fields.settingsDivider,
		compactStatus: function () { return deps.siteListStatus.compactPanel(); }
	};
	var miscPanel = settingsMiscModel.create({
		fields: fields,
		value: deps.value,
		setOption: deps.setOption,
		setOptions: deps.setOptions,
		accessSteps: deps.accessSteps,
		defaultSiteAllowlistSources: deps.defaultSiteAllowlistSources,
		defaultSiteBlocklistSources: deps.defaultSiteBlocklistSources,
		timeSettings: function () { return deps.timeSettings.render(); },
		ipv6Field: function () { return deps.integrationPanel.ipv6Field(integrationUi); },
		siteStatus: function () { return deps.siteListStatus.panel(); },
		importSettings: function () { return deps.backup.panel().importAll(); },
		exportSettings: function () { return deps.backup.panel().exportAll(); },
		updateRow: function () { return deps.routerMaintenance.updateRow(deps.notify); },
		rebootButton: function () { return deps.routerMaintenance.rebootButton(deps.notify); }
	});
	var storageView = settingsStorageModel.create({
		fields: fields,
		storagePanel: function () { return deps.storagePanel.render(); }
	});
	/* SHEEPFOLD_AI_BEGIN */
	var aiView = settingsAiModel.create({
		fields: fields,
		value: deps.value,
		setOption: deps.setOption
	});
	/* SHEEPFOLD_AI_END */
	var saveFlow = settingsSaveFlowModel.create({
		draft: deps.draft,
		persistence: deps.persistence,
		applyRuntime: deps.sideEffects.apply,
		applyPostSave: deps.sideEffects.applyPostSave,
		value: deps.globalValue,
		updateButtons: updateSaveButtons,
		notify: deps.notify,
		notifyCentered: deps.notifyCentered,
		errorText: deps.errorText,
		confirmWifiAutoDisable: miscPanel.confirmWifiAutoDisable
	});

	function updateSaveButtons() {
		var dirty = deps.draft.isDirty();
		document.querySelectorAll('[data-settings-save]').forEach(function (button) {
			button.disabled = deps.draft.isSaving() ? true : null;
			button.classList.toggle('sf-action-muted', !dirty);
		});
		document.querySelectorAll('[data-settings-dirty-note]').forEach(function (node) {
			node.hidden = dirty ? null : 'hidden';
		});
	}

	function renderGeneral() {
		return deps.generalModel.render({
			checkbox: deps.forms.checkboxControl,
			confirm: deps.confirm,
			setBetaOptions: function (options) {
				deps.setOptions(options);
				// Обе вкладки уже отрисованы, поэтому обновляем и видимые значения уведомлений
				Object.keys(options).forEach(function (option) {
					document.querySelectorAll('select[data-setting-option="' + option + '"]').forEach(function (input) {
						input.value = options[option];
					});
				});
			},
			value: deps.value,
			setOption: deps.setOption,
			setOptions: deps.setOptions,
			selectField: fields.saveSelectGlobalField,
			textareaField: fields.globalTextareaOptionField,
			divider: fields.settingsDivider,
			detectionTools: deps.detectionTools,
			timeSettings: deps.timeSettings,
			timeSetupNotice: deps.timeSettings.notice
		});
	}

	function renderBot() {
		return E('div', { 'class': 'sf-settings-section' }, [
			E('p', { 'class': 'sf-section-intro' },
				_('Messenger integration lets approved parents receive notifications and control Sheepfold with short commands when they are away from home.')),
			deps.messengerSettings.settingsBox({
				get: deps.globalValue,
				icon: deps.icon,
				routerControl: deps.run,
				command: deps.actions.execute,
				ensureOk: deps.actions.ensureOk,
				parseOutput: deps.parseKeyValues,
				errorText: deps.errorText,
				notify: deps.notify,
				changed: updateSaveButtons,
				registerSaver: deps.draft.registerSaver,
				sameValues: deps.sameValues
			})
		]);
	}

	function renderNotifications() {
		return deps.notificationSettings.render({
			selectField: fields.saveSelectGlobalField,
			clearWifiHistory: function (button) {
				if (!deps.confirm(_('Delete the saved list of child-device Wi-Fi networks and their locations?')))
					return Promise.resolve(false);
				return deps.actions.execute({
					key: 'child-wifi-history-clear',
					button: button,
					args: ['child-wifi-history-clear'],
					successMessage: _('Saved Wi-Fi network history cleared.'),
					errorMessage: _('Could not clear saved Wi-Fi network history.')
				}).then(function () { return true; }).catch(function () { return false; });
			}
		});
	}

	function renderFeedback() {
		return deps.feedbackPanel.render({
			runAction: deps.run,
			runCommand: deps.run,
			parseOutput: deps.parseKeyValues,
			notify: deps.notify,
			errorText: deps.errorText
		});
	}

	function panel(tab, content, activeTab) {
		return E('div', {
			'class': 'sf-settings-panel',
			'data-settings-panel': tab,
			'hidden': activeTab === tab ? null : 'hidden'
		}, content);
	}

	function tabRow(tabs, activeTab, onSelect, extraClass) {
		return E('div', {
			'class': 'sf-tabs sf-settings-tabs' + (extraClass ? ' ' + extraClass : '')
		}, tabs.map(function (tab) {
			var icon = tab[2] ? deps.icon(tab[2]) : null;
			if (icon)
				icon.classList.add('sf-tab-icon');
			return E('button', {
				'class': 'sf-tab sf-settings-tab' + (activeTab === tab[0] ? ' active' : ''),
				'data-settings-tab': tab[0],
				'click': function (event) {
					event.preventDefault();
					onSelect(event.currentTarget, tab[0]);
				}
			}, [icon || '', E('span', { 'class': 'sf-tab-label' }, _(tab[1]))]);
		}));
	}

	function switchTab(button, tab) {
		var panelRoot = button.closest('.sf-panel');
		deps.navigation.selectSettings(tab);
		panelRoot.querySelectorAll('.sf-settings-tab').forEach(function (node) {
			node.classList.toggle('active', node.getAttribute('data-settings-tab') === tab);
		});
		panelRoot.querySelectorAll('.sf-settings-panel').forEach(function (node) {
			node.hidden = node.getAttribute('data-settings-panel') !== tab;
		});
		if (tab === 'info' && deps.routerInfo.status() !== 'loading')
			deps.routerInfo.load(deps.routerInfo.status() !== 'ready').catch(function () { return null; });
	}

	function render() {
		var state = deps.navigation.snapshot();
		var active = deps.navigationModel.isKnownSettingsTab(state.activeSettingsTab) ? state.activeSettingsTab : 'general';
		if (active !== state.activeSettingsTab)
			deps.navigation.selectSettings(active);
		deps.draft.reset();

		return E('div', { 'class': 'sf-panel' }, [
			E('div', { 'class': 'sf-settings-tabs-row' }, [
				E('div', { 'class': 'sf-settings-tabs-wrap' }, [
					tabRow(deps.navigationModel.settingsPrimaryTabs(), active, switchTab),
					tabRow(deps.navigationModel.settingsSecondaryTabs(), active, switchTab, 'sf-settings-tabs-secondary')
				])
			]),
			E('div', { 'class': 'sf-settings-tabs-separator', 'aria-hidden': 'true' }),
			saveFlow.bar(true),
			panel('info', deps.routerInfo.panel(), active),
			panel('general', renderGeneral(), active),
			panel('integrations', [deps.integrationPanel.render(integrationUi), homeNetworkModel.render({
				run: deps.run, icon: deps.icon, registerSaver: deps.draft.registerSaver, changed: updateSaveButtons
			})], active),
			panel('messenger', renderBot(), active),
			panel('notifications', renderNotifications(), active),
			panel('emergency', deps.emergency.render(), active),
			panel('misc', miscPanel.render(), active),
			panel('feedback', renderFeedback(), active),
			/* SHEEPFOLD_AI_BEGIN */
			panel('ai', aiView.render(), active),
			/* SHEEPFOLD_AI_END */
			panel('storage', storageView.render(), active),
			saveFlow.bar(false)
		]);
	}

	return {
		fields: fields,
		integrationUi: function () { return integrationUi; },
		updateSaveButtons: updateSaveButtons,
		saveNow: saveFlow.save,
		renderWifiAutomation: miscPanel.renderWifiAutomation,
		renderSaveBar: saveFlow.bar,
		switchTab: switchTab,
		render: render
	};
}

return baseclass.extend({ create: create });
