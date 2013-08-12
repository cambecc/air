'use strict';

var util = require('util');
var _ = require('underscore');
var tool = require('./tool');
var when = require('when');
var pg = require('pg');
var connectionString = tool.format('postgres://postgres:{0}@localhost:5432/air', process.argv[2]);

var labels = ['year', 'month', 'day', 'hour', 'minute', 'second'];

function nameQuote(s) {
    return '"' + s + '"';
}

function valueQuote(s) {
    return "'" + s + "'";
}

function cast(value, type) {
    return 'CAST(' + value + ' AS ' + type + ')';
}

exports.dropTable = function dropTable(tableSpec) {
    return 'DROP TABLE IF EXISTS ' + nameQuote(tableSpec.name) + ';';
}

exports.createTable = function createTable(tableSpec) {
    var stmt = 'CREATE TABLE IF NOT EXISTS ' + nameQuote(tableSpec.name) + ' (\n    ';
    stmt += tableSpec.columns.map(function(column) {
        return nameQuote(column.name) + ' ' + column.type + (column.modifier ? ' ' + column.modifier : '');
    }).join(',\n    ');
    if (tableSpec.primary) {
        stmt += ',\n    CONSTRAINT ' + nameQuote(tableSpec.primary.name) + ' PRIMARY KEY (';
        stmt += tableSpec.primary.columns.map(function(x) { return nameQuote(x); }).join(', ') + ')';
    }
    stmt += '\n) WITH (OIDS = FALSE);';
    if (tableSpec.owner) {
        stmt += '\nALTER TABLE ' + nameQuote(tableSpec.name) + ' OWNER TO ' + tableSpec.owner + ';';
    }
    return stmt;
}

exports.upsert = function upsert(tableSpec, row) {
    /*
        WITH new_values (id, field1, field2) AS (
            VALUES ($1, $2, $3)),
        upsert AS (
            UPDATE someTable m
                SET field1 = nv.field1,
                    field2 = nv.field2
            FROM new_values nv
            WHERE m.id = nv.id
            RETURNING m.*
        )
        INSERT INTO someTable (id, field1, field2)
        SELECT id, field1, field2
        FROM new_values
        WHERE NOT EXISTS (SELECT 1 FROM upsert up WHERE up.id = new_values.id)
    */

    var table = nameQuote(tableSpec.name);
    var columns = tableSpec.columns;
    var quotedNames = columns.map(function(column) { return nameQuote(column.name); });
    var allQuotedNames = quotedNames.join(', ');
    function idEqualityExpression(l, r) {
        return tableSpec.primary.columns.map(function(n) {
            return l + '.' + nameQuote(n) + ' = ' + r + '.' + nameQuote(n);
        }).join(' AND ');
    }

    var stmt = '';

    var values = [];

    stmt += 'WITH new_values (' + allQuotedNames + ') AS (\n';
    stmt += '    VALUES (\n        ';
    stmt += columns.map(function(column, i) {
        var value = row[column.name];
        if (typeof value === 'undefined') {
            value = null;
        }
        values.push(value);
        return cast('$' + (i + 1), column.type);
    }).join(',\n        ');
    stmt += ')),\n';
    stmt += 'upsert AS (\n    UPDATE ' + table + ' m SET\n        ';

    var provided = [];
    columns.forEach(function(column, i) {
        // Skip assignment of columns that have no value defined for them. This will retain the column value
        // of the row if it exists.
        if (typeof row[column.name] !== 'undefined') {
            provided.push(quotedNames[i]);
        }
    });

    stmt += provided.map(function(n) {return n + ' = nv.' + n}).join(',\n        ') + '\n';
    stmt += '    FROM new_values nv\n';
    stmt += '    WHERE ' + idEqualityExpression('m', 'nv') + '\n';
    stmt += '    RETURNING m.*)\n';

    stmt += 'INSERT INTO ' + table + '(' + allQuotedNames + ')\n';
    stmt += 'SELECT ' + allQuotedNames + '\n';
    stmt += 'FROM new_values\n';
    stmt += 'WHERE NOT EXISTS (SELECT 1 FROM upsert up WHERE ' + idEqualityExpression('up', 'new_values') + ');\n';

    return { sql: stmt, args: values };
}

