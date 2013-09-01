"use strict";

exports.stations = {
    name: "stations",
    owner: "postgres",
    columns: [
        {name: "id", type: "INTEGER", modifier: "NOT NULL", description: "station id"},
        {name: "name", type: "TEXT", description: "station name"},
        {name: "address", type: "TEXT", description: "station location"},
        {name: "latitude", type: "NUMERIC(9, 6)", description: "latitude"},
        {name: "longitude", type: "NUMERIC(9, 6)", description: "longitude"}
    ],
    primary: {name: "stations_PK", columns: ["id"]}
}

exports.samples = {
    name: "samples",
    owner: "postgres",
    columns: [
        {name: "date", type: "TIMESTAMP WITH TIME ZONE", modifier: "NOT NULL", description: "sample date"},
        {name: "stationId", type: "INTEGER", modifier: "NOT NULL", description: "sampling station"},
        {name: "temp", type: "NUMERIC(4, 1)", description: "temperature (C)"},
        {name: "hum", type: "NUMERIC(4, 1)", description: "humidity (%)"},
        {name: "wv", type: "NUMERIC(4, 1)", description: "wind velocity (m/s)"},
        {name: "wd", type: "NUMERIC(4, 1)", description: "wind direction (deg)"},
        {name: "in", type: "NUMERIC(4, 2)", description: "insolation, solar irradiation (MJ/m2 [over 1 hr])"},
        {name: "no", type: "NUMERIC(5, 3)", description: "nitric monoxide 一酸化窒素 (cm3/m3 [ppm])"},
        {name: "no2", type: "NUMERIC(5, 3)", description: "nitrogen dioxide 二酸化窒素 (cm3/m3 [ppm])"},
        {name: "nox", type: "NUMERIC(5, 3)", description: "nitrogen oxide 窒素酸化物 (cm3/m3 [ppm])"},
        {name: "ox", type: "NUMERIC(5, 3)", description: "photochemical oxidant (cm3/m3 [ppm])"},
        {name: "so2", type: "NUMERIC(5, 3)", description: "sulfur dioxide (cm3/m3 [ppm])"},
        {name: "co", type: "NUMERIC(5, 1)", description: "carbon monoxide (cm3/m3 [ppm])"},
        {name: "ch4", type: "NUMERIC(5, 2)", description: "methane (cm3/m3 [ppm])"},
        {name: "nmhc", type: "NUMERIC(5, 2)", description: "non-methane hydrocarbon (cm3/m3 [ppm])"},
        {name: "spm", type: "NUMERIC(4, 0)", description: "suspended particulate matter (μg/m3)"},
        {name: "pm25", type: "NUMERIC(4, 0)", description: "2.5 micron particulate matter (μg/m3)"}
    ],
    primary: {name: "samples_PK", columns: ["date", "stationId"]}
}
