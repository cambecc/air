"use strict";

var db = require("../db");

exports.testDropTable = function(test) {
    test.deepEqual(db.dropTable({name: "foo"}), {sql: 'DROP TABLE IF EXISTS "foo";', args: []});
    test.done();
}

exports.testCreateTable = function(test) {
    var spec = {
        name: "foo",
        columns: [
            {name: "a", type: "x", modifier: "1"},
            {name: "b", type: "y"},
            {name: "c", type: "z", modifier: "3"}],
        primary: {
            name: "PK",
            columns: ["a"]}};

    test.deepEqual(
        db.createTable(spec),
        {
            sql: 'CREATE TABLE IF NOT EXISTS "foo" (\n    "a" x 1,\n    "b" y ,\n    "c" z 3,\n    ' +
                 'CONSTRAINT "PK" PRIMARY KEY ("a")\n) WITH (OIDS = FALSE);',
            args: []
        });

    test.done();
}

exports.testCreateTableMultiColumnKey = function(test) {
    var spec = {
        name: "foo",
        columns: [
            {name: "a", type: "x", modifier: "1"},
            {name: "b", type: "y"},
            {name: "c", type: "z", modifier: "3"}],
        primary: {
            name: "PK",
            columns: ["a", "b"]}};

    test.deepEqual(
        db.createTable(spec),
        {
            sql: 'CREATE TABLE IF NOT EXISTS "foo" (\n    "a" x 1,\n    "b" y ,\n    "c" z 3,\n    ' +
                 'CONSTRAINT "PK" PRIMARY KEY ("a", "b")\n) WITH (OIDS = FALSE);',
            args: []
        });

    test.done();
}

exports.testUpsert = function(test) {
    var spec = {
        name: "foo",
        columns: [
            {name: "a", type: "x"},
            {name: "b", type: "y"},
            {name: "c", type: "z"}],
        primary: {
            name: "PK",
            columns: ["a", "b"]}};

    var row = {a: 5, b: "bob", c: null};

    test.deepEqual(
        db.upsert(spec, row),
        {
            sql: 'WITH new_values ("a", "b", "c") AS (\n    VALUES (\n        ' +
                 'CAST($1 AS x),\n        CAST($2 AS y),\n        CAST($3 AS z))),\n' +
                 'upsert AS (\n    UPDATE "foo" m SET\n        ' +
                 '"a" = nv."a",\n        "b" = nv."b",\n        "c" = nv."c"\n    ' +
                 'FROM new_values nv\n    WHERE m."a" = nv."a" AND m."b" = nv."b"\n    RETURNING m.*)\n' +
                 'INSERT INTO "foo"("a", "b", "c")\nSELECT "a", "b", "c"\nFROM new_values\n' +
                 'WHERE NOT EXISTS (' +
                 'SELECT 1 FROM upsert up WHERE up."a" = new_values."a" AND up."b" = new_values."b");\n',
            args: [5, "bob", null]
        });

    test.done();
}

exports.testUpsertMissingColumn = function(test) {
    var spec = {
        name: "foo",
        columns: [
            {name: "a", type: "x"},
            {name: "b", type: "y"},
            {name: "c", type: "z"}],
        primary: {
            name: "PK",
            columns: ["a", "b"]}};

    var row = {a: 5, c: "Z"};  // b is undefined

    test.deepEqual(
        db.upsert(spec, row),
        {
            sql: 'WITH new_values ("a", "b", "c") AS (\n    VALUES (\n        ' +
                 'CAST($1 AS x),\n        CAST($2 AS y),\n        CAST($3 AS z))),\n' +
                 'upsert AS (\n    UPDATE "foo" m SET\n        ' +
                 '"a" = nv."a",\n        "c" = nv."c"\n    ' +
                 'FROM new_values nv\n    WHERE m."a" = nv."a" AND m."b" = nv."b"\n    RETURNING m.*)\n' +
                 'INSERT INTO "foo"("a", "b", "c")\nSELECT "a", "b", "c"\nFROM new_values\n' +
                 'WHERE NOT EXISTS (' +
                 'SELECT 1 FROM upsert up WHERE up."a" = new_values."a" AND up."b" = new_values."b");\n',
            args: [5, null, "Z"]
        });

    test.done();
}
