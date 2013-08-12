'use strict';

var util = require('util');
var when = require('when');
var http = require('http');
var htmlparser = require('htmlparser');
var shiftJIStoUTF8 = new (require('iconv')).Iconv('SHIFT_JIS', 'UTF-8//TRANSLIT//IGNORE');

function parseHTML(text) {
    var handler = new htmlparser.DefaultHandler(
        function(error/*, dom*/) {
            if (error) {
                console.log('Error while parsing: ' + error);
            }
        },
        { verbose: false, ignoreWhitespace: true });

    new htmlparser.Parser(handler).parseComplete(text);
    return handler.dom;
}

exports.fetch = function(options) {
    var d = when.defer();
    console.log('http get: ' + util.inspect(options));
    http.get(options, function(response) {
        var chunks = [];
        response.on('data', function(chunk) {
            chunks.push(chunk);
        });
        response.on('end', function() {
            console.log('end: ' + options);
            var buffer = Buffer.concat(chunks);
            console.log('concated: ' + options);
            var converted = shiftJIStoUTF8.convert(buffer);
            console.log('converted: ' + options);
            var parsed = parseHTML(converted);
            console.log('parsed: ' + options);
            d.resolve(parsed);
        });
    }).on('error', function(error) {
        d.reject(error);
    });
    return d.promise;
}

exports.tablesOf = function(dom) {
    return htmlparser.DomUtils.getElements({ tag_type: 'tag', tag_name: 'table' }, dom);
}

exports.rowsOf = function(dom) {
    return htmlparser.DomUtils.getElements({ tag_type: 'tag', tag_name: 'tr' }, dom);
}; var rowsOf = exports.rowsOf;

exports.textsOf = function(dom) {
    return htmlparser.DomUtils.getElements({ tag_type: 'text' }, dom);
}; var textsOf = exports.textsOf;

exports.extract = function(table) {
    var rowElements = rowsOf(table);
    return rowElements.map(function(rowElement) {
        var textElements = textsOf(rowElement);
        return textElements.map(function(textElement) {
            var value = textElement.data;
            return value.trim();
        });
    });
}

exports.matchElements = function(regex, dom) {
    var found = htmlparser.DomUtils.getElements(
        { tag_type: 'text', tag_contains: function(s) { return s.search(regex) > -1; } },
        dom);
    return found ? found.map(function(tag) { return tag.data.match(regex); }) : null;
}

exports.getElementsByTagName = function(name, dom) {
    return htmlparser.DomUtils.getElementsByTagName(name, dom);
}
