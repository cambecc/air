/**
 * tool - a set of general utility functions
 */

"use strict";

var _ = require("underscore");
var when = require("when");
var winston = require("winston");

/**
 * Returns a new, nicely configured winston logger.
 *
 * @returns {winston.Logger}
 */
exports.log = function() {
    return new (winston.Logger)({
        transports: [
            new (winston.transports.Console)({level: 'debug', timestamp: true, colorize: false})
        ]
    });
}; var log = exports.log();

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
 * Returns the date as an ISO string having the specified zone:  "yyyy-MM-dd hh:mm:ss±xx:yy"
 */
function dateToISO(date, zone) {
    return _.isFinite(date.getFullYear()) ?
        format("{0}-{1}-{2} {3}:{4}:{5}{6}",
            date.getFullYear(),
            pad(date.getMonth() + 1, 2),
            pad(date.getDate(), 2),
            pad(date.getHours(), 2),
            pad(date.getMinutes(), 2),
            pad(date.getSeconds(), 2),
            zone) :
        null;
}

/**
 * Converts the specified object containing date fields to an ISO 8601 formatted string. This function first
 * constructs a Date object by providing the specified fields to the date constructor, then produces a string from
 * the resulting date. As a consequence of constructing a Date object, date fields in excess of the normal ranges
 * will cause the date to overflow to the next valid date. For example, toISOString({year:2013, month:1, day:31,
 * hour:24}) will produce the string "2013-02-01 00:00:00Z".
 *
 * @param {object} dateFields an object with keys:
 *                     [year:] the four digit year, default is 1901;
 *                     [month:] the month (1-12), default is 1;
 *                     [day:] the day, default is 1;
 *                     [hour:] the hour, default is 0;
 *                     [minute:] minutes, default is 0;
 *                     [second:] seconds, default is 0;
 *                     [zone:] a valid ISO timezone offset string, such as "+09:00", default is "Z"
 * @returns {string} the specified parts in ISO 8601 format: yyyy-MM-dd hh:mm:ss±xx:yy, or null if the parts do not
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

    return dateToISO(date, coalesce(dateFields.zone, "Z"));
}

/**
 * Converts the date represented by the specified ISO string to a different time zone.
 *
 * @param isoString a date in ISO 8601 format: yyyy-MM-dd hh:mm:ss±xx:yy.
 * @param zone a valid ISO timezone offset string, such as "+09:00", representing the zone to convert to.
 * @returns {string} the date adjusted to the specified time zone as an ISO 8601 string.
 */
exports.withZone = function(isoString, zone) {
    zone = coalesce(zone, "Z");
    var adjust = zone === "Z" ? 0 : +(zone.split(":")[0]) * 60;

    var date = new Date(isoString);
    date.setMinutes(date.getMinutes() + adjust + date.getTimezoneOffset());

    return dateToISO(date, zone);
}

/**
 * Repeatedly calls a function with the specified period, waiting 'initialDelay' milliseconds before the first
 * invocation. If the function returns true, then the invocation for the next period is scheduled. If the function
 * returns false, then function invocation is retried on a schedule determined by the backoff function.
 *
 * The backoff function is a function(i) that is invoked when the ith retry has failed, and returns the number
 * of milliseconds to wait before attempting the next retry. For example, given a time t that corresponds to a
 * period Px in which to invoke the function, i is initially 0. If the invocation at t fails, invocation is
 * scheduled for backoff(0) milliseconds later, and i is incremented. If that invocation yet again fails, the next
 * invocation is scheduled for backoff(1) milliseconds later, and i again increments. This continues until the
 * function succeeds. Upon success, i becomes 0, and the next invocation is scheduled for the period Px+1.
 *
 * It is sometimes useful to initialize i to a negative value for each period Px. This has the effect of "retrying"
 * the function _before_ the desired time, allowing the schedule to adapt to noisy environments where the period of
 * some recurring event exhibits variation. For example, given an estimated time t when function invocation is
 * expected to be successful, initializing i to -1 means function invocation first occurs at t - backoff(-1).
 * Assuming this fails, the next attempt occurs at t (backoff(-1) milliseconds later), then again backoff(0) ms
 * later, and so on as discussed earlier.
 *
 * This function returns a function that, when invoked, cancels all future invocations.
 *
 * @param funcToCall the function to invoke repeatedly.
 * @param initialDelay the milliseconds to wait before the first invocation.
 * @param period the desired milliseconds between subsequent invocations.
 * @param backoff a function(i) that returns the number of milliseconds to wait after the ith retry fails.
 * @param [initialRetry] the initial ith retry value for each period; defaults to 0.
 * @returns {Function} when the returned function is invoked, all future invocations are canceled.
 */
exports.setFlexInterval = function(funcToCall, initialDelay, period, backoff, initialRetry) {
    var done = false;
    initialRetry = initialRetry || 0;
    var i = initialRetry;
    var start = 0;
    for (var t = initialRetry; t < 0; t++) {
        start += backoff(t);
    }

    function schedule(success) {
        if (success) {
            i = initialRetry;
        }
        var next = Math.max(0, success ? period - start : backoff(i++));
        log.info("scheduling next invocation for: " + next);
        setTimeout(invoke, next);
    }

    function invoke() {
        if (!done) {
            when(funcToCall()).then(schedule, function(e) { log.error(e.stack); });
        }
    }

    setTimeout(invoke, initialDelay);
    return function() { done = true; };
}
