"use strict";

var when = require("when");
var http = require("http");
var htmlparser = require("htmlparser");
var tool = require("./tool");
var log = tool.log();

/**
 * Converts the provided HTML text into a dom.
 *
 * @param {string} text
 * @returns {Object} object representing the dom
 */
exports.parseHTML = function(text) {
    var handler = new htmlparser.DefaultHandler(null, {verbose: false, ignoreWhitespace: true});
    new htmlparser.Parser(handler).parseComplete(text);
    return handler.dom;
}; var parseHTML = exports.parseHTML;

/**
 * Returns all <table> tags contained in the provided dom as elements in an array.
 *
 * @param {Object} dom a parse tree obtained from calling the parseHTML function.
 * @returns {Array} an array of all tables and their associated sub trees.
 */
exports.tablesOf = function(dom) {
    return htmlparser.DomUtils.getElements({tag_type: "tag", tag_name: "table"}, dom);
}

/**
 * Returns all text nodes contained in the provided dom as elements in an array.
 *
 * @param {Object} dom a parse tree obtained from calling the parseHTML function.
 * @returns {Array} a flattened array of all text nodes.
 */
exports.textsOf = function(dom) {
    return htmlparser.DomUtils.getElements({tag_type: "text"}, dom);
}; var textsOf = exports.textsOf;

/**
 * Returns all <tr> tags contained in the provided dom, presumably a tree rooted with a table node.
 *
 * @param {Object} dom a parse tree obtained from calling the parseHTML function.
 * @returns {Array} an array of all rows and their associated sub trees.
 */
exports.rowsOf = function(dom) {
    return htmlparser.DomUtils.getElements({tag_type: "tag", tag_name: "tr"}, dom);
}; var rowsOf = exports.rowsOf;

/**
 * Given an html table comprised of rows having the <tr> tag, return a two-dimensional array of all cell values.
 *
 * @param {Object} table a parse tree obtained from calling the parseHTML function.
 * @returns {Array} an array of rows, each row being an array of trimmed text values.
 */
exports.extract = function(table) {
    return rowsOf(table).map(function(row) {
        return textsOf(row).map(function(text) {
            return text.data.trim();
        });
    });
}

/**
 * Returns the match results of all text nodes in the provided dom, satisfying the specified regex, as elements
 * in an array.
 *
 * @param regex a regular expression.
 * @param {Object} dom a parse tree obtained from calling the parseHTML function.
 * @returns {Array} an array of regex match results.
 */
exports.matchText = function(regex, dom) {
    var results = [];
    function matchForRegex(data) {
        var match = data.match(regex);
        return match ? results.push(match) : false;
    }
    htmlparser.DomUtils.getElements({tag_type: "text", tag_contains: matchForRegex}, dom);
    return results;
}

/**
 * Performs an http GET and parses the HTML into a dom. The result is a promise for the dom.
 *
 * @param options same as those taken by the http.request method.
 * @param [converter] a callback that takes a buffer and converts it to another format.
 * @returns {promise} a promise for the parsed dom of the specified url
 */
exports.fetch = function(options, converter) {
    converter = converter || function nop(buffer) { return buffer; };
    var d = when.defer();
    log.info("get: " + options);
    http.get(options, function(response) {
        var chunks = [];
        response.on("data", function(chunk) {
            chunks.push(chunk);
        });
        response.on("end", function() {
            log.info("got: " + options);
            var converted = converter(Buffer.concat(chunks));
            var parsed = parseHTML(converted);
            log.info("done: " + options);
            d.resolve(parsed);
        });
    }).on("error", function(error) {
        d.reject(error);
    });
    return d.promise;
}
