"use strict";

var tool = require("../tool");

exports.testPad = function(test) {
    test.equal(tool.pad(42, 9), "000000042");
    test.equal(tool.pad(42, 4), "0042");
    test.equal(tool.pad(42, 3), "042");
    test.equal(tool.pad(42, 2), "42");
    test.equal(tool.pad(42, 1), "42");
    test.equal(tool.pad(42, 0), "42");
    test.equal(tool.pad(42, -1), "42");

    test.equal(tool.pad(3.14159, 8), "03.14159");
    test.equal(tool.pad(3.14159, 7), "3.14159");
    test.equal(tool.pad(3.14159, 6), "3.14159");
    test.equal(tool.pad(3.14159, 3), "3.14159");

    test.equal(tool.pad(42, 5, {char: " "}), "   42");
    test.equal(tool.pad(255, 4, {radix: 16}), "00ff");
    test.equal(tool.pad(255, 4, {char: " ", radix: 16}), "  ff");

    test.equal(tool.pad(42, 3, {}), "042");
    test.equal(tool.pad("42", "3"), "042");

    test.equal(tool.pad("xy", 3), "0xy");
    test.equal(tool.pad("xy", 3, {char: " "}), " xy");
    test.equal(tool.pad("xy", 3, {char: " ", radix: 16}), " xy");

    test.done();
}

exports.testCoalesce = function(test) {
    test.equal(tool.coalesce(null, 3), 3);
    test.equal(tool.coalesce(undefined, 3), 3);
    test.equal(tool.coalesce(false, 3), false);

    test.equal(tool.coalesce(3, null), 3);
    test.equal(tool.coalesce(3, undefined), 3);
    test.equal(tool.coalesce(3, false), 3);

    test.ok(tool.coalesce(null, undefined) === undefined);
    test.ok(tool.coalesce(undefined, null) === null);

    test.done();
};

exports.testFormat = function(test) {
    test.equal(tool.format("the {0} brown {1}", "quick", "fox"), "the quick brown fox");
    test.equal(tool.format("the {0} brown {1}", "quick"), "the quick brown {1}");
    test.equal(tool.format("the {0} brown {1}"), "the {0} brown {1}");
    test.equal(tool.format("the {1} brown {0}", "fox", "quick"), "the quick brown fox");
    test.equal(tool.format("the {0}, {0} brown {1}", "quick", "fox"), "the quick, quick brown fox");

    test.equal(tool.format("a {0} c {1} e {2}", null, "d"), "a null c d e {2}");
    test.equal(tool.format("a {0} c {1} e {2}", undefined, "d"), "a {0} c d e {2}");

    test.equal(tool.format("{-1}{0.7}{99}", "a", "b"), "{-1}{0.7}{99}");
    test.equal(tool.format("{0}{1}{0}{1}", "{1}" ,"{0}"), "{1}{0}{1}{0}");
    test.equal(tool.format("{0}{1}", "{2}" ,"{1}", "b"), "{2}{1}");

    test.done();
}

exports.testToISOString = function(test) {
    test.equal(
        tool.toISOString({year:2013, month:1, day:1, hour:3, minute:30, second:15, zone:"+09:00"}),
        "2013-01-01T03:30:15+09:00");

    test.equal(tool.toISOString({year:2013, month:2, day:2, hour:3, minute:30, second:15}), "2013-02-02T03:30:15Z");
    test.equal(tool.toISOString({year:2013, month:2, day:2, hour:3, minute:30}), "2013-02-02T03:30:00Z");
    test.equal(tool.toISOString({year:2013, month:2, day:2, hour:3}), "2013-02-02T03:00:00Z");
    test.equal(tool.toISOString({year:2013, month:2, day:2}), "2013-02-02T00:00:00Z");
    test.equal(tool.toISOString({year:2013, month:2}), "2013-02-01T00:00:00Z");
    test.equal(tool.toISOString({year:2013}), "2013-01-01T00:00:00Z");
    test.equal(tool.toISOString({}), "1901-01-01T00:00:00Z");

    test.equal(tool.toISOString({year:2013, month:1, day:31, hour:24}), "2013-02-01T00:00:00Z");
    test.equal(tool.toISOString({year:2013, month:1, day:32}), "2013-02-01T00:00:00Z");
    test.equal(tool.toISOString({year:2013, month:0, day:32}), "2013-01-01T00:00:00Z");  // kinda weird, but consistent

    test.equal(tool.toISOString({year: "sf", month: "sfd"}), null);

    test.done();
}
