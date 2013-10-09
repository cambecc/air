"use strict";

console.log("============================================================");
console.log(new Date().toISOString() + " - Starting");

var util = require("util");
var _ = require("underscore");
var when = require("when");
var db = require("./db");
var scraper = require("./scraper");
var tool = require("./tool");
var schema = require("./schema");
var api = require("./api");
var stationsData = require("./station-data");

var log = tool.log();
var iconvShiftJIStoUTF8 = new (require("iconv")).Iconv("SHIFT_JIS", "UTF-8//TRANSLIT//IGNORE");
var shiftJIStoUTF8 = iconvShiftJIStoUTF8.convert.bind(iconvShiftJIStoUTF8);

var scrapeURL = process.argv[4];
var stationNames = {};

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

    return db.upsert(schema.samples, item);
}

function processP160(dom) {
    log.info("Processing P160...");

    var tables = scraper.tablesOf(dom);
    if (tables.length < 4) {
        log.error("no data found");
        return null;
    }

    var header = scraper.extract(tables[2])[0];  // table at index two is the header
    validateP160Header(header);

    var date = extractP160DateTime(dom);
    var rows = scraper.extract(tables[3]);  // table at index three is the data
    return rows.map(function(row) { return processP160Row(row, date); });
}

function start() {
    log.info("Preparing tables...");
    return persist([db.createTable(schema.stations), db.createTable(schema.samples)]);
}

function scrapeP160(page, date) {
    date = date ? Math.floor(date.getTime() / 1000) : "";
    var url = tool.format("{0}/p160.cgi?no2=={1}={2}==2====2=", scrapeURL, date, page);
    return scraper.fetch(url, shiftJIStoUTF8);
}

function persist(statements) {
    if (!statements) {
        return when.resolve(null);
    }
    log.info("Persisting...");
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
    // CONSIDER: This function's behavior is subtle and confusing. Improve.
    var promises = [doP160Page(1, date), doP160Page(2, date)];
    return when.reduce(
        promises,
        function(current, value) {
            return current && !value;
        },
        true);
}

function pollP160ForUpdates() {
    // Return a promise for a boolean which is true if new data was found. New data is found if the database
    // reports that rows have been inserted or updated after scraping both pages.
    // CONSIDER: This function's behavior is subtle and confusing. Improve.
    var promises = [doP160Page(1), doP160Page(2)];

    function sumRowCounts(current, value) {
        if (value) {
            value.forEach(function(result) {
                current += result.rowCount;  // abstraction leakage -- relying on rowCount to exist
            });
        }
        return current;
    }

    return when.reduce(promises, sumRowCounts, 0).then(
        function(rowsInsertedOrUpdated) {
            log.info("results of poll: rowsInsertedOrUpdated = " + rowsInsertedOrUpdated);
            // Expect at least 60 samples, otherwise scrape not successful. Ugh.
            var foundNewData = rowsInsertedOrUpdated >= 60;
            if (foundNewData) {
                log.info("resetting query memos");
                api.resetQueryMemos();
            }
            return foundNewData;
        });
}

function doStationDetails() {
    log.info("Preparing station details...");
    var statements = [];
    _.keys(stationNames).forEach(function(name) {
        statements.push(db.upsert(schema.stations, {id: stationNames[name], name: name}));
    });
    stationsData.forEach(function(station) {
        var row = {
            id: station[0],
            name: station[1],
            address: station[2],
            latitude: station[3],
            longitude: station[4]
        };
        statements.push(db.upsert(schema.stations, row));
    });
    return persist(statements);
}

function doP160Historical(hours) {
    log.info("Starting P160 Historical...");
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
            log.info(tool.format("Processing {0}... (remaining: {1})", date, dates.length));
            return doP160(date).then(wait).then(doAnotherDate);
        }
        else {
            log.info("Finished P160 Historical");
        }
    }(false);
}

/**
 * Look for new air data every hour.
 */
function pollForUpdates() {
    var ONE_SECOND = 1000;
    var ONE_MINUTE = 60 * ONE_SECOND;
    var ONE_HOUR = 60 * ONE_MINUTE;

    // Wait an exponentially longer amount of time after each retry, up to 15 min.
    function exponentialBackoff(t) {
        return Math.min(Math.pow(2, t < 0 ? -(t + 1) : t), 15) * ONE_MINUTE;
    }

    // The air data is updated every hour, but we don't know exactly when. By specifying initialRetry = -1,
    // the pages get scraped a little earlier than the estimated time. Eventually, the algorithm will center
    // itself on the actual time, even if it varies a bit.
    tool.setFlexInterval(pollP160ForUpdates, ONE_MINUTE, ONE_HOUR, exponentialBackoff, -1);
}

start()
    .then(doP160.bind(undefined, null))
    .then(doStationDetails)
    .then(pollForUpdates)
    .then(doP160Historical.bind(undefined, 0/*9 * 24*/)) // up to nine days of historical data available
    .then(null, function(e) { log.error(e.stack); });
