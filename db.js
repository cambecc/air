'use strict';

var util = require('util');
var _ = require('underscore');
var tool = require('./tool');
var when = require('when');
var pg = require('pg');

var connectionString = process.argv[2];  // for example: 'postgres://postgres:12345@localhost:5432/air'
var labels = ['year', 'month', 'day', 'hour', 'minute', 'second'];

/**
 * Surrounds s with double quotes.
 */
function quoteName(s) {
    return '"' + s + '"';
}

/**
 * Surrounds s with single quotes.
 */
function quoteValue(s) {
    return "'" + s + "'";
}

/**
 * Returns a sql statement that drops the specified table.
 *
 * @param {Object} tableSpec an object that describes the table structure. This function requires the name: key to
 *                 hold the table's name.
 * @returns {{sql: string, args: Array}} an object {sql: x, args: y} representing a drop table statement.
 */
exports.dropTable = function dropTable(tableSpec) {
    return {sql: tool.format('DROP TABLE IF EXISTS {0};', quoteName(tableSpec.name)), args: []};
}

/**
 * Returns a sql statement that creates the specified table if it doesn't already exist.
 *
 * @param {Object} tableSpec an object that describes the table structure. This function requires the following keys:
 *            name: the name of the table;
 *            columns: an array of column objects:
 *                name: the name of the column;
 *                type: the type of the column;
 *                modifier: optional definition flags for the column, such as 'NOT NULL';
 *            primary: an optional object to describe the table's primary key:
 *                name: the primary key's name;
 *                columns: an array of one or more column names that contribute to the primary key;
 * @returns {{sql: string, args: Array}} an object {sql: x, args: y} representing a create table statement.
 */
exports.createTable = function createTable(tableSpec) {
    var stmt = tool.format('CREATE TABLE IF NOT EXISTS {0} (\n    ', quoteName(tableSpec.name));
    stmt += tableSpec.columns.map(function(column) {
        return tool.format('{0} {1} {2}', quoteName(column.name), column.type, tool.coalesce(column.modifier, ''));
    }).join(',\n    ');
    if (tableSpec.primary) {
        stmt += tool.format(',\n    CONSTRAINT {0} PRIMARY KEY ({1})',
            quoteName(tableSpec.primary.name),
            tableSpec.primary.columns.map(function(columnName) { return quoteName(columnName); }).join(', '));
    }
    stmt += '\n) WITH (OIDS = FALSE);';
    if (tableSpec.owner) {
        stmt += tool.format('\nALTER TABLE {0} OWNER TO {1};', quoteName(tableSpec.name), tableSpec.owner);
    }
    return {sql: stmt, args: []};
}

/**
 * Returns a sql statement that either inserts or updates the provided row into the specified table.
 *
 * @param {Object} tableSpec an object that describes the table structure. This function requires the following keys:
 *            name: the name of the table;
 *            columns: an array of column objects:
 *                name: the name of the column;
 *                type: the type of the column;
 *            primary: an object to describe the table's primary key:
 *                name: the primary key's name;
 *                columns: an array of one or more column names that contribute to the primary key;
 * @param {Object} row an object of keys and values where keys correspond to column names.
 * @returns {{sql: string, args: Array}} an object {sql: x, args: y} representing an upsert statement.
 */
exports.upsert = function upsert(tableSpec, row) {
    /*  WITH new_values (id, field1, field2) AS (
            VALUES (CAST($1 AS foo), CAST($2 AS foo), CAST($3 AS foo))),
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
        WHERE NOT EXISTS (SELECT 1 FROM upsert up WHERE up.id = new_values.id) */

    var table = quoteName(tableSpec.name);
    var columns = tableSpec.columns;
    var quotedNames = columns.map(function(column) { return quoteName(column.name); });
    var allQuotedNames = quotedNames.join(', ');
    function idEqualityExpression(l, r) {
        return tableSpec.primary.columns.map(function(n) {
            return tool.format('{0}.{2} = {1}.{2}', l, r, quoteName(n));
        }).join(' AND ');
    }

    var values = [];
    var stmt = tool.format('WITH new_values ({0}) AS (\n    VALUES (\n        {1})),\n',
        allQuotedNames,
        columns.map(function(column, i) {
            var value = row[column.name];
            if (value === undefined) {
                value = null;
            }
            values.push(value);
            return tool.format('CAST(${0} AS {1})', i + 1, column.type);
        }).join(',\n        '));

    stmt += tool.format('upsert AS (\n    UPDATE {0} m SET\n        ', table);
    var provided = [];
    columns.forEach(function(column, i) {
        // Skip assignment of columns that have no value defined for them. This will retain the column value
        // of the row if it exists.
        if (row[column.name] !== undefined) {
            provided.push(quotedNames[i]);
        }
    });
    stmt += tool.format('{0}\n    FROM new_values nv\n    WHERE {1}\n    RETURNING m.*)\n',
        provided.map(function(col) {return tool.format('{0} = nv.{0}', col); }).join(',\n        '),
        idEqualityExpression('m', 'nv'));

    stmt += tool.format(
        'INSERT INTO {0}({1})\nSELECT {1}\nFROM new_values\nWHERE NOT EXISTS (SELECT 1 FROM upsert up WHERE {2});\n',
        table,
        allQuotedNames,
        idEqualityExpression('up', 'new_values'));

    return {sql: stmt, args: values};
}

/**
 * Builds a sql constraint clause for the provided date parts.
 */
