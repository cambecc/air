"use strict";

var util = require("util");
var _ = require("underscore");
var when = require("when");
var db = require("./db");
var scraper = require("./scraper");
var tool = require("./tool");
var stationsData = require("./station-data");
var iconvShiftJIStoUTF8 = new (require("iconv")).Iconv("SHIFT_JIS", "UTF-8//TRANSLIT//IGNORE");
var shiftJIStoUTF8 = iconvShiftJIStoUTF8.convert.bind(iconvShiftJIStoUTF8);

var stationNames = {};

var stationsTable = {
    name: "stations",
    owner: "postgres",
    columns: [
        {name: "id", type: "INTEGER", modifier: "NOT NULL", description: "station id"},
        {name: "name", type: "TEXT", description: "station name"},
        {name: "address", type: "TEXT", description: "station location"},
        {name: "latitude", type: "NUMERIC(9, 6)", description: "latitude"},
        {name: "longitude", type: "NUMERIC(9, 6)", description: "longitude"}
    ],
    primary: {name: "stations_PK", columns: ["id"]}
}

var samplesTable = {
    name: "samples",
    owner: "postgres",
    columns: [
        {name: "date", type: "TIMESTAMP WITH TIME ZONE", modifier: "NOT NULL", description: "sample date"},
        {name: "stationId", type: "INTEGER", modifier: "NOT NULL", description: "sampling station"},
        {name: "temp", type: "NUMERIC(4, 1)", description: "temperature (C)"},
        {name: "hum", type: "NUMERIC(4, 1)", description: "humidity (%)"},
        {name: "wv", type: "NUMERIC(4, 1)", description: "wind velocity (m/s)"},
        {name: "wd", type: "NUMERIC(4, 1)", description: "wind direction (deg)"},
        {name: "in", type: "NUMERIC(4, 2)", description: "insolation, solar irradiation (MJ/m2 [over 1 hr])"},
        {name: "no", type: "NUMERIC(5, 3)", description: "nitric monoxide 一酸化窒素 (cm3/m3 [ppm])"},
        {name: "no2", type: "NUMERIC(5, 3)", description: "nitrogen dioxide 二酸化窒素 (cm3/m3 [ppm])"},
        {name: "nox", type: "NUMERIC(5, 3)", description: "nitrogen oxide 窒素酸化物 (cm3/m3 [ppm])"},
        {name: "ox", type: "NUMERIC(5, 3)", description: "photochemical oxidant (cm3/m3 [ppm])"},
        {name: "so2", type: "NUMERIC(5, 3)", description: "sulfur dioxide (cm3/m3 [ppm])"},
        {name: "co", type: "NUMERIC(5, 1)", description: "carbon monoxide (cm3/m3 [ppm])"},
        {name: "ch4", type: "NUMERIC(5, 2)", description: "methane (cm3/m3 [ppm])"},
        {name: "nmhc", type: "NUMERIC(5, 2)", description: "non-methane hydrocarbon (cm3/m3 [ppm])"},
        {name: "spm", type: "NUMERIC(4, 0)", description: "suspended particulate matter (μg/m3)"},
        {name: "pm25", type: "NUMERIC(4, 0)", description: "2.5 micron particulate matter (μg/m3)"}
    ],
    primary: {name: "samples_PK", columns: ["date", "stationId"]}
};

var api = require("./api").initialize(stationsTable, samplesTable);

function extractP160DateTime(dom) {
    var parts = scraper.matchText(/−(.*)年(.*)月(.*)日(.*)時.*−/, dom)[0];
    return tool.toISOString({year: parts[1], month: parts[2], day: parts[3], hour: parts[4], zone: "+09:00"});
}

function cardinalToDegrees(s) {
    switch (s) {
        case "N":   return 0;
        case "NNE": return 22.5;
        case "NE":  return 45;
        case "ENE": return 67.5;
        case "E":   return 90;
        case "ESE": return 112.5;
        case "SE":  return 135;
        case "SSE": return 157.5;
        case "S":   return 180;
        case "SSW": return 202.5;
        case "SW":  return 225;
        case "WSW": return 247.5;
        case "W":   return 270;
        case "WNW": return 292.5;
        case "NW":  return 315;
        case "NNW": return 337.5;
        case "C":   return 360;  // calm; map to 360 to distinguish from 0 (N) and null (no sample)
        default: return s;
    }
}

function addTag(target, tag, value) {
    value = (value || "").trim();
    if (value.length > 0 && value !== "-" && value !== "&nbsp") {
        var scale = 1;
        switch (tag) {
            case "temp": scale = 0.1; break;    // 0.1 deg C -> deg C
            case "hum": scale = 0.1; break;     // 0.1% -> 1%
            case "wv":
                value = (value == "C" ? 0 : value);
                scale = 0.1;                    // 0.1 m/s -> 1 m/s
                break;
            case "wd":
                value = cardinalToDegrees(value);
                break;
            case "in": scale = 0.01; break;     // 0.01 MJ/m2 -> MJ/m2
            case "no": scale = 0.001; break;    // mm3/m3 -> cm3/m3
            case "no2": scale = 0.001; break;   // mm3/m3 -> cm3/m3
            case "nox": scale = 0.001; break;   // mm3/m3 -> cm3/m3
            case "ox": scale = 0.001; break;    // mm3/m3 -> cm3/m3
            case "so2": scale = 0.001; break;   // mm3/m3 -> cm3/m3
            case "co": scale = 0.1; break;      // 0.1 cm3/m3 -> cm3/m3
            case "ch4": scale = 0.01; break;    // 10 mm3/m3 -> cm3/m3
            case "nmhc": scale = 0.01; break;   // 10 mm3/m3 -> cm3/m3
            case "spm": break;                  // μg/m3
            case "pm25": break;                 // μg/m3
        }
        target[tag] = value * scale;
    }
    return target;
}

