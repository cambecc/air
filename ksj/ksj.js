'use strict';

var _ = require('underscore');
var util = require('util');
var when = require('when');
var fs = require('fs');
var xml2js = require('xml2js');

/**
 * Returns a promise for a simplified JSON representation of the specified KSJ xml file.
 *
 * @param sourceFile
 * @returns {*}
 */
exports.convertToJSON = function(sourceFile) {
    var d = when.defer();
    fs.readFile(sourceFile, function(error, data) {
        if (error) {
            return d.reject(error);
        }
        console.log('Parsing...');
        var parser = new xml2js.Parser();
        parser.parseString(data, function(error, root) {
            if (error) {
                return d.reject(error);
            }
            console.log('Process Pass 1...');
            var childCounts = pass1(root);
            console.log('Process Pass 2...');
            pass2(root, childCounts);
            console.log('Process Pass 3...');
            pass3(root);
            console.log('Stringify...');
            var result = JSON.stringify(root, null, ' ');
            console.log('Converted.');
            d.resolve(result);
        });
    });
    return d.promise;
}

function removeNamespace(str) {
    var i = str.indexOf(':');
    return i < 0 ? str : str.substr(i + 1);
}

function removePrefix(str) {
    var i = str.indexOf('.');
    return i < 0 ? str : str.substr(i + 1);
}

function pass1(root) {
    // removes namespaces
    // removes prefixes
    // calculates child counts to aid in collapsing arrays during pass 2

    var childCounts = {};

    function visitArray(ary, context) {
        if (context) {
            childCounts[context] = Math.max(childCounts[context] | 0, ary.length);
        }
        ary.forEach(function(element, i) {
            ary[i] = visit(element);
        });
        return ary;
    }

    function visitObject(obj, context) {
        _.keys(obj).forEach(function(rawKey) {
            var simpleKey = removePrefix(removeNamespace(rawKey));
            if (_.has(obj, simpleKey)) {
                simpleKey = rawKey;  // simplified key already exists, so use original key as-is.
            }
            obj[simpleKey] = visit(obj[rawKey], simpleKey);
            if (simpleKey !== rawKey) {
                delete obj[rawKey];
            }
        });
        return obj;
    }

    function visit(value, context) {
        if (_.isArray(value)) {
            return visitArray(value, context);
        }
        if (_.isObject(value)) {
            return visitObject(value, context);
        }
        return value;
    }

    visit(root);

    return childCounts;
}

function pass2(root, childCounts) {
    // removes redundant arrays where all instances contain just one child
    // merges attributes ($) into owning object

    function visitArray(ary, context) {
        ary.forEach(function(element, i) {
            ary[i] = visit(element);
        });
        return ary.length == 1 && childCounts[context] == 1 ? ary[0] : ary;
    }

    function visitObject(obj, context) {
        var result = obj;
        _.keys(obj).forEach(function(key) {
            obj[key] = visit(obj[key], key);
        });

        // Move all properties from $ into owning object if they don't already exist. If afterwards $ is
        // empty, then get rid of $.
        var $ = obj.$;
        if ($) {
            result = {};  // create a new object to represent the union of the keys in obj and obj.$
            _.keys($).forEach(function(key) {
                if (_.has(obj, key)) {
                    return;
                }
                result[key] = $[key];
                delete $[key];
            });
            if (_.size($) === 0) {
                delete obj.$;
            }
            _.keys(obj).forEach(function(key) {
                result[key] = obj[key];
            });
        }
        return result;
    }

    function visit(value, context) {
        if (_.isArray(value)) {
            return visitArray(value, context);
        }
        if (_.isObject(value)) {
            return visitObject(value, context);
        }
        return value;
    }

    visit(root);
}

function pass3(root) {
    // simplifies deep objects to shallow objects

    function visitArray(ary, context) {
        ary.forEach(function(element, i) {
            ary[i] = visit(element);
        });
        return ary;
    }

    function visitObject(obj, context) {
        _.keys(obj).forEach(function(key) {
            obj[key] = visit(obj[key], key);
        });

        var size = _.size(obj);

        if (size === 2 && _.has(obj, 'dimension') && _.has(obj, 'coordinate')) {
            // {"coordinate": "35.89 139.01", "dimension": "2"}  ==>  "35.89 139.01"
            return obj.coordinate;
        }

        if (size === 1 && _.has(obj, 'idref')) {
            // {"idref": "n00001"}  ==>  "n00001"
            return obj.idref;
        }

        if (size === 1 && _.has(obj, 'DirectPosition') && context == 'position') {
            // "position": {"DirectPosition": "35.89 139.01"}  ==>  "position": "35.89 139.01"
            return obj.DirectPosition;
        }

        if (size === 1 && _.has(obj, 'point') && context == 'indirect') {
            // "indirect": {"point": "n00001"}  ==>  "indirect": "n00001"
            return obj.point;
        }

        return obj;
    }

    function visit(value, context) {
        if (_.isArray(value)) {
            return visitArray(value, context);
        }
        if (_.isObject(value)) {
            return visitObject(value, context);
        }
        return value;
    }

    visit(root);
}

