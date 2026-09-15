'use strict';
'require baseclass';

function create(onChange) {
	var options = {};
	var specialSavers = [];
	var saving = false;

	function changed() {
		if (onChange)
			onChange();
	}

	function reset() {
		options = {};
		specialSavers = [];
		saving = false;
		changed();
	}

	function has(option) {
		return Object.prototype.hasOwnProperty.call(options, option);
	}

	function set(option, value) {
		options[option] = String(value == null ? '' : value);
		changed();
	}

	function setMany(values) {
		Object.keys(values || {}).forEach(function (option) {
			options[option] = String(values[option] == null ? '' : values[option]);
		});
		changed();
	}

	function registerSaver(saver) {
		specialSavers.push(saver);
		changed();
	}

	function dirtySavers() {
		return specialSavers.filter(function (saver) {
			return saver.isChanged && saver.isChanged();
		});
	}

	function isDirty() {
		return Object.keys(options).length > 0 || dirtySavers().length > 0;
	}

	function snapshot() {
		return Object.assign({}, options);
	}

	function clearOptions() {
		options = {};
		changed();
	}

	function acceptOptions(saved) {
		// Ответ относится только к переданному снимку. Более поздний ввод нельзя
		// стирать или объявлять сохранённым вместе с завершившейся операцией.
		Object.keys(saved || {}).forEach(function (option) {
			if (has(option) && options[option] === saved[option])
				delete options[option];
		});
		changed();
	}

	function setSaving(value) {
		saving = !!value;
		changed();
	}

	return {
		reset: reset,
		has: has,
		get: function (option) { return options[option]; },
		set: set,
		setSection: function (section, option, value) { set(section + '.' + option, value); },
		setMany: setMany,
		registerSaver: registerSaver,
		dirtySavers: dirtySavers,
		isDirty: isDirty,
		snapshot: snapshot,
		clearOptions: clearOptions,
		acceptOptions: acceptOptions,
		setSaving: setSaving,
		isSaving: function () { return saving; }
	};
}

function sameValues(left, right) {
	var leftKeys = Object.keys(left || {});
	var rightKeys = Object.keys(right || {});

	if (leftKeys.length !== rightKeys.length)
		return false;

	return leftKeys.every(function (key) {
		return String(left[key] == null ? '' : left[key]) === String(right[key] == null ? '' : right[key]);
	});
}

return baseclass.extend({
	create: create,
	sameValues: sameValues
});
