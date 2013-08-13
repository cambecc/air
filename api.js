'use strict';

var util = require('util');
var express = require('express');
var db = require('./db');
var when = require('when');
var _ = require('underscore');
var tool = require('./tool');

var app = express();
var samplesTableSpec;

exports.initialize = function(samplesTable) {
    samplesTableSpec = samplesTable;
    return this;
}

app.get('/samples', function(request, response) {
    response.send('TODO: usage');
});

app.get('/samples/*', function(request, response) {
    var args = request.params[0].split(/\//);
    console.log('/samples/* ' + util.inspect(args));

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
    var result = {date: {current: false, parts: [], zone: '+09:00'}, sampleType: null, stationId: null, error: null};

    function parseSampleTypePath() {
        result.sampleType = next;  // UNDONE: sample type validation
        result.stationId = args.shift();  // UNDONE: stationId validation
        return db.selectSamples(samplesTableSpec, result);
    }

    function parseDatePath() {
        do {
            result.date.parts.push(next * 1);  // UNDONE: actual int validation
            next = args.shift();
        } while (_.isFinite(next));
        return parseSampleTypePath();
    }

    function parseCurrentPath() {
        result.date.current = true;  // next == 'current';
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
        if (next === 'current') {
            return parseCurrentPath();
        }
        result.error = 'not numeric';
    }

    var stmt = parseSamplesPath();

    if (args.length > 0) {
        result.error = 'too many args';
    }

    if (result.error) {
        return response.send(result.error);
    }

    when(db.execute(stmt)).then(
        function(result) {
            response.send(result.rows);
        },
        function(error) {
            response.send(error.message);
        });
});

app.listen(3000);
console.log('Listening on port 3000...');
