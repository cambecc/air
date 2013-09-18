"use strict";

var π = Math.PI;
var particleCount = 5000;
var particleMaxAge = 40;
var frameRate = 40; // one frame per this many milliseconds
var done = false;
var pixelsPerUnitVelocity = 1.00;
var fadeFillStyle = "rgba(0, 0, 0, 0.97)";
var isFF = /firefox/i.test(navigator.userAgent);

var noVector = [0, 0, -1];
var projection;
var bbox;

/**
 * An object to handle logging if browser supports it.
 */
var log = function() {
    return {
        debug:   function(s) { if (console && console.log) console.log(s); },
        info:    function(s) { if (console && console.info) console.info(s); },
        error:   function(e) { if (console && console.error) console.error(e.stack ? e + "\n" + e.stack : e); },
        time:    function(s) { if (console && console.time) console.time(s); },
        timeEnd: function(s) { if (console && console.timeEnd) console.timeEnd(s); }
    };
}();

/**
 * An object {width:, height:} that is the size of the browser's view.
 */
var view = function() {
    var w = window, d = document.documentElement, b = document.getElementsByTagName('body')[0];
    var x = w.innerWidth || d.clientWidth || b.clientWidth;
    var y = w.innerHeight || d.clientHeight || b.clientHeight;
    return {width: x, height: y};
}();

var displayDiv = document.getElementById("display");
var mapSvg = d3.select("#map-svg").attr("width", view.width).attr("height", view.height);
var fieldCanvas = d3.select("#field-canvas").attr("width", view.width).attr("height", view.height)[0][0];
var topoTask = loadJson(displayDiv.dataset.topography);
var dataTask = loadJson(displayDiv.dataset.samples);

topoTask.then(doProcess).then(null, log.error);

/**
 * Returns a human readable string for the provided coordinates.
 */
function formatCoordinates(lng, lat) {
    return Math.abs(lat).toFixed(6) + "º " + (lat >= 0 ? "N" : "S") + ", " +
           Math.abs(lng).toFixed(6) + "º " + (lng >= 0 ? "E" : "W");
}

/**
 * Returns a human readable string for the provided rectangular wind vector.
 */
function formatVector(x, y) {
    var d = Math.atan2(-x, y) / π * 180;  // calculate into-the-wind cardinal degrees
    var wd = Math.round((d + 360) % 360 / 5) * 5;  // shift [-180, 180] to [0, 360], and round to nearest 5.
    var m = Math.sqrt(x * x + y * y);
    return wd.toFixed(0) + " @ " + m.toFixed(1) + " m/s";
}

/**
 * Multiply the vector v (in rectangular [x, y] form) by the scalar s, in place, and return it.
 */
function scaleVector(v, s) {
    v[0] *= s;
    v[1] *= s;
    return v;
}

/**
 * Add the second vector into the first and return it. Both vectors must be in rectangular [x, y] form.
 */
function addVectors(a, b) {
    a[0] += b[0];
    a[1] += b[1];
    return a;
}

/**
 * Returns the square of the distance between the two specified points p0: [x0, y0] and p1: [x1, y1].
 */
function distance2(p0, p1) {
    var Δx = p0[0] - p1[0];
    var Δy = p0[1] - p1[1];
    return Δx * Δx + Δy * Δy;
}

/**
 * Converts an into-the-wind polar vector in cardinal degrees to a with-the-wind rectangular vector
 * in pixel space. For example, given wind _from_ the NW at 2 represented as the vector [315, 2], this
 * method returns [1.4142..., 1.4142...], a vector (x, y) with magnitude 2, which when drawn on a display
 * would point _to_ the SE (lower right).
 */
function polarToRectangular(v) {
    var wd_deg = v[0] + 180;  // convert into-the-wind cardinal degrees to with-the-wind
    var cr = wd_deg / 180 * π;  // convert to cardinal radians, clockwise
    var wd_rad = Math.atan2(Math.cos(cr), Math.sin(cr));  // convert to standard radians, counter-clockwise
    var wv = v[1];  // wind velocity
    var x = Math.cos(wd_rad) * wv;
    var y = -Math.sin(wd_rad) * wv;  // negate along y axis because pixel space increases downwards
    return [x, y];  // rectangular form wind vector in pixel space
}

