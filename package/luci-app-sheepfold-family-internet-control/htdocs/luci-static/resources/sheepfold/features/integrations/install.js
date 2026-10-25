'use strict';
'require baseclass';
'require ui';

var busyStates = ['starting', 'installing', 'configuring', 'switching_dns', 'verifying'];

function reasonText(reason) {
	var messages = {
		root_password: _('Set your own router password in OpenWrt administration first.'),
		already_installed: _('AdGuard Home already exists. Its settings will not be overwritten.'),
		previous_install: _('A previous installation needs review. The backup path is shown below.'),
		unsaved_changes: _('Save or discard pending settings before installation.'),
		low_memory: _('Installation requires at least 48 MiB of free storage and 128 MiB of available RAM.'),
		ipv6_active: _('This installation profile requires IPv6 to be disabled already. No IPv6 setting is changed automatically.'),
		port_busy: _('A required DNS or administration port is already in use.'),
		unsupported_version: _('This profile supports AdGuard Home 0.107.79 only. DNS settings were not switched.'),
		unsupported_package: _('The AdGuard Home package has an unsupported service layout. DNS settings were not switched.'),
		dns_unavailable: _('The current DNS service is unavailable. Restore it before installation.'),
		podkop_stopped: _('Start Podkop and check internet access before installation.'),
		dns_layout: _('The DNS configuration differs from the supported installation profile.'),
		multiple_dnsmasq: _('Automatic installation supports one dnsmasq instance only.'),
		unsupported_lan: _('Automatic installation requires one static LAN IPv4 address.'),
		package_failed: _('The package could not be installed. Existing DNS settings were preserved.'),
		verification_failed: _('The new DNS service could not be verified. Check the recovery status.'),
		config_changed: _('Settings changed during installation. Check the backup before recovery.')
	};
	return messages[reason] || _('Installation is unavailable. Check the router configuration and backup.');
}

function stateText(state) {
	var messages = {
		ready: _('AdGuard Home can be installed on this router.'),
		starting: _('Starting installation...'),
		installing: _('Downloading and installing AdGuard Home...'),
		configuring: _('Preparing the AdGuard Home account and DNS settings...'),
		switching_dns: _('Switching DNS services...'),
		verifying: _('Checking the new DNS service...'),
		installed: _('AdGuard Home is installed and both filters are loaded. DNS access from a LAN device still needs verification.'),
		installed_filters_pending: _('AdGuard Home is installed. Filter downloads and DNS access from a LAN device still need verification.'),
		failed_restored: _('Installation failed. The previous DNS configuration was restored.'),
		recovery_required: _('Automatic recovery did not complete. Keep the backup and restore DNS manually.'),
		interrupted: _('Installation was interrupted. Check the router and the saved backup before continuing.'),
		failed: _('Installation stopped before switching DNS. The package may remain installed.')
	};
	return messages[state] || '';
}

function render(deps) {
	var label = _('Install AdGuard Home');
	var note = E('p', { 'role': 'status', 'class': 'sf-note' }, _('Checking installation requirements...'));
	var button = E('button', { 'type': 'button', 'class': 'sf-action', 'disabled': true }, [deps.icon('actionSettings'), ' ', label]);
	var root = E('div', { 'class': 'sf-adguard-install' }, [button, note]);

	function response(result) {
		if (!result || result.code !== 0)
			throw new Error(_('Could not read the installation status. Refresh this page.'));
		var state = {};
		String(result.stdout || '').split(/\r?\n/).forEach(function (line) {
			var index = line.indexOf('=');
			if (index > 0) state[line.slice(0, index)] = line.slice(index + 1);
		});
		if (!state.status) throw new Error(_('Could not read the installation status. Refresh this page.'));
		return state;
	}

	function showStatus(state, target) {
		target.textContent = stateText(state.status) || reasonText(state.reason);
		if (state.reason && state.status !== 'unavailable') target.textContent += ' ' + reasonText(state.reason);
		if (state.backup) target.textContent += ' ' + _('Backup') + ': ' + state.backup;
		button.disabled = state.status !== 'ready';
	}

	button.addEventListener('click', function () {
		if (deps.isDirty()) {
			note.textContent = _('Save or discard pending settings before installation.');
			return;
		}
		var progress = E('p', { 'role': 'status' });
		var timer = null;
		var closed = false;
		var attempts = 0;
		var startingPolls = 0;
		var start = E('button', { 'class': 'btn cbi-button-positive', 'type': 'button' }, label);
		function close() {
			closed = true;
			if (timer !== null) window.clearTimeout(timer);
			ui.hideModal();
		}
		function refresh() {
			if (closed || !progress.isConnected) return;
			// failed здесь является результатом операции, а не ошибкой чтения её состояния
			deps.run(['adguard-install-status'], { parse: 'text' }).then(response).then(function (state) {
				if (closed) return;
				// Worker ещё может проверять прежний DNS до создания каталога операции
				if (state.status === 'ready' && ++startingPolls <= 5) state.status = 'starting';
				showStatus(state, progress);
				showStatus(state, note);
				if (busyStates.indexOf(state.status) >= 0 && ++attempts < 180)
					timer = window.setTimeout(refresh, 3000);
				else if (busyStates.indexOf(state.status) >= 0)
					progress.textContent = _('Installation is still running. Close this dialog and refresh the page later. Do not start another installation.');
			}).catch(function (error) { progress.textContent = error.message; });
		}
		start.addEventListener('click', function () {
			if (start.disabled) return;
			if (deps.isDirty()) { progress.textContent = _('Save or discard pending settings before installation.'); return; }
			start.disabled = true;
			button.disabled = true;
			deps.run(['adguard-install-start', 'confirmed']).then(response).then(function (state) {
				showStatus(state, progress);
				timer = window.setTimeout(refresh, 1000);
			}).catch(function (error) { progress.textContent = error.message; });
		});
		ui.showModal(label, [
			E('p', {}, _('Install the official OpenWrt package and switch LAN DNS to AdGuard Home, then local dnsmasq on port 5354. Podkop routes and external DNS stay unchanged. Internet names may stop resolving briefly.')),
			E('p', {}, _('Enable HaGeZi LIGHT and TIF MINI, disable DNS caches, keep 1000 recent DNS queries and one day of statistics in RAM. Filters must download again after reboot. Existing AdGuard Home installations are not changed.')),
			E('p', { 'class': 'sf-note sf-note-warning' }, _('Initial AdGuard Home login: admin. Password: password. Anyone on your home network who knows these common credentials can change DNS and disable filters. Change them in AdGuard Home after installation and update the integration credentials here. The router password is never copied.')),
			E('p', {}, _('Reload this page after installation to load the new integration settings.')),
			E('p', {}, _('A private backup is kept on the router. If verification fails, Sheepfold attempts to restore DNS without overwriting later user changes. No packages are removed automatically.')),
			progress,
			E('div', { 'class': 'right' }, [E('button', { 'class': 'btn', 'type': 'button', 'click': close }, _('Close')), ' ', start])
		]);
	});
	deps.run(['adguard-install-status'], { parse: 'text' }).then(response).then(function (state) { showStatus(state, note); })
		.catch(function (error) { note.textContent = error.message; });
	return root;
}

return baseclass.extend({ render: render, reasonText: reasonText, stateText: stateText });
