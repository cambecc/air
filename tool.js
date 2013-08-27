"use strict";

var _ = require("underscore");

/**
 * Returns the string representation of a number padded with leading characters to make
 * it at least "width" length.
 *
 * @param {Number} n the number to convert to a padded string
 * @param {Number} width the desired minimum width of the resulting string
 * @param {Object} [options] an object with keys:
 *                     [char:] the character to use for padding, default is "0";
 *                     [radix:] the radix to use for number conversion, default is 10;
 * @returns {string} the padded string
 */
exports.pad = function(n, width, options) {
    options = options || {};
    var s = n.toString(options.radix);
    var i = Math.max(width - s.length, 0);
    return new Array(i + 1).join(options.char || "0") + s;
}; var pad = exports.pad;

/**
 * Return the first non-null, non-undefined argument, otherwise the last argument.
 *
 * @param a the first arg
 * @param b the second arg
 * @returns {*}
 */
exports.coalesce = function(a, b) {
    return a !== undefined && a !== null ? a : b;
}; var coalesce = exports.coalesce;

/**
 * Returns a string resulting from replacing the expansion points in the pattern with the provided arguments.
 * Expansion points have the form "{i}", where i is a number corresponding to the ith argument provided after the
 * pattern. For example, format("the {0} brown {1}", "quick", "fox") would produce: "the quick brown fox".
 * Undefined arguments cause no expansion to occur at their corresponding expansion point.
 *
 * @param {string} pattern the pattern for expansion
 * @returns {string} the expanded string
 */
exports.format = function(pattern) {
    var args = _.rest(arguments, 1);
    return pattern.replace(/{(\d+)}/g, function(match, capture) {
        var index = capture * 1;
        return 0 <= index && index < args.length && args[index] !== undefined ? args[index] : match;
    });
}; var format = exports.format;

/**
 * Converts the specified object containing date fields to an ISO 8601 formatted string. This function first
 * constructs a Date object by providing the specified fields to the date constructor, then produces a string from
 * the resulting date. As a consequence of constructing a Date object, date fields in excess of the normal ranges
 * will cause the date to overflow to the next valid date. For example, toISOString({year:2013, month:1, day:31,
 * hour:24}) will produce the string "2013-02-01T00:00:00Z".
 *
 * @param {object} dateFields an object with keys:
 *                     [year:] the four digit year, default is 1901;
 *                     [month:] the month (1-12), default is 1;
 *                     [day:] the day, default is 1;
 *                     [hour:] the hour, default is 0;
 *                     [minute:] minutes, default is 0;
 *                     [second:] seconds, default is 0;
 *                     [zone:] a valid ISO timezone offset string, such as "+09:00", default is "Z"
 * @returns {string} the specified parts in ISO 8601 format: yyyy-MM-ddThh:mm:ss±xx:yy, or null if the parts do not
 *                   represent a valid date.
 */
exports.toISOString = function(dateFields) {
    var date = new Date(
        coalesce(dateFields.year, 1901),
        coalesce(dateFields.month, 1) - 1,
        coalesce(dateFields.day, 1),
        coalesce(dateFields.hour, 0),
        coalesce(dateFields.minute, 0),
        coalesce(dateFields.second, 0));

    return _.isFinite(date.getFullYear()) ?
        format("{0}-{1}-{2}T{3}:{4}:{5}{6}",
            date.getFullYear(),
            pad(date.getMonth() + 1, 2),
            pad(date.getDate(), 2),
            pad(date.getHours(), 2),
            pad(date.getMinutes(), 2),
            pad(date.getSeconds(), 2),
            coalesce(dateFields.zone, "Z")) :
        null;
}