/**
 * Returns an Albers conical projection (en.wikipedia.org/wiki/Albers_projection) that maps the bounding box
 * onto the view port having (0, 0) as the upper left point and (width, height) as the lower right point.
 */
function createProjection(boundingBox, width, height) {
    var lng0 = boundingBox[0];  // lower left longitude
    var lat0 = boundingBox[1];  // lower left latitude
    var lng1 = boundingBox[2];  // upper right longitude
    var lat1 = boundingBox[3];  // upper right latitude

    // Construct a unit projection centered on the bounding box. NOTE: calculation of the center will not
    // be correct if the bounding box crosses the 180th meridian. But don't expect that to happen...
    var projection = d3.geo.albers()
        .rotate([-((lng0 + lng1) / 2), 0]) // rotate the globe from the prime meridian to the bounding box's center.
        .center([0, (lat0 + lat1) / 2])    // set the globe vertically on the bounding box's center.
        .scale(1)
        .translate([0, 0]);

    // Project the two longitude/latitude points into pixel space. These will be tiny because scale is 1.
    var p0 = projection([lng0, lat0]);
    var p1 = projection([lng1, lat1]);
    // The actual scale is the ratio between the size of the bounding box in pixels and the size of the view port.
    // Reduce by 5% for a nice border.
    var s = 1 / Math.max((p1[0] - p0[0]) / width, (p0[1] - p1[1]) / height) * 0.95;
    // Move the center to (0, 0) in pixel space.
    var t = [width / 2, height / 2];

    return projection.scale(s).translate(t);
}

/**
 * Returns a promise for a JSON resource (URL) fetched via XHR.
 */
function loadJson(resource) {
    var d = when.defer();
    d3.json(resource, function(error, result) {
        return error ? d.reject(error) : d.resolve(result);
    });
    return d.promise;
}

function masker(renderTask) {
    return renderTask.then(function(canvas) {
        var data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        var width = canvas.width;
        return function(x, y) {
            var i = (y * width + x) * 4;
            return data[i] > 0;
        }
    });
}

function render(width, height, appendTo) {
    var d = when.defer();

    setTimeout(function() {
        log.time("rendering canvas");

        var div = document.createElement("div");
        var svg = document.createElement("svg");
        svg.setAttribute("width", width);
        svg.setAttribute("height", height);
        div.appendChild(svg);

        appendTo(d3.select(svg));

        var canvas = document.createElement("canvas");
        canvas.setAttribute("width", width);
        canvas.setAttribute("height", height);
        canvg(canvas, div.innerHTML.trim());

        log.timeEnd("rendering canvas");
        d.resolve(canvas);
    }, 25);
    return d.promise;
}

function plotCurrentPosition(svg, projection) {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function(position) {
                var p = projection([position.coords.longitude, position.coords.latitude]);
                var x = Math.round(p[0]);
                var y = Math.round(p[1]);
                if (0 <= x && x < view.width && 0 <= y && y < view.height) {
                    svg.append("circle").attr("cx", x).attr("cy", y).attr("r", 3).attr("id", "position");
                }
            },
            log.error,
            {enableHighAccuracy: true});
    }
}

