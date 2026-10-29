'use strict';
'require baseclass';

/* §frontmod §persist1 §devmut §ovaudit3
 * Device persistence owns Sheepfold/DHCP staging and the ordered firewall/domain
 * runtime refresh. All staging occurs inside the serialized UCI mutation callback.
 */
function create(deps) {
	var runtimeQueue = Promise.resolve();

	function configured(value) { return typeof value === 'function' ? value() : value; }

	function codedError(code, message) {
		var error = new Error(message || code);
		error.errorCode = code;
		return error;
	}

	function macOf(device) {
		var mac = deps.normalizeMac(device && device.mac);
		if (!mac)
			throw codedError('invalid_mac', configured(deps.invalidMacMessage) || 'invalid_mac');
		return mac;
	}

	function validDhcpHostname(name) {
		return typeof name === 'string' && name.length <= 63 &&
			/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(name);
	}

	function namedSection(config, name) {
		return deps.persistence.sections(config).filter(function (section) {
			return section['.name'] === name;
		})[0] || null;
	}

	function compatibleDeviceSection(section, mac) {
		var storedMac;
		if (!section || section['.type'] !== 'device')
			return false;
		storedMac = deps.normalizeMac(section.mac);
		return !storedMac || storedMac === mac;
	}

	function ensureDeviceSection(device) {
		var mac = macOf(device);
		var preferred = device && device.configSection ? String(device.configSection) : '';
		var candidate = preferred || deps.generatedSectionName('device', mac);
		var existing = namedSection('sheepfold', candidate);

		if (existing) {
			if (!compatibleDeviceSection(existing, mac)) {
				var conflict = codedError('device_section_collision', 'device_section_collision');
				conflict.section = candidate;
				throw conflict;
			}
			return candidate;
		}
		// A stale configSection pointer must not turn subsequent uci.set() calls into
		// silent no-ops. Recreate only a deterministic device section for this MAC.
		if (preferred)
			candidate = deps.generatedSectionName('device', mac);
		existing = namedSection('sheepfold', candidate);
		if (existing) {
			if (!compatibleDeviceSection(existing, mac))
				throw codedError('device_section_collision', 'device_section_collision');
			return candidate;
		}
		return deps.persistence.ensureSection('sheepfold', 'device', candidate);
	}

	function ensureListSection(listName) {
		return deps.persistence.ensureSection('sheepfold', 'list', listName);
	}

	function updateMacList(listName, mac, enabled) {
		var sectionName = ensureListSection(listName);
		var values = deps.accessLists.updatedValues(
			deps.uci.get('sheepfold', sectionName, 'mac'), deps.normalizeMac(mac), enabled
		);
		deps.persistence.replaceList('sheepfold', sectionName, 'mac', values);
		return values;
	}

	function existingStaticDhcpSection(device) {
		var mac = macOf(device);
		var preferred = device && device.staticSection ? String(device.staticSection) : '';
		var preferredSection = preferred ? namedSection('dhcp', preferred) : null;

		if (preferredSection && preferredSection['.type'] === 'host' &&
			deps.normalizeMac(preferredSection.mac) === mac)
			return preferred;
		return deps.persistence.sections('dhcp', 'host').filter(function (section) {
			return deps.normalizeMac(section.mac) === mac;
		})[0]?.['.name'] || '';
	}

	function ensureStaticDhcpSection(device) {
		var existingForMac = existingStaticDhcpSection(device);
		var mac = macOf(device);
		var base = deps.generatedSectionName('sheepfold', mac);
		var index;
		var candidate;
		var occupied;

		if (existingForMac)
			return existingForMac;
		for (index = 1; index <= 999; index++) {
			candidate = index === 1 ? base : base + '_' + index;
			occupied = namedSection('dhcp', candidate);
			if (!occupied)
				return deps.persistence.ensureSection('dhcp', 'host', candidate);
			if (occupied['.type'] === 'host' && deps.normalizeMac(occupied.mac) === mac)
				return candidate;
		}
		throw codedError('dhcp_section_collision', 'dhcp_section_collision');
	}

	function applyRuntime() {
		var operation = runtimeQueue.catch(function () { return null; }).then(function () {
			return deps.run(['schedule-sync'], { key: 'access-runtime:schedule' }).then(function (result) {
				deps.ensureOk(result, configured(deps.accessRuntimeError) || 'access_runtime_failed');
				return deps.run(['site-lists-apply'], { key: 'access-runtime:sites' });
			}).then(function (result) {
				deps.ensureOk(result, configured(deps.siteRuntimeError) || 'site_runtime_failed');
				return deps.refreshSiteStatus ? Promise.resolve().then(function () { return deps.refreshSiteStatus(); }).catch(function () { return null; }) : null;
			});
		});

		// A second UCI commit may finish while the first firewall/domain refresh is
		// still running. Queue the complete pair so the later commit always gets its
		// own final sync instead of coalescing into an older in-flight command.
		runtimeQueue = operation.catch(function () { return null; });
		return operation;
	}

	function finishRuntime(mutation) {
		var state = {
			persisted: true,
			runtimeApplied: false,
			stageResult: mutation && mutation.stageResult
		};
		return applyRuntime().then(function () {
			state.runtimeApplied = true;
			return state;
		}, function (error) {
			error.persisted = true;
			error.runtimeApplied = false;
			error.persistenceResult = state.stageResult;
			throw error;
		});
	}

	function saveAccess(configs, stage) {
		return deps.persistence.mutate(configs || ['sheepfold'], stage).then(finishRuntime);
	}

	function stageSettings(device, payload) {
		var mac = macOf(device);
		var sectionName = ensureDeviceSection(device);
		var oldStaticSection = existingStaticDhcpSection(device);
		var staticSectionName = '';
		var oldGroup = deps.normalizeGroupName(device.group);
		var notConfiguredGroup = configured(deps.notConfiguredGroup) || 'Not configured';
		var newGroup = deps.normalizeGroupName(payload.group || notConfiguredGroup);
		var status = payload.status;
		var adminDevice = deps.isAdminDevice(device);
		var dhcpName;
		var result;
		if (adminDevice) {
			newGroup = notConfiguredGroup;
			status = 'allow';
		}
		/* SHEEPFOLD_AI_BEGIN */
		var activityLogEnabled = !adminDevice && status !== 'allow' &&
			status !== 'blocked' && !!payload.activityLogEnabled;
		/* SHEEPFOLD_AI_END */

		deps.uci.set('sheepfold', sectionName, 'mac', mac);
		deps.uci.set('sheepfold', sectionName, 'name', payload.name);
		deps.uci.set('sheepfold', sectionName, 'name_source', 'user');
		deps.uci.set('sheepfold', sectionName, 'ip', payload.ip);
		deps.uci.set('sheepfold', sectionName, 'group', newGroup);
		deps.uci.set('sheepfold', sectionName, 'group_source', 'user');
		deps.uci.set('sheepfold', sectionName, 'device_type', payload.deviceType);
		deps.uci.set('sheepfold', sectionName, 'manual_device_type', payload.deviceType === 'unknown' ? '0' : '1');
		deps.uci.set('sheepfold', sectionName, 'device_type_source', payload.deviceType === 'unknown' ? 'detector' : 'user');
		deps.uci.set('sheepfold', sectionName, 'status', status);
		/* SHEEPFOLD_AI_BEGIN */
		deps.uci.set('sheepfold', sectionName, 'activity_log_enabled', activityLogEnabled ? '1' : '0');
		/* SHEEPFOLD_AI_END */

		if (oldGroup === configured(deps.noRestrictionsGroupName) && newGroup !== configured(deps.noRestrictionsGroupName))
			deps.markNoRestrictionsExcluded(sectionName);
		if (oldGroup === configured(deps.personalDevicesGroupName) && newGroup !== configured(deps.personalDevicesGroupName))
			deps.markPersonalDevicesExcluded(sectionName);

		if (status === 'allow')
			updateMacList('allowlist', mac, true);
		else if (status !== 'blocked')
			updateMacList('allowlist', mac, false);
		if (status === 'blocked')
			updateMacList('blocklist', mac, true);
		else if (status !== 'allow')
			updateMacList('blocklist', mac, false);

		if (payload.staticLease) {
			staticSectionName = ensureStaticDhcpSection(device);
			// Отображаемое имя может быть русским, но dnsmasq получит только безопасный hostname
			dhcpName = validDhcpHostname(payload.name) ? payload.name : deps.uci.get('dhcp', staticSectionName, 'name');
			deps.uci.set('dhcp', staticSectionName, 'mac', mac);
			deps.uci.set('dhcp', staticSectionName, 'ip', payload.ip);
			if (validDhcpHostname(dhcpName))
				deps.uci.set('dhcp', staticSectionName, 'name', dhcpName);
			else
				deps.uci.unset('dhcp', staticSectionName, 'name');
		} else if (oldStaticSection) {
			deps.uci.remove('dhcp', oldStaticSection);
		}

		result = {
			sectionName: sectionName,
			staticSectionName: staticSectionName,
			mac: mac,
			name: payload.name,
			ip: payload.ip,
			group: newGroup,
			deviceType: payload.deviceType,
			manualDeviceType: payload.deviceType !== 'unknown',
			status: status,
			staticLease: !!payload.staticLease
		};
		/* SHEEPFOLD_AI_BEGIN */
		result.activityLogEnabled = activityLogEnabled;
		/* SHEEPFOLD_AI_END */
		return result;
	}

	function persistSettings(device, payload) {
		var configs = ['sheepfold'];
		if (payload.staticLease || existingStaticDhcpSection(device))
			configs.push('dhcp');
		return saveAccess(configs, function () { return stageSettings(device, payload); }).then(function (state) {
			var result = state.stageResult;
			result.persisted = true;
			result.runtimeApplied = state.runtimeApplied;
			return result;
		});
	}

	function removeFromList(device, listName) {
		if (listName !== 'allowlist' && listName !== 'blocklist')
			return Promise.reject(codedError('invalid_request', 'invalid_access_list'));
		return saveAccess(['sheepfold'], function () {
			var mac = macOf(device);
			var sectionName = ensureDeviceSection(device);
			updateMacList(listName, mac, false);
			deps.uci.set('sheepfold', sectionName, 'status', 'new');
			return { sectionName: sectionName, mac: mac, status: 'new' };
		}).then(function (state) {
			var result = state.stageResult;
			result.persisted = true;
			result.runtimeApplied = state.runtimeApplied;
			return result;
		});
	}

	function setBackendStatus(device, status) {
		var mac;
		try { mac = macOf(device); } catch (error) { return Promise.reject(error); }
		return deps.action({
			key: 'device-status:' + mac + ':' + status,
			args: [
				'set-device-status', mac, status,
				device.name || device.hostname || mac, device.ip || '',
				deps.normalizeGroupName(device.group) || configured(deps.notConfiguredGroup) || 'Not configured',
				device.deviceType || 'smart'
			],
			silent: true,
			errorMessage: deps.statusError ? deps.statusError(status) : 'device_status_failed'
		}).then(function (response) { return response.result; });
	}

	return {
		ensureDeviceSection: ensureDeviceSection,
		ensureListSection: ensureListSection,
		updateMacList: updateMacList,
		ensureStaticDhcpSection: ensureStaticDhcpSection,
		existingStaticDhcpSection: existingStaticDhcpSection,
		applyRuntime: applyRuntime,
		saveAccess: saveAccess,
		stageSettings: stageSettings,
		persistSettings: persistSettings,
		removeFromList: removeFromList,
		setBackendStatus: setBackendStatus,
		reload: deps.persistence.reload,
		discard: deps.persistence.discard
	};
}

return baseclass.extend({ create: create });
