"use strict";

var util = require("util");
var fs = require("fs");
var _ = require("underscore");
var express = require("express");
var when = require("when");
var db = require("./db");
var tool = require("./tool");
var log = tool.log();

var port = process.argv[2];

// Cache index.html to serve it out. Changes require a restart to pick them up. Need to find a better way to do this.
var indexHTML = "./public/index.html";
var indexHTMLText = fs.readFileSync(indexHTML, {encoding: "utf-8"});
var indexHTMLDate = fs.statSync(indexHTML).mtime;

var app = express();

app.use(cacheControl());
app.use(express.compress({filter: compressionFilter}));

express.logger.token("date", function() {
    return new Date().toISOString();
});
express.logger.token("response-all", function(req, res) {
    return tool.coalesce(res._header, "").trim();
});
app.use(express.logger(
    ':date - info: :remote-addr :req[cf-connecting-ip] :req[cf-ipcountry] :method :url HTTP/:http-version ' +
    '":user-agent" :referrer :req[cf-ray]'));
//  '":user-agent" :referrer :req[cf-ray]\\n:response-all\\n'));

//app.get("/about/stations", function(request, response) {
//    var result = {};
//    schema.stations.columns.forEach(function(column) {
//        result[column.name] = column.description;
//    });
//    response.type("json");
//    response.json(prepare(result));
//});
//
//app.get("/stations", function(request, response) {
//    var stmt = db.selectAll(schema.stations);
//    when(db.execute(stmt)).then(
//        function(result) {
//            response.type("json");
//            response.json(prepare(result.rows));
//        },
//        function(error) {
//            response.type("json");
//            response.json(prepare(error.message));
//        });
//});
//
//app.get("/stations/geo", function(request, response) {
//    var stmt = db.selectAll(schema.stations);
//    when(db.execute(stmt)).then(
//        function(result) {
//            var out = {
//                type: "FeatureCollection",
//                features: result.rows.map(function(element) {
//                    return {
//                        type: "Feature",
//                        properties: {name: element.id.toString()},
//                        geometry: {
//                            type: "Point",
//                            coordinates: [
//                                parseFloat(element.longitude),
//                                parseFloat(element.latitude)
//                            ]
//                        }
//                    }
//                })
//            };
//            response.type("json");
//            response.json(prepare(out));
//        },
//        function(error) {
//            response.type("json");
//            response.json(prepare(error.message));
//        });
//});
//
//app.get("/about/samples", function(request, response) {
//    var result = {};
//    schema.samples.columns.forEach(function(column) {
//        result[column.name] = column.description;
//    });
//    response.type("json");
//    response.json(prepare(result));
//});
//
//app.get("/samples/*", function(request, response) {
//    var args = request.params[0].split(/\//);
//    console.log("/samples/* " + util.inspect(args));
//
//    // sample-type := 'all' | 'temp' | 'hum' | 'wd' | ...
//    // station-id := int
//    // year, month, day, hour := int
//    //
//    // sample-type-path := sample-type [ '/' station-id ]
//    // date-path := year [ '/' month [ '/' day [ '/' hour ] ] ] [ '/' sample-type-path ]
//    // current-path := 'current' [ '/' (date-path | sample-type-path) ]
//    // samples-path := 'samples' [ '/' (current-path | date-path) ]
//    //
//    // examples:
//    //     samples/current                  - all current samples
//    //     samples/current/temp             - all current temps
//    //     samples/current/temp/117         - current temp at station 117
//    //     samples/2013/7/temp              - all temps for month of 2013-07
//    //     samples/2013/7/15/temp           - all temps for day of 2013-07-15
//    //     samples/2013/7/15/22/temp/117    - temp at 10 PM on 2013-07-15 for station 117
//    //     samples/current/-1/temp          - all temps at this moment, one year ago today
//    //     samples/current/0/0/-7/all/117   - all samples for station 117 at this moment, one week ago
//    //
//    // CONSIDER: significance of date parts determines sample range:
//    //     samples/current/0/-1/temp        - all temps for last month
//    //     samples/current/0/-1/0/temp      - all temps for the entire day exactly one month ago
//    //     samples/current/0/-1/0/0/temp    - all temps for this exact moment one month ago
//
//    var next;
//    var result = {date: {current: false, parts: [], zone: "+09:00"}, sampleType: null, stationId: null, error: null};
//
//    function parseSampleTypePath() {
//        result.sampleType = next;  // UNDONE: sample type validation -- must be one of no, no2, temp, etc.
//        result.stationId = args.shift();  // UNDONE: stationId validation -- must be numeric
//        return db.selectSamples(schema.samples, schema.stations, result);
//    }
//
//    function parseDatePath() {
//        do {
//            result.date.parts.push(next * 1);  // UNDONE: actual int validation -- must be numeric
//            next = args.shift();
//        } while (_.isFinite(next));
//        return parseSampleTypePath();
//    }
//
//    function parseCurrentPath() {
//        result.date.current = true;  // next == "current";
//        next = args.shift();
//        if (_.isFinite(next)) {
//            return parseDatePath();
//        }
//        return parseSampleTypePath();
//    }
//
//    function parseSamplesPath() {
//        next = args.shift();
//        if (_.isFinite(next)) {
//            return parseDatePath();
//        }
//        if (next === "current") {
//            return parseCurrentPath();
//        }
//        result.error = "not numeric";
//    }
//
//    var stmt = parseSamplesPath();
//
//    if (args.length > 0) {
//        result.error = "too many args";
//    }
//
//    if (result.error) {
//        response.type("json");
//        return response.json(prepare(result.error));
//    }
//
//    when(db.execute(stmt)).then(
//        function(result) {
//            response.type("json");
//            response.json(prepare(result.rows));
//        },
//        function(error) {
//            response.type("json");
//            response.json(prepare(error.message));
//        });
//});

