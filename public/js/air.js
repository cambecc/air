/**
 * License ...
 */
(function () {
    "use strict";

    var π = Math.PI;
    var MIN_SLEEP = 25;
    var MAX_TASK_TIME = 100;
    var INVISIBLE = -1;  // an invisible vector
    var NONE = -2;       // non-existent vector

    var MAP_SVG_ID = "#map-svg";
    var FIELD_CANVAS_ID = "#field-canvas";
    var DISPLAY_ID = "#display";
    var LOCATION_ID = "#location";
    var STATUS_ID = "#status";
    var WIND_ID = "#wind";
    var SHOW_LOCATION_ID = "#show-location";
    var POSITION_ID = "#position";
    var STOP_ANIMATION = "#stop-animation";

    /**
     * An object to perform logging when the browser supports it.
     */
    var log = {
        debug:   function(s) { if (console && console.log) console.log(s); },
        info:    function(s) { if (console && console.info) console.info(s); },
        error:   function(e) { if (console && console.error) console.error(e.stack ? e + "\n" + e.stack : e); },
        time:    function(s) { if (console && console.time) console.time(s); },
        timeEnd: function(s) { if (console && console.timeEnd) console.timeEnd(s); }
    };

    /**
     * An object {width:, height:} that describes the extent of the browser's view.
     */
    var view = function() {
        var w = window, d = document.documentElement, b = document.getElementsByTagName("body")[0];
        var x = w.innerWidth || d.clientWidth || b.clientWidth;
        var y = w.innerHeight || d.clientHeight || b.clientHeight;
        return {width: x, height: y};
    }();

    function apply(f) {
        return function(array) {
            return f.apply(null, array);
        }
    }

    /**
     * Returns a promise for a JSON resource (URL) fetched via XHR. If an error occurs, the promise resolves
     * successfully with an error object: {error: http-status-code, message: http-status-text}}.
     */
    function loadJson(resource) {
        var d = when.defer();
        d3.json(resource, function(error, result) {
            if (error) {
                result = {error: error.status, message: error.statusText};
            }
            return d.resolve(result);
        });
        return d.promise;
    }

    var topoTask = loadJson(d3.select(DISPLAY_ID).attr("data-topography"));
    var dataTask = loadJson(d3.select(DISPLAY_ID).attr("data-samples"));

    function createSettings(topo) {
        if (!topo || topo.error) {
            return null;
        }
        var projection = createProjection(topo.bbox[0], topo.bbox[1], topo.bbox[2], topo.bbox[3], view);
        var bbox = createBoundingBox(topo.bbox[0], topo.bbox[1], topo.bbox[2], topo.bbox[3], projection);
        var isFF = /firefox/i.test(navigator.userAgent);
        // log.debug(JSON.stringify(settings);
        return {
            projection: projection,
            bbox: bbox,
            particleCount: Math.round(bbox.height / 0.14),
            particleMaxAge: 40,
            pixelsPerUnitVelocity: +(bbox.height / 700).toFixed(3),
            fieldMaskWidth: isFF ? 2 : Math.ceil(bbox.height * 0.06),  // Wide strokes on FF are very slow.
            fadeFillStyle: isFF ? "rgba(0, 0, 0, 0.95)": "rgba(0, 0, 0, 0.97)",  // FF alpha behaves differently
            frameRate: 40
        };
    }

    var settingsTask = when(topoTask).then(createSettings);

    function buildMeshes(topo, settings) {
        if (!topo || topo.error || !settings) {
            return null;
        }
        log.time("building meshes");
        var path = d3.geo.path().projection(settings.projection);
        var outerBoundary = topojson.mesh(topo, topo.objects.main, function(a, b) { return a === b; });
        var divisionBoundaries = topojson.mesh(topo, topo.objects.main, function (a, b) { return a !== b; });
        log.timeEnd("building meshes");
        return {
            path: path,
            outerBoundary: outerBoundary,
            divisionBoundaries: divisionBoundaries
        };
    }

    var meshTask = when.all([topoTask, settingsTask]).then(apply(buildMeshes));

    var displayMaskTask = when(meshTask).then(function(mesh) {
        if (!mesh) {
            return null;
        }
        return masker(
            render(view.width, view.height, function(svg) {
                displayStatus("Building display mask...");
                svg.append("path")
                    .datum(mesh.outerBoundary)
                    .attr("fill", "#fff")
                    .attr("stroke-width", 2)
                    .attr("stroke", "#000")
                    .attr("d", mesh.path);
            }));
    });

    var fieldMaskTask = when.all([meshTask, settingsTask]).then(apply(function(mesh, settings) {
        if (!mesh || !settings) {
            return null;
        }
        return masker(
            render(view.width, view.height, function(svg) {
                displayStatus("Building field mask...");
                svg.append("path")
                    .datum(mesh.outerBoundary)
                    .attr("fill", "#fff")
                    .attr("stroke-width", settings.fieldMaskWidth)
                    .attr("stroke", "#fff")
                    .attr("d", mesh.path);
            }));
    }));

    var done = false;

    /**
     * Returns the DOM element for the first item of a d3 selection.
     */
    function asElement(d) {
        return d[0][0];
    }

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
        return wd.toFixed(0) + "º @ " + m.toFixed(1) + " m/s";
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
        var y = -Math.sin(wd_rad) * wv;  // negate along y axis because pixel space grows downwards
        return [x, y];  // rectangular form wind vector in pixel space
    }

    /**
     * Returns an Albers conical projection (en.wikipedia.org/wiki/Albers_projection) that maps the bounding box
     * defined by the lower left geographic coordinates (lng0, lat0) and upper right coordinates (lng1, lat1) onto
     * the view port having (0, 0) as the upper left point and (width, height) as the lower right point.
     */
    function createProjection(lng0, lat0, lng1, lat1, view) {
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
        var s = 1 / Math.max((p1[0] - p0[0]) / view.width, (p0[1] - p1[1]) / view.height) * 0.95;
        // Move the center to (0, 0) in pixel space.
        var t = [view.width / 2, view.height / 2];

        return projection.scale(s).translate(t);
    }

    function createBoundingBox(lng0, lat0, lng1, lat1, projection) {
        var upperLeft = projection([lng0, lat1]).map(Math.floor);
        var lowerRight = projection([lng1, lat0]).map(Math.ceil);
        var width = lowerRight[0] - upperLeft[0] + 1;
        var height = lowerRight[1] - upperLeft[1] + 1;
        return {
            x: upperLeft[0],
            y: upperLeft[1],
            width: width,
            height: height,
            area: width * height
        }
    }

    function masker(renderTask) {
        return when(renderTask).then(function(canvas) {
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
            var div = d3.select(document.createElement("div"));
            var svg = div.append("svg").attr("width", width).attr("height", height);
            appendTo(svg);

            var canvas = document.createElement("canvas");
            d3.select(canvas).attr("width", width).attr("height", height);
            canvg(canvas, asElement(div).innerHTML.trim());

            log.timeEnd("rendering canvas");
            d.resolve(canvas);
        }, MIN_SLEEP);
        return d.promise;
    }

    function plotCurrentPosition(projection) {
        if (navigator.geolocation && projection && !asElement(d3.select(POSITION_ID))) {
            log.debug("requesting location...");
            navigator.geolocation.getCurrentPosition(
                function(position) {
                    log.debug("position available");
                    var p = projection([position.coords.longitude, position.coords.latitude]);
                    var x = Math.round(p[0]);
                    var y = Math.round(p[1]);
                    if (0 <= x && x < view.width && 0 <= y && y < view.height) {
                        d3.select(MAP_SVG_ID).append("circle")
                            .attr("id", POSITION_ID.substr(1))
                            .attr("cx", x)
                            .attr("cy", y)
                            .attr("r", 3);
                    }
                },
                log.error,
                {enableHighAccuracy: true});
        }
    }

    function plotStations(data, mesh) {
        if (!data || data.error || !mesh) {
            return null;
        }
        var features = data[0].samples.map(function(e) {
            return {
                type: "Features",
                properties: {name: e.stationId.toString()},
                geometry: {type: "Point", coordinates: e.coordinates}};
        });
        mesh.path.pointRadius(1);
        d3.select(MAP_SVG_ID).append("path")
            .datum({type: "FeatureCollection", features: features})
            .attr("class", "station")
            .attr("d", mesh.path);
    }

    var plotStationsTask = when.all([dataTask, meshTask]).then(apply(plotStations));

    function renderMap(mesh) {
        if (!mesh) {
            return null;
        }
        log.time("rendering map");
        displayStatus("Rendering map...");

        var mapSvg = d3.select(MAP_SVG_ID);

        mapSvg.append("path")
            .datum(mesh.outerBoundary)
            .attr("class", "out-boundary")
            .attr("d", mesh.path);
        mapSvg.append("path")
            .datum(mesh.divisionBoundaries)
            .attr("class", "in-boundary")
            .attr("d", mesh.path);

        log.timeEnd("rendering map");
    }

    var renderMapTask = when(meshTask).then(renderMap);

//    function doProcess(topo) {
//        if (topo.error) {
//            displayStatus(topo.error + " " + topo.message);
//            return;
//        }
//    }

    function displayCoordinates(c) {
        asElement(d3.select(LOCATION_ID)).textContent = "⁂ " + formatCoordinates(c[0], c[1]);
    }

    function displayVectorDetails(v) {
        asElement(d3.select(WIND_ID)).textContent = "⁂ " + formatVector(v[0], v[1]);
    }

    function displayStatus(status) {
        asElement(d3.select(STATUS_ID)).textContent = "⁂ " + status;
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
     * Finds the neighbors nearest to the specified point, starting the search at the k-d tree provided as 'node'.
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

        // Now determine if the current node is a close neighbor. Do the comparison using _squared_ distance to
        // avoid unnecessary Math.sqrt operations.
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
            // than the worst neighbor encountered so far. If so, descend down the other side.
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
     * The returned function has the signature (x, y, result). When invoked, a zero vector should be passed as 'result'
     * to provide the initial value. After invocation, result holds the interpolated vector vxi, vyi in its 0th and 1st
     * elements, respectively.
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

    function buildStations(samples, projection) {
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

    function createField(columns) {
        var noVector = [NaN, NaN, NONE];
        return function(x, y) {
            var column = columns[Math.round(x)];
            if (column) {
                var v = column[Math.round(y) - column[0]];
                if (v) {
                    return v;
                }
            }
            return noVector;
        }
    }

    function interpolateField(data, settings, displayMask, fieldMask) {
        var d = when.defer();
        if (!settings || !displayMask || !fieldMask) {
            return null;
        }

        var bbox = settings.bbox;

        if (!data || data.error || data.length == 0) {
            displayStatus(data.error == 404 || data.length == 0 ? "No Data" : data.error + " " + data.message);
            d.reject(data);
            return null;
        }

        log.time("interpolating field");

        var stations = buildStations(data[0].samples, settings.projection);
        var interpolate = idw(stations, 5);  // Use the five closest neighbors to interpolate

        var columns = [];
        var xBound = bbox.x + bbox.width;  // upper bound (exclusive)
        var yBound = bbox.y + bbox.height;  // upper bound (exclusive)
        var x = bbox.x;

        function batchInterpolate() {
            var start = +new Date;
            while (x < xBound) {
                // Find min and max y coordinates in the column where the field mask is defined.
                var yMin, yMax;
                for (yMin = 0; yMin < yBound && !fieldMask(x, yMin); yMin++) {
                }
                for (yMax = yBound - 1; yMax > yMin && !fieldMask(x, yMax); yMax--) {
                }

                if (yMin <= yMax) {
                    // Interpolate a vector for each valid y in the column. A column may have a long empty
                    // region at the front. To save space, eliminate this empty region by encoding an
                    // offset in the column's 0th element. A column with only three points defined at y=92,
                    // 93 and 94, would have an offset of 91 and a length of four. The point at y=92 would
                    // be column[92 - column[0]] === column[1].

                    var column = columns[x] = [];
                    var offset = column[0] = yMin - 1;
                    for (var y = yMin; y <= yMax; y++) {
                        var v = null;
                        if (fieldMask(x, y)) {
                            v = [0, 0, 0];
                            v = interpolate(x, y, v);
                            v[2] = displayMask(x, y) ? Math.sqrt(v[0] * v[0] + v[1] * v[1]) : INVISIBLE;
                        }
                        column[y - offset] = v;
                    }
                }
                else {
                    columns[x] = null;
                }
                x++;

                if ((+new Date - start) > MAX_TASK_TIME) {
                    displayStatus("Interpolating: " + x + "/" + xBound);
                    setTimeout(batchInterpolate, MIN_SLEEP);
                    return;
                }
            }

            d.resolve(createField(columns));
            displayStatus(data[0].date);
            log.timeEnd("interpolating field");
        }

        batchInterpolate();

        return d.promise;
    }

    var interpolateTask = when.all([dataTask, settingsTask, displayMaskTask, fieldMaskTask]).then(apply(interpolateField));

    function process(settings, field) {
        if (!settings || !field) {
            log.debug("returning");
            return null;
        }

        var particles = [];
        var bbox = settings.bbox;

        function randomize(particle) {
            var x, y, i = 30;
            do {
                x = bbox.x + Math.random() * bbox.width;
                y = bbox.y + Math.random() * bbox.height;
                if (--i == 0) {  // Ugh. How to efficiently pick a random point inside an arbitrary polygon?
                    x = bbox.width / 2;
                    y = bbox.height / 2;
                    break;
                }
            } while (field(x, y)[2] === NONE);
            particle.x = x;
            particle.y = y;
        }

        for (var i = 0; i < settings.particleCount; i++) {
            var particle = {age: Math.floor(Math.random() * settings.particleMaxAge)};
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

        var g = asElement(d3.select(FIELD_CANVAS_ID)).getContext("2d");
        g.lineWidth = 0.75;

        (function draw() {
            var start = +new Date;

            var prev = g.globalCompositeOperation;
            g.fillStyle = settings.fadeFillStyle;
            g.globalCompositeOperation = "destination-in";
            g.fillRect(bbox.x, bbox.y, bbox.width, bbox.height);
            g.globalCompositeOperation = prev;

            var buckets = [];
            for (var i = 0; i < styles.length; i++) {
                buckets[i] = [];
            }

            particles.forEach(function(particle) {
                if (particle.age > settings.particleMaxAge) {
                    randomize(particle);
                    particle.age = 0;
                }

                // get vector at current location
                var x = particle.x;
                var y = particle.y;

                var v = field(x, y);
                if (v[2] === NONE) {  // particle has gone off the field, never to return...
                    particle.age = settings.particleMaxAge + 1;
                    return;
                }

                var xt = x + v[0] * settings.pixelsPerUnitVelocity;
                var yt = y + v[1] * settings.pixelsPerUnitVelocity;
                var m = v[2];

                if (m > INVISIBLE && field(xt, yt)[2] > INVISIBLE) {
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
                var next = Math.max(settings.frameRate, settings.frameRate - d);
                setTimeout(draw, next);
            }
        })();
    }

    var processTask = when.all([settingsTask, interpolateTask]).then(apply(process));

    function initializeDocument() {
        log.debug(JSON.stringify(view));

        // Tweak document to distinguish CSS styling between touch and non-touch environments.
        if ("ontouchstart" in document.documentElement) {
            document.addEventListener("touchstart", function() {}, false);  // this hack enables :active pseudoclass
        }
        else {
            document.documentElement.className += " no-touch";  // class .no-touch can filter styles problematic for touch
        }

        d3.select(MAP_SVG_ID).attr("width", view.width).attr("height", view.height);
        d3.select(FIELD_CANVAS_ID).attr("width", view.width).attr("height", view.height);
        d3.select(STOP_ANIMATION).on("click", function() {
            done = true;
        });
        when(settingsTask).then(function(settings) {
            d3.select(SHOW_LOCATION_ID).on("click", function() {
                plotCurrentPosition(settings.projection);
            });
        });
        when.all([settingsTask, interpolateTask]).then(apply(function(settings, field) {
            d3.select(DISPLAY_ID).on("click", function() {
                var p = d3.mouse(this);
                var c = settings.projection.invert(p);
                var v = field(p[0], p[1]);
                if (v[2] > INVISIBLE) {
                    displayCoordinates(c);
                    displayVectorDetails(v);
                }
            });
        }));
    }

    initializeDocument();

})();
