air
===

"air" is a project to visualize air quality data provided by the Tokyo Metropolitan
Government. The main components of the project are:
   * a scraper to extract air data from [www.kankyo.metro.tokyo.jp](www.kankyo.metro.tokyo.jp)
   * a postgres database to store the data
   * an express.js server to serve this data and other static files to the client
   * a client app that interpolates the data and renders an animated wind map

An instance of "air" is available at http://air.nullschool.net. It is currently hosted
by [Amazon Web Services](http://aws.amazon.com) and fronted by
[CloudFlare](https://www.cloudflare.com).

"air" is a personal project I've used to learn javascript, node.js, when.js, postgres, D3
and browser programming. Some of the design decisions were made simply to try something new
(e.g., postgres). Undoubtedly, other decisions were made from a lack of experience. Feedback
welcome!

building and launching
----------------------

1. Clone the project and install libraries from npm:

    npm install

NOTE: you will need [libpq](http://www.postgresql.org/docs/9.3/static/libpq.html) to
build [pg](https://github.com/brianc/node-postgres). The libpq library was installed
automatically by postgres on Mac OS X but required separate installation on AWS.

2. Install postgres and create a database, something like:

    CREATE DATABASE air
      WITH OWNER = postgres
           ENCODING = 'UTF8'
           TABLESPACE = pg_default
           LC_COLLATE = 'en_US.UTF-8'
           LC_CTYPE = 'en_US.UTF-8'
           CONNECTION LIMIT = -1;

3. Launch the server:

    node server.js <port> <postgres-connection-string> <air-data-url>

Example:

    node server.js 8080 postgres://postgres:12345@localhost:5432/air <air-data-url>

4. Finally, point the browser at the server:

    http://localhost:8080

implementation notes
--------------------

Building this project required solutions to some interesting problems. Here are a few:

   * Live air data is available as Shift_JIS encoded HTML. Node.js does not natively
     support Shift_JIS, so the [iconv](https://github.com/bnoordhuis/node-iconv) library
     is used to perform the conversion to UTF-8.
   * Geographic data of Tokyo was sourced directly from the Ministry of Land,
     Infrastructure, Transport and Tourism, as an 80MB XML file. This data was transformed
     to a 300KB [TopoJSON](https://github.com/mbostock/topojson) file, small
     enough for browsers to download and render as SVG with [D3](http://d3js.org/).
   * Roughly 50 sampling stations provide hourly wind data.
     [Inverse Distance Weighting](http://en.wikipedia.org/wiki/Inverse_distance_weighting)
     interpolation is used to construct a wind vector field that covers all of Tokyo. IDW
     produces strange artifacts and is considered obsolete, but it is very simple and was
     easy to extend to perform vector interpolation.
   * The browser interpolates each point (x, y) using the n-closest sampling stations. To
     determine the n-closest neighbors, the client constructs a [k-d tree](
     http://en.wikipedia.org/wiki/K-d_tree), which greatly improves the performance.
   * The SVG map of Tokyo is overlaid with an HTML5 Canvas, where the animation is drawn.
     The animation renderer needs to know where the borders of Tokyo are rendered
     on screen by the SVG engine, but this information is extremely difficult to obtain.
     To workaround this problem, the [canvg](http://code.google.com/p/canvg/) library
     is used to re-render Tokyo's polygons to a detached Canvas element, and the Canvas'
     pixels operate as a mask to distinguish points that lie inside the map to those
     outside.
   * I used [when.js](https://github.com/cujojs/when) on the browser because it was a fun
     experiment.

inspiration
-----------

The awesome [wind map at hint.fm](http://hint.fm/wind/) provided the main inspiration for
this project. And the very nice D3 tutorial [Let's Make a Map](http://bost.ocks.org/mike/map/)
showed how easy it was to actually get started.