exports.convertToGeoJSON = function(root) {
    var pointRefs = extractPointRefs(root);
    var curves = extractCurves(root, pointRefs);
    var surfaces = extractSurfaces(root);
    var names = extractNames(root, surfaces);
    var result = {
        type: 'FeatureCollection',
        features: buildFeatures(names, curves)
    };
    return JSON.stringify(result, null, ' ');
}

function asPoint(str) {
    var point = str.split(' ').map(function(element) {
        return parseFloat(element);
    });
    // [long, lat] expected, but data source is [lat, long], so swap.
    var t = point[0];
    point[0] = point[1];
    point[1] = t;
    return point;
}

function extractPointRefs(root) {
    var refs = {};
    var gmPoints = root.GI.dataset.object.AA01.OBJ.GM_Point;
    gmPoints.forEach(function(element) {
        refs[element.id] = asPoint(element.position);
    });
    return refs;
}

function extractSegment(segment, pointRefs) {
    var gmPointArray = segment.GM_LineString.controlPoint.GM_PointArray.column;
    return gmPointArray.map(function(element) {
        var ref = element.indirect;
        if (ref) {
            return pointRefs[ref];
        }
        return asPoint(element.direct);
    });
}

function extractCurves(root, pointRefs) {
    var curves = {};
    var gmCurves = root.GI.dataset.object.AA01.OBJ.GM_Curve;
    gmCurves.forEach(function(element) {
        var id = element.id;
        curves[id] = {id: element.id, points: extractSegment(element.segment, pointRefs)};
    });
    return curves;
}

function extractCurveRefs(gmPolygon) {
    return gmPolygon.map(function(element) {
        var ref = element.boundary.GM_SurfaceBoundary.exterior.GM_Ring.generator;
        if (ref.indexOf('_') === 0) {
            ref = ref.substr(1);
        }
        return ref;
    });
}

function extractSurfaces(root) {
    var surfaces = {};
    var gmSurfaces = root.GI.dataset.object.AA01.OBJ.GM_Surface;
    gmSurfaces.forEach(function(element) {
        var id = element.id;
        surfaces[id] = {id: element.id, curves: extractCurveRefs(element.patch.GM_Polygon)};
    });
    return surfaces;
}

function scoalesce(x, y) {
    if (x && x.length > 0) {
        return x;
    }
    return y;
}

function extractNames(root, surfaces) {
    var names = {};
    var ec01 = root.GI.dataset.object.AA01.OBJ.EC01;
    ec01.forEach(function(element) {
        var id = element.AAC._;
        var name = scoalesce(element.CN2, element.CON);
        if (!id && name === '所属未定') {
            id = 'pending';
        }
        var feature = names[id];
        if (!feature) {
            names[id] = feature = {id: id, name: name, curves: []};
        }
        surfaces[element.ARE].curves.forEach(function(element) {
            feature.curves.push(element);
        });
    });
    return names;
}

function isInBounds(point) {
    var longitude = point[0];
    var latitude = point[1];
    return 138.90 < longitude && longitude < 139.95 &&
            35.45 < latitude  && latitude  < 35.95;
}

function buildGeometry(curveRefs, curves) {
    var allowedCurves = [];
    curveRefs.forEach(function(id) {
        var points = curves[id].points;
        for (var i = 0; i < points.length; i++) {
            if (!isInBounds(points[i])) {
                return;
            }
        }
        allowedCurves.push(id);
    });

    if (allowedCurves.length === 0) {
        return null;
    }

    var multi = allowedCurves.length > 1;
    var coordinates = [];
    allowedCurves.forEach(function(id) {
        var points = curves[id].points;
        coordinates.push(multi ? [points] : points);
    });
    return multi ?
        {type: 'MultiPolygon', coordinates: coordinates} :
        {type: 'Polygon', coordinates: coordinates};
}

function buildFeature(n, curves) {
    return {
        type: 'Feature',
        id: n.id,
        properties: {name: n.name},
        geometry: buildGeometry(n.curves, curves)
    };
}

function buildFeatures(names, curves) {
    var result = [];
    _.values(names).forEach(function(element) {
        var feature = buildFeature(element, curves);
        if (feature.geometry) {
            result.push(feature);
        }
    });
    return result;
}
