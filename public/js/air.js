
var π = Math.PI;
var sin = Math.sin;
var cos = Math.cos;
var atan2 = Math.atan2;
var sqrt = Math.sqrt;
var abs = Math.abs;
var random = Math.random;
var round = Math.round;
var floor = Math.floor;

var width = 1024, height = 768;

var projection;  // ugh. global to this script, but assigned asynchronously

var mapSvg = d3.select("#map-svg").attr("width", width).attr("height", height);
var maskSvg = d3.select("#mask-svg").attr("width", width).attr("height", height);
var maskCanvas = d3.select("#mask-canvas").attr("width", width).attr("height", height)[0][0];
var fieldCanvas = d3.select("#field-canvas").attr("width", width).attr("height", height)[0][0];

d3.json("tk.topojson", function (error, tk) {

    var bbox = tk.bbox;
    var boundary = topojson.mesh(tk, tk.objects.tk, function(a, b) { return a === b; });
    var path;

    var bboxCenter = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];  // not going to work if crossing 180th meridian
    // Create a unit projection.
    projection = d3.geo.albers()
        .center([0, bboxCenter[1]])
        .rotate([-bboxCenter[0], 0])
        .scale(1)
        .translate([0, 0]);

    // Create a path generator.
    path = d3.geo.path().projection(projection);

    // Compute the bounds of a feature of interest, then derive scale & translate.
    var b = path.bounds(boundary);
    var s = .95 / Math.max((b[1][0] - b[0][0]) / width, (b[1][1] - b[0][1]) / height);
    var t = [(width - s * (b[1][0] + b[0][0])) / 2, (height - s * (b[1][1] + b[0][1])) / 2];

    // Update the projection to use computed scale & translate.
    projection.scale(s).translate(t);

    document.getElementById("detail").innerHTML += "⁂ " + bbox.join(", ");

    mapSvg.append("path")
        .datum(topojson.mesh(tk, tk.objects.tk, function(a, b) { return a === b; }))
        .attr("class", "tk-outboundary")
        .attr("d", path);

    mapSvg.append("path")
        .datum(topojson.mesh(tk, tk.objects.tk, function (a, b) { return a !== b; }))
        .attr("class", "tk-inboundary")
        .attr("d", path);

    maskSvg.append("path")
        .datum(topojson.mesh(tk, tk.objects.tk, function(a, b) { return a === b; }))
        .attr("fill", "#fff")
//        .attr("stroke-width", "50")  // firefox does NOT like this -- incredible performance penalty
        .attr("stroke-width", "5")
        .attr("stroke", "#000")
//        .attr("stroke-linejoin", "round")
        .attr("d", path);

    canvg(maskCanvas, document.getElementById("mask").innerHTML.trim());
    var maskCanvasContext = maskCanvas.getContext("2d");
    var maskData = maskCanvasContext.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;

    for (var x = maskCanvas.width - 1; x >= 0; x -= 1) {
        var column = fieldMask[x] = [];
        for (var y = maskCanvas.height - 1; y >= 0; y -= 1) {
            var i = (y * maskCanvas.width + x) * 4;
            column[y] = maskData[i] > 0;
        }
    }

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function(position) {
                var p = projection([position.coords.longitude, position.coords.latitude]);
                var x = round(p[0]);
                var y = round(p[1]);
                if (0 <= x && x < width && 0 <= y && y < height) {
                    mapSvg.append("circle")
                        .attr("cx", x)
                        .attr("cy", y)
                        .attr("r", 3)
                        .attr("id", "pos");
                }
            },
            console.error.bind(console),
            {enableHighAccuracy: true});
    }

    var e;
    e = document.getElementById("mask");
    e.parentNode.removeChild(e);
    e = document.getElementById("mask2");
    e.parentNode.removeChild(e);

    d3.json("stations/geo", function(error, stations) {
        path.pointRadius(1);
        mapSvg.append("path")
            .datum(stations)
            .attr("class", "station")
            .attr("d", path);

//        var resource = "samples/2013/8/24/16"
//        var resource = "samples/2013/8/22/19"
//        var resource = "samples/2013/8/21/22"
//        var resource = "samples/2013/8/21/16"
//        var resource = "samples/2013/8/21/15"
//        var resource = "samples/2013/8/20/22"
//        var resource = "samples/2013/8/20/21"
//        var resource = "samples/2013/8/20/20"
//        var resource = "samples/2013/8/20/19"
//        var resource = "samples/2013/8/20/18"
//        var resource = "samples/2013/8/19/16"
//        var resource = "samples/2013/8/18/17"  // strong northerly wind
//        var resource = "samples/2013/8/17/17"
//        var resource = "samples/2013/8/16/15"
//        var resource = "samples/2013/8/12/19"  // max wind at one station
//        var resource = "samples/2013/8/27/12"  // gentle breeze
//        var resource = "samples/2013/8/26/29"
        var resource = "samples/current";

        interpolateVectorField(resource);
//            interpolateScalarField(resource, "no2");
    });
});

