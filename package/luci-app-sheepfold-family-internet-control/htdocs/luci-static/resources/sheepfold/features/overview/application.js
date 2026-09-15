'use strict';
'require baseclass';
'require uci';
'require ui';
'require fs';
'require rpc';
'require sheepfold.i18n as sheepfoldI18n';
'require sheepfold.core.backend.router as routerBackend';
'require sheepfold.core.backend.actions as commandActionsModel';
'require sheepfold.core.persistence.uci as uciPersistenceModel';
'require sheepfold.core.security.random as secureRandom';
'require sheepfold.features.overview.store as overviewStoreModel';
'require sheepfold.features.overview.environment as overviewEnvironmentModel';
'require sheepfold.features.navigation.state as navigationStateModel';
'require sheepfold.features.page.refresh as pageRefreshModel';
'require sheepfold.features.page.shell as pageShellModel';
'require sheepfold.features.router.discovery as routerDiscovery';
'require sheepfold.features.router.info as routerInfo';
'require sheepfold.features.router.maintenance as routerMaintenance';
'require sheepfold.features.administrators.model as administratorModel';
'require sheepfold.features.administrators.view as administratorView';
'require sheepfold.features.administrators.editor as administratorEditor';
'require sheepfold.features.administrators.controller as administratorControllerModel';
'require sheepfold.features.devices.access-lists as deviceAccessLists';
'require sheepfold.features.devices.editor as deviceEditor';
'require sheepfold.features.devices.inventory as deviceInventory';
'require sheepfold.features.devices.persistence as devicePersistenceModel';
'require sheepfold.features.devices.quick-allowlist as quickAllowlistModel';
'require sheepfold.features.devices.selection as deviceSelection';
'require sheepfold.features.devices.table as deviceTableModel';
'require sheepfold.features.devices.type-control as deviceTypeControlModel';
'require sheepfold.features.devices.types as deviceTypes';
'require sheepfold.features.devices.controller as deviceControllerModel';
'require sheepfold.features.devices.detection-tools as detectionToolsModel';
'require sheepfold.features.groups.model as groupModel';
'require sheepfold.features.groups.naming as groupNamingModel';
'require sheepfold.features.groups.view as groupView';
'require sheepfold.features.groups.editor as groupEditor';
'require sheepfold.features.groups.persistence as groupPersistenceModel';
'require sheepfold.features.groups.controller as groupControllerModel';
'require sheepfold.features.schedules.model as scheduleModel';
'require sheepfold.features.schedules.view as scheduleView';
'require sheepfold.features.schedules.editor as scheduleEditor';
'require sheepfold.features.schedules.persistence as schedulePersistenceModel';
'require sheepfold.features.schedules.controller as scheduleControllerModel';
'require sheepfold.features.pairing.qr as pairingQr';
'require sheepfold.features.pairing.persistence as pairingPersistenceModel';
'require sheepfold.features.wifi.cards as wifiCards';
'require sheepfold.features.wifi.editor as wifiEditorModel';
'require sheepfold.features.wifi.payload as wifiPayload';
'require sheepfold.features.wifi.persistence as wifiPersistenceModel';
'require sheepfold.features.wifi.controller as wifiControllerModel';
'require sheepfold.features.emergency.sites as emergencySiteModel';
'require sheepfold.features.emergency.panel as emergencyPanelModel';
'require sheepfold.features.feedback.panel as feedbackPanel';
'require sheepfold.features.integrations.panel as integrationPanel';
'require sheepfold.features.logs.panel as logPanelModel';
'require sheepfold.features.messenger.settings as messengerSettings';
'require sheepfold.features.notifications.settings as notificationSettings';
'require sheepfold.features.settings.backup as settingsBackupModel';
'require sheepfold.features.settings.backup-panel as settingsBackupPanelModel';
'require sheepfold.features.settings.backup-persistence as backupPersistenceModel';
'require sheepfold.features.settings.backup-controller as settingsBackupControllerModel';
'require sheepfold.features.settings.draft as settingsDraftModel';
'require sheepfold.features.settings.persistence as settingsPersistenceModel';
'require sheepfold.features.settings.side-effects as settingsSideEffectsModel';
'require sheepfold.features.settings.time as settingsTimeModel';
'require sheepfold.features.settings.general as settingsGeneralModel';
'require sheepfold.features.settings.controller as settingsControllerModel';
'require sheepfold.features.sites.status as siteListStatus';
'require sheepfold.features.storage.panel as storagePanelModel';
'require sheepfold.shared.forms as sharedForms';
'require sheepfold.shared.icons as sharedIcons';
'require sheepfold.shared.downloads as downloads';