function validateP160Header(header) {
    var expected =
        "番号,局番,局名,SO2,ppb,Ox,ppb,NO,ppb,NO2,ppb,NOx,ppb,CO,0.1ppm,SPM,μg/m3,NMHC," +
        "pphmC,CH4,pphmC,PM2.5,μg/m3,風向,風速,0.1m/s,気温,0.1度,湿度,0.1％,日射量,0.01MJ/m2";
    var actual = "" + header;
    if (actual !== expected) {
        throw "Expected P160 header: \n    " + expected + "\nbut found:\n    " + actual;
    }
}

function processP160Row(row, date) {
    /* 0   1    2   3   4  5  6   7   8  9   10   11  12    13   14  15   16   17
      番号 局番 局名 SO2 Ox NO NO2 NOx CO SPM NMHC CH4 PM2.5 風向 風速 気温 湿度 日射量 */
    var stationId = row[1] * 1;
    var stationName = row[2];

    stationNames[stationName] = stationId;

    var item = { stationId: stationId, stationName: stationName, date: date };
    addTag(item, "so2", row[3]);
    addTag(item, "ox", row[4]);
    addTag(item, "no", row[5]);
    addTag(item, "no2", row[6]);
    addTag(item, "nox", row[7]);
    addTag(item, "co", row[8]);
    addTag(item, "spm", row[9]);
    addTag(item, "nmhc", row[10]);
    addTag(item, "ch4", row[11]);
    addTag(item, "pm25", row[12]);
    addTag(item, "wd", row[13]);
    addTag(item, "wv", row[14]);
    addTag(item, "temp", row[15]);
    addTag(item, "hum", row[16]);
    addTag(item, "in", row[17]);

    return db.upsert(samplesTable, item);
}

function processP160(dom) {
    console.log("Processing P160...");

    var tables = scraper.tablesOf(dom);
    if (tables.length < 4) {
        console.log("no data found");
        return null;
    }

    var header = scraper.extract(tables[2])[0];  // table at index two is the header
    validateP160Header(header);

    var date = extractP160DateTime(dom);
    var rows = scraper.extract(tables[3]);  // table at index three is the data
    return rows.map(function(row) { return processP160Row(row, date); });
}

function start() {
    console.log("Preparing tables...");
    return persist([db.createTable(stationsTable), db.createTable(samplesTable)]);
}

function scrapeP160(page, date) {
    date = date ? Math.floor(date.getTime() / 1000) : "";
    var url = tool.format("http://www.kankyo.metro.tokyo.jp/cgi-bin/bunpu1/p160.cgi?no2=={0}={1}==2====2=", date, page);
    return scraper.fetch(url, shiftJIStoUTF8);
}

function persist(statements) {
    if (!statements) {
        return when.resolve(null);
    }
    console.log("Persisting...");
    return db.executeAll(statements);
}

function doP160Page(page, date) {
    return scrapeP160(page, date)
        .then(processP160)
        .then(persist);
}

function doP160(date) {
    // return a promise for a boolean which is false if data was processed, and true if data was not available
    // i.e., true == we are done.
    return when.reduce(
        [doP160Page(1, date), doP160Page(2, date)],
        function(current, value) {
            return current && !value;
        },
        true);
}

function doStationDetails() {
    console.log("Preparing station details...");
    var statements = [];
    _.keys(stationNames).forEach(function(name) {
        statements.push(db.upsert(stationsTable, {id: stationNames[name], name: name}));
    });
    stationsData.forEach(function(station) {
        var row = {
            id: station[0],
            name: station[1],
            address: station[2],
            latitude: station[3],
            longitude: station[4]
        };
        statements.push(db.upsert(stationsTable, row));
    });
    return persist(statements);
}

function doP160Historical(hours) {
    console.log("Starting P160 Historical...");
    var now = new Date().getTime();
    var dates = [];
    for (var i = 1; i <= hours; i++) {
        dates.push(new Date(now - (i * 60 * 60 * 1000)));
    }

    function wait(x) {
        var d = when.defer();
        setTimeout(function() { d.resolve(x); }, 3000);
        return d.promise;
    }

    return function doAnotherDate(done) {
        if (dates.length > 0 && !done) {
            var date = dates.shift();
            console.log(tool.format("Processing {0}... (remaining: {1})", date, dates.length));
            return doP160(date).then(wait).then(doAnotherDate);
        }
        else {
            console.log("Finished P160 Historical");
        }
    }(false);
}

start()
    .then(doP160.bind(undefined, null))
    .then(doStationDetails)
    .then(doP160Historical.bind(undefined, 0/*9 * 24*/)) // up to nine days of historical data available
    .then(null, console.error);

//setInterval(function update() {
//    doP160(null).then(null, console.error);
//}, 10 * 60 * 1000);  // update every ten minutes
