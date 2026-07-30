# -*- coding: utf-8 -*-
"""
Qilian Mountain National Park WebGIS - Flask Backend
======================================================

Provides REST/JSON APIs over a SQLite database and serves GeoJSON vector
layers plus the frontend static files.

Run:
    python app.py
    -> http://localhost:5000
"""

import os
import json
import sqlite3

from flask import (
    Flask, jsonify, request, send_from_directory, abort
)
from flask_cors import CORS


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "qilian_webgis.db")
VECTORS_DIR = os.path.join(DATA_DIR, "vectors")
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")

# Map friendly layer names -> GeoJSON file names
GEOJSON_LAYERS = {
    "boundary": "qilian_boundary.geojson",
    "watersheds": "watersheds.geojson",
    "stations": "monitoring_stations.geojson",
    "wildlife": "wildlife_stations.geojson",
    "human_activities": "human_activities.geojson",
    "plants": "endangered_plants.geojson",
    "rivers": "rivers.geojson",
    "provinces": "ne_provinces.geojson",
    "roads": "ne_roads.geojson",
    "lakes": "ne_lakes.geojson",
}

# Metric columns returned by the meteorological endpoint (kept in a fixed
# order so the charting frontend receives predictable arrays).
METEO_METRICS = [
    "air_temp",
    "soil_temp",
    "canopy_temp",
    "atmosphere_temp",
    "precipitation",
    "humidity",
    "wind_speed",
]

app = Flask(__name__, static_folder=None)
CORS(app)  # enable CORS for all routes