function doProcess(topo) {
    log.time("building meshes");

    projection = createProjection(topo.bbox, view.width, view.height);

    var ur = projection([topo.bbox[0], topo.bbox[3]]);
    var ll = projection([topo.bbox[2], topo.bbox[1]]);
    bbox = [ur.map(Math.floor), ll.map(Math.ceil)];

    var path = d3.geo.path().projection(projection);
    var outerBoundary = topojson.mesh(topo, topo.objects.main, function(a, b) { return a === b; });
    var divisionBoundaries = topojson.mesh(topo, topo.objects.main, function (a, b) { return a !== b; });

    log.timeEnd("building meshes");

    log.time("rendering map");
    mapSvg.append("path")
        .datum(outerBoundary)
        .attr("class", "out-boundary")
        .attr("d", path);
    mapSvg.append("path")
        .datum(divisionBoundaries)
        .attr("class", "in-boundary")
        .attr("d", path);
    log.timeEnd("rendering map");

    var displayMaskTask = masker(
        render(view.width, view.height, function(svg) {
            svg.append("path")
                .datum(outerBoundary)
                .attr("fill", "#fff")
                .attr("stroke-width", "2")
                .attr("stroke", "#000")
                .attr("d", path);
        }));

    var fieldMaskTask = masker(
        render(view.width, view.height, function(svg) {
            svg.append("path")
                .datum(outerBoundary)
                .attr("fill", "#fff")
                .attr("stroke-width", isFF ? 2 : 50)  // Wide strokes on FF are very slow.
                .attr("stroke", "#fff")               // UNDONE: scale stroke-width with canvas size
                .attr("d", path);
        }));

    plotCurrentPosition(mapSvg, projection);

    dataTask.then(function(data) {
        var features = data[0].samples.map(function(e) {
            return {
                type: "Features",
                properties: {name: e.stationId.toString()},
                geometry: {type: "Point", coordinates: e.coordinates}};
        });
        path.pointRadius(1);
        mapSvg.append("path")
            .datum({type: "FeatureCollection", features: features})
            .attr("class", "station")
            .attr("d", path);
    }).then(null, log.error);

    interpolateVectorField(displayMaskTask, fieldMaskTask)
        .then(processVectorField)
        .then(null, log.error);
}

function displayCoordinates(c) {
    document.getElementById("location").textContent = "⁂ " + formatCoordinates(c[0], c[1]);
}

function displayVectorDetails(v) {
    document.getElementById("wind").textContent = "⁂ " + formatVector(v[0], v[1]);
}

function displayTimestamp(isoDate) {
    document.getElementById("date").textContent = "⁂ " + isoDate;
}

/**
 * Builds a k-d tree from the specified stations using each station's location. Each location should be made
 * available as an array [x, y, ...], accessible via the key "location".
 */
function kdTree(stations, k, depth) {
    if (stations.length == 0) {
        return null;
    }
    var axis = depth % k;  // cycle through each axis as we descend downwards
    var compareByAxis = function(a, b) {
        return a.location[axis] - b.location[axis];
    }
    stations.sort(compareByAxis);

    // Pivot on the median station using the policy that all stations to the left must be _strictly smaller_.
    var median = Math.floor(stations.length / 2);
    var node = stations[median];
    // Scan backwards for stations aligned on the same axis. We must be at the beginning of any such sequence of dups.
    while (median > 0 && compareByAxis(node, stations[median - 1]) === 0) {
        node = stations[--median];
    }

    node.left = kdTree(stations.slice(0, median), k, depth + 1);
    node.right = kdTree(stations.slice(median + 1), k, depth + 1);

    // Provide a function that easily calculates a point's distance to the partitioning plane of this node.
    var plane = node.location[axis];
    node.planeDistance = function(p) { return plane - p[axis]; };

    return node;
}

/**
 * Given array a, representing a binary heap, this method pushes the key down from the top of the heap. After
 * invocation, the key having the largest "distance2" value is at the top of the heap.
 */
function heapify(a, key) {
    var i = 0;
    var length = a.length;
    var child;
    while ((child = i * 2 + 1) < length) {
        var favorite = a[child];
        var right = child + 1;
        var r;
        if (right < length && (r = a[right]).distance2 > favorite.distance2) {
            favorite = r;
            child = right;
        }
        if (key.distance2 >= favorite.distance2) {
            break;
        }
        a[i] = favorite;
        i = child;
    }
    a[i] = key;
}

/**
 * Finds the neighbors nearest to the specified point, starting the search at the k-d tree provided as node.
 * The n closest neighbors are placed in the results array (of length n) in no defined order.
 */
