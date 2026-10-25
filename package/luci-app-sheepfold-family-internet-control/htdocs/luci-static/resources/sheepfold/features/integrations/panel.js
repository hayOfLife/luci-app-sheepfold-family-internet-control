'use strict';
'require baseclass';
'require sheepfold.features.integrations.install as adguardInstall';

function usesPodkop(mode) {
	return mode === 'podkop' || mode === 'adguard_podkop';
}

function modeNote(mode) {
	var notes = {
		none: _('Sheepfold works alone.'),
		adguard: _('Sheepfold blocks/allows devices before AdGuard Home DNS filtering.'),
		podkop: _('Sheepfold must not overwrite Podkop-managed routing, Dnsmasq, nftables, or sing-box state.'),
		adguard_podkop: _('Recommended chain: Sheepfold -> AdGuard Home -> Podkop.')
	};

	return notes[mode] || notes.none;
}

// Источник auto_podkop позволяет вернуть прежнее состояние после отказа от
// Podkop. Ручное отключение IPv6 пользовательским выбором не откатывается. §ipv6pod
function ipv6Draft(mode, current, source) {
	if (usesPodkop(mode)) {
		if (current !== '1')
			return { router_ipv6_disabled: '1', router_ipv6_mode_source: 'auto_podkop' };
		if (source === 'default')
			return { router_ipv6_mode_source: 'auto_podkop' };
	} else if (source === 'auto_podkop') {
		return { router_ipv6_disabled: '0', router_ipv6_mode_source: 'default' };
	}

	return null;
}

function ipv6Note(forced) {
	return forced ?
		_('IPv6 is disabled automatically because the selected integration uses Podkop.') :
		_('Current Podkop releases do not provide complete IPv6 support. Enable this manually only when it is needed without Podkop.');
}

function updateIpv6Controls(deps, mode) {
	var forced = usesPodkop(mode);

	document.querySelectorAll('[data-router-ipv6-control]').forEach(function (input) {
		input.checked = forced || deps.value('router_ipv6_disabled', '0') === '1';
		input.disabled = forced;
	});
	document.querySelectorAll('[data-router-ipv6-note]').forEach(function (note) {
		note.textContent = ipv6Note(forced);
	});
}

function syncIpv6Draft(deps, mode) {
	var changes = ipv6Draft(
		mode,
		deps.value('router_ipv6_disabled', '0'),
		deps.value('router_ipv6_mode_source', 'default')
	);

	if (changes)
		deps.setOptions(changes);
	updateIpv6Controls(deps, mode);
}

function ipv6Field(deps) {
	var mode = deps.value('integration_mode', 'none');
	var forced = usesPodkop(mode);
	var control = deps.checkbox(
		_('Disable IPv6 on the router'),
		forced || deps.value('router_ipv6_disabled', '0') === '1',
		null,
		{
			'data-router-ipv6-control': '1',
			'disabled': forced ? 'disabled' : null,
			'change': function (ev) {
				deps.setOptions({
					router_ipv6_disabled: ev.currentTarget.checked ? '1' : '0',
					router_ipv6_mode_source: 'manual'
				});
			}
		}
	);

	control.node.appendChild(E('small', { 'data-router-ipv6-note': '1' }, ipv6Note(forced)));
	return control.node;
}

function siteFilteringBox(deps) {
	var container = E('div', { 'class': 'sf-site-filter-settings' });

	function rebuild() {
		var backend = deps.value('site_filter_backend', 'auto');
		var autoManage = deps.value('adguard_auto_manage', '1') === '1';
		var backendSelect = E('select', {
			'class': 'cbi-input-select',
			'change': function (ev) {
				deps.setOption('site_filter_backend', ev.currentTarget.value);
				rebuild();
			}
		}, [
			['auto', _('Automatically (recommended)')],
			['adguard', 'AdGuard Home'],
			['sheepfold', _('Built-in Sheepfold tools')]
		].map(function (item) {
			return E('option', {
				'value': item[0],
				'selected': item[0] === backend ? 'selected' : null
			}, item[1]);
		}));
		var autoManageControl = deps.checkbox(
			_('Automatic AdGuard Home management'),
			autoManage,
			_('Sheepfold adds and updates only its own filter. User filters and AdGuard Home settings are not overwritten.'),
			{
				'change': function (ev) {
					deps.setOption('adguard_auto_manage', ev.currentTarget.checked ? '1' : '0');
					rebuild();
			}
			}
		);
		var fields = [
			E('div', { 'class': 'sf-filter-backend-row' }, [
				E('label', { 'class': 'sf-field sf-field-wide sf-filter-backend-control' }, [
					E('span', {}, _('Site filtering is performed through')),
					backendSelect,
					E('small', {}, _('Automatic mode uses AdGuard Home only when it is selected in the integration chain and Sheepfold confirms the managed filter. Otherwise the built-in filtering is used.'))
				]),
				deps.compactStatus()
			]),
			autoManageControl.node
		];

		if (backend !== 'sheepfold' && autoManage) {
			fields.push(E('div', { 'class': 'sf-grid two sf-adguard-credentials' }, [
				deps.sectionInput(
					'adguard', _('AdGuard Home address'), 'url',
					'http://127.0.0.1:3000', 'http://127.0.0.1:3000',
					_('Use the local AdGuard Home administration address without /control at the end.'), false
				),
				deps.sectionInput(
					'adguard', _('AdGuard Home username'), 'username', '', _('Optional'),
					_('Leave both credential fields empty only when the local AdGuard Home API has no authentication.'), false
				),
				deps.sectionInput(
					'adguard', _('AdGuard Home password'), 'password', '', '',
					_('The password is used only by the router for local API calls and is never shown in status output.'), true
				)
			]));
		} else if (!autoManage && backend !== 'sheepfold') {
			fields.push(E('p', { 'class': 'sf-note sf-note-warning' },
				_('Automatic management is off. Sheepfold will not change AdGuard Home and cannot confirm manually configured lists.')));
		}

		container.replaceChildren.apply(container, fields);
	}

	rebuild();
	return container;
}

