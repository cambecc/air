"use strict";

var util = require("util");
var fs = require("fs");
var _ = require("underscore");
var express = require("express");
var when = require("when");
var db = require("./db");
var tool = require("./tool");

var indexHTML = fs.readFileSync("./public/index.html", {encoding: "utf-8"});
var samplesRegex = /\/samples\/current/;  // for replacing value of 'data-samples="/samples/current"' in index.html

var app = express();

app.use(express.logger())
app.use(express.compress({filter: compressionFilter}));

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
    console.error(error);
    console.error(error.stack);
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
        if (!row.wd || !row.wv) {
            return;
        }
        bucket.push({
            stationId: row.stationId.toString(),
            coordinates: [asNullOrNumber(row.longitude), asNullOrNumber(row.latitude)],
            wind: [asNullOrNumber(row.wd), asNullOrNumber(row.wv)]
        });
    });

    var result = [];
    Object.keys(buckets).forEach(function(date) {
        result.push({date: date, samples: buckets[date]});
    });
    return JSON.stringify(result);
}

function query(constraints) {
    var stmt = db.selectSamplesCompact(constraints, ["date", "stationId", "longitude", "latitude", "wv", "wd"]);
    return db.execute(stmt).then(buildResponse);
}

var memos = {};

function process(res, constraints) {
    var key = JSON.stringify(constraints);
    var queryTask = _.has(memos, key) ?
        memos[key] :
        (memos[key] = query(constraints));

    function sendResponse(data) {
        res.set("Content-Type", "application/json");
        res.send(data);
    }

    return queryTask.then(sendResponse).then(null, handleUnexpected.bind(null, res));
}

exports.reset = function() {
    memos = {};
}

app.get("/samples/current", function(req, res) {
    try {
        process(res, {date: {current: true, parts: [], zone: "+09:00"}});
    }
    catch (error) {
        handleUnexpected(res, error);
    }
});

app.get("/samples/:year/:month/:day/:hour", function(req, res) {
    try {
        var parts = parseDateParts(req.params.year, req.params.month, req.params.day, req.params.hour);
        if (isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2]) || isNaN(parts[3])) {
            return res.send(400);
        }
        process(res, {date: {current: false, parts: parts, zone: "+09:00"}});
    }
    catch (error) {
        handleUnexpected(res, error);
    }
});

app.get("/map/current", function(req, res) {
    try {
        res.send(indexHTML);
    }
    catch (error) {
        handleUnexpected(res, error);
    }
});

app.get("/map/:year/:month/:day/:hour", function(req, res) {
    try {
        var parts = parseDateParts(req.params.year, req.params.month, req.params.day, req.params.hour);
        if (isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2]) || isNaN(parts[3])) {
            return res.send(400);
        }
        res.send(indexHTML.replace(samplesRegex, "/samples/" + parts.join("/")));
    }
    catch (error) {
        handleUnexpected(res, error);
    }
});

app.use(express.static(__dirname + "/public"));

app.listen(3000);
console.log("Listening on port 3000...");