# --------------------------------------------------------------------------- #
# Database helpers
# --------------------------------------------------------------------------- #
def get_db():
    """Open a SQLite connection configured to return dict-like rows."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def rows_to_dicts(rows):
    return [dict(r) for r in rows]


def query_all(sql, params=()):
    """Run a SELECT and return all rows as a list of dicts."""
    conn = get_db()
    try:
        cur = conn.execute(sql, params)
        return rows_to_dicts(cur.fetchall())
    finally:
        conn.close()


def query_one(sql, params=()):
    """Run a SELECT and return the first row as a dict (or None)."""
    conn = get_db()
    try:
        cur = conn.execute(sql, params)
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def error_response(message, status_code=400, **extra):
    """Build a uniform JSON error payload."""
    payload = {"error": message, "status": status_code}
    payload.update(extra)
    return jsonify(payload), status_code


# --------------------------------------------------------------------------- #
# Error handlers
# --------------------------------------------------------------------------- #
@app.errorhandler(404)
def not_found(e):
    return error_response("Resource not found", 404)


@app.errorhandler(500)
def internal_error(e):
    return error_response("Internal server error", 500)


# --------------------------------------------------------------------------- #
# 1. GeoJSON layer serving
# --------------------------------------------------------------------------- #
@app.route("/api/geojson/<layer_name>")
def get_geojson(layer_name):
    """Serve a GeoJSON vector file by friendly layer name."""
    filename = GEOJSON_LAYERS.get(layer_name)
    if not filename:
        return error_response(
            "Unknown layer '%s'. Available layers: %s"
            % (layer_name, ", ".join(sorted(GEOJSON_LAYERS.keys()))),
            404,
        )

    file_path = os.path.join(VECTORS_DIR, filename)
    if not os.path.isfile(file_path):
        return error_response("GeoJSON file not found on disk: %s" % filename, 404)

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (IOError, json.JSONDecodeError) as exc:
        return error_response("Failed to read GeoJSON file: %s" % exc, 500)

    return jsonify(data)


# --------------------------------------------------------------------------- #
# 2. Data API endpoints
# --------------------------------------------------------------------------- #
@app.route("/api/stations")
def api_stations():
    """Return all monitoring stations."""
    try:
        rows = query_all(
            "SELECT id, name, longitude, latitude, elevation, "
            "station_type, forest_type, description "
            "FROM monitoring_stations ORDER BY id"
        )
        return jsonify({"count": len(rows), "stations": rows})
    except sqlite3.Error as exc:
        return error_response("Database error: %s" % exc, 500)


@app.route("/api/meteorological")
def api_meteorological():
    """Return meteorological time series for charting.

    Query params (all optional):
        station_id  default DYK001
        start_date  default 2020-01-01
        end_date    default 2022-12-31
    """
    station_id = request.args.get("station_id", "DYK001").strip()
    start_date = request.args.get("start_date", "2020-01-01").strip()
    end_date = request.args.get("end_date", "2022-12-31").strip()

    if not station_id:
        return error_response("station_id is required", 400)

    try:
        rows = query_all(
            "SELECT date, air_temp, soil_temp, canopy_temp, atmosphere_temp, "
            "precipitation, humidity, wind_speed "
            "FROM meteorological_data "
            "WHERE station_id = ? AND date >= ? AND date <= ? "
            "ORDER BY date ASC",
            (station_id, start_date, end_date),
        )
    except sqlite3.Error as exc:
        return error_response("Database error: %s" % exc, 500)

    if not rows:
        return error_response(
            "No meteorological data found for station '%s' between %s and %s"
            % (station_id, start_date, end_date),
            404,
        )

    dates = [r["date"] for r in rows]
    metrics = {m: [r[m] for r in rows] for m in METEO_METRICS}

    return jsonify(
        {
            "station_id": station_id,
            "start_date": start_date,
            "end_date": end_date,
            "count": len(rows),
            "dates": dates,
            "metrics": metrics,
        }
    )


@app.route("/api/ecosystem-stats")
def api_ecosystem_stats():
    """Return ecosystem type areas for a region (default 黑河流域)."""
    region = request.args.get("region", "黑河流域").strip()

    try:
        row = query_one(
            "SELECT region, glacier_km2, grassland_km2, bare_land_km2, "
            "shrub_km2, desert_km2, human_activity_km2, forest_km2, "
            "wetland_km2, water_body_km2 "
            "FROM ecosystem_stats WHERE region = ?",
            (region,),
        )
    except sqlite3.Error as exc:
        return error_response("Database error: %s" % exc, 500)

    if not row:
        return error_response("No ecosystem stats found for region '%s'" % region, 404)

    # Split out the label/value pairs for easy charting.
    area_fields = [
        "glacier_km2",
        "grassland_km2",
        "bare_land_km2",
        "shrub_km2",
        "desert_km2",
        "human_activity_km2",
        "forest_km2",
        "wetland_km2",
        "water_body_km2",
    ]
    areas = [{"type": f, "area_km2": row[f]} for f in area_fields]

    return jsonify({"region": region, "stats": row, "areas": areas})


@app.route("/api/human-activity-stats")
def api_human_activity_stats():
    """Return human-activity statistics for a region (default 祁连山全域)."""
    region = request.args.get("region", "祁连山全域").strip()

    try:
        row = query_one(
            "SELECT region, total_km2, urban_land_km2, urban_land_count, "
            "rural_residential_km2, rural_residential_count, "
            "reservoir_pond_km2, reservoir_pond_count, "
            "industrial_mining_km2, industrial_mining_count, "
            "other_construction_km2, other_construction_count "
            "FROM human_activity_stats WHERE region = ?",
            (region,),
        )
    except sqlite3.Error as exc:
        return error_response("Database error: %s" % exc, 500)

    if not row:
        return error_response(
            "No human-activity stats found for region '%s'" % region, 404
        )

    return jsonify({"region": region, "stats": row})


@app.route("/api/wildlife/species")
def api_wildlife_species():
    """Wildlife species taxonomy summary grouped by category.

    For each category counts the distinct orders, distinct families and the
    total number of species (sum of species_count).
    """
    try:
        summary = query_all(
            "SELECT category, "
            "COUNT(DISTINCT order_name) AS order_count, "
            "COUNT(DISTINCT family_name) AS family_count, "
            "COALESCE(SUM(species_count), 0) AS species_count "
            "FROM wildlife_species "
            "GROUP BY category ORDER BY category"
        )
        details = query_all(
            "SELECT category, order_name, family_name, species_count, "
            "protection_level FROM wildlife_species ORDER BY category, order_name"
        )
    except sqlite3.Error as exc:
        return error_response("Database error: %s" % exc, 500)

    total_species = sum(s["species_count"] for s in summary)
    return jsonify(
        {
            "categories": len(summary),
            "total_species": total_species,
            "summary": summary,
            "details": details,
        }
    )


@app.route("/api/wildlife/observations")
def api_wildlife_observations():
    """Return wildlife observation records, optionally filtered by species."""
    species = request.args.get("species", "").strip()

    try:
        if species:
            rows = query_all(
                "SELECT id, station_id, species, observation_date, temperature, "
                "media_type, description FROM wildlife_observations "
                "WHERE species = ? ORDER BY observation_date DESC",
                (species,),
            )
        else:
            rows = query_all(
                "SELECT id, station_id, species, observation_date, temperature, "
                "media_type, description FROM wildlife_observations "
                "ORDER BY observation_date DESC"
            )
    except sqlite3.Error as exc:
        return error_response("Database error: %s" % exc, 500)

    return jsonify(
        {
            "count": len(rows),
            "species_filter": species if species else None,
            "observations": rows,
        }
    )


@app.route("/api/plants")
def api_plants():
    """Return endangered plant records grouped by protection level."""
    try:
        rows = query_all(
            "SELECT id, name, sci_name, protection_level, longitude, latitude, "
            "elevation FROM endangered_plants ORDER BY protection_level, name"
        )
    except sqlite3.Error as exc:
        return error_response("Database error: %s" % exc, 500)

    groups = {}
    for r in rows:
        level = r["protection_level"] or "未分类"
        groups.setdefault(level, []).append(r)

    grouped = [
        {"protection_level": level, "count": len(items), "plants": items}
        for level, items in groups.items()
    ]

    return jsonify(
        {
            "total": len(rows),
            "group_count": len(grouped),
            "groups": grouped,
            "plants": rows,
        }
    )


@app.route("/api/ndvi")
def api_ndvi():
    """Return the NDVI time series (year, mean, max, min)."""
    try:
        rows = query_all(
            "SELECT year, ndvi_mean, ndvi_max, ndvi_min "
            "FROM ndvi_time_series ORDER BY year ASC"
        )
    except sqlite3.Error as exc:
        return error_response("Database error: %s" % exc, 500)

    years = [r["year"] for r in rows]
    series = {
        "ndvi_mean": [r["ndvi_mean"] for r in rows],
        "ndvi_max": [r["ndvi_max"] for r in rows],
        "ndvi_min": [r["ndvi_min"] for r in rows],
    }
    return jsonify(
        {"count": len(rows), "years": years, "series": series, "records": rows}
    )


@app.route("/api/precipitation")
def api_precipitation():
    """Return precipitation time series for a region (default 祁连山全域)."""
    region = request.args.get("region", "祁连山全域").strip()

    try:
        rows = query_all(
            "SELECT year, precipitation_mm, region "
            "FROM precipitation_time_series "
            "WHERE region = ? ORDER BY year ASC",
            (region,),
        )
    except sqlite3.Error as exc:
        return error_response("Database error: %s" % exc, 500)

    if not rows:
        return error_response(
            "No precipitation data found for region '%s'" % region, 404
        )

    years = [r["year"] for r in rows]
    values = [r["precipitation_mm"] for r in rows]
    return jsonify(
        {
            "region": region,
            "count": len(rows),
            "years": years,
            "precipitation_mm": values,
            "records": rows,
        }
    )


@app.route("/api/human-activity-trends")
def api_human_activity_trends():
    """Return human-activity trends by zone and year (2013-2019)."""
    try:
        rows = query_all(
            "SELECT year, zone, count "
            "FROM human_activity_trends "
            "WHERE year BETWEEN 2013 AND 2019 "
            "ORDER BY zone, year ASC"
        )
    except sqlite3.Error as exc:
        return error_response("Database error: %s" % exc, 500)

    if not rows:
        return error_response("No human-activity trend data found", 404)

    years = sorted({r["year"] for r in rows})
    zones = sorted({r["zone"] for r in rows})

    # Build a zone -> {year: count} lookup for convenient charting.
    by_zone = {z: {} for z in zones}
    for r in rows:
        by_zone[r["zone"]][r["year"]] = r["count"]

    # Per-zone arrays aligned with the sorted years list.
    series = {
        z: [by_zone[z].get(y, 0) for y in years] for z in zones
    }

    return jsonify(
        {
            "years": years,
            "zones": zones,
            "series": series,
            "records": rows,
        }
    )


@app.route("/api/remote-sensing")
def api_remote_sensing():
    """Return remote-sensing indicators, optionally filtered by indicator
    code/name and/or year."""
    indicator = request.args.get("indicator", "").strip()
    year = request.args.get("year", "").strip()

    sql = (
        "SELECT id, indicator_name, indicator_code, unit, description, "
        "year, value FROM remote_sensing_indicators WHERE 1=1"
    )
    params = []

    if indicator:
        # Allow matching either the code (NDVI) or the name (归一化植被指数).
        sql += " AND (indicator_code = ? OR indicator_name = ?)"
        params.extend([indicator, indicator])

    if year:
        try:
            year_int = int(year)
        except ValueError:
            return error_response("year must be an integer", 400)
        sql += " AND year = ?"
        params.append(year_int)

    sql += " ORDER BY indicator_code, year ASC"

    try:
        rows = query_all(sql, tuple(params))
    except sqlite3.Error as exc:
        return error_response("Database error: %s" % exc, 500)

    if not rows:
        return error_response("No remote-sensing indicators match the filters", 404)

    return jsonify(
        {
            "count": len(rows),
            "indicator_filter": indicator if indicator else None,
            "year_filter": int(year) if year else None,
            "indicators": rows,
        }
    )


# --------------------------------------------------------------------------- #
# 3. Frontend static file serving
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    """Serve the frontend entry point."""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.isfile(index_path):
        return send_from_directory(FRONTEND_DIR, "index.html")
    return error_response(
        "Frontend not found. Place the frontend files under the 'frontend/' directory.",
        404,
    )


@app.route("/<path:path>")
def static_files(path):
    """Serve any frontend static asset, falling back to index.html for
    client-side routing when the file does not exist."""
    # Never shadow the API: unknown /api/* paths are real 404s.
    if path.startswith("api/"):
        return error_response("Resource not found", 404)

    full_path = os.path.join(FRONTEND_DIR, path)
    if os.path.isfile(full_path):
        return send_from_directory(FRONTEND_DIR, path)

    # SPA fallback: serve index.html for unknown non-asset routes.
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.isfile(index_path):
        return send_from_directory(FRONTEND_DIR, "index.html")

    return error_response("Resource not found", 404)


# --------------------------------------------------------------------------- #
# 4. Application entry point
# --------------------------------------------------------------------------- #
if __name__ == "__main__":
    # Sanity check the database path on startup.
    if not os.path.isfile(DB_PATH):
        app.logger.warning("Database not found at %s", DB_PATH)
    if not os.path.isdir(VECTORS_DIR):
        app.logger.warning("Vectors directory not found at %s", VECTORS_DIR)
    if not os.path.isdir(FRONTEND_DIR):
        app.logger.warning("Frontend directory not found at %s", FRONTEND_DIR)

    app.run(host="0.0.0.0", port=5000, debug=False)