/*
 * Это намеренно только видимая заглушка. До появления модели угроз, серверного
 * протокола и backend роутера нельзя сохранять фиктивный режим или устанавливать
 * транспортный пакет из LuCI. §rsup001
 */
function remoteSupportPlaceholder() {
	var unavailableNote = _('This button will become available after the router and support-server parts are implemented.');

	return E('div', { 'class': 'sf-settings-section sf-remote-support-placeholder' }, [
		E('p', { 'class': 'sf-section-intro' },
			_('This section previews temporary help from Sheepfold support. The feature is not available yet.')),
		E('div', { 'class': 'sf-filter-backend-row' }, [
			E('label', { 'class': 'sf-field sf-field-wide sf-filter-backend-control' }, [
				E('span', {}, _('Mode')),
				E('select', {
					'class': 'cbi-input-select',
					'disabled': 'disabled',
					'aria-describedby': 'sf-remote-support-placeholder-note'
				}, [
					E('option', { 'selected': 'selected' }, _('Off for now'))
				]),
				E('small', { 'id': 'sf-remote-support-placeholder-note' },
					_('No remote access module is installed and no connection to a support server is created.'))
			]),
			E('div', {
				'class': 'sf-inline-status sf-inline-status-muted',
				'role': 'status'
			}, [
				E('span', { 'class': 'sf-inline-status-label' }, _('Status')),
				E('strong', {}, _('Planned'))
			])
		]),
		E('div', { 'class': 'sf-action-stack' }, [
			E('button', {
				'class': 'sf-action sf-action-positive sf-action-muted',
				'type': 'button',
				'disabled': 'disabled',
				'title': unavailableNote,
				'aria-describedby': 'sf-remote-support-placeholder-note'
			}, _('Give access')),
			E('small', { 'class': 'sf-muted' }, unavailableNote)
		])
	]);
}

function render(deps) {
	var mode = deps.value('integration_mode', 'none');
	var note = E('span', {}, modeNote(mode));
	var select = E('select', {
		'class': 'cbi-input-select',
		'change': function (ev) {
			var nextMode = ev.currentTarget.value;

			deps.setOptions({
				integration_mode: nextMode,
				integration_mode_source: 'manual',
				integration_mode_user_set: '1'
			});
			syncIpv6Draft(deps, nextMode);
			note.textContent = modeNote(nextMode);
		}
	}, [
		['none', _('None')],
		['adguard', 'AdGuard Home'],
		['podkop', 'Podkop'],
		['adguard_podkop', 'AdGuard Home + Podkop']
	].map(function (item) {
		return E('option', { 'value': item[0], 'selected': item[0] === mode ? 'selected' : null }, item[1]);
	}));

	return E('div', { 'class': 'sf-settings-section' }, [
		E('div', { 'class': 'sf-form-row' }, [
			E('label', { 'class': 'sf-field sf-field-wide' }, [
				E('span', {}, _('Use together with')),
				select,
				E('small', {}, _('Auto-detected during installation. You can change it manually if needed.'))
			])
		]),
		E('div', { 'class': 'sf-grid two' }, [
			E('div', { 'class': 'sf-box sf-status-card' }, [
				E('h4', {}, _('AdGuard Home status')),
				E('p', {}, _('AdGuard Home filters DNS requests after Sheepfold allows a device. It helps block ads, trackers, and unwanted domains.')),
				adguardInstall.render({ run: deps.run, icon: deps.icon, isDirty: deps.isDirty })
			]),
			E('div', { 'class': 'sf-box sf-status-card' }, [
				E('h4', {}, _('Podkop status')),
				E('p', {}, _('Podkop routes already allowed traffic according to its own routing rules. Sheepfold does not change Podkop routes, marks, or sing-box settings.'))
			])
		]),
		E('div', { 'class': 'sf-note' }, [E('strong', {}, _('Mode notes')), note]),
		deps.divider(_('Site filtering')),
		siteFilteringBox(deps),
		deps.divider(_('Remote help from Sheepfold support')),
		remoteSupportPlaceholder()
	]);
}

return baseclass.extend({
	usesPodkop: usesPodkop,
	modeNote: modeNote,
	ipv6Draft: ipv6Draft,
	syncIpv6Draft: syncIpv6Draft,
	ipv6Field: ipv6Field,
	siteFilteringBox: siteFilteringBox,
	remoteSupportPlaceholder: remoteSupportPlaceholder,
	render: render
});