var done = false;

var fieldMask = [];

d3.select("#field-canvas").on("click", printCoord);

function printCoord() {
    console.log(d3.mouse(this));
    console.log(projection.invert(d3.mouse(this)));
    done = true;
}

var particles = [];
var maxAge = 30;

function distance(x1, y1, x2, y2) {
    var xd = abs(x1 - x2);
    var yd = abs(y1 - y2);
    return sqrt(xd * xd + yd * yd);
}

function weight(x1, y1, x2, y2) {
    var d = distance(x1, y1, x2, y2);
    return 1 / (d * d);
}

function multiply(x, y) {
    return x * y;
}

function add(x, y) {
    return x + y;
}

function vectorScale(v, m) {
    v[1] *= m;
    return v;
}

function vectorAdd(a, b) {
    var ax = cos(a[0]) * a[1];
    var ay = sin(a[0]) * a[1];
    var bx = cos(b[0]) * b[1];
    var by = sin(b[0]) * b[1];

    var cx = ax + bx;
    var cy = ay + by;

    var r = atan2(cy, cx);
    var m = sqrt(cx * cx + cy * cy);

    if (!isFinite(r)) {
        r = 0;
    }
    a[0] = r;
    a[1] = m;
    return a;
}

var temp = [];  // HACK
function f(x, y, initial, data, scale, add) {
    var n = initial;
    var d = 0;
    for (var i = 0; i < data.length; i++) {
        var sample = data[i];
        var value = sample[2];
        var w = weight(x, y, sample[0], sample[1]);
        if (w === Number.POSITIVE_INFINITY) {
            return value;
        }
        temp[0] = value[0];  // DOESN'T WORK FOR SCALARS
        temp[1] = value[1];
        var s = scale(temp, w);
        n = add(n, s);
        d += w;
    }
    return scale(n, 1 / d);
}

var c = fieldCanvas;
var g = c.getContext("2d");

function interpolateScalarField(resource, sampleType) {
    d3.json(resource, function(error, samples) {
        var values = [];
        samples.forEach(function(sample) {
            if (sample[sampleType]) {
                values.push([sample.longitude * 1, sample.latitude * 1, sample[sampleType] * 1]);
            }
        });
        var field = [];
        var min = Number.POSITIVE_INFINITY;
        var max = Number.NEGATIVE_INFINITY;
        for (var x = width; x >= 350; x--) {
            field[x] = [];
            for (var y = height; y >= 150; y--) {
                var p = projection.invert([x, y]);
                var v = f(p[0], p[1], 0, values, multiply, add);
                field[x][y] = v;
                if (v < min) {
                    min = v;
                }
                if (v > max) {
                    max = v;
                }
            }
        }
        processScalarField(field, min, max);
    });

    function processScalarField(field, min, max) {
        var styles = [];
        for (var i = 0; i < 255; i += 1) {
            styles.push("rgba(" + i + ", " + i + ", " + i + ", 0.6)");
        }
        var range = max - min;

        for (var x = 350; x < width; x+=1) {
            for (var y = 150; y < height; y+=1) {
                if (fieldMask[x][y]) {
                    var v = field[x][y];
                    var style = styles[floor((v-min)/range * (styles.length-1))];
                    g.fillStyle = style;
                    g.fillRect(x, y, 1, 1);
                }
            }
        }
    }
}

