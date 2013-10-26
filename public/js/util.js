

util = function() {
    "use strict";

    /**
     * Returns a random number between min (inclusive) and max (exclusive).
     */
    function rand(min, max) {
        return min + Math.random() * (max - min);
    }

    /**
     * Returns the index of v in array a. The array must be sorted in ascending order. (Adapted from Java and
     * darkskyapp/binary-search).
     *
     * @param a {Array} the array
     * @param v {number} the number to search for
     * @returns {number} the index of the value if found, otherwise a negative value x such that x == -i - 1,
     *          where i represents the insertion point of v into the array while maintaining sorted order.
     */
    function binarySearch(a, v) {
        var low = 0;
        var high = a.length - 1;

        while (low <= high) {
            var mid = low + ((high - low) >> 1)
            var p = a[mid];

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
     * Returns a function that takes an array and applies it as arguments to the specified function. Yup. Basically
     * the same as when.js/apply.
     */
    function apply(f) {
        return function(args) {
            return f.apply(null, args);
        }
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
     * Returns a d3 Albers conical projection (en.wikipedia.org/wiki/Albers_projection) that maps the bounding box
     * defined by the lower left geographic coordinates (lng0, lat0) and upper right coordinates (lng1, lat1) onto
     * the view port having (0, 0) as the upper left point and (width, height) as the lower right point.
     */
    function createFooProjection(lng0, lat0, lng1, lat1, view) {
        // Construct a unit projection centered on the bounding box. NOTE: center calculation will not be correct
        // when the bounding box crosses the 180th meridian.
        var projection = d3.geo.orthographic()
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
     * Return exported members.
     */
    return {
        rand: rand,
        binarySearch: binarySearch,
        apply: apply,
        log: log,
        view: view,
        loadJson: loadJson,
        createAlbersProjection: createAlbersProjection,
        createFooProjection: createFooProjection,
        createDisplayBounds: createDisplayBounds
    };

}();