/* §frontmod §ovfinal1
 * Этот файл намеренно остаётся корнем композиции. Состояние функций, насыщенные
 * DOM представления, сохранение и побочные эффекты роутера живут в перечисленных
 * выше профильных модулях.
 */
var NOT_CONFIGURED_GROUP = 'Not configured';
var DEFAULT_LOG_CACHE_PATH = '/tmp/sheepfold/events.log';
var DEFAULT_SITE_ALLOWLIST_SOURCES = [
	'UT1 child | https://dsi.ut-capitole.fr/blacklists/download/child.tar.gz'
].join('\n');
var DEFAULT_SITE_BLOCKLIST_SOURCES = [
	'HaGeZi NSFW | https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/nsfw.txt',
	'HaGeZi Gambling mini | https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/gambling.mini.txt',
	'HaGeZi Threat Intelligence mini | https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/tif.mini.txt',
	'URLhaus malware domains | https://urlhaus.abuse.ch/downloads/hostfile/'
].join('\n');
var ACCESS_STEPS = [
	['no_restrictions', 'No restrictions group'],
	['blocklist', 'Blocklist'],
	['admin_devices', 'Admin devices'],
	['allowlist', 'Allowlist'],
	['global_block', 'Global internet block'],
	['temp_access', 'Temporary access'],
	['device_schedule', 'Device schedule'],
	['group_schedule', 'Group schedule'],
	['default_access', 'Default access']
];

var callUciRevert = rpc.declare({
	object: 'uci',
	method: 'revert',
	params: ['config'],
	reject: true
});

var store = overviewStoreModel.create();
var environment = overviewEnvironmentModel.create({
	uci: uci,
	ui: ui,
	fs: fs,
	routerBackend: routerBackend,
	routerInfo: routerInfo,
	icons: sharedIcons,
	pairingQr: pairingQr
});
var navigation = navigationStateModel.create();
var uciPersistence = uciPersistenceModel.create({
	uci: uci,
	applyTimeout: 10,
	setTimeout: window.setTimeout.bind(window),
	revert: function (configs) {
		return Promise.all((configs || []).map(function (config) { return callUciRevert(config); }));
	}
});
var commandActions = commandActionsModel.create({
	run: routerBackend.run,
	withTimeout: routerBackend.withTimeout,
	ensureOk: routerBackend.ensureOk,
	errorText: routerBackend.errorText,
	actionMetadata: routerBackend.actionMetadata,
	notify: environment.notify,
	parseKeyValues: routerBackend.parseKeyValues
});

var administratorController = null;
var deviceController = null;
var wifiController = null;
var scheduleController = null;
var groupController;
var settingsController = null;
var storagePanelInstance = null;

function runCommand(args, options) {
	return commandActions.run(args || [], options || {});
}

function settingValueFactory(draft) {
	return function (option, fallback) {
		return draft.has(option) ? draft.get(option) : environment.get('sheepfold', 'global', option, fallback || '');
	};
}

function sectionValueFactory(draft) {
	return function (section, option, fallback) {
		var key = section + '.' + option;
		return draft.has(key) ? draft.get(key) : environment.get('sheepfold', section, option, fallback || '');
	};
}

