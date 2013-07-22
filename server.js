'use strict';

var util = require('util');
var _ = require('underscore');
_.format = function format(pattern) {
    var args = _.rest(arguments, 1);
    return pattern.replace(/{(\d+)}/g, function(match, capture) {
        var index = capture * 1;
        return 0 <= index && index < args.length ? args[index] : match;
    });
}

var htmlparser = require('htmlparser');
var when = require('when');
var pipeline = require('when/pipeline');
var db = require(__dirname + '/db');
var scraper = require(__dirname + '/scraper');

var stationNames = {};

var stationsTable = {
    name: 'stations',
    owner: 'postgres',
    columns: [
        {name: 'id', type: 'INTEGER', modifier: 'NOT NULL'},
        {name: 'name', type: 'TEXT'},
        {name: 'address', type: 'TEXT'}
    ],
    primary: {name: 'stations_PK', columns: ['id']}
}

var samplesTable = {
    name: 'samples',
    owner: 'postgres',
    columns: [
        {name: 'date', type: 'TIMESTAMP WITH TIME ZONE', modifier: 'NOT NULL'},
        {name: 'stationId', type: 'INTEGER', modifier: 'NOT NULL'},
        {name: 'temp', type: 'NUMERIC(4, 1)'},  // temperature (C)
        {name: 'hum', type: 'NUMERIC(4, 1)'},   // humidity (%)
        {name: 'wv', type: 'NUMERIC(4, 1)'},    // wind velocity (m/s)
        {name: 'wd', type: 'NUMERIC(4, 1)'},    // wind direction (deg)
        {name: 'in', type: 'NUMERIC(4, 2)'},    // insolation, solar irradiation (MJ/m2 [over 1 hr])
        {name: 'no', type: 'NUMERIC(5, 3)'},    // nitric monoxide 一酸化窒素 (cm3/m3 [ppm])
        {name: 'no2', type: 'NUMERIC(5, 3)'},   // nitrogen dioxide 二酸化窒素 (cm3/m3 [ppm])
        {name: 'nox', type: 'NUMERIC(5, 3)'},   // nitrogen oxide 窒素酸化物 (cm3/m3 [ppm])
        {name: 'ox', type: 'NUMERIC(5, 3)'},    // photochemical oxidant (cm3/m3 [ppm])
        {name: 'so2', type: 'NUMERIC(5, 3)'},   // sulfur dioxide (cm3/m3 [ppm])
        {name: 'co', type: 'NUMERIC(5, 1)'},    // carbon monoxide (cm3/m3 [ppm])
        {name: 'ch4', type: 'NUMERIC(5, 2)'},   // methane (cm3/m3 [ppm])
        {name: 'nmhc', type: 'NUMERIC(5, 2)'},  // non-methane hydrocarbon (cm3/m3 [ppm])
        {name: 'spm', type: 'NUMERIC(4, 0)'},   // suspended particulate matter (μg/m3)
        {name: 'pm25', type: 'NUMERIC(4, 0)'}   // 2.5 micron particulate matter (μg/m3)
    ],
    primary: {name: 'samples_PK', columns: ['date', 'stationId']}
};

function zeroPad(num, numZeros) {
    var n = Math.abs(num);
    var zeros = Math.max(0, numZeros - Math.floor(n).toString().length);
    var zeroString = Math.pow(10, zeros).toString().substr(1);
    if (num < 0) {
        zeroString = '-' + zeroString;
    }
    return zeroString + n;
}

function tablesOf(dom) {
    return htmlparser.DomUtils.getElements({ tag_type: 'tag', tag_name: 'table' }, dom);
}

function rowsOf(dom) {
    return htmlparser.DomUtils.getElements({ tag_type: 'tag', tag_name: 'tr' }, dom);
}

function textsOf(dom) {
    return htmlparser.DomUtils.getElements({ tag_type: 'text' }, dom);
}

function extract(table) {
    var rowElements = rowsOf(table);
    return rowElements.map(function(rowElement) {
        var textElements = textsOf(rowElement);
        return textElements.map(function(textElement) {
            var value = textElement.data;
            return value.trim();
        });
    });
}

function dateFilter(regex) {
    return { tag_type: 'text', tag_contains: function(s) { return s.search(regex) > -1; } };
}