function displayTimestamp(isoDate) {
    document.getElementById("detail").textContent += " ⁂ " + isoDate;
}

function interpolateVectorField(resource) {
    d3.json(resource, function(error, samples) {
        // Convert cardinal (north origin, clockwise) to radians (counter-clockwise)

        if (samples.length > 0) {
            displayTimestamp(samples[0].date);
        }

        var vectors = [];
        samples.forEach(function(sample) {
            if (sample.wd && sample.wv) {
                var r = sample.wd / 180 * π;
                vectors.push([
                    sample.longitude * 1,
                    sample.latitude * 1,
                    [atan2(cos(r), sin(r)), sample.wv * 1]]);
            }
        });

        var field = [];
        for (var x = width - 1; x >= 0; x--) {
            var column = field[x] = [];
            for (var y = height - 1; y >= 0; y--) {
                if (fieldMask[x][y]) {
                    var p = projection.invert([x, y]);
                    var px = p[0];
                    var py = p[1];
                    p[0] = 0;
                    p[1] = 0;
                    var v = f(px, py, p, vectors, vectorScale, vectorAdd);
                    var r = v[0];
                    var m = v[1];
                    v[0] = cos(r + π) * m;
                    v[1] = -sin(r + π) * m;
                    v[2] = m;
                    column[y] = v;
                }
            }
        }
        processVectorField(field);
    });

    function randomPoint() {
        var x;
        var y;
        var i = 50;
        do {
            x = random() * (width - 1);
            y = random() * (height - 1);
            if (--i == 0) {  // remove this check. make better.
                console.log("failed");
                return [100, 100];
            }
        } while (!fieldMask[round(x)][round(y)]);
        return [x, y];
    }

    function processVectorField(field) {

        for (var i = 0; i < 3000; i++) {
            var p = randomPoint();
            particles.push({
                x: p[0],
                y: p[1],
                age: floor(random() * maxAge)
            });
        }

        var styles = [];
        for (var j = 70; j <= 255; j += 1) {
            styles.push("rgba(" + j + ", " + j + ", " + j + ", 1)");
        }
        var max = 17;
        var min = 0;
        var range = max - min;

        draw();

        function draw() {
            var prev = g.globalCompositeOperation;
            g.fillStyle = "rgba(0, 0, 0, 0.93)";
            g.globalCompositeOperation = "destination-in";
            g.fillRect(0, 0, c.width, c.height);
            g.globalCompositeOperation = prev;

            g.lineWidth = 0.75;

            particles.forEach(function(particle) {
                if (particle.age > maxAge) {
                    particle.age = 0;
                    var p = randomPoint();
                    particle.x = p[0];
                    particle.y = p[1];
                }

                // get vector at current location
                var x = particle.x;
                var y = particle.y;
                var fx = round(x);
                var fy = round(y);

                if (fx < field.length && field[fx] && fy < field[fx].length && field[fx][fy]) {
                    if (fx < fieldMask.length && fy < fieldMask[fx].length && fieldMask[fx][fy]) {
                        var v = field[fx][fy];
                        var xt = x + v[0] * 1;
                        var yt = y + v[1] * 1;

                        var i = floor((Math.min(v[2], max) - min) / range * (styles.length - 1));
                        var style = styles[i];

//                        g.fillStyle = style; //"rgba(255, 255, 255, 1)";
//                        g.fillRect(round(xt), round(yt), 1, 1);

                        g.beginPath();
                        g.strokeStyle = style;
                        g.moveTo(round(x), round(y));
                        g.lineTo(round(xt), round(yt));
                        g.stroke();

                        particle.x = xt;
                        particle.y = yt;
                    }
                }
                particle.age += 1;
            });

            if (!done) {
                setTimeout(draw, 40);
            }
        }
    }
}