function nearest(point, node, results) {
    // This recursive function descends the k-d tree, visiting partitions containing the desired point.
    // As it descends, it keeps a priority queue of the closest neighbors found. Each visited node is
    // compared against the worst (i.e., most distant) neighbor in the queue, replacing it if the current
    // node is closer. The queue is implemented as a binary heap so the worst neighbor is always the
    // element at the top of the queue.

    // Calculate distance of the point to the plane this node uses to split the search space.
    var planeDistance = node.planeDistance(point);

    var containingSide;
    var otherSide;
    if (planeDistance <= 0) {
        // point is contained in the right partition of the current node.
        containingSide = node.right;
        otherSide = node.left;
    }
    else {
        // point is contained in the left partition of the current node.
        containingSide = node.left;
        otherSide = node.right;
    }

    if (containingSide) {
        // Search the containing partition for neighbors.
        nearest(point, containingSide, results);
    }

    // Now determine if the current node is a close neighbor. Do the comparison using _squared_ distance so
    // we don't waste time doing unnecessary Math.sqrt operations.
    var d2 = distance2(point, node.location);
    var n = results[0];
    if (d2 < n.distance2) {
        // Current node is closer than the worst neighbor encountered so far, so replace it and adjust the queue.
        n.station = node;
        n.distance2 = d2;
        heapify(results, n);
    }

    if (otherSide) {
        // The other partition *might* have relevant neighbors if the point is closer to the partition plane
        // than the worst neighbor encountered so far. Descend down the other side if so.
        if ((planeDistance * planeDistance) < results[0].distance2) {
            nearest(point, otherSide, results);
        }
    }
}

/**
 * Returns a function that performs inverse distance weighting (en.wikipedia.org/wiki/Inverse_distance_weighting)
 * interpolation over the specified stations using k closest neighbors. The stations array must be comprised of
 * elements with the structure {point: [x, y], sample: [vx, vy]}, where sample represents a vector in rectangular form.
 *
 * The returned function has the signature (x, y, result). When invoked, a zero vector should be passed as result.
 * After invocation, result holds the interpolated vector vxi, vyi in its 0th and 1st elements, respectively.
 */
function idw(stations, k) {

    // Build a space partitioning tree to use for quick lookup of closest neighbors.
    var tree = kdTree(stations, 2, 0);

    // Define special scratch objects for intermediate calculations to avoid unnecessary array allocations.
    var temp = [];
    var nearestNeighbors = [];
    for (var i = 0; i < k; i++) {
        nearestNeighbors.push({});
    }

    function clear() {
        for (var i = 0; i < k; i++) {
            var n = nearestNeighbors[i];
            n.station = null;
            n.distance2 = Infinity;
        }
    }

    // Return a function that interpolates a vector for the point (x, y) and stores it in "result".
    return function(x, y, result) {
        var weightSum = 0;

        clear();  // reset our scratch objects
        temp[0] = x;
        temp[1] = y;

        nearest(temp, tree, nearestNeighbors);  // calculate nearest neighbors

        // Sum up the values at each nearest neighbor, adjusted by the inverse square of the distance.
        for (var i = 0; i < k; i++) {
            var neighbor = nearestNeighbors[i];
            var sample = neighbor.station.sample;
            var d2 = neighbor.distance2;
            if (d2 === 0) {  // (x, y) is exactly on top of a station.
                result[0] = sample[0];
                result[1] = sample[1];
                return result;
            }
            var weight = 1 / d2;
            temp[0] = sample[0];
            temp[1] = sample[1];
            result = addVectors(result, scaleVector(temp, weight));
            weightSum += weight;
        }

        // Divide by the total weight to calculate an average, which is our interpolated result.
        return scaleVector(result, 1 / weightSum);
    }
}

function buildStations(samples) {
    var stations = [];
    samples.forEach(function(sample) {
        if (sample.wind[0] && sample.wind[1]) {
            stations.push({
                location: projection(sample.coordinates),
                sample: polarToRectangular(sample.wind)
            });
        }
    });
    return stations;
}