function buildDateConstraint(constraints) {
    var parts = constraints.parts;

    if (constraints.current) {
        var condition = '(SELECT MAX("date") FROM "samples")';
        if (parts.length > 0) {
            // "date" = ((select max(date) from samples) + INTERVAL '-1 day -3 hour') order by date
            condition = tool.format('({0} + INTERVAL \'{1}\')',
                condition,
                parts.map(function(item, i) {
                    return item + ' ' + labels[i];
                }).join(' '));
        }
        return '"date" = ' + condition;
    }
    var str = tool.toISOString({year: parts[0], month: parts[1], day: parts[2], hour: parts[3], zone: '+09:00'});
    return tool.format(
        '{0} <= "date" AND "date" < CAST({0} AS TIMESTAMP WITH TIME ZONE) + INTERVAL \'1 {1}\'',
        valueQuote(str),
        labels[parts.length - 1]);
}

function buildTypeConstraint(constraints) {
    // UNDONE: validation sampleType and give err if not supported -- or just select nothing..
    // which wouldn't make too much sense.
    if (constraints.sampleType && constraints.sampleType != '') {
        return '"' + constraints.sampleType + '" IS NOT NULL';   // is this actually needed? so what if null returned...
    }
    return undefined;
}

function buildStationConstraint(constraints) {
    // UNDONE: validate stationId and give err if not supported -- or just select nothing...
    if (_.isFinite(constraints.stationId)) {
        return '"stationId" = ' + (constraints.stationId * 1);
    }
    return undefined;
}

exports.buildStatement = function(constraints) {
    console.log(constraints);
    var stmt = 'SELECT ';
    if (constraints.sampleType && constraints.sampleType != 'all') {  // UNDONE: sampleType may be ''.
        stmt += tool.format('CAST("date" AS TEXT), "stationId", "{0}" ', constraints.sampleType);  // UNDONE: protect sql
    }
    else {
        stmt += '* ';
    }
    stmt += '\nFROM "samples" WHERE ' + buildDateConstraint(constraints);
//    var typeConstraint = buildTypeConstraint(constraints);
//    if (typeConstraint) {
//        stmt += ' AND ' + typeConstraint;
//    }
    var stationConstraint = buildStationConstraint(constraints);
    if (stationConstraint) {
        stmt += ' AND ' + stationConstraint;
    }
    return stmt + '\nORDER BY "date" DESC, "stationId"';
}

exports.execute = function(statement) {
    var d = when.defer();

    pg.connect(connectionString, function(error, client, done) {
        if (error) {
            return d.reject(error);
        }

        var sql = typeof statement === 'string' ? statement : statement.sql;
        var args = typeof statement === 'string' ? null : statement.args;

        console.log(sql + (args ? '; ' + args : ''));

        client.query(sql, args, function(error, result) {
            done();
            if (error) {
                return d.reject(error);
            }
            d.resolve(result);
        }).on('row', function(row) {
            d.notify(row);
        });
    });

    return d.promise;
}

exports.executeAll = function(statements) {
    var last = statements.length - 1;
    if (last < 0) {
        return when.resolve([]);
    }
    var d = when.defer();

    pg.connect(connectionString, function(error, client, done) {
        if (error) {
            return d.reject(error);
        }

        d.resolve(statements.map(function(statement, index) {
            var sd = when.defer();
            var sql = typeof statement === 'string' ? statement : statement.sql;
            var args = typeof statement === 'string' ? null : statement.args;

            console.log(/*sql + */(args ? '; ' + args : ''));

            client.query(sql, args, function(error, result) {
                if (index == last || error) {
                    done();
                }
                if (error) {
                    return sd.reject(error);
                }
                sd.resolve(result);
            }).on('row', function(row) {
                sd.notify(row);
            });

            return sd.promise;
        }));
    });
    return d.promise;
}

exports.done = function() {
    pg.end();
}