function handleUnexpected(res, error) {
    log.error(error.stack);
    res.send(500);
}

/**
 * Returns true if the response should be compressed.
 */
function compressionFilter(req, res) {
    return /json|text|javascript|font/.test(res.getHeader('Content-Type'));
}

/**
 * Returns i as an integer if it matches the regex and lies in the range [from, to], otherwise NaN.
 */
function parseInt(i, regex, from, to) {
    if (!regex.test(i)) {
        return NaN;
    }
    var result = parseFloat(i);
    if (result !== Math.floor(result) || result < from || to < result) {
        return NaN;
    }
    return result;
}

/**
 * Returns the specified date parts as an array. Any value that is not valid for the date part it represents is
 * parsed as NaN. For example: "2013", "09", "17", "23" yields [2013, 9, 17, 23] whereas "2013", "9.1", "-17", "42"
 * yields [2013, NaN, NaN, NaN].
 */
function parseDateParts(year, month, day, hour) {
    return [
        parseInt(year, /^\d{4}$/, 2000, 2100),
        parseInt(month, /^\d{1,2}$/, 1, 12),
        parseInt(day, /^\d{1,2}$/, 1, 31),
        parseInt(hour, /^\d{1,2}$/, 0, 24)
    ];
}

/**
 * Casts v to a Number if it is truthy, otherwise null.
 */
function asNullOrNumber(v) {
    return v ? +v : null;
}

/**
 * Returns the greater of two dates.
 */
function dateMax(a, b) {
    return a < b ? b : a;  // Wish I could use Math.max here...
}

function buildResponse(rows) {
    // Build JSON response like this:
    //  [
    //    {
    //      "date": "2013-09-04 16:00:00+09:00",
    //      "samples": [ {"stationId": "101", "coordinates": [139.768119, 35.692752], "wind": [90, 0.6]}, ... ]
    //    },
    //    ...
    //  ]

    var buckets = {};  // collect rows having common dates into buckets
    rows.rows.forEach(function(row) {
        var date = row.date + ":00";
        var bucket = buckets[date];
        if (!bucket) {
            buckets[date] = bucket = [];
        }
        if (!_.isFinite(row.wd) || !_.isFinite(row.wv)) {
            return;
        }
        bucket.push({
            stationId: row.stationId.toString(),
            coordinates: [asNullOrNumber(row.longitude), asNullOrNumber(row.latitude)],
            wind: [asNullOrNumber(row.wd), asNullOrNumber(row.wv)]
        });
    });

    var result = [];
    var mostRecent = new Date("1901-01-01 00:00:00Z");
    Object.keys(buckets).forEach(function(date) {
        result.push({date: tool.withZone(date, "+09:00"), samples: buckets[date]});
        mostRecent = dateMax(mostRecent, new Date(date));
    });
    return {lastModified: mostRecent, jsonPayload: JSON.stringify(result), notFound: result.length === 0};
}

function doQuery(constraints) {
    var stmt = db.selectSamplesCompact(constraints, ["date", "stationId", "longitude", "latitude", "wv", "wd"]);
    return db.execute(stmt).then(buildResponse);
}

function memoize(f, maxEntries) {
    var memos = {};

    function invoke(x) {
        var key = JSON.stringify(arguments);
        if (_.has(memos, key)) {
            return memos[key];
        }

        var keys = Object.keys(memos);
        if (keys.length >= maxEntries) {  // If too many memos, just remove a random one--it's easy.
             delete memos[keys[_.random(0, keys.length - 1)]];
        }

        return memos[key] = f.apply(this, arguments);
    }

    invoke.resetMemos = function() { memos = {}; };
    return invoke;
}