function interpolateVectorField(displayMaskTask, fieldMaskTask) {
    var d = when.defer();

    when.all([dataTask, displayMaskTask, fieldMaskTask]).then(function(results) {
        log.time("interpolating field");
        var data = results[0];
        var displayMask = results[1];
        var fieldMask = results[2];

        var date = data[0].date;
        displayTimestamp(date);

        var stations = buildStations(data[0].samples);
        var interpolate = idw(stations, 5);  // use the five closest neighbors to interpolate

        var field = [];
        var x = 0;

        (function batchInterpolate() {
            var start = +new Date;
            while (x < view.width) {
                var column = field[x] = [];
                for (var y = 0; y < view.height; y++) {
                    var v = noVector;
                    if (fieldMask(x, y)) {
                        v = [0, 0, 0];
                        v = interpolate(x, y, v);
                        v = scaleVector(v, pixelsPerUnitVelocity)
                        v[2] = displayMask(x, y) ? Math.sqrt(v[0] * v[0] + v[1] * v[1]) : -1;
                    }
                    column[y] = v;
                }
                x++;

                if ((+new Date - start) > 100) {
                    setTimeout(batchInterpolate, 25);
                    return;
                }
            }
            d.resolve(field);
            log.timeEnd("interpolating field");
        })();

    }).then(null, log.error);

    return d.promise;
}

function processVectorField(field) {
    var particles = [];
    var width = bbox[1][0] - bbox[0][0] + 1;
    var height = bbox[1][1] - bbox[0][1] + 1;

    d3.select("#field-canvas").on("click", mouseClick);

    function mouseClick() {
        var p = d3.mouse(this);
        var c = projection.invert(p);
        var v = vectorAt(p[0], p[1]);
        if (v[2] === -1) {
            done = true;
        }
        else {
            displayCoordinates(c);
            displayVectorDetails(v);
        }
    }

    function vectorAt(x, y) {
        var column = field[Math.round(x)];
        if (column) {
            var v = column[Math.round(y)];
            if (v) {
                return v;
            }
        }
        return noVector;
    }

    function randomize(particle) {
        var x;
        var y;
        var i = 30;
        do {
            x = Math.random() * width + bbox[0][0];
            y = Math.random() * height + bbox[0][1];
            if (--i == 0) {  // UNDONE: ugh. remove this safety net. make better. somehow.
                x = width / 2;
                y = height / 2;
                break;
            }
        } while (vectorAt(x, y) === noVector);
        particle.x = x;
        particle.y = y;
    }

    for (var i = 0; i < particleCount; i++) {
        var particle = {age: Math.floor(Math.random() * particleMaxAge)};
        randomize(particle);
        particles.push(particle);
    }

    var styles = [];
    for (var j = 85; j <= 255; j += 5) {
        styles.push("rgba(" + j + ", " + j + ", " + j + ", 1)");
    }
    var max = 17;
    var min = 0;
    var range = max - min;

    var c = fieldCanvas;
    var g = c.getContext("2d");
    g.lineWidth = 0.75;

    (function draw() {
        var start = +new Date;

        var prev = g.globalCompositeOperation;
        g.fillStyle = fadeFillStyle;
        g.globalCompositeOperation = "destination-in";
        g.fillRect(bbox[0][0], bbox[0][1], width, height);
        g.globalCompositeOperation = prev;

        var buckets = [];
        for (var i = 0; i < styles.length; i++) {
            buckets[i] = [];
        }

        particles.forEach(function(particle) {
            if (particle.age > particleMaxAge) {
                randomize(particle);
                particle.age = 0;
            }

            // get vector at current location
            var x = particle.x;
            var y = particle.y;

            var v = vectorAt(x, y);
            if (v === noVector) {  // particle has gone off the field, never to return...
                particle.age = particleMaxAge + 1;
                return;
            }

            var xt = x + v[0];
            var yt = y + v[1];
            var m = v[2];

            if (m >= 0 && vectorAt(xt, yt)[2] >= 0) {
                var i = Math.floor((Math.min(m, max) - min) / range * (styles.length - 1));
                particle.xt = xt;
                particle.yt = yt;
                buckets[i].push(particle);
            }
            else {
                particle.x = xt;
                particle.y = yt;
            }
            particle.age += 1;
        });

        buckets.forEach(function(bucket, i) {
            if (bucket.length > 0) {
                g.beginPath();
                g.strokeStyle = styles[i];
                bucket.forEach(function(particle) {
                    g.moveTo(particle.x, particle.y);
                    g.lineTo(particle.xt, particle.yt);
                    particle.x = particle.xt;
                    particle.y = particle.yt;
                });
                g.stroke();
            }
        });

        if (!done) {
            var d = (+new Date - start);
            var next = Math.max(frameRate, frameRate - d);
            setTimeout(draw, next);
        }
    })();
}