function dateConstraint(date) {
    var parts = date.parts;
    var column = quoteName('date');
    var table = quoteName('samples');

    if (date.current) {
        var condition = tool.format('(SELECT MAX({0}) FROM {1})', column, table);
        if (parts.length > 0) {
            // "date" = ((select max(date) from samples) + INTERVAL '-1 day -3 hour') order by date
            condition = tool.format("({0} + INTERVAL '{1}')",
                condition,
                parts.map(function(item, i) {
                    return item + ' ' + labels[i];
                }).join(' '));
        }
        return column + ' = ' + condition;
    }
    var str = tool.toISOString({year: parts[0], month: parts[1], day: parts[2], hour: parts[3], zone: date.zone});
    return tool.format(
        '{0} <= {1} AND {1} < CAST({0} AS TIMESTAMP WITH TIME ZONE) + INTERVAL \'1 {2}\'',
        quoteValue(str),
        column,
        labels[parts.length - 1]);
}

/**
 * Builds a sql constraint clause for station id, if necessary.
 */
function stationIdConstraint(constraints) {
    return constraints.stationId ? tool.format('{0} = {1}', quoteName('stationId'), constraints.stationId) : null;
}

/**
 * Builds a sql constraint clause for sample type, if necessary.
 */
function sampleTypeConstraint(constraints) {
    return /*constraints.sampleType ? quoteName(constraints.sampleType) + ' IS NOT NULL' :*/ null;
}

/**
 * Returns a sql statement that selects samples matching the specified constraints.
 *
 * @param {Object} tableSpec
 * @param {Object} constraints an object the describes the constraints for the select, having the form:
 *                  date: {current: Boolean, parts: [year, month, day, hour], zone: string},
 *                  sampleType: string column name for sample, or null or 'all' if all requested.
 *                  stationId: Number id of desired station, or null for all.
 * @returns {{sql: string, args: Array}} an object {sql: x, args: y} representing a sample select statement.
 */
exports.selectSamples = function(tableSpec, stationTableSpec, constraints) {
    console.log(constraints);
    var dateColumn = quoteName('date');
    var idColumn = quoteName('id');
    var stationIdColumn = quoteName('stationId');
    var longitudeColumn = quoteName('longitude');
    var latitudeColumn = quoteName('latitude');
    var table = quoteName(tableSpec.name);
    var stmt = tool.format('SELECT b.{0}, b.{1}, ', longitudeColumn, latitudeColumn);

    // First, decide which columns to select.
    if (constraints.sampleType && constraints.sampleType != 'all') {
        // Select only one kind of sample, including the primary key columns. Treat date as text to preserve zone.
        stmt += tool.format('CAST({0} AS TEXT), {1}, {2} ',
            dateColumn,
            stationIdColumn,
            quoteName(constraints.sampleType));
    }
    else {
        // Select all sample kinds, including primary key columns. Treat date as text to preserve zone.
        var allColumns = tableSpec.columns.map(function(col) {
            return col.name != 'date' ? quoteName(col.name) : tool.format('CAST({0} AS TEXT)', dateColumn);
        }).join(', ');
        stmt += allColumns;
    }

    // Next, constrain the results by date, station id, and sample type, where necessary.
    stmt += tool.format('\nFROM {0} a INNER JOIN {1} b ON a.{2} = b.{3}', table, quoteName(stationTableSpec.name), stationIdColumn, idColumn);
    stmt += tool.format('\nWHERE {0}', dateConstraint(constraints.date));
    var stationConstraint = stationIdConstraint(constraints);
    if (stationConstraint) {
        stmt += ' AND ' + stationConstraint;
    }
    var typeConstraint = sampleTypeConstraint(constraints);
    if (typeConstraint) {
        stmt += ' AND ' + typeConstraint;
    }

    // Finally, order by date descending, then station id.
    return {sql: stmt + tool.format('\nORDER BY {0} DESC, {1};', dateColumn, stationIdColumn), args: []};
}

/**
 * Returns a sql statement that selects all rows from the provided table.
 *
 * @param {Object} tableSpec
 * @returns {{sql: string, args: Array}} an object {sql: x, args: y} representing a select * statement.
 */
exports.selectAll = function(tableSpec) {
    var stmt = tool.format('SELECT * FROM {0}', quoteName(tableSpec.name));
    if (tableSpec.primary) {
        stmt += tool.format('\nORDER BY {0}', tableSpec.primary.columns.map(quoteName).join(', '));
    }
    return {sql: stmt, args: []};
}

/**
 * Executes the specified statement, eventually.
 *
 * @param {Object} statement an object {sql: text, args: [x, y, z]}, were args are optional.
 * @returns {promise} a promise for the eventual processing of the statement
 */
exports.execute = function(statement) {
    var d = when.defer();

    pg.connect(connectionString, function(error, client, done) {
        if (error) {
            return d.reject(error);
        }

        var sql = typeof statement === 'string' ? statement : statement.sql;
        var args = typeof statement === 'string' ? [] : (statement.args || []);

        console.log(sql + (args.length > 0 ? '; ' + args : ''));

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

/**
 * Executes the specified statements, eventually.
 *
 * @param {Array} statements an array of statement objects {sql: text, args: [x, y, z]}, were args are optional.
 * @returns {promise} a promise for the eventual processing of the statements
 */
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
            var args = typeof statement === 'string' ? [] : (statement.args || []);

//            console.log(/*sql + */(args.length > 0 ? '; ' + args : ''));

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

/**
 * Closes the database component, for shutdown.
 */
exports.done = function() {
    pg.end();
}
