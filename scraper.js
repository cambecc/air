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