var pageRefresh = pageRefreshModel.create({
	page: function () { return document.querySelector('.sf-page'); },
	view: store.activeView,
	devices: store.devices
});
var groupNaming = groupNamingModel.create({
	uci: uci,
	get: environment.get,
	sections: environment.sections,
	notConfigured: NOT_CONFIGURED_GROUP,
	groupModel: groupModel,
	normalizeMac: deviceInventory.normalizeMac,
	reservedListSection: deviceInventory.reservedListSection,
	generatedSectionName: deviceInventory.generatedSectionName
});
var devicePersistence = devicePersistenceModel.create({
	uci: uci,
	persistence: uciPersistence,
	accessLists: deviceAccessLists,
	normalizeMac: deviceInventory.normalizeMac,
	generatedSectionName: deviceInventory.generatedSectionName,
	normalizeGroupName: groupNaming.normalize,
	notConfiguredGroup: NOT_CONFIGURED_GROUP,
	isAdminDevice: function (device) {
		return administratorController ? administratorController.isAdminDevice(device) : !!(device && device.adminDevice);
	},
	noRestrictionsGroupName: groupNaming.noRestrictionsName,
	personalDevicesGroupName: groupNaming.personalDevicesName,
	markNoRestrictionsExcluded: groupNaming.markNoRestrictionsExcluded,
	markPersonalDevicesExcluded: groupNaming.markPersonalDevicesExcluded,
	run: runCommand,
	action: commandActions.execute,
	ensureOk: environment.ensureOk,
	refreshSiteStatus: function () { return siteListStatus.load(true); },
	invalidMacMessage: function () { return _('Invalid MAC address'); },
	accessRuntimeError: function () { return _('Could not apply internet access rules.'); },
	siteRuntimeError: function () { return _('Could not apply site list policy.'); },
	statusError: function (status) {
		return status === 'allow' ? _('Could not add device to allowlist.') :
			status === 'blocked' ? _('Could not add device to blocklist.') :
			_('Could not update device status.');
	}
});
var wifiPersistence = wifiPersistenceModel.create({ uci: uci, persistence: uciPersistence, exec: environment.exec });
var schedulePersistence = schedulePersistenceModel.create({
	uci: uci,
	persistence: uciPersistence,
	listValues: deviceInventory.listValues,
	newSectionName: function () { return 'schedule_' + Date.now().toString(36); },
	run: runCommand,
	ensureOk: environment.ensureOk,
	runtimeError: function () { return _('Could not apply internet access rules.'); }
});
var groupPersistence = groupPersistenceModel.create({
	uci: uci,
	persistence: uciPersistence,
	groupModel: groupModel,
	devicePersistence: devicePersistence,
	normalizeMac: deviceInventory.normalizeMac,
	normalizeGroupName: groupNaming.normalize,
	notConfiguredGroup: NOT_CONFIGURED_GROUP,
	noRestrictionsGroupName: groupNaming.noRestrictionsName,
	personalDevicesGroupName: groupNaming.personalDevicesName,
	markNoRestrictionsExcluded: groupNaming.markNoRestrictionsExcluded,
	markPersonalDevicesExcluded: groupNaming.markPersonalDevicesExcluded,
	listValues: deviceInventory.listValues,
	isAdminDevice: function (device) { return administratorController ? administratorController.isAdminDevice(device) : !!(device && device.adminDevice); }
});
var pairingPersistence = pairingPersistenceModel.create({
	uci: uci,
	persistence: uciPersistence,
	devicePersistence: devicePersistence,
	normalizeMac: deviceInventory.normalizeMac,
	notConfiguredGroup: NOT_CONFIGURED_GROUP,
	deviceById: function (id) { return deviceController ? deviceController.byId(id) : null; },
	canBind: function (device) { return administratorController ? administratorController.canBind(device) : !!device && device.status !== 'blocked'; },
	listValues: deviceInventory.listValues,
	action: commandActions.execute,
	activateError: function () { return _('Could not prepare the pairing code. Please reopen administrator settings.'); },
	statusError: function () { return _('Could not check administrator pairing status.'); },
	blocklistedError: function () { return _('A blocklisted device cannot become an administrator device. Remove it from the blocklist first.'); },
	boundElsewhereError: function () { return _('This device is already assigned to another administrator.'); }
});
var backupPersistence = backupPersistenceModel.create({
	model: settingsBackupModel,
	uci: uci,
	persistence: uciPersistence,
	refreshRuntime: function () {
		return runCommand(['settings-import-applied']).then(function (result) {
			return environment.ensureOk(result, _('Settings were restored, but router services could not be refreshed.'));
		});
	}
});

