"use strict";

var util = require("util");
var express = require("express");
var db = require("./db");
var when = require("when");
var _ = require("underscore");
var tool = require("./tool");

var app = express();
var stationsTable;
var samplesTable;

exports.initialize = function(stationsTableSpec, samplesTableSpec) {
    stationsTable = stationsTableSpec;
    samplesTable = samplesTableSpec;
    return this;
}

function prepare(value) {
    return value;
//    return JSON.stringify(value, null, " ");
}

app.get("/about/stations", function(request, response) {
    var schema = {};
    stationsTable.columns.forEach(function(column) {
        schema[column.name] = column.description;
    });
    response.type("json");
    response.json(prepare(schema));
});

app.get("/stations", function(request, response) {
    var stmt = db.selectAll(stationsTable);
    when(db.execute(stmt)).then(
        function(result) {
            response.type("json");
            response.json(prepare(result.rows));
        },
        function(error) {
            response.type("json");
            response.json(prepare(error.message));
        });
});

app.get("/stations/geo", function(request, response) {
    var stmt = db.selectAll(stationsTable);
    when(db.execute(stmt)).then(
        function(result) {
            var out = {
                type: "FeatureCollection",
                features: result.rows.map(function(element) {
                    return {
                        type: "Feature",
                        properties: {name: element.id.toString()},
                        geometry: {
                            type: "Point",
                            coordinates: [
                                parseFloat(element.longitude),
                                parseFloat(element.latitude)
                            ]
                        }
                    }
                })
            };
            response.type("json");
            response.json(prepare(out));
        },
        function(error) {
            response.type("json");
            response.json(prepare(error.message));
        });
});

app.get("/about/samples", function(request, response) {
    var schema = {};
    samplesTable.columns.forEach(function(column) {
        schema[column.name] = column.description;
    });
    response.type("json");
    response.json(prepare(schema));
});

app.get("/samples/*", function(request, response) {
    var args = request.params[0].split(/\//);
    console.log("/samples/* " + util.inspect(args));

    // sample-type := 'all' | 'temp' | 'hum' | 'wd' | ...
    // station-id := int
    // year, month, day, hour := int
    //
    // sample-type-path := sample-type [ '/' station-id ]
    // date-path := year [ '/' month [ '/' day [ '/' hour ] ] ] [ '/' sample-type-path ]
    // current-path := 'current' [ '/' (date-path | sample-type-path) ]
    // samples-path := 'samples' [ '/' (current-path | date-path) ]
    //
    // examples:
    //     samples/current                  - all current samples
    //     samples/current/temp             - all current temps
    //     samples/current/temp/117         - current temp at station 117
    //     samples/2013/7/temp              - all temps for month of 2013-07
    //     samples/2013/7/15/temp           - all temps for day of 2013-07-15
    //     samples/2013/7/15/22/temp/117    - temp at 10 PM on 2013-07-15 for station 117
    //     samples/current/-1/temp          - all temps at this moment, one year ago today
    //     samples/current/0/0/-7/all/117   - all samples for station 117 at this moment, one week ago
    //
    // CONSIDER: significance of date parts determines sample range:
    //     samples/current/0/-1/temp        - all temps for last month
    //     samples/current/0/-1/0/temp      - all temps for the entire day exactly one month ago
    //     samples/current/0/-1/0/0/temp    - all temps for this exact moment one month ago

    var next;
    var result = {date: {current: false, parts: [], zone: "+09:00"}, sampleType: null, stationId: null, error: null};

    function parseSampleTypePath() {
        result.sampleType = next;  // UNDONE: sample type validation -- must be one of no, no2, temp, etc.
        result.stationId = args.shift();  // UNDONE: stationId validation -- must be numeric
        return db.selectSamples(samplesTable, stationsTable, result);
    }

    function parseDatePath() {
        do {
            result.date.parts.push(next * 1);  // UNDONE: actual int validation -- must be numeric
            next = args.shift();
        } while (_.isFinite(next));
        return parseSampleTypePath();
    }

    function parseCurrentPath() {
        result.date.current = true;  // next == "current";
        next = args.shift();
        if (_.isFinite(next)) {
            return parseDatePath();
        }
        return parseSampleTypePath();
    }

    function parseSamplesPath() {
        next = args.shift();
        if (_.isFinite(next)) {
            return parseDatePath();
        }
        if (next === "current") {
            return parseCurrentPath();
        }
        result.error = "not numeric";
    }

    var stmt = parseSamplesPath();

    if (args.length > 0) {
        result.error = "too many args";
    }

    if (result.error) {
        response.type("json");
        return response.json(prepare(result.error));
    }

    when(db.execute(stmt)).then(
        function(result) {
            response.type("json");
            response.json(prepare(result.rows));
        },
        function(error) {
            response.type("json");
            response.json(prepare(error.message));
        });
});

app.use(express.static(__dirname + "/public"));
var server = require("http").Server(app);

//var io = require("socket.io").listen(server);
//// listen for incoming connections from client
//io.sockets.on("connection", function (socket) {
//
//    // start listening for coords
//    socket.on("send:coords", function (data) {
//
//        when(db.execute(db.selectAll(stationsTable))).then(
//            function(result) {
//                var coords = [];
//                result.rows.forEach(function(row) {
//                    if (row.latitude && row.longitude) {
//                        coords.push({lat: row.latitude, lng: row.longitude, acr: 0});
//                    }
//                });
//                var data = {id: "stations", active: true, coords: coords};
//                console.log("broadcast: " + util.inspect(data, {depth:null}));
//                socket.broadcast.emit("load:coords", data);
//            },
//            console.error);
//
//        // broadcast your coordinates to everyone except you
//        socket.broadcast.emit("load:coords", data);
//    });
//});

app.listen(3000);
console.log("Listening on port 3000...");