function extractP282Date(dom) {
    var regex = /−(.*)年(.*)月(.*)日.*−/;
    var found = htmlparser.DomUtils.getElements(dateFilter(regex), dom);
    if (!found || found.length == 0) {
        throw 'Cannot find P282 date: ' + util.inspect(dom);
    }
    var parts = found[0].data.match(regex);
    var year = parts[1], month = parts[2], day = parts[3];
    return year + '-' + zeroPad(month, 2) + '-' + zeroPad(day, 2);
}

function constructP282DateTime(ymd, hour) {
    var days = Math.floor(hour / 24);
    hour %= 24;
    var date = new Date(ymd + 'T' + zeroPad(hour, 2) + ':00:00+09:00');
    date.setDate(date.getDate() + days);
    var year = date.getFullYear(), month = date.getMonth() + 1, day = date.getDate();
    return year + '-' + zeroPad(month, 2) + '-' + zeroPad(day, 2) + 'T' + zeroPad(date.getHours(), 2) + ':00:00+09:00';
}

function extractP160DateTime(dom) {
    var regex = /−(.*)年(.*)月(.*)日(.*)時.*−/;
    var found = htmlparser.DomUtils.getElements(dateFilter(regex), dom);
    if (!found || found.length == 0) {
        throw 'Cannot find P160 date: ' + util.inspect(dom, {depth:null});
    }
    var parts = found[0].data.match(regex);
    var year = parts[1], month = parts[2], day = parts[3], hour = parts[4];
    return year + '-' + zeroPad(month, 2) + '-' + zeroPad(day, 2) + 'T' + zeroPad(hour, 2) + ':00:00+09:00';
}

function cardinalToDegrees(s) {
    switch (s) {
        case 'N':   return 0;
        case 'NNE': return 22.5;
        case 'NE':  return 45;
        case 'ENE': return 67.5;
        case 'E':   return 90;
        case 'ESE': return 112.5;
        case 'SE':  return 135;
        case 'SSE': return 157.5;
        case 'S':   return 180;
        case 'SSW': return 202.5;
        case 'SW':  return 225;
        case 'WSW': return 247.5;
        case 'W':   return 270;
        case 'WNW': return 292.5;
        case 'NW':  return 315;
        case 'NNW': return 337.5;
        default: return s;
    }
}

function addTag(target, tag, value) {
    if (value && value !== '-' && value !== '&nbsp' && value.trim().length !== 0) {
        var scale = 1;
        switch (tag) {
            case 'temp': scale = 0.1; break;    // 0.1 deg C -> deg C
            case 'hum': scale = 0.1; break;     // 0.1% -> 1%
            case 'wv':
                value = (value == 'C' ? 0 : value);
                scale = 0.1;                    // 0.1 m/s -> 1 m/s
                break;
            case 'wd':
                value = cardinalToDegrees(value);
                break;
            case 'in': scale = 0.01; break;     // 0.01 MJ/m2 -> MJ/m2
            case 'no': scale = 0.001; break;    // mm3/m3 -> cm3/m3
            case 'no2': scale = 0.001; break;   // mm3/m3 -> cm3/m3
            case 'nox': scale = 0.001; break;   // mm3/m3 -> cm3/m3
            case 'ox': scale = 0.001; break;    // mm3/m3 -> cm3/m3
            case 'so2': scale = 0.001; break;   // mm3/m3 -> cm3/m3
            case 'co': scale = 0.1; break;      // 0.1 cm3/m3 -> cm3/m3
            case 'ch4': scale = 0.01; break;    // 10 mm3/m3 -> cm3/m3
            case 'nmhc': scale = 0.01; break;   // 10 mm3/m3 -> cm3/m3
            case 'spm': break;                  // μg/m3
            case 'pm25': break;                 // μg/m3
        }
        target[tag] = value * scale;
    }
    return target;
}

function validateP282Header(header, sampleType) {
    var expected = '測定局,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,';
    expected += (sampleType === 'wd' ? '最多' : '平均');
    var actual = '' + header;
    if (actual !== expected) {
        throw 'Expected P282 header: \n    ' + expected + '\nbut found:\n    ' + actual;
    }
}

function processP282Row(row, ymd, sampleType) {
    var results = [];
    var stationName = row[1];
    for (var i = 2; i < 26; i++) {
        var stationId = stationNames[stationName];
        var item = { stationId: stationId, stationName: stationName, date: constructP282DateTime(ymd, i - 1) };
        var sample = row[i];
        addTag(item, sampleType, sample);
        // Skip items that have no sample for the current sample type.
        if (item[sampleType]) {
            results.push(db.upsert(samplesTable, item));
        }
    }
    return results;
}

