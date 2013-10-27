/**
 * air - a project to visualize air quality data for Tokyo.
 *
 * Copyright (c) 2013 Cameron Beccario
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/cambecc/air
 */
(function() {
    "use strict";

    var τ = 2 * Math.PI;
    var MAX_TASK_TIME = 100;  // amount of time before a task yields control (milliseconds)
    var MIN_SLEEP_TIME = 25;  // amount of time a task waits before resuming (milliseconds)
    var INVISIBLE = -1;  // an invisible vector
    var NIL = -2;       // non-existent vector

    // special document elements
    var MAP_SVG_ID = "#map-svg";
    var FIELD_CANVAS_ID = "#field-canvas";
    var OVERLAY_CANVAS_ID = "#overlay-canvas";
    var DISPLAY_ID = "#display";
    var LOCATION_ID = "#location";
    var SAMPLE_LABEL_ID = "#sample-label";
    var STATUS_ID = "#status";
    var POINT_DETAILS_ID = "#point-details";
    var PREVIOUS_DAY_ID = "#previous-day";
    var PREVIOUS_HOUR_ID = "#previous-hour";
    var NEXT_HOUR_ID = "#next-hour";
    var NEXT_DAY_ID = "#next-day";
    var CURRENT_CONDITIONS_ID = "#current-conditions";
    var SHOW_LOCATION_ID = "#show-location";
    // var STOP_ANIMATION_ID = "#stop-animation";
    var POSITION_ID = "#position";

    // metadata about each type of overlay
    var OVERLAY_TYPES = {
        "temp": {min: -10,   max: 35,    scale: "line", precision: 1, label: "気温 Temperature", unit: "ºC"},
        "hum":  {min: 0,     max: 100,   scale: "line", precision: 1, label: "湿度 Humidity", unit: "%"},
        "wv":   {min: 1,     max: 20,    scale: "log",  precision: 1, label: "風速 Wind Velocity", unit: " m/s"},
        "in":   {min: 0.1,   max: 4.0,   scale: "log",  precision: 2, label: "日射量 Insolation", unit: ' MJ/m<span class="sup">2</span>'},
        "no":   {min: 0.001, max: 0.600, scale: "log",  precision: 0, label: "一酸化窒素 Nitric Monoxide", unit: " ppb", multiplier: 1000},
        "no2":  {min: 0.001, max: 0.200, scale: "log",  precision: 0, label: "二酸化窒素 Nitrogen Dioxide", unit: " ppb", multiplier: 1000},
        "nox":  {min: 0.001, max: 0.600, scale: "log",  precision: 0, label: "窒素酸化物 Nitrogen Oxides", unit: " ppb", multiplier: 1000},
        "ox":   {min: 0.001, max: 0.250, scale: "log",  precision: 0, label: "光化学オキシダント Photochemical Oxidants", unit: " ppb", multiplier: 1000},
        "so2":  {min: 0.001, max: 0.110, scale: "log",  precision: 0, label: "二酸化硫黄 Sulfur Dioxide", unit: " ppb", multiplier: 1000},
        "co":   {min: 0.1,   max: 3.0,   scale: "log",  precision: 1, label: "一酸化炭素 Carbon Monoxide", unit: " ppm"},
        "ch4":  {min: 1.5,   max: 3.0,   scale: "log",  precision: 2, label: "メタン Methane", unit: " ppm"},
        "nmhc": {min: 0.01,  max: 1.30,  scale: "log",  precision: 2, label: "非メタン炭化水素 Non-Methane Hydrocarbons", unit: " ppm"},
        "spm":  {min: 1,     max: 750,   scale: "log",  precision: 0, label: "浮遊粒子状物質 Suspended Particulate Matter", unit: ' μg/m<span class="sup">3</span>'},
        "pm25": {min: 1,     max: 750,   scale: "log",  precision: 0, label: "微小粒子状物質 2.5µm Particulate Matter", unit: ' μg/m<span class="sup">3</span>'}
    };

    // extract parameters sent to us by the server
    var displayData = {
        topography: d3.select(DISPLAY_ID).attr("data-topography"),
        samples: d3.select(DISPLAY_ID).attr("data-samples"),
        type: d3.select(DISPLAY_ID).attr("data-type"),
        date: d3.select(DISPLAY_ID).attr("data-date")
    };
    var overlayType = OVERLAY_TYPES[displayData.type];

    /**
     * Returns an object holding parameters for the animation engine, scaled for view size and type of browser.
     * Many of these values are chosen because they look nice.
     *
     * @param topo a TopoJSON object holding geographic map data and its bounding box.
     */
    function createSettings(topo) {
        var isFF = /firefox/i.test(navigator.userAgent);
        var projection = createAlbersProjection(topo.bbox[0], topo.bbox[1], topo.bbox[2], topo.bbox[3], view);
        var bounds = createDisplayBounds(topo.bbox[0], topo.bbox[1], topo.bbox[2], topo.bbox[3], projection);
        var styles = [];
        var settings = {
            projection: projection,
            displayBounds: bounds,
            particleCount: Math.round(bounds.height / 0.14),
            maxParticleAge: 40,  // max number of frames a particle is drawn before regeneration
            velocityScale: +(bounds.height / 700).toFixed(3),  // particle speed as number of pixels per unit vector
            fieldMaskWidth: isFF ? 2 : Math.ceil(bounds.height * 0.06),  // Wide strokes on FF are very slow
            fadeFillStyle: isFF ? "rgba(0, 0, 0, 0.95)" : "rgba(0, 0, 0, 0.97)",  // FF Mac alpha behaves differently
            frameRate: 40,  // desired milliseconds per frame
            animate: true,
            styles: styles,
            styleIndex: function(m) {  // map wind speed to a style
                return Math.floor(Math.min(m, 17) / 17 * (styles.length - 1));
            }
        };
        log.debug(JSON.stringify(view) + " " + JSON.stringify(settings));
        for (var j = 85; j <= 255; j += 5) {
            styles.push(asColorStyle(j, j, j, 1));
        }
        return settings;
    }

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
     * An object {width:, height:} that describes the extent of the browser's view in pixels.
     */
    var view = function() {
        var w = window, d = document.documentElement, b = document.getElementsByTagName("body")[0];
        var x = w.innerWidth || d.clientWidth || b.clientWidth;
        var y = w.innerHeight || d.clientHeight || b.clientHeight;
        return {width: x, height: y};
    }();

    function asColorStyle(r, g, b, a) {
        return "rgba(" + r + ", " + g + ", " + b + ", " + a + ")";
    }

    /**
     * Produces a color style in a rainbow-like trefoil color space. Not quite HSV, but produces a nice
     * spectrum. See http://krazydad.com/tutorials/makecolors.php.
     *
     * @param hue the hue rotation in the range [0, 1]
     * @param a the alpha value in the range [0, 1]
     * @returns {String} rgba style string
     */
    function asRainbowColorStyle(hue, a) {
        // Map hue [0, 1] to radians [0, 5/6τ]. Don't allow a full rotation because that keeps hue == 0 and
        // hue == 1 from mapping to the same color.
        var rad = hue * τ * 5/6;
        rad *= 0.75;  // increase frequency to 2/3 cycle per rad

        var s = Math.sin(rad);
        var c = Math.cos(rad);
        var r = Math.floor(Math.max(0, -c) * 255);
        var g = Math.floor(Math.max(s, 0) * 255);
        var b = Math.floor(Math.max(c, 0, -s) * 255);
        return asColorStyle(r, g, b, a);
    }

    function init() {
        // Tweak document to distinguish CSS styling between touch and non-touch environments. Hacky hack.
        if ("ontouchstart" in document.documentElement) {
            document.addEventListener("touchstart", function() {}, false);  // this hack enables :active pseudoclass
        }
        else {
            document.documentElement.className += " no-touch";  // to filter styles problematic for touch
        }

        // Modify the display elements to fill the screen.
        d3.select(MAP_SVG_ID).attr("width", view.width).attr("height", view.height);
        d3.select(FIELD_CANVAS_ID).attr("width", view.width).attr("height", view.height);
        d3.select(OVERLAY_CANVAS_ID).attr("width", view.width).attr("height", view.height);

        // Show the overlay label, if any.
        if (overlayType) {
            d3.select(SAMPLE_LABEL_ID).attr("style", "display: inline").node().textContent = "+ " + overlayType.label;
        }

        // Add event handlers for the time navigation buttons.
        function navToHours(offset) {
            var parts = displayData.date.split(/[- :]/);
            var date = parts.length >= 4 ?
                new Date(parts[0], parts[1] - 1, parts[2], parts[3]) :
                displayData.samples.indexOf("current") > 0 ? new Date() : null;

            if (isFinite(+date)) {
                date.setHours(date.getHours() + offset);
                window.location.href = "/map/" +
                    displayData.type + "/" +
                    date.getFullYear() + "/" +
                    (date.getMonth() + 1) + "/" +
                    date.getDate() + "/" +
                    date.getHours();
            }
        }
        d3.select(PREVIOUS_DAY_ID).on("click", navToHours.bind(null, -24));
        d3.select(PREVIOUS_HOUR_ID).on("click", navToHours.bind(null, -1));
        d3.select(NEXT_HOUR_ID).on("click", navToHours.bind(null, +1));
        d3.select(NEXT_DAY_ID).on("click", navToHours.bind(null, +24));
        d3.select(CURRENT_CONDITIONS_ID).on("click", function() {
            window.location.href = "/map/" + displayData.type + "/current";
        });

        // Add event handlers for the overlay navigation buttons.
        function addNavToSampleType(type) {
            d3.select("#" + type).on("click", function() {
                window.location.href = displayData.samples.replace("/data/" + displayData.type, "/map/" + type);
            });
        }
        for (var type in OVERLAY_TYPES) {
            if (OVERLAY_TYPES.hasOwnProperty(type)) {
                addNavToSampleType(type);
            }
        }
        addNavToSampleType("wind");  // add the "None" overlay
    }

    /**
     * Returns a d3 Albers conical projection (en.wikipedia.org/wiki/Albers_projection) that maps the bounding box
     * defined by the lower left geographic coordinates (lng0, lat0) and upper right coordinates (lng1, lat1) onto
     * the view port having (0, 0) as the upper left point and (width, height) as the lower right point.
     */
    function createAlbersProjection(lng0, lat0, lng1, lat1, view) {
        // Construct a unit projection centered on the bounding box. NOTE: center calculation will not be correct
        // when the bounding box crosses the 180th meridian. Don't expect that to happen to Tokyo for a while...
        var projection = d3.geo.albers()
            .rotate([-((lng0 + lng1) / 2), 0]) // rotate the globe from the prime meridian to the bounding box's center
            .center([0, (lat0 + lat1) / 2])    // set the globe vertically on the bounding box's center
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

    /**
     * Returns an object that describes the location and size of the map displayed on screen.
     */
    function createDisplayBounds(lng0, lat0, lng1, lat1, projection) {
        var upperLeft = projection([lng0, lat1]).map(Math.floor);
        var lowerRight = projection([lng1, lat0]).map(Math.ceil);
        return {
            x: upperLeft[0],
            y: upperLeft[1],
            width: lowerRight[0] - upperLeft[0] + 1,
            height: lowerRight[1] - upperLeft[1] + 1
        }
    }

    /**
     * Returns a promise for a JSON resource (URL) fetched via XHR. If the load fails, the promise rejects with an
     * object describing the reason: {error: http-status-code, message: http-status-text, resource:}.
     */
    function loadJson(resource) {
        var d = when.defer();
        d3.json(resource, function(error, result) {
            return error ?
                !error.status ?
                    d.reject({error: -1, message: "Cannot load resource: " + resource, resource: resource}) :
                    d.reject({error: error.status, message: error.statusText, resource: resource}) :
                d.resolve(result);
        });
        return d.promise;
    }

    /**
     * Returns a function that takes an array and applies it as arguments to the specified function. Yup. Basically
     * the same as when.js/apply.
     */
    function apply(f) {
        return function(args) {
            return f.apply(null, args);
        }
    }

    /**
     * Returns a promise that resolves to the specified value after a short nap.
     */
    function nap(value) {
        var d = when.defer();
        setTimeout(function() { d.resolve(value); }, MIN_SLEEP_TIME);
        return d.promise;
    }

    /**
     * Returns a random number between min (inclusive) and max (exclusive).
     */
    function rand(min, max) {
        return min + Math.random() * (max - min);
    }

    var bad = false;
    function displayStatus(status, error) {
        if (error) {
            bad = true;  // errors are sticky--let's not overwrite error information if it occurs
            d3.select(STATUS_ID).node().textContent = "⁂ " + error;
        }
        else if (!bad) {
            d3.select(STATUS_ID).node().textContent = "⁂ " + status;
        }
    }

    function buildMeshes(topo, settings) {
        displayStatus("building meshes...");
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

    function renderMap(mesh) {
        displayStatus("Rendering map...");
        log.time("rendering map");
        var mapSvg = d3.select(MAP_SVG_ID);
        mapSvg.append("path").datum(mesh.outerBoundary).attr("class", "out-boundary").attr("d", mesh.path);
        mapSvg.append("path").datum(mesh.divisionBoundaries).attr("class", "in-boundary").attr("d", mesh.path);
        log.timeEnd("rendering map");
    }

    /**
     * Returns a pair of functions {fieldMask: f(x, y), displayMask: f(x, y)} that return true if the pixel
     * (x, y) is not masked.
     *
     * The field mask defines the area where the wind vector field is available. The field extends beyond the
     * borders of the visible map to provide a more natural looking animation (particles don't die immediately
     * upon hitting the visible border).
     *
     * The display mask defines the area where the animation is visible on screen.
     */
    function renderMasks(mesh, settings) {
        displayStatus("Rendering masks...");
        log.time("render masks");

        // To build the masks, re-render the map to a detached canvas and use the resulting pixel data array.
        // The red color channel defines the field mask, and the green color channel defines the display mask.

        var canvas = document.createElement("canvas");  // create detached canvas
        d3.select(canvas).attr("width", view.width).attr("height", view.height);
        var g = canvas.getContext("2d");
        var path = d3.geo.path().projection(settings.projection).context(g);  // create a path for the canvas

        path(mesh.outerBoundary);  // define the border

        // draw a fat border in red
        g.strokeStyle = asColorStyle(255, 0, 0, 1);
        g.lineWidth = settings.fieldMaskWidth;
        g.stroke();

        // fill the interior with both red and green
        g.fillStyle = asColorStyle(255, 255, 0, 1);
        g.fill();

        // draw a small border in red, slightly shrinking the display mask so we don't draw particles directly
        // on top of the visible SVG border
        g.strokeStyle = asColorStyle(255, 0, 0, 1);
        g.lineWidth = 2;
        g.stroke();

        // d3.select(DISPLAY_ID).node().appendChild(canvas);  // uncomment to make mask visible for debugging

        var width = canvas.width;
        var data = g.getImageData(0, 0, canvas.width, canvas.height).data;

        log.timeEnd("render masks");

        // data array layout: [r, g, b, a, r, g, b, a, ...]
        return {
            fieldMask: function(x, y) {
                var i = (y * width + x) * 4;  // red channel is field mask
                return data[i] > 0;
            },
            displayMask: function(x, y) {
                var i = (y * width + x) * 4 + 1;  // green channel is display mask
                return data[i] > 0;
            }
        }
    }

    /**
     * Draws the map on screen and returns a promise for the rendered field and display masks.
     */
    function render(settings, mesh) {
        return when(renderMap(mesh))
            .then(nap)  // temporarily yield control back to the browser to maintain responsiveness
            .then(renderMasks.bind(null, mesh, settings));
    }

    function isValidSample(wind) {
        return wind[0] == +wind[0] && wind[1] == +wind[1];
    }

    /**
     * Draws the locations of the sampling stations as small points on the map. For fun.
     */
    function plotStations(data, mesh) {
        // Convert station data to GeoJSON format.
        var features = [];
        data[0].samples.forEach(function(e) {
            if (isValidSample(e.wind)) {
                features.push({
                    type: "Features",
                    properties: {name: e.stationId.toString()},
                    geometry: {type: "Point", coordinates: e.coordinates}});
            }
        });
        mesh.path.pointRadius(1);
        d3.select(MAP_SVG_ID).append("path")
            .datum({type: "FeatureCollection", features: features})
            .attr("class", "station")
            .attr("d", mesh.path);
    }

    function plotCurrentPosition(projection) {
        if (navigator.geolocation && projection && !d3.select(POSITION_ID).node()) {
            log.debug("requesting location...");
            navigator.geolocation.getCurrentPosition(
                function(position) {
                    log.debug("position available");
                    var p = projection([position.coords.longitude, position.coords.latitude]);
                    var x = Math.round(p[0]);
                    var y = Math.round(p[1]);
                    if (0 <= x && x < view.width && 0 <= y && y < view.height) {
                        var id = POSITION_ID.substr(1);
                        d3.select(MAP_SVG_ID).append("circle").attr("id", id).attr("cx", x).attr("cy", y).attr("r", 5);
                    }
                },
                log.error,
                {enableHighAccuracy: true});
        }
    }

    /**
     * Converts a meteorological wind vector to a u,v-component vector in pixel space. For example, given wind
     * from the NW at 2 represented as the vector [315, 2], this method returns [1.4142..., 1.4142...], a vector
     * (u, v) with magnitude 2, which when drawn on a display would point to the SE (lower right). See
     * http://mst.nerc.ac.uk/wind_vect_convs.html.
     */
    function componentize(wind) {
        var φ = wind[0] / 360 * τ;  // meteorological wind direction in radians
        var m = wind[1];  // wind velocity, m/s
        var u = -m * Math.sin(φ);  // u component, zonal velocity
        var v = -m * Math.cos(φ);  // v component, meridional velocity
        return [u, -v];  // negate v because pixel space grows downwards
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
        var d = Math.atan2(-x, y) / τ * 360;  // calculate into-the-wind cardinal degrees
        var wd = Math.round((d + 360) % 360 / 5) * 5;  // shift [-180, 180] to [0, 360], and round to nearest 5.
        var m = Math.sqrt(x * x + y * y);
        return wd.toFixed(0) + "º @ " + m.toFixed(1) + " m/s";
    }

    /**
     * Returns a human readable string for the provided overlay value.
     */
    function formatOverlayValue(v) {
        v = Math.min(v, overlayType.max);
        v = Math.max(v, Math.min(overlayType.min, 0));
        if (overlayType.multiplier) {
            v *= overlayType.multiplier;
        }
        return v.toFixed(overlayType.precision) + overlayType.unit;
    }

    /**
     * Converts samples to points in pixel space with the form [x, y, v], where v is the sample value at that point.
     * The transform callback extracts the value v from the sample, or null if the sample is not valid.
     */
    function buildPointsFromSamples(samples, projection, transform) {
        var points = [];
        samples.forEach(function(sample) {
            var point = projection(sample.coordinates);
            var value = transform(sample);
            if (value !== null) {
                points.push([point[0], point[1], value]);
            }
        });
        return points;
    }

    /**
     * Returns the index of v in array a (adapted from Java and darkskyapp/binary-search).
     */
    function binarySearch(a, v) {
        var low = 0, high = a.length - 1;
        while (low <= high) {
            var mid = low + ((high - low) >> 1), p = a[mid];
            if (p < v) {
                low = mid + 1;
            }
            else if (p === v) {
                return mid;
            }
            else {
                high = mid - 1;
            }
        }
        return -(low + 1);
    }

    /**
     * Returns a function f(x, y) that defines a vector field. The function returns the vector nearest to the
     * point (x, y) if the field is defined, otherwise the "nil" vector [NaN, NaN, NIL (-2)] is returned. The method
     * randomize(o) will set {x:, y:} to a random real point somewhere within the field's bounds.
     */
    function createField(columns) {
        var nilVector = [NaN, NaN, NIL];
        var field = function(x, y) {
            var column = columns[Math.round(x)];
            if (column) {
                var v = column[Math.round(y) - column[0]];  // the 0th element is the offset--see interpolateColumn
                if (v) {
                    return v;
                }
            }
            return nilVector;
        }

        // Create a function that will set a particle to a random location in the field. To do this uniformly and
        // efficiently given the field's sparse data structure, we build a running sum of column widths, starting at 0:
        //     [0, 10, 25, 29, ..., 100]
        // Each value represents the index of the first point in that column, and the last element is the total
        // number of points. Choosing a random point means generating a random number between [0, total), then
        // finding the column that contains this point by doing a binary search on the array. For example, point #27
        // corresponds to w[2] and therefore columns[2]. If columns[2] has the form [1041, a, b, c, d], then point
        // #27's coordinates are {x: 2, y: 1043}, where 1043 == 27 - 25 + 1 + 1041, and the value at that point is 'c'.

        field.randomize = function() {
            var w = [0];
            for (var i = 1; i <= columns.length; i++) {
                var column = columns[i - 1];
                w[i] = w[i - 1] + (column ? column.length - 1 : 0);
            }
            var pointCount = w[w.length - 1];

            return function(o) {
                var p = Math.floor(rand(0, pointCount));  // choose random point index
                var x = binarySearch(w, p);  // find column that contains this point
                x = x < 0 ? -x - 2 : x;  // when negative, x refers to _following_ column, so flip and go back one
                while (!columns[o.x = x]) {  // skip columns that have no points
                    x++;
                }
                // use remainder of point index to index into column, then add the column's offset to get actual y
                o.y = p - w[x] + 1 + columns[x][0];
                return o;
            }
        }();

        return field;
    }

    /**
     * Returns a promise for a vector field function (see createField). The vector field uses the sampling stations'
     * data to interpolate a vector at each point (x, y) in the specified field mask. The vectors produced by this
     * interpolation have the form [dx, dy, m] where dx and dy are the rectangular components of the vector and m is
     * the magnitude dx^2 + dy^2. If the vector is not visible because it lies outside the display mask, then m
     * has the value INVISIBLE (-1).
     */
    function interpolateField(data, settings, masks) {
        log.time("interpolating field");
        var d = when.defer();

        if (data.length === 0) {
            return d.reject("No Data in Response");
        }

        var points = buildPointsFromSamples(data[0].samples, settings.projection, function(sample) {
            return isValidSample(sample.wind) ? componentize(sample.wind) : null;
        });

        if (points.length < 5) {
            return d.reject("東京都環境局がデータを調整中");
        }

        var interpolate = mvi.inverseDistanceWeighting(points, 5);  // Use the five closest neighbors

        var columns = [];
        var bounds = settings.displayBounds;
        var displayMask = masks.displayMask;
        var fieldMask = masks.fieldMask;
        var xBound = bounds.x + bounds.width;  // upper bound (exclusive)
        var yBound = bounds.y + bounds.height;  // upper bound (exclusive)
        var x = bounds.x;

        function interpolateColumn(x) {
            // Find min and max y coordinates in the column where the field mask is defined.
            var yMin, yMax;
            for (yMin = 0; yMin < yBound && !fieldMask(x, yMin); yMin++) {
            }
            for (yMax = yBound - 1; yMax > yMin && !fieldMask(x, yMax); yMax--) {
            }

            if (yMin <= yMax) {
                // Interpolate a vector for each valid y in the column. A column may have a long empty region at
                // the front. To save space, eliminate this empty region by encoding an offset in the column's 0th
                // element. A column with only three points defined at y=92, 93 and 94, would have an offset of 91
                // and a length of four. The point at y=92 would be column[92 - column[0]] === column[1].

                var column = [];
                var offset = column[0] = yMin - 1;
                for (var y = yMin; y <= yMax; y++) {
                    var v = null;
                    if (fieldMask(x, y)) {
                        v = [0, 0, 0];
                        v = interpolate(x, y, v);
                        v[2] = displayMask(x, y) ? Math.sqrt(v[0] * v[0] + v[1] * v[1]) : INVISIBLE;
                        v = mvi.scaleVector(v, settings.velocityScale);
                    }
                    column[y - offset] = v;
                }
                return column;
            }
            else {
                return null;
            }
        }

        (function batchInterpolate() {
            try {
                var start = +new Date;
                while (x < xBound) {
                    columns[x] = interpolateColumn(x);
                    x += 1;
                    if ((+new Date - start) > MAX_TASK_TIME) {
                        // Interpolation is taking too long. Schedule the next batch for later and yield.
                        displayStatus("Interpolating: " + x + "/" + xBound);
                        setTimeout(batchInterpolate, MIN_SLEEP_TIME);
                        return;
                    }
                }
                var date = data[0].date.replace(":00+09:00", "");
                d3.select(DISPLAY_ID).attr("data-date", displayData.date = date);
                displayStatus(date + " JST");
                d.resolve(createField(columns));
                log.timeEnd("interpolating field");
            }
            catch (e) {
                d.reject(e);
            }
        })();

        return d.promise;
    }

    /**
     * Draw particles with the specified vector field. Frame by frame, each particle ages by one and moves according to
     * the vector at its current position. When a particle reaches its max age, reincarnate it at a random location.
     *
     * Per frame, draw each particle as a line from its current position to its next position. The speed of the
     * particle chooses the line style--faster particles are drawn with lighter styles. For performance reasons, group
     * particles of the same style and draw them within one beginPath()-stroke() operation.
     *
     * Before each frame, paint a very faint alpha rectangle over the entire canvas to provide a fade effect on the
     * particles' previously drawn trails.
     */
    function animate(settings, field) {
        var bounds = settings.displayBounds;
        var buckets = settings.styles.map(function() { return []; });
        var particles = [];
        for (var i = 0; i < settings.particleCount; i++) {
            particles.push(field.randomize({age: rand(0, settings.maxParticleAge)}));
        }

        function evolve() {
            buckets.forEach(function(bucket) { bucket.length = 0; });
            particles.forEach(function(particle) {
                if (particle.age > settings.maxParticleAge) {
                    field.randomize(particle).age = 0;
                }
                var x = particle.x;
                var y = particle.y;
                var v = field(x, y);  // vector at current position
                var m = v[2];
                if (m === NIL) {
                    particle.age = settings.maxParticleAge;  // particle has escaped the grid, never to return...
                }
                else {
                    var xt = x + v[0];
                    var yt = y + v[1];
                    if (m > INVISIBLE && field(xt, yt)[2] > INVISIBLE) {
                        // Path from (x,y) to (xt,yt) is visible, so add this particle to the appropriate draw bucket.
                        particle.xt = xt;
                        particle.yt = yt;
                        buckets[settings.styleIndex(m)].push(particle);
                    }
                    else {
                        // Particle isn't visible, but it still moves through the field.
                        particle.x = xt;
                        particle.y = yt;
                    }
                }
                particle.age += 1;
            });
        }

        var g = d3.select(FIELD_CANVAS_ID).node().getContext("2d");
        g.lineWidth = 0.75;
        g.fillStyle = settings.fadeFillStyle;

        function draw() {
            // Fade existing particle trails.
            var prev = g.globalCompositeOperation;
            g.globalCompositeOperation = "destination-in";
            g.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
            g.globalCompositeOperation = prev;

            // Draw new particle trails.
            buckets.forEach(function(bucket, i) {
                if (bucket.length > 0) {
                    g.beginPath();
                    g.strokeStyle = settings.styles[i];
                    bucket.forEach(function(particle) {
                        g.moveTo(particle.x, particle.y);
                        g.lineTo(particle.xt, particle.yt);
                        particle.x = particle.xt;
                        particle.y = particle.yt;
                    });
                    g.stroke();
                }
            });
        }

        (function frame() {
            try {
                if (settings.animate) {
                    // var start = +new Date;
                    evolve();
                    draw();
                    // var duration = (+new Date - start);
                    setTimeout(frame, settings.frameRate /* - duration*/);
                }
            }
            catch (e) {
                report(e);
            }
        })();
    }

    /**
     * Draws the overlay on top of the map. This process involves building a thin plate spline interpolation from
     * the sample data, then walking the canvas and drawing colored rectangles at each point.
     */
    function drawOverlay(data, settings, masks) {
        if (!overlayType) {
            return when.resolve(null);
        }

        log.time("drawing overlay");
        var d = when.defer();

        if (data.length === 0) {
            return d.reject("No Data in Response");
        }

        var points = buildPointsFromSamples(data[0].samples, settings.projection, function(sample) {
            var datum = sample[displayData.type];
            return datum == +datum ? datum : null;
        });

        if (points.length < 3) {  // we need at least three samples to interpolate
            return d.reject("東京都環境局がデータを調整中");
        }

        var min = overlayType.min;
        var max = overlayType.max;
        var range = max - min;
        var rigidity = range * 0.05;  // use 5% of range as the rigidity

        var interpolate = mvi.thinPlateSpline(points, rigidity);

        var g = d3.select(OVERLAY_CANVAS_ID).node().getContext("2d");
        var isLogarithmic = (overlayType.scale === "log");
        var LN101 = Math.log(101);
        var bounds = settings.displayBounds;
        var displayMask = masks.displayMask;
        var xBound = bounds.x + bounds.width;  // upper bound (exclusive)
        var yBound = bounds.y + bounds.height;  // upper bound (exclusive)
        var x = bounds.x;

        // Draw color scale for reference.
        var n = view.width / 5;
        for (var i = n; i >= 0; i--) {
            g.fillStyle = asRainbowColorStyle((1 - (i / n)), 0.9);
            g.fillRect(view.width - 10 - i, view.height - 20, 1, 10);
        }

        // Draw a column by interpolating a value for each point and painting a 2x2 rectangle
        function drawColumn(x) {
            for (var y = bounds.y; y < yBound; y += 2) {
                if (displayMask(x, y)) {
                    // Clamp interpolated z value to the range [min, max].
                    var z = Math.min(Math.max(interpolate(x, y), min), max);
                    // Now map to range [0, 1].
                    z = (z - min) / range;
                    if (isLogarithmic) {
                        // Map to logarithmic range [1, 101] then back to [0, 1]. Seems legit.
                        z = Math.log(z * 100 + 1) / LN101;
                    }
                    g.fillStyle = asRainbowColorStyle(z, 0.6);
                    g.fillRect(x, y, 2, 2);
                }
            }
        }

        (function batchDraw() {
            try {
                var start = +new Date;
                while (x < xBound) {
                    drawColumn(x);
                    x += 2;
                    if ((+new Date - start) > MAX_TASK_TIME) {
                        // Drawing is taking too long. Schedule the next batch for later and yield.
                        setTimeout(batchDraw, MIN_SLEEP_TIME);
                        return;
                    }
                }
                d.resolve(interpolate);
                log.timeEnd("drawing overlay");
            }
            catch (e) {
                d.reject(e);
            }
        })();

        return d.promise;
    }

    function postInit(settings, field, overlay) {
        d3.select(SHOW_LOCATION_ID).on("click", function() {
            plotCurrentPosition(settings.projection);
        });
        // d3.select(STOP_ANIMATION_ID).on("click", function() {
        //     settings.animate = false;
        // });
        d3.select(DISPLAY_ID).on("click", function() {
            var p = d3.mouse(this);
            var c = settings.projection.invert(p);
            var v = field(p[0], p[1]);
            if (v[2] >= INVISIBLE) {
                d3.select(LOCATION_ID).node().textContent = "⁂ " + formatCoordinates(c[0], c[1]);
                var pointDetails = "⁂ " + formatVector(v[0], v[1]);
                if (overlay) {
                    pointDetails += " | " + formatOverlayValue(overlay(p[0], p[1]));
                }
                d3.select(POINT_DETAILS_ID).node().innerHTML = pointDetails;
            }
        });
    }

    function report(e) {
        log.error(e);
        displayStatus(null, e.error ? e.error == 404 ? "No Data" : e.error + " " + e.message : e);
    }

    // Let's try an experiment! Define a dependency graph of tasks and use promises to let the control flow occur
    // organically. Any errors will cause dependent tasks to be skipped.

    var topoTask         = loadJson(displayData.topography);
    var dataTask         = loadJson(displayData.samples);
    var initTask         = when.all([true                                 ]).then(apply(init));
    var settingsTask     = when.all([topoTask                             ]).then(apply(createSettings));
    var meshTask         = when.all([topoTask, settingsTask               ]).then(apply(buildMeshes));
    var renderTask       = when.all([settingsTask, meshTask               ]).then(apply(render));
    var plotStationsTask = when.all([dataTask, meshTask                   ]).then(apply(plotStations));
    var overlayTask      = when.all([dataTask, settingsTask, renderTask   ]).then(apply(drawOverlay));
    var fieldTask        = when.all([dataTask, settingsTask, renderTask   ]).then(apply(interpolateField));
    var animateTask      = when.all([settingsTask, fieldTask              ]).then(apply(animate));
    var postInitTask     = when.all([settingsTask, fieldTask, overlayTask ]).then(apply(postInit));

    // Register a catch-all error handler to log errors rather then let them slip away into the ether.... Cleaner way?
    when.all([
        topoTask,
        dataTask,
        initTask,
        settingsTask,
        meshTask,
        renderTask,
        plotStationsTask,
        overlayTask,
        fieldTask,
        animateTask,
        postInitTask
    ]).then(null, report);

})();

// what the... you read this far?
