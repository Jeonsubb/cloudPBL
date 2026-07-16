"""Canonical shipping route catalog shared by API and Agent code."""

import re
import unicodedata


ROUTES = {
    "composite": {"label": "종합", "aliases": ("전체", "종합지수")},
    "us_west": {"label": "미주서안", "aliases": ("미서안", "북미서안", "uswc")},
    "us_east": {"label": "미주동안", "aliases": ("미동안", "북미동안", "usec")},
    "europe": {"label": "유럽", "aliases": ("북유럽",)},
    "mediterranean": {"label": "지중해", "aliases": ()},
    "middle_east": {"label": "중동", "aliases": ("페르시아만",)},
    "oceania": {"label": "오세아니아", "aliases": ("호주", "뉴질랜드")},
    "latin_america_east": {"label": "남미동안", "aliases": ("중남미동안",)},
    "latin_america_west": {"label": "남미서안", "aliases": ("중남미서안",)},
    "south_america": {"label": "남미", "aliases": ("중남미",)},
    "south_africa": {"label": "남아프리카", "aliases": ("남아공",)},
    "west_africa": {"label": "서아프리카", "aliases": ()},
    "africa": {"label": "아프리카", "aliases": ()},
    "china": {"label": "중국", "aliases": ()},
    "japan": {"label": "일본", "aliases": ()},
    "korea": {"label": "한국", "aliases": ("대한민국",)},
    "sea": {"label": "동남아", "aliases": ("동남아시아", "southeastasia")},
}


def _alias_key(value):
    normalized = unicodedata.normalize("NFKC", str(value)).strip().lower()
    return re.sub(r"[\s_./:→>\-–—]+", "", normalized)


def _build_aliases():
    aliases = {}
    for code, route in ROUTES.items():
        values = (code, route["label"], *route["aliases"])
        for value in values:
            aliases[_alias_key(value)] = code
            aliases[_alias_key(f"부산-{value}")] = code
    return aliases


ROUTE_ALIASES = _build_aliases()


def normalize_route(value, default=None):
    """Convert a route label or alias to a canonical project route code."""
    if value not in (None, ""):
        route_code = ROUTE_ALIASES.get(_alias_key(value))
        if route_code:
            return route_code
    if default is not None:
        return default

    supported = ", ".join(route["label"] for route in ROUTES.values())
    raise ValueError(f"지원하지 않는 항로입니다. 지원 항로: {supported}")


def route_label(route_code):
    route = ROUTES.get(route_code)
    return route["label"] if route else route_code
