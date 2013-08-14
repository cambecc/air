'use strict';

var util = require('util');
var scraper = require('../scraper');
var when = require('when');
var http = require('http');

exports.testParseHTML = function(test) {
    var dom = scraper.parseHTML('<x y="z"> <w/> t </x>\n<s/>');
    var expected = [{
        type: 'tag',
        name: 'x',
        attribs: {y: 'z'},
        children: [
            {type: 'tag', name: 'w'},
            {type: 'text', data: ' t '}
        ]},
        {type: 'tag', name: 's'}
    ];

    test.deepEqual(dom, expected);
    test.done();
}

exports.testTablesOf = function(test) {
    var dom = scraper.parseHTML(
        '<body><table class="a"/><div><table class="b"><table class="c"/></table></div></body>');
    var tables = scraper.tablesOf(dom);
    var expected = [
        {type: 'tag', name: 'table', attribs: {class: 'a'}},
        {type: 'tag', name: 'table', attribs: {class: 'b'}, children: [
            {type: 'tag', name: 'table', attribs: {class: 'c'}}]},
        {type: 'tag', name: 'table', attribs: {class: 'c'}}
    ];

    test.deepEqual(tables, expected);
    test.done();
}

exports.testRowsOf = function(test) {
    var dom = scraper.parseHTML('<table><tr class="a"/><tr class="b"/></table><div><tr class="c">x</tr></div>');
    var tables = scraper.rowsOf(dom);
    var expected = [
        {type: 'tag', name: 'tr', attribs: {class: 'a'}},
        {type: 'tag', name: 'tr', attribs: {class: 'b'}},
        {type: 'tag', name: 'tr', attribs: {class: 'c'}, children: [ {type: 'text', data: 'x'} ]}
    ];

    test.deepEqual(tables, expected);
    test.done();
}

exports.testTextsOf = function(test) {
    var dom = scraper.parseHTML('w<div>x<tr>y</tr>z</div>');
    var tables = scraper.textsOf(dom);
    var expected = [
        {type: 'text', data: 'w'},
        {type: 'text', data: 'x'},
        {type: 'text', data: 'y'},
        {type: 'text', data: 'z'}];

    test.deepEqual(tables, expected);
    test.done();
}

exports.testExtract = function(test) {
    var dom = scraper.parseHTML('<tr>w</tr>bad<tr><div>x</div><div>y</div></tr><tr><td/><div><td>z</td></div></tr>');
    var result = scraper.extract(dom);
    var expected = [
        ['w'],
        ['x', 'y'],
        ['z']];

    test.deepEqual(result, expected);
    test.done();
}

exports.testMatchText = function(test) {
    var dom = scraper.parseHTML('<div>test a1c</div><div>test a2c</div><div>test abc</div>');
    var result = scraper.matchText(/a(\d)c/, dom);
    var expected = [
        'test a1c'.match(/a(\d)c/),
        'test a2c'.match(/a(\d)c/)];

    test.deepEqual(result, expected);
    test.done();
}

exports.testFetch = function(test) {
    var server = http.createServer(function(request, response) {
        response.writeHead(200);
        response.write('<div>hello, world</div>');
        response.end();
    })

    test.expect(2);

    server.listen(4242);
    when(scraper.fetch('http://localhost:4242', function nopConverter(buffer) { test.ok(true); return buffer; }),
        function(result) {
            server.close();

            var expected = [
                {type: 'tag', name: 'div', children: [ {type: 'text', data: 'hello, world'} ]}
            ];
            test.deepEqual(result, expected);
            test.done();
        },
        function(reason) {
            server.close();

            test.ok(false, reason);
            test.done();
        });
}