var settingsDraft = settingsDraftModel.create(function () {
	if (settingsController)
		settingsController.updateSaveButtons();
});
var settingValue = settingValueFactory(settingsDraft);
var sectionValue = sectionValueFactory(settingsDraft);
var settingsPersistence = settingsPersistenceModel.create({
	uci: uci,
	persistence: uciPersistence,
	normalizeLanguage: sheepfoldI18n.normalizeApplicationLanguage,
	sectionValue: sectionValue,
	accessKeys: ACCESS_STEPS.map(function (item) { return item[0]; })
});
var detectionTools = detectionToolsModel.create({
	mode: function () {
		if (settingValue('auto_configure', '1') !== '1')
			return 'disabled';
		return settingValue('detection_mode', 'full') === 'reduced' ? 'reduced' : 'full';
	},
	status: function () {
		return runCommand(['device-detection-capabilities'], {
			key: 'device-detection-capabilities',
			timeoutMs: 10000,
			timeoutMessage: _('Could not check optional nmap support.')
		}).then(function (result) {
			environment.ensureOk(result, _('Could not check optional nmap support.'));
			return routerBackend.parseKeyValues(result.stdout || '');
		});
	},
	install: function (button) {
		return commandActions.execute({
			key: 'device-detection-install-nmap',
			button: button,
			args: ['device-detection-install-nmap'],
			timeoutMs: 10000,
			timeoutMessage: _('Could not start nmap installation.'),
			silent: true,
			errorMessage: _('Could not start nmap installation.')
		});
	},
	confirm: window.confirm.bind(window),
	errorText: environment.errorText
});
var timeSettings = settingsTimeModel.create({
	systemValue: function (section, option, fallback) { return environment.get('system', section, option, fallback); },
	globalValue: function (option, fallback) { return environment.get('sheepfold', 'global', option, fallback); },
	countryProfile: function () { return settingValue('country_profile', 'ru'); },
	listValues: deviceInventory.listValues,
	checkbox: sharedForms.checkboxControl,
	registerSaver: settingsDraft.registerSaver,
	sameValues: settingsDraftModel.sameValues,
	changed: function () { if (settingsController) settingsController.updateSaveButtons(); },
	status: function () {
		return runCommand(['time-status'], {
			key: 'time-status',
			timeoutMs: 10000,
			timeoutMessage: _('Could not read router time status.')
		}).then(function (result) {
			environment.ensureOk(result, _('Could not read router time status.'));
			return routerBackend.parseKeyValues(result.stdout || '');
		});
	},
	save: function (options) {
		return runCommand([
			'time-save', options.server_enabled, options.client_enabled,
			options.timezone_name, options.timezone, options.servers, options.country_profile
		], {
			key: 'time-save',
			timeoutMs: 30000,
			timeoutMessage: _('Could not save router time settings.')
		}).then(function (result) {
			return environment.ensureOk(result, _('Could not save router time settings.'));
		}).catch(function (error) {
			throw settingsTimeModel.normalizeSaveError(error, routerBackend.parseKeyValues);
		});
	}
});
var emergencyPanel = emergencyPanelModel.create({
	model: emergencySiteModel,
	uci: uci,
	persistence: uciPersistence,
	run: runCommand,
	registerSaver: settingsDraft.registerSaver,
	markChanged: function () { if (settingsController) settingsController.updateSaveButtons(); },
	notify: environment.notify,
	iconButton: environment.iconButton,
	ensureOk: environment.ensureOk,
	runtimeError: function () { return _('Could not apply emergency-useful site rules.'); }
});
var settingsSideEffects = settingsSideEffectsModel.create({
	run: runCommand,
	ensureOk: environment.ensureOk,
	siteCronError: function () { return _('Could not update the site-list schedule.'); },
	sitePolicyError: function () { return _('Could not apply site list policy.'); },
	ledError: function () { return _('Could not apply router LED settings.'); },
	ipv6Error: function () { return _('Could not apply the IPv6 setting.'); },
	scheduleError: function () { return _('Could not apply internet access rules.'); },
	emergencyError: function () { return _('Could not apply emergency-useful site rules.'); },
	discoveryError: function () { return _('Could not update application discovery after changing the application port.'); },
	restartError: function () { return _('Could not restart the Sheepfold service after changing the application port.'); },
	countryProfileError: function () { return _('Could not apply the router country profile.'); },
	refreshSiteStatus: function () { return siteListStatus.load(true); },
	emergencySitesChanged: emergencyPanel.changed,
	writeDiscovery: function (port) {
		return environment.write('/www/.well-known/sheepfold.json', routerDiscovery.discoveryJson(
			port, environment.get('sheepfold', 'global', 'ui_asset_version', '0.1.0')
		));
	},
	restartService: function () { return environment.exec('/etc/init.d/sheepfold', ['restart']); },
	/* SHEEPFOLD_AI_BEGIN */
	ensureAiLogs: function () {
		return environment.exec('/usr/libexec/sheepfold/sheepfold-openssl-ensure', []).then(function (result) {
			if (Number(result && result.code || 0) !== 0)
				throw new Error(_('OpenSSL check failed. Per-device AI logs stay disabled.'));
		});
	},
	/* SHEEPFOLD_AI_END */
	reloadConfig: function (config) { return uciPersistence.reload([config]); },
	refreshEmergencySites: function () {
		emergencyPanel.load(environment.sections('sheepfold', emergencySiteModel.sectionType), true);
	},
	reloadPage: function (delay) {
		return new Promise(function (resolve) {
			window.setTimeout(function () { window.location.reload(); resolve(); }, delay);
		});
	}
});
var logPanel = logPanelModel.create({
	clear: function () {
		var path = environment.get('sheepfold', 'global', 'log_cache_path', DEFAULT_LOG_CACHE_PATH) || DEFAULT_LOG_CACHE_PATH;
		if (!/^\/tmp\/[A-Za-z0-9_./-]+$/.test(path) || path.indexOf('..') !== -1)
			path = DEFAULT_LOG_CACHE_PATH;
		return environment.write(path, '');
	},
	download: downloads.textFile,
	notify: environment.notify
});
var backupController = settingsBackupControllerModel.create({
	sections: environment.sections,
	model: settingsBackupModel,
	persistence: backupPersistence,
	panel: settingsBackupPanelModel,
	exportMode: function () { return settingValue('export_mode', 'safe'); },
	resetDraft: settingsDraft.reset,
	notify: environment.notify,
	notifyCentered: environment.notifyCentered
});
var storagePanelProxy = {
	render: function () {
		if (!storagePanelInstance) {
			storagePanelInstance = storagePanelModel.create({
				settingValue: settingValue,
				setOption: settingsDraft.set,
				sectionInputField: settingsController.fields.sectionInputField,
				sectionSelectField: settingsController.fields.saveSelectSectionField,
				divider: settingsController.fields.settingsDivider,
				routerControl: runCommand,
				errorText: environment.errorText,
				infoValue: environment.infoValue
			});
		}
		return storagePanelInstance.render();
	}
};

