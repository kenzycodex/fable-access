"""Reverse geocoding: Google names the street, and never holds up a transfer.

Google is never called here; its response is stubbed with the shape the real
API returns for a Lagos street address.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import geocoding  # noqa: E402

LAGOS = {
    "status": "OK",
    "plus_code": {"compound_code": "GJ9X+5R Lagos, Nigeria"},
    "results": [
        {
            "types": ["street_address"],
            "formatted_address": "14 Adebayo St, Akoka, Lagos 102216, Lagos, Nigeria",
            "address_components": [
                {"long_name": "14", "short_name": "14", "types": ["street_number"]},
                {"long_name": "Adebayo Street", "short_name": "Adebayo St", "types": ["route"]},
                {"long_name": "Akoka", "short_name": "Akoka", "types": ["neighborhood", "political"]},
                {"long_name": "Lagos", "short_name": "Lagos", "types": ["locality", "political"]},
                {"long_name": "Shomolu", "short_name": "Shomolu", "types": ["administrative_area_level_2", "political"]},
                {"long_name": "Lagos", "short_name": "LA", "types": ["administrative_area_level_1", "political"]},
                {"long_name": "Nigeria", "short_name": "NG", "types": ["country", "political"]},
                {"long_name": "102216", "short_name": "102216", "types": ["postal_code"]},
            ],
        },
        {
            "types": ["neighborhood", "political"],
            "formatted_address": "Akoka, Lagos, Nigeria",
            "address_components": [],
        },
    ],
}


def _reset(monkeypatch, key="test-key"):
    monkeypatch.setattr(config, "GOOGLE_MAPS_API_KEY", key)
    geocoding._cache.clear()


def test_street_address_with_house_number(monkeypatch):
    _reset(monkeypatch)
    monkeypatch.setattr(geocoding, "_fetch", lambda lat, lon: LAGOS)
    place = geocoding.reverse(6.5179, 3.3996)
    assert place["street_line"] == "14 Adebayo Street"
    assert place["area"] == "Akoka"
    # The metro, not the local government area, because scoring compares cities.
    assert place["city"] == "Lagos"
    assert place["country_code"] == "NG"
    assert place["plus_code"].startswith("GJ9X+5R")


def test_state_stands_in_when_locality_missing(monkeypatch):
    _reset(monkeypatch)
    body = {
        "status": "OK",
        "results": [{
            "types": ["route"],
            "formatted_address": "Ring Rd, Ibadan, Oyo State, Nigeria",
            "address_components": [
                {"long_name": "Ring Road", "short_name": "Ring Rd", "types": ["route"]},
                {"long_name": "Oyo State", "short_name": "OY", "types": ["administrative_area_level_1"]},
                {"long_name": "Nigeria", "short_name": "NG", "types": ["country"]},
            ],
        }],
    }
    monkeypatch.setattr(geocoding, "_fetch", lambda lat, lon: body)
    place = geocoding.reverse(7.39, 3.9)
    assert place["city"] == "Oyo"
    assert place["street_line"] == "Ring Road"
    assert place["house_number"] is None


def test_cached_lookup_costs_one_call(monkeypatch):
    _reset(monkeypatch)
    calls = []

    def fetch(lat, lon):
        calls.append((lat, lon))
        return LAGOS

    monkeypatch.setattr(geocoding, "_fetch", fetch)
    geocoding.reverse(6.517981, 3.399622)
    geocoding.reverse(6.517982, 3.399621)  # within a metre: same key
    assert len(calls) == 1


def test_failures_return_none_never_raise(monkeypatch):
    _reset(monkeypatch)

    def boom(lat, lon):
        raise OSError("network down")

    monkeypatch.setattr(geocoding, "_fetch", boom)
    assert geocoding.reverse(6.5, 3.4) is None

    monkeypatch.setattr(geocoding, "_fetch", lambda lat, lon: {"status": "REQUEST_DENIED", "error_message": "bad key"})
    assert geocoding.reverse(6.6, 3.4) is None
    monkeypatch.setattr(geocoding, "_fetch", lambda lat, lon: {"status": "ZERO_RESULTS", "results": []})
    assert geocoding.reverse(6.7, 3.4) is None


def test_endpoint(monkeypatch):
    from fastapi.testclient import TestClient
    from main import app

    client = TestClient(app)

    _reset(monkeypatch, key="")
    assert client.get("/v1/geo/reverse", params={"lat": 6.5, "lon": 3.4}).status_code == 503

    _reset(monkeypatch)
    monkeypatch.setattr(geocoding, "_fetch", lambda lat, lon: LAGOS)
    res = client.get("/v1/geo/reverse", params={"lat": 6.5179, "lon": 3.3996})
    assert res.status_code == 200
    assert res.json()["street_line"] == "14 Adebayo Street"

    assert client.get("/v1/geo/reverse", params={"lat": 120, "lon": 3.4}).status_code == 422
