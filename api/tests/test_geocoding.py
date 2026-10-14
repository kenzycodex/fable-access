"""Reverse geocoding: name the street a device is on, and never hold up a transfer.

No map service is called here; each provider's response is stubbed with the
shape the real API returns.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402
import geocoding  # noqa: E402

GOOGLE_LAGOS = {
    "status": "OK",
    "results": [{
        "types": ["street_address"],
        "formatted_address": "14 Adebayo St, Akoka, Lagos 102216, Lagos, Nigeria",
        "address_components": [
            {"long_name": "14", "short_name": "14", "types": ["street_number"]},
            {"long_name": "Adebayo Street", "short_name": "Adebayo St", "types": ["route"]},
            {"long_name": "Akoka", "short_name": "Akoka", "types": ["neighborhood", "political"]},
            {"long_name": "Lagos", "short_name": "Lagos", "types": ["locality", "political"]},
            {"long_name": "Lagos", "short_name": "LA", "types": ["administrative_area_level_1", "political"]},
            {"long_name": "Nigeria", "short_name": "NG", "types": ["country", "political"]},
        ],
    }],
}

NOMINATIM_CAMPUS = {
    "name": "Faculty of Engineering",
    "addresstype": "amenity",
    "address": {
        "amenity": "Faculty of Engineering",
        "road": "Zoology",
        "suburb": "Akoka",
        "city": "Bariga",
        "state": "Lagos State",
        "country": "Nigeria",
        "country_code": "ng",
    },
}


def _reset(monkeypatch, google="", locationiq="", geoapify=""):
    monkeypatch.setattr(config, "GOOGLE_MAPS_API_KEY", google)
    monkeypatch.setattr(config, "LOCATIONIQ_API_KEY", locationiq)
    monkeypatch.setattr(config, "GEOAPIFY_API_KEY", geoapify)
    monkeypatch.setattr(geocoding, "_nominatim_last", 0.0)
    geocoding._cache.clear()
    geocoding._disabled_until.clear()


def _serve(monkeypatch, routes):
    """Answer _http_json by host; a host not listed fails like a dead network."""
    calls = []

    def fake(url, data=None):
        calls.append(url)
        for host, body in routes.items():
            if host in url:
                if isinstance(body, Exception):
                    raise body
                return body
        raise OSError(f"unexpected call to {url}")

    monkeypatch.setattr(geocoding, "_http_json", fake)
    return calls


def test_plus_code_matches_the_open_location_code_reference():
    # The worked example in the Open Location Code specification.
    assert geocoding.plus_code(47.365590, 8.524997) == "8FVC9G8F+6X"


def test_openstreetmap_needs_no_key_and_names_the_metro(monkeypatch):
    _reset(monkeypatch)
    _serve(monkeypatch, {"nominatim.openstreetmap.org": NOMINATIM_CAMPUS})
    place = geocoding.reverse(6.5179853, 3.3996222)
    assert place["street_line"] == "Zoology"
    assert place["area"] == "Akoka"
    # Bariga is a local government area; the metro is Lagos, and scoring
    # compares metros, so crossing town is not a "new city".
    assert place["city"] == "Lagos"
    assert place["district"] == "Bariga"
    assert place["landmark"] == "Faculty of Engineering"
    assert place["plus_code"] == "6FR5G99X+5R"
    assert "OpenStreetMap" in place["attribution"]


def test_google_first_when_configured(monkeypatch):
    _reset(monkeypatch, google="g-key")
    calls = _serve(monkeypatch, {"maps.googleapis.com": GOOGLE_LAGOS, "nominatim.openstreetmap.org": NOMINATIM_CAMPUS})
    place = geocoding.reverse(6.52, 3.40)
    assert place["street_line"] == "14 Adebayo Street"
    assert place["city"] == "Lagos"
    assert place["source"] == "google"
    assert not any("nominatim" in c for c in calls)


def test_refused_key_falls_through_and_is_not_retried(monkeypatch):
    _reset(monkeypatch, google="g-key")
    calls = _serve(monkeypatch, {
        "maps.googleapis.com": {"status": "REQUEST_DENIED", "error_message": "billing"},
        "nominatim.openstreetmap.org": NOMINATIM_CAMPUS,
    })
    assert geocoding.reverse(6.51, 3.39)["source"] == "openstreetmap"
    assert geocoding.reverse(6.61, 3.39)["source"] == "openstreetmap"
    assert sum("googleapis" in c for c in calls) == 1


def test_free_providers_in_order(monkeypatch):
    _reset(monkeypatch, locationiq="liq", geoapify="gfy")
    geoapify = {"results": [{
        "housenumber": "3", "street": "Allen Avenue", "suburb": "Allen",
        "city": "Ikeja", "state": "Lagos State", "country": "Nigeria", "country_code": "ng",
    }]}
    calls = _serve(monkeypatch, {"locationiq.com": OSError("down"), "geoapify.com": geoapify})
    place = geocoding.reverse(6.6012, 3.3515)
    assert place["street_line"] == "3 Allen Avenue"
    assert place["city"] == "Lagos" and place["district"] == "Ikeja"
    assert "Geoapify" in place["attribution"]
    assert [c for c in calls if "locationiq" in c] and not [c for c in calls if "nominatim" in c]


def test_cached_lookup_costs_one_call(monkeypatch):
    _reset(monkeypatch)
    calls = _serve(monkeypatch, {"nominatim.openstreetmap.org": NOMINATIM_CAMPUS})
    geocoding.reverse(6.51798, 3.39962)
    geocoding.reverse(6.51801, 3.39959)  # within about 11 m: same key
    assert len(calls) == 1


def test_everything_down_returns_none(monkeypatch):
    _reset(monkeypatch)
    _serve(monkeypatch, {})
    assert geocoding.reverse(6.5, 3.4) is None


def test_endpoint(monkeypatch):
    from fastapi.testclient import TestClient
    from main import app

    client = TestClient(app)
    _reset(monkeypatch)
    _serve(monkeypatch, {"nominatim.openstreetmap.org": NOMINATIM_CAMPUS})
    res = client.get("/v1/geo/reverse", params={"lat": 6.5179853, "lon": 3.3996222})
    assert res.status_code == 200
    assert res.json()["city"] == "Lagos"

    _reset(monkeypatch)
    _serve(monkeypatch, {})
    assert client.get("/v1/geo/reverse", params={"lat": 6.1, "lon": 3.1}).status_code == 404
    assert client.get("/v1/geo/reverse", params={"lat": 120, "lon": 3.4}).status_code == 422
