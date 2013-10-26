(function() {
    "use strict";

    var DISPLAY_ID = "#display";
    var MAP_SVG_ID = "#map-svg";

    var log = util.log;
    var apply = util.apply;
    var view = util.view;
    var parameters = {
        topography: d3.select(DISPLAY_ID).attr("data-topography")
    };

    function init() {
        // Modify the display elements to fill the screen.
        d3.select(MAP_SVG_ID).attr("width", view.width).attr("height", view.height);
    }

    function createSettings(topo) {
        var projection = util.createFooProjection(topo.bbox[0], topo.bbox[1], topo.bbox[2], topo.bbox[3], view);
        var bounds = util.createDisplayBounds(topo.bbox[0], topo.bbox[1], topo.bbox[2], topo.bbox[3], projection);
        var settings = {
            projection: projection,
            displayBounds: bounds
        };
        log.debug(JSON.stringify(view) + " " + JSON.stringify(settings));
        return settings;
    }

    function buildMeshes(topo, settings) {
        // displayStatus("building meshes...");
        log.time("building meshes");
        var path = d3.geo.path().projection(settings.projection);
        var boundary = topojson.mesh(topo, topo.objects.land);
//        var outerBoundary = topojson.mesh(topo, topo.objects.main, function(a, b) { return a === b; });
//        var divisionBoundaries = topojson.mesh(topo, topo.objects.main, function (a, b) { return a !== b; });
        log.timeEnd("building meshes");
        return {
            path: path,
            boundary: boundary
        };
    }

    function renderMap(mesh) {
        // displayStatus("Rendering map...");
        log.time("rendering map");
        var mapSvg = d3.select(MAP_SVG_ID);
        mapSvg.append("path").datum(mesh.boundary).attr("class", "coastline").attr("d", mesh.path);
//        mapSvg.append("path").datum(mesh.divisionBoundaries).attr("class", "in-boundary").attr("d", mesh.path);
        log.timeEnd("rendering map");
    }

    function report(e) {
        log.error(e);
        // displayStatus(null, e.error ? e.error == 404 ? "No Data" : e.error + " " + e.message : e);
    }

    var topoTask        = util.loadJson(parameters.topography);
    var initTask        = when.all([true                                ]).then(apply(init));
    var settingsTask    = when.all([topoTask                            ]).then(apply(createSettings));
    var meshTask        = when.all([topoTask, settingsTask              ]).then(apply(buildMeshes));
    var renderTask      = when.all([meshTask                            ]).then(apply(renderMap));

    // Register a catch-all error handler to log errors rather then let them slip away into the ether.... Cleaner way?
    when.all([
        topoTask,
        initTask,
        settingsTask,
        meshTask,
        renderTask
    ]).then(null, report);

})();