function processP282(sampleType, dom) {
    var text = textsOf(htmlparser.DomUtils.getElements({ tag_type: 'tag', tag_name: 'pre' }, dom));
    var rows = text[0].data.split(/[\r\n]+/);  // split on line terminators

    var ymd = extractP282Date(dom);

    var results = [];
    var header = null;
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i].trim().split(/\s+/);  // split on whitespace to create columns
        if (row.length > 1) {  // empty rows will become [''], an array with one empty string element.
            if (!header) {
                validateP282Header(header = row, sampleType);
            }
            else {
                processP282Row(row, ymd, sampleType).forEach(function(x) { results.push(x); });
            }
        }
    }
    return results;
}

function validateP160Header(header) {
    var expected =
        '番号,局番,局名,SO2,ppb,Ox,ppb,NO,ppb,NO2,ppb,NOx,ppb,CO,0.1ppm,SPM,μg/m3,NMHC,' +
        'pphmC,CH4,pphmC,PM2.5,μg/m3,風向,風速,0.1m/s,気温,0.1度,湿度,0.1％,日射量,0.01MJ/m2';
    var actual = '' + header;
    if (actual !== expected) {
        throw 'Expected P160 header: \n    ' + expected + '\nbut found:\n    ' + actual;
    }
}

function processP160Row(row, date) {
    /*  0    1    2   3   4  5  6   7   8  9   10  11   12   13   14   15  16   17
      番号 局番 局名 SO2 Ox NO NO2 NOx CO SPM NMHC CH4 PM2.5 風向 風速 気温 湿度 日射量 */
    var stationId = row[1] * 1;
    var stationName = row[2];

    stationNames[stationName] = stationId;

    var item = { stationId: stationId, stationName: stationName, date: date };
    addTag(item, 'so2', row[3]);
    addTag(item, 'ox', row[4]);
    addTag(item, 'no', row[5]);
    addTag(item, 'no2', row[6]);
    addTag(item, 'nox', row[7]);
    addTag(item, 'co', row[8]);
    addTag(item, 'spm', row[9]);
    addTag(item, 'nmhc', row[10]);
    addTag(item, 'ch4', row[11]);
    addTag(item, 'pm25', row[12]);
    addTag(item, 'wd', row[13]);
    addTag(item, 'wv', row[14]);
    addTag(item, 'temp', row[15]);
    addTag(item, 'hum', row[16]);
    addTag(item, 'in', row[17]);

    return db.upsert(samplesTable, item);
}

function processP160(dom) {
    console.log('[ZZZ] Processing P160...');

    var tables = tablesOf(dom);
    var header = extract(tables[2])[0];
    validateP160Header(header);

    var date = extractP160DateTime(dom);
    var rows = extract(tables[3]);
    return rows.map(function(row) { return processP160Row(row, date); });
}

function start() {
    console.log('[ZZZ] Starting...');
    return when.all([
        db.execute(db.createTable(stationsTable)),
        db.execute(db.createTable(samplesTable))
    ]);
}

function scrapeP160(page) {
    var url = _.format('http://www.kankyo.metro.tokyo.jp/cgi-bin/bunpu1/p160.cgi?no2==={0}==2====2=', page);
    return scraper.fetch(url);
}

function scrapeP282(sampleType, page) {
    var url = _.format('http://www.kankyo.metro.tokyo.jp/cgi-bin/bunpu1/p282.cgi?{0}==={1}==a=0===7=', sampleType, page);
    return scraper.fetch(url);
}

function persist(statements) {
    console.log('[ZZZ] Persisting...');
    return db.executeAll(statements);
}

function doP160() {
    console.log('[ZZZ] Starting P160...');
    return when.all([
        pipeline([scrapeP160, processP160, persist], 1),
        pipeline([scrapeP160, processP160, persist], 2)]);
}

function doP282() {
    console.log('[ZZZ] Starting P282...');
    return ['temp', 'hum', 'wv', 'wd', 'no', 'no2', 'nox', 'ox', 'so2', 'co', 'ch4', 'nmhc', 'spm', 'pm25'].map(
        function (sampleType) {
            function scrape(page) { return scrapeP282(sampleType, page); }
            function process(dom) { return processP282(sampleType, dom); }

            return when.all([
                pipeline([scrape, process, persist], 1),
                pipeline([scrape, process, persist], 2)]);
        });
}

when(start()).then(pipeline([doP160, doP282]), console.error);
