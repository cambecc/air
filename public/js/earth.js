(function() {
    "use strict";

    var NIL = -2;       // non-existent vector
    var MAX_TASK_TIME = 100;  // amount of time before a task yields control (milliseconds)
    var MIN_SLEEP_TIME = 25;  // amount of time a task waits before resuming (milliseconds)

    var DISPLAY_ID = "#display";
    var MAP_SVG_ID = "#map-svg";
    var FIELD_CANVAS_ID = "#field-canvas";
    var OVERLAY_CANVAS_ID = "#overlay-canvas";
    var STATUS_ID = "#status";

    var log = util.log;
    var apply = util.apply;
    var view = util.view;
    var parameters = {
        topography_lo: d3.select(DISPLAY_ID).attr("data-topography-lo"),
        topography_hi: d3.select(DISPLAY_ID).attr("data-topography-hi"),
        samples: d3.select(DISPLAY_ID).attr("data-samples")
    };

    function init() {
        // Modify the display elements to fill the screen.
        d3.select(MAP_SVG_ID).attr("width", view.width).attr("height", view.height);
        d3.select(FIELD_CANVAS_ID).attr("width", view.width).attr("height", view.height);
        d3.select(OVERLAY_CANVAS_ID).attr("width", view.width).attr("height", view.height);
    }

    function createSettings(topo) {
        var isFF = /firefox/i.test(navigator.userAgent);
        var projection = util.createOrthographicProjection(topo.bbox[0], topo.bbox[1], topo.bbox[2], topo.bbox[3], view);
        var bounds = util.createDisplayBounds(projection);
        var styles = [];
        var settings = {
            projection: projection,
            displayBounds: bounds,
            particleCount: Math.round(bounds.width / 0.14),
            maxParticleAge: 40,  // max number of frames a particle is drawn before regeneration
            velocityScale: +(bounds.height / 700).toFixed(3),  // particle speed as number of pixels per unit vector
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
            styles.push(util.asColorStyle(j, j, j, 1));
        }
        return settings;
    }

    var bad = false;
    function displayStatus(status, error) {
        if (error) {
            bad = true;  // errors are sticky--let's not overwrite error information if it occurs
            d3.select(STATUS_ID).node().textContent = "⁂ " + error;
        }
        else if (!bad) {
            d3.select(STATUS_ID).node().textContent = status ? "⁂ " + status : "";
        }
    }

    function buildMeshes(topoLo, topoHi, settings) {
        // UNDONE: Probably don't need this function anymore. Just need settings that will initialize the features...
        displayStatus("building meshes...");
        log.time("building meshes");
        var path = d3.geo.path().projection(settings.projection);
        var boundaryLo = topojson.feature(topoLo, topoLo.objects.coastline);  // UNDONE: understand why mesh didn't work here
        var lakesLo = topojson.feature(topoLo, topoLo.objects.lakes);
        var riversLo = topojson.feature(topoLo, topoLo.objects.rivers);
        var boundaryHi = topojson.feature(topoHi, topoHi.objects.coastline);
        var lakesHi = topojson.feature(topoHi, topoHi.objects.lakes);
        var riversHi = topojson.feature(topoHi, topoHi.objects.rivers);
        log.timeEnd("building meshes");
        return {
            path: path,
            boundaryLo: boundaryLo,
            boundaryHi: boundaryHi,
            lakesLo: lakesLo,
            lakesHi: lakesHi,
            riversLo: riversLo,
            riversHi: riversHi
        };
    }

    function renderMap(settings, mesh) {
        displayStatus("Rendering map...");
        log.time("rendering map");

        var projection = settings.projection;

        var path = d3.geo.path().projection(projection);

        var mapSvg = d3.select(MAP_SVG_ID);

        mapSvg.append("defs").append("path")
            .datum({type: "Sphere"})
            .attr("id", "sphere")
            .attr("d", path);
        mapSvg.append("use")
//            .attr("class", "sphere-fill")
            .attr("fill", "url(#g741)")
            .attr("xlink:href", "#sphere");

        var graticule = d3.geo.graticule();
        mapSvg.append("path")
            .datum(graticule)
            .attr("class", "graticule")
            .attr("d", path);

        var world = mapSvg.append("path").attr("class", "coastline").datum(mesh.boundaryHi).attr("d", path);
//        var lakes = mapSvg.append("path").attr("class", "lakes").datum(mesh.lakesHi).attr("d", path);
//        var rivers = mapSvg.append("path").attr("class", "rivers").datum(mesh.riversHi).attr("d", path);

        mapSvg.append("use")
            .attr("class", "sphere-stroke")
            .attr("xlink:href", "#sphere");

        var zoom = d3.behavior.zoom()
            .scale(projection.scale())
            .scaleExtent([0, view.width * 2])
            .on("zoomstart", function() {
                resetDisplay(settings);
                world.datum(mesh.boundaryLo);
//                lakes.datum(mesh.lakesLo);
//                rivers.datum(mesh.riversLo);
            })
            .on("zoom", function() {
                projection.scale(d3.event.scale);
                mapSvg.selectAll("path").attr("d", path);
            })
            .on("zoomend", function() {
                world.datum(mesh.boundaryHi).attr("d", path);
//                lakes.datum(mesh.lakesHi).attr("d", path);
//                rivers.datum(mesh.riversHi).attr("d", path);
                prepareDisplay(settings);
            });

        var m = .25; // drag sensitivity
        d3.select(OVERLAY_CANVAS_ID).call(
            d3.behavior.drag()
                .origin(function() {
                    var r = projection.rotate();
                    return {
                        x: r[0] / m,
                        y: -r[1] / m
                    };
                })
                .on("dragstart", function() {
                    d3.event.sourceEvent.stopPropagation();
                    resetDisplay(settings);
                    world.datum(mesh.boundaryLo);
//                    lakes.datum(mesh.lakesLo);
//                    rivers.datum(mesh.riversLo);
                })
                .on("drag", function() {
                    var rotate = projection.rotate();
                    projection.rotate([d3.event.x * m, -d3.event.y * m, rotate[2]]);
                    mapSvg.selectAll("path").attr("d", path);
                })
                .on("dragend", function() {
                    world.datum(mesh.boundaryHi).attr("d", path);
//                    lakes.datum(mesh.lakesHi).attr("d", path);
//                    rivers.datum(mesh.riversHi).attr("d", path);
                    prepareDisplay(settings);
                }));

        d3.select(DISPLAY_ID).call(zoom);

        log.timeEnd("rendering map");
    }

    function renderMasks(settings) {
        displayStatus("Rendering masks...");
        log.time("render masks");

        // To build the masks, re-render the map to a detached canvas and use the resulting pixel data array.
        // The red color channel defines the field mask, and the green color channel defines the display mask.

        var canvas = document.createElement("canvas");  // create detached canvas
        d3.select(canvas).attr("width", view.width).attr("height", view.height);
        var g = canvas.getContext("2d");
        var path = d3.geo.path().projection(settings.projection).context(g);  // create a path for the canvas

        path({type: "Sphere"});  // define the border

        // draw a fat border in red
        g.strokeStyle = util.asColorStyle(255, 0, 0, 1);
        g.lineWidth = settings.fieldMaskWidth;
        g.stroke();

        // fill the interior with both red and green
        g.fillStyle = util.asColorStyle(255, 255, 0, 1);
        g.fill();

        // draw a small border in red, slightly shrinking the display mask so we don't draw particles directly
        // on top of the visible SVG border
        g.strokeStyle = util.asColorStyle(255, 0, 0, 1);
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
        return when(renderMap(settings, mesh))
            .then(util.nap)  // temporarily yield control back to the browser to maintain responsiveness
            .then(renderMasks.bind(null, settings));
    }

    function floorDiv(a, n) {
        return a - n * Math.floor(a / n);
    }

    // maps x to the longitudinal range starting at the prime meridian: [0, 360)
    function primeMeridianNormal(x) {
        return x - 360 * Math.floor(x / 360);
    }

    // maps x to the longitudinal range starting at the anti-meridian: [-180, 180)
    function antiMeridianNormal(x) {
        return x - 360 * Math.floor((x + 180) / 360);
    }

    function buildGrid(data) {
        log.time("build grid");
        var d = when.defer();

        if (data.length < 2) {
            return d.reject("Insufficient data in response");
        }

        // Build array of vectors
        var record0 = data[0];
        var record1 = data[1];
        var header = record0.header;
        var nx = header.nx;    // 144 divisions lon
        var ny = header.ny;    // 73 divisions lat
        var lo1 = header.lo1;  // 0.0
        var lo2 = header.lo2;  // 357.5
        var la1 = header.la1;  // 90.0
        var la2 = header.la2;  // -90.0
        var dx = header.dx;    // 2.5 deg lon
        var dy = header.dy;    // 2.5 deg lat
        var ua = record0.data;
        var va = record1.data;
        if (ua.length != va.length) {
            return d.reject("Mismatched data point lengths");
        }

        // scan mode 0 assumed: http://www.nco.ncep.noaa.gov/pmb/docs/grib2/grib2_table3-4.shtml
        var grid = [];
        var p = 0;
        for (var j = 0; j < ny; j++) {
            var row = [];
            var lat = la1 - (j * dy);
            for (var i = 0; i < nx; i++, p++) {
                var lon = antiMeridianNormal(lo1 + (i * dx));
                row[i] = [lon, lat, [ua[p], va[p]]];
            }
            grid[j] = row;
        }

        var normalize = lo1 < lo2 ? primeMeridianNormal : antiMeridianNormal;
        var isContinuous = (dx * nx) == 360;  // UNDONE: comparison valid?

        var minLon = normalize(lo1);
        var maxLon = normalize(lo2);
        if (minLon > maxLon) {
            throw new Error("unexpected...");
        }
        var minLat = la2;
        var maxLat = la1;

        var ll = [], ul = [], lr = [], ur = [];

        log.timeEnd("build grid");

        return {
            cell: function(lon, lat) {
                // YUCK ---------------------------------------------------------
                lon = normalize(lon);
                var i = (lon - minLon) / dx;
                var j = (maxLat - lat) / dy;

                var fi = Math.floor(i);
                if (fi < 0 || nx <= fi) {
                    fi = isContinuous ? floorDiv(fi, nx) : NaN;
                }
                var ci = Math.ceil(i);
                if (ci < 0 || nx <= ci) {
                    ci = isContinuous ? floorDiv(ci, nx) : NaN;
                }
                var fj = Math.floor(j);
                if (fj < 0 || ny <= fj) {
                    fj = NaN;
                }
                var cj = Math.ceil(j);
                if (cj < 0 || ny <= cj) {
                    cj = NaN;
                }

                function get(j, i) {
                    var row = grid[j];
                    return row ? row[i] : null;
                }

                ll[0] = fi, ll[1] = cj, ll[2] = get(cj, fi);
                ul[0] = fi, ul[1] = fj, ul[2] = get(fj, fi);
                lr[0] = ci, lr[1] = cj, lr[2] = get(cj, ci);
                ur[0] = ci, ur[1] = fj, ur[2] = get(fj, ci);

                // log.debug(ll + " : " + lr + " : " + ul + " : " + ur);

                if (!ll[2] || !ul[2] || !lr[2] || !ur[2]) {
                    return null;    // UNDONE does this happen anymore?
                }

                var v = mvi.bilinear((lon - normalize(ll[2][0])) / dx, (lat - ll[2][1]) / dy, ll[2], lr[2], ul[2], ur[2]);
                return v;
            }
        }
    }

    function createField(columns, bounds) {
        var nilVector = [NaN, NaN, NIL];
        var field = function(x, y) {
            var column = columns[Math.round(x)];
            if (column) {
                var v = column[Math.round(y)];
                if (v) {
                    return v;
                }
            }
            return nilVector;
        }

        field.randomize = function(o) {
            var x, y;
            var net = 0;  // UNDONE: fix
            do {
                x = Math.round(util.rand(bounds.x, bounds.xBound + 1));
                y = Math.round(util.rand(bounds.y, bounds.yBound + 1));
            } while (field(x, y)[2] == NIL && net++ < 30);
            o.x = x;
            o.y = y;
            return o;
        };

        return field;
    }

    function interpolateField(grid, settings, masks) {
        log.time("interpolating field");
        var d = when.defer();

        var bounds = settings.displayBounds;
        var projection = settings.projection;
        var displayMask = masks.displayMask;

        var columns = [];
        var point = [];

        var du = [];  // u component distortion vector
        var dv = [];  // v component distortion vector

        var x = bounds.x;
        var distortion = util.distortion(projection);

        function interpolateColumn(x) {
            var column = [];
            for (var y = bounds.y; y <= bounds.yBound; y += 1) {
                if (displayMask(x, y)) {
                    point[0] = x, point[1] = y;
                    var coord = projection.invert(point);
                    var λ = coord[0], φ = coord[1];

                    var wind = grid.cell(λ, φ);
                    if (!wind) continue;  // UNDONE does this happen anymore?

                    distortion(λ, φ, x, y, du, dv);

                    var u = wind[0], v = wind[1];
                    du = mvi.scaleVector(du, u * 0.02); // scale warped u by u component value.
                    dv = mvi.scaleVector(dv, v * 0.02); // scale warped v by v component value.
                    wind[0] = 0; wind[1] = 0;
                    wind = mvi.addVectors(wind, du);
                    wind = mvi.addVectors(wind, dv);

                    wind[1] = -wind[1];  // reverse v component because y-axis grows down in pixel space
                    wind[2] = Math.sqrt(u * u + v * v);  // pre-calculate magnitude

                    column[y] = wind;
                }
            }
            columns[x] = column;
        }

        (function batchInterpolate() {
            try {
                if (settings.animate) {
                    var start = +new Date;
                    while (x < bounds.xBound) {
                        interpolateColumn(x);
                        x += 1;
                        if ((+new Date - start) > MAX_TASK_TIME) {
                            // Interpolation is taking too long. Schedule the next batch for later and yield.
                            displayStatus("Interpolating: " + x + "/" + bounds.xBound);
                            setTimeout(batchInterpolate, MIN_SLEEP_TIME);
                            return;
                        }
                    }
                    // var date = data[0].date.replace(":00+09:00", "");
                    // d3.select(DISPLAY_ID).attr("data-date", displayData.date = date);
                    // displayStatus(date + " JST");
                    displayStatus("");
                    d.resolve(createField(columns, bounds));
                    log.timeEnd("interpolating field");
                }
            }
            catch (e) {
                d.reject(e);
            }
        })();

        return d.promise;
    }

    function overlay(settings, field) {

        var d = when.defer();

        var bounds = settings.displayBounds;
        var g = d3.select(OVERLAY_CANVAS_ID).node().getContext("2d");

        var BLOCK = 1;  // block size of an overlay pixel

        log.time("overlay");
        var x = bounds.x;
        function drawColumn(x) {
            for (var y = bounds.y; y <= bounds.yBound; y += BLOCK) {
                var v = field(x, y);
                var m = v[2];
                if (m != NIL) {
                    m = Math.min(m, 25);
                    g.fillStyle = util.asRainbowColorStyle(m / 25, 0.4);
                    g.fillRect(x, y, BLOCK, BLOCK);
                }
            }
        }

        (function batchDraw() {
            try {
                if (settings.animate) {
                    var start = +new Date;
                    while (x < bounds.xBound) {
                        drawColumn(x);
                        x += BLOCK;
                        if ((+new Date - start) > MAX_TASK_TIME * 5) {
                            // Drawing is taking too long. Schedule the next batch for later and yield.
                            setTimeout(batchDraw, MIN_SLEEP_TIME);
                            return;
                        }
                    }
                    d.resolve(true);
                    log.timeEnd("overlay");
                }
            }
            catch (e) {
                d.reject(e);
            }
        })();

        return d.promise;
    }

    function animate(settings, field) {

        log.debug("here");

        var bounds = settings.displayBounds;
        var buckets = settings.styles.map(function() { return []; });
        var particles = [];

        for (var i = 0; i < settings.particleCount; i++) {
            particles.push(field.randomize({age: util.rand(0, settings.maxParticleAge)}));
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
                    if (field(xt, yt)[2] !== NIL) {
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
            // log.debug("frame");
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

    function clearCanvas(canvas) {
        canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    }

    function resetDisplay(settings) {
        settings.animate = false;
        clearCanvas(d3.select(FIELD_CANVAS_ID).node());
        clearCanvas(d3.select(OVERLAY_CANVAS_ID).node());
    }

    function prepareDisplay(settings) {
        settings.animate = true;
        settings.displayBounds = util.createDisplayBounds(settings.projection);
        log.debug(JSON.stringify(settings.displayBounds));
        var maskTask        = when.all([settingsTask]).then(apply(renderMasks));
        var fieldTask       = when.all([buildGridTask, settingsTask, maskTask]).then(apply(interpolateField));
        var overlayTask     = when.all([settingsTask, fieldTask             ]).then(apply(overlay));
        var animateTask     = when.all([settingsTask, fieldTask, overlayTask]).then(apply(animate));
        when.all([
            fieldTask,
            overlayTask,
            animateTask
        ]).then(null, report);
    }

    function report(e) {
        log.error(e);
        displayStatus(null, e.error ? e.error == 404 ? "No Data" : e.error + " " + e.message : e);
    }

    var topoLoTask      = util.loadJson(parameters.topography_lo);
    var topoHiTask      = util.loadJson(parameters.topography_hi);
    var dataTask        = util.loadJson(parameters.samples);
    var initTask        = when.all([true                                ]).then(apply(init));
    var settingsTask    = when.all([topoLoTask                          ]).then(apply(createSettings));
    var meshTask        = when.all([topoLoTask, topoHiTask, settingsTask]).then(apply(buildMeshes));
    var renderTask      = when.all([settingsTask, meshTask              ]).then(apply(render));
    var buildGridTask   = when.all([dataTask                            ]).then(apply(buildGrid));

    var prepareTask = when.all([settingsTask]).then(apply(prepareDisplay));

    // Register a catch-all error handler to log errors rather then let them slip away into the ether.... Cleaner way?
    when.all([
        topoLoTask,
        topoHiTask,
        initTask,
        settingsTask,
        meshTask,
        renderTask,
        buildGridTask,
        prepareTask
    ]).then(null, report);

})();
