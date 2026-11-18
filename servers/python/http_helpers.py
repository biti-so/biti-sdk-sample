import math

from flask import current_app, request


def settings():
    return current_app.config["DARYEEL"]


def biti():
    return settings()["biti"]


def json_body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def to_number(value):
    """Like JavaScript Number(): NaN when it is not a number."""
    if value is None or isinstance(value, bool):
        return math.nan if value is None else float(value)
    try:
        number = float(value)
    except (TypeError, ValueError):
        return math.nan
    return int(number) if number.is_integer() and abs(number) < 1e15 else number


def return_url(page_path):
    """A return URL for Biti's web pages, only when this request came from an allowed origin."""
    origin = f"{request.scheme}://{request.host}"
    return f"{origin}{page_path}" if origin in settings()["app_origins"] else None