wifiController = wifiControllerModel.create({
	cards: wifiCards,
	editor: wifiEditorModel,
	persistence: wifiPersistence,
	sections: environment.sections,
	get: environment.get,
	confirm: window.confirm.bind(window),
	notify: environment.notify,
	errorText: environment.errorText,
	icon: sharedIcons.named,
	palette: groupNaming.palette,
	payload: wifiPayload,
	qrCode: environment.qrCode,
	automationPanel: function () { return settingsController.renderWifiAutomation(); },
	settingsSaveBar: function (top) { return settingsController.renderSaveBar(top); }
});
var deviceTypeControl = deviceTypeControlModel.create({
	byValue: deviceTypes.byValue,
	definitions: deviceTypes.definitions,
	icon: deviceTypes.icon
});
deviceController = deviceControllerModel.create({
	store: store,
	fs: fs,
	inventory: deviceInventory,
	persistence: devicePersistence,
	actions: commandActions,
	accessLists: deviceAccessLists,
	selection: deviceSelection,
	table: deviceTableModel,
	types: deviceTypes,
	typeControl: { control: deviceTypeControl.field },
	editor: deviceEditor,
	quickAllowlist: quickAllowlistModel,
	wifiPayload: wifiPayload,
	discovery: routerDiscovery,
	random: secureRandom,
	groups: groupNaming,
	administrators: function () { return administratorController; },
	wifi: function () { return wifiController; },
	pageRefresh: pageRefresh,
	notConfigured: NOT_CONFIGURED_GROUP,
	get: environment.get,
	sections: environment.sections,
	run: runCommand,
	ensureOk: environment.ensureOk,
	errorText: environment.errorText,
	notify: environment.notify,
	infoValue: environment.infoValue,
	forms: sharedForms,
	iconButton: environment.iconButton,
	identityIcon: environment.identityIcon,
	adminCrown: environment.adminCrown,
	staticLease: environment.staticLease,
	qrCode: environment.qrCode,
	settingLine: environment.settingLine
});
scheduleController = scheduleControllerModel.create({
	model: scheduleModel,
	view: scheduleView,
	editor: scheduleEditor,
	persistence: schedulePersistence,
	actions: commandActions,
	sections: environment.sections,
	get: environment.get,
	listValues: deviceInventory.listValues,
	devices: deviceController.devices,
	deviceById: deviceController.byId,
	displayDeviceId: deviceController.formattedId,
	groups: groupNaming,
	conflictValue: function () { return settingValue('schedule_conflict_internet', 'off') === 'on' ? 'on' : 'off'; },
	refresh: pageRefresh.schedules,
	notify: environment.notify,
	errorText: environment.errorText
});
groupController = groupControllerModel.create({
	model: groupModel,
	view: groupView,
	editor: groupEditor,
	persistence: groupPersistence,
	actions: commandActions,
	naming: groupNaming,
	notConfigured: NOT_CONFIGURED_GROUP,
	sections: environment.sections,
	devices: deviceController.devices,
	createDeviceSelector: function (options) {
		options = Object.assign({}, options || {});
		var originalFilter = options.filter;
		options.filter = function (device) {
			return !deviceController.isAdminDevice(device) && (!originalFilter || originalFilter(device));
		};
		return deviceController.createSelection(options);
	},
	displayDeviceId: deviceController.formattedId,
	listValues: deviceInventory.listValues,
	schedules: function () { return scheduleController; },
	forms: sharedForms,
	iconButton: environment.iconButton,
	notify: environment.notify,
	errorText: environment.errorText,
	refreshDevices: function () { pageRefresh.userLists(); pageRefresh.groups(); }
});
administratorController = administratorControllerModel.create({
	model: administratorModel,
	view: administratorView,
	editor: administratorEditor,
	persistence: pairingPersistence,
	actions: commandActions,
	administrators: store.administrators,
	replaceAdministrators: store.replaceAdministrators,
	devices: deviceController.devices,
	deviceById: deviceController.byId,
	createDeviceSelector: deviceController.createSelection,
	displayDeviceId: deviceController.formattedId,
	normalizeMac: deviceController.normalizeMac,
	isBlocklisted: function (device) {
		return deviceInventory.macInList(
			environment.sections('sheepfold', 'list'),
			'blocklist',
			device && device.mac
		);
	},
	notConfigured: NOT_CONFIGURED_GROUP,
	sections: environment.sections,
	get: environment.get,
	run: runCommand,
	ensureOk: environment.ensureOk,
	parseKeyValues: routerBackend.parseKeyValues,
	errorText: environment.errorText,
	notify: environment.notify,
	notifyCentered: environment.notifyCentered,
	confirm: window.confirm.bind(window),
	reloadDevices: deviceController.reload,
	refreshDevices: function () { pageRefresh.userLists(); pageRefresh.groups(); },
	discovery: routerDiscovery,
	random: secureRandom,
	forms: sharedForms,
	table: deviceTableModel,
	iconButton: environment.iconButton,
	identityIcon: environment.identityIcon,
	qrCode: environment.qrCode,
	passwordRevealField: environment.passwordRevealField,
	settingLine: environment.settingLine
});
settingsController = settingsControllerModel.create({
	draft: settingsDraft,
	persistence: settingsPersistence,
	sideEffects: settingsSideEffects,
	value: settingValue,
	sectionValue: sectionValue,
	globalValue: function (option, fallback) { return environment.get('sheepfold', 'global', option, fallback); },
	setOption: settingsDraft.set,
	setSectionOption: settingsDraft.setSection,
	setOptions: settingsDraft.setMany,
	forms: sharedForms,
	icon: environment.icon,
	defaultLogCachePath: DEFAULT_LOG_CACHE_PATH,
	accessSteps: ACCESS_STEPS,
	defaultSiteAllowlistSources: DEFAULT_SITE_ALLOWLIST_SOURCES,
	defaultSiteBlocklistSources: DEFAULT_SITE_BLOCKLIST_SOURCES,
	timeSettings: timeSettings,
	detectionTools: detectionTools,
	generalModel: settingsGeneralModel,
	integrationPanel: integrationPanel,
	siteListStatus: siteListStatus,
	backup: backupController,
	storagePanel: storagePanelProxy,
	routerMaintenance: routerMaintenance,
	messengerSettings: messengerSettings,
	notificationSettings: notificationSettings,
	emergency: emergencyPanel,
	feedbackPanel: feedbackPanel,
	routerInfo: routerInfo,
	navigation: navigation,
	navigationModel: navigationStateModel,
	actions: commandActions,
	run: runCommand,
	parseKeyValues: routerBackend.parseKeyValues,
	sameValues: settingsDraftModel.sameValues,
	notify: environment.notify,
	notifyCentered: environment.notifyCentered,
	errorText: environment.errorText,
	confirm: window.confirm.bind(window)
});

var overviewView = pageShellModel.create({
	store: store,
	navigation: navigation,
	navigationModel: navigationStateModel,
	i18n: sheepfoldI18n,
	get: environment.get,
	sections: environment.sections,
	run: runCommand,
	actions: commandActions,
	reloadConfig: uciPersistence.reload,
	confirm: window.confirm.bind(window),
	notify: environment.notify,
	errorText: environment.errorText,
	fs: fs,
	devices: deviceController,
	schedules: scheduleController,
	groups: groupController,
	administrators: administratorController,
	wifi: wifiController,
	settings: settingsController,
	icon: sharedIcons.named,
	emergency: emergencyPanel,
	emergencySectionType: emergencySiteModel.sectionType,
	logPanel: logPanel,
	siteListStatus: siteListStatus,
	tableStylesheet: deviceTableModel.stylesheet,
	defaultLogCachePath: DEFAULT_LOG_CACHE_PATH
});

/*
 * LuCI передаёт require-зависимости как уже созданные экземпляры. Поэтому
 * entrypoint получает фабрику, а не пытается вернуть этот экземпляр как класс.
 */
return baseclass.extend({
	create: function () {
		return overviewView;
	}
});