var memoizedQuery = memoize(doQuery, 100);  // Allow many memos, but don't grow indefinitely.
exports.resetQueryMemos = memoizedQuery.resetMemos;

function query(res, constraints) {
    var queryTask = memoizedQuery(constraints);

    function sendResponse(data) {
        if (data.notFound) {
            prepareCacheControl(res, 30);
            return res.send(404);
        }
        prepareLastModified(res, data.lastModified);
        res.set("Content-Type", "application/json");
        res.send(data.jsonPayload);
    }

    return queryTask.then(sendResponse).then(null, handleUnexpected.bind(null, res));
}

app.get("/data/wind/current", function(req, res) {
    try {
        query(res, {date: {current: true, parts: [], zone: "+09:00"}});
    }
    catch (error) {
        handleUnexpected(res, error);
    }
});

app.get("/data/wind/:year/:month/:day/:hour", function(req, res) {
    try {
        var parts = parseDateParts(req.params.year, req.params.month, req.params.day, req.params.hour);
        if (isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2]) || isNaN(parts[3])) {
            return res.send(400);
        }
        query(res, {date: {current: false, parts: parts, zone: "+09:00"}});
    }
    catch (error) {
        handleUnexpected(res, error);
    }
});

app.get("/map/wind/current", function(req, res) {
    try {
        prepareLastModified(res, indexHTMLDate);
        res.send(indexHTMLText);
    }
    catch (error) {
        handleUnexpected(res, error);
    }
});

var windRegex = /\/data\/wind\/current/;  // for replacing value of '/data/wind/current' in index.html
var dateRegex = /data-date="/;  // for inserting the date of the samples when specified

app.get("/map/wind/:year/:month/:day/:hour", function(req, res) {
    try {
        var parts = parseDateParts(req.params.year, req.params.month, req.params.day, req.params.hour);
        if (isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2]) || isNaN(parts[3])) {
            return res.send(400);
        }
        var date = tool.toISOString({year: parts[0], month: parts[1], day: parts[2], hour: parts[3]});
        var text = indexHTMLText.replace(windRegex, "/data/wind/" + parts.join("/"));
        text = text.replace(dateRegex, 'data-date="' + date.substr(0, date.length - 1));  // strip off 'Z'

        prepareLastModified(res, indexHTMLDate);
        res.send(text);
    }
    catch (error) {
        handleUnexpected(res, error);
    }
});

// CF won't compress MIME type "application/x-font-ttf" (the express.js default) but will compress "font/ttf".
// https://support.cloudflare.com/hc/en-us/articles/200168396-What-will-CloudFlare-gzip-
express.static.mime.define({"font/ttf": ["ttf"]});

app.use(express.static(__dirname + "/public"));

/**
 * Adds headers to a response to specify the last modified date.
 */
function prepareLastModified(res, lastModified) {
    res.set("Last-Modified", lastModified.toUTCString());
}

/**
 * Adds headers to a response to enable caching. maxAge is number of seconds to cache the response.
 */
function prepareCacheControl(res, maxAge) {
    res.setHeader("Cache-Control", "public, max-age=" + maxAge);
    if (maxAge) {
        var now = (Math.ceil(Date.now() / 1000) + 1) * 1000;
        res.setHeader("Expires", new Date(now + maxAge * 1000).toUTCString());
    }
}

function cacheControl() {
    var SECOND = 1;
    var MINUTE = 60 * SECOND;
    var HOUR = 60 * MINUTE;
    var DAY = 24 * HOUR;
    var DEFAULT = 30 * MINUTE;

    var rules = [
        // very-short-lived
        [/data\/wind\/current/, 1 * MINUTE],

        // short-lived (default behavior for all other resources)
        [/js\/air\.js/, DEFAULT],  // override medium-lived .js rule below

        // medium-lived
        [/js\/.*\.js/, 5 * DAY],
        [/tokyo-topo\.json/, 5 * DAY],

        // long-lived
        [/mplus-.*\.ttf/, 30 * DAY],
        [/\.png|\.ico/, 30 * DAY]
    ];

    return function(req, res, next) {
        var maxAge = DEFAULT;
        for (var i = 0; i < rules.length; i++) {
            var rule = rules[i];
            if (rule[0].test(req.url)) {
                maxAge = rule[1];
                break;
            }
        }
        prepareCacheControl(res, maxAge);
        return next();
    };
}

app.listen(port);
log.info(tool.format("Listening on port {0}...", port));
